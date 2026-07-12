import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/User.js';
import { Company } from '../models/Company.js';
import { Order } from '../models/Order.js';
import { Lead } from '../models/Lead.js';
import { Attendance } from '../models/Attendance.js';
import { tenantScope, tenantCompanyId } from '../middleware/auth.js';

// Local YYYY-MM-DD (office-local day) to match attendance records.
const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const listUsers = asyncHandler(async(req, res) => {
    const scope = tenantScope(req);
    const users = await User.find({...scope, role: { $ne: 'developer' } })
        .select('+visiblePassword')
        .sort({ createdAt: 1 });
    // Order counts must be scoped to the same company so one tenant's order
    // volume can never bleed into another's user list.
    const counts = await Order.aggregate([
        ...(scope.company ? [{ $match: { company: scope.company } }] : []),
        { $group: { _id: '$salesperson', n: { $sum: 1 } } },
    ]);
    const map = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
    res.json({
        success: true,
        // `password` is the admin-visible copy (Option B). This route is admin-only,
        // so it is never exposed to sales users.
        users: users.map((u) => ({...u.toSafeJSON(), orders: map[String(u._id)] || 0, password: u.visiblePassword || '' })),
    });
});

export const getUserDetail = asyncHandler(async(req, res) => {
    const user = await User.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!user) throw new ApiError(404, 'User not found');

    // Local day boundaries (server-local). We look up by stored date string
    // first, then fall back to the most recent record whose loginTime is within
    // today — this tolerates any date-string/timezone drift between how the
    // record was stamped at clock-in and how "today" is computed here.
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const [attByDate, orderAgg, leadCount, wonCount] = await Promise.all([
        Attendance.findOne({ user: user._id, company: user.company, date: todayStr() }).lean(),
        Order.aggregate([
            { $match: { salesperson: user._id, company: user.company } },
            { $group: { _id: null, n: { $sum: 1 }, revenue: { $sum: '$grandTotal' } } },
        ]),
        Lead.countDocuments({ owner: user._id, company: user.company }),
        Lead.countDocuments({ owner: user._id, company: user.company, $or: [{ status: 'Won' }, { converted: true }] }),
    ]);

    let att = attByDate;
    // Fallback 1: a record whose loginTime is sometime today, even if its
    // stored `date` string doesn't match (timezone/format drift).
    if (!att) {
        att = await Attendance.findOne({
            user: user._id,
            company: user.company,
            loginTime: { $gte: startOfDay, $lte: endOfDay },
        }).sort({ loginTime: -1 }).lean();
    }
    // Fallback 2: an open session (clocked in, not yet out) regardless of date —
    // covers an overnight shift that began before midnight.
    if (!att) {
        att = await Attendance.findOne({
            user: user._id,
            company: user.company,
            loginTime: { $ne: null },
            logoutTime: null,
            status: { $in: ['active', 'on_break'] },
        }).sort({ loginTime: -1 }).lean();
    }

    // Derive a human "working status" from the attendance record.
    let working = 'Not clocked in';
    if (att) {
        const openSession = att.loginTime && !att.logoutTime;
        if (att.status === 'on_break' && openSession) working = 'On break';
        else if (openSession) working = 'Working';
        else if (att.logoutTime) working = 'Clocked out';
    }

    const o = orderAgg[0] || { n: 0, revenue: 0 };
    res.json({
        success: true,
        user: user.toSafeJSON(),
        createdAt: user.createdAt,
        working,
        attendance: att ? {
            status: att.status,
            loginTime: att.loginTime,
            logoutTime: att.logoutTime,
            totalWorkMinutes: att.totalWorkMinutes || 0,
            totalBreakMinutes: att.totalBreakMinutes || 0,
            onBreak: (att.breaks || []).some((b) => !b.endTime),
        } : null,
        stats: {
            orders: o.n,
            revenue: Number((o.revenue || 0).toFixed(2)),
            leads: leadCount,
            won: wonCount,
            convRate: leadCount ? Math.round((wonCount / leadCount) * 100) : 0,
        },
    });
});


export const createUser = asyncHandler(async(req, res) => {
    const { name, username, password } = req.body;
    const role = req.body.role === 'admin' ? 'admin' : 'sales'; // never create developers here
    const exists = await User.findOne({ username: username.toLowerCase() });
    if (exists) throw new ApiError(409, 'Username already taken');

    // Which company this user will belong to.
    const companyId = tenantCompanyId(req);

    // Enforce the company's limits (0 = unlimited).
    const company = await Company.findById(companyId);
    if (!company) throw new ApiError(404, 'Company not found');
    if (!company.active) throw new ApiError(403, 'This company is deactivated');

    const field = role === 'admin' ? 'maxAdmins' : 'maxEmployees';
    const rawLimit = company.limits ? company.limits[field] : undefined;
    const limit = rawLimit != null ? rawLimit : 0;
    if (limit > 0) {
        const current = await User.countDocuments({ company: companyId, role, active: true });
        if (current >= limit) {
            throw new ApiError(403, `Limit reached: this company allows a maximum of ${limit} ${role === 'admin' ? 'admin(s)' : 'employee(s)'}.`);
        }
    }

    const { email } = req.body;
    const user = await User.create({
        name,
        username,
        password,
        role,
        company: companyId,
        email: email ? email.toLowerCase().trim() : '',
        clockInLocation: sanitizeClockInLocation(req.body.clockInLocation),
        locationTracking: sanitizeTracking(req.body.locationTracking),
    });
    res.status(201).json({ success: true, user: user.toSafeJSON() });
});

// Whitelist + coerce the per-employee clock-in location override.
function sanitizeClockInLocation(loc) {
    if (!loc || typeof loc !== 'object') return undefined;
    const lat = loc.lat === '' || loc.lat == null ? null : Number(loc.lat);
    const lng = loc.lng === '' || loc.lng == null ? null : Number(loc.lng);
    return {
        enabled: !!loc.enabled && lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng),
        lat: Number.isNaN(lat) ? null : lat,
        lng: Number.isNaN(lng) ? null : lng,
        label: typeof loc.label === 'string' ? loc.label.trim().slice(0, 80) : '',
    };
}

// Whitelist + coerce the per-employee live-location tracking rule.
function sanitizeTracking(t) {
    if (!t || typeof t !== 'object') return undefined;
    const allowed = [15, 30, 60];
    let interval = Number(t.intervalMinutes);
    if (allowed.indexOf(interval) === -1) interval = 30;
    return { enabled: !!t.enabled, intervalMinutes: interval };
}

export const updateUser = asyncHandler(async(req, res) => {
    const user = await User.findOne({ _id: req.params.id, ...tenantScope(req) }).select('+password');
    if (!user) throw new ApiError(404, 'User not found');
    const { name, password, active } = req.body;
    if (name !== undefined) user.name = name;
    if (active !== undefined) user.active = active;
    if (password) user.password = password;
    if (req.body.email !== undefined) user.email = String(req.body.email || '').toLowerCase().trim();
    if (req.body.clockInLocation !== undefined) {
        user.clockInLocation = sanitizeClockInLocation(req.body.clockInLocation);
    }
    if (req.body.locationTracking !== undefined) {
        user.locationTracking = sanitizeTracking(req.body.locationTracking);
    }
    await user.save();
    res.json({ success: true, user: user.toSafeJSON() });
});

export const deleteUser = asyncHandler(async(req, res) => {
    const user = await User.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!user) throw new ApiError(404, 'User not found');
    if (user.username === 'admin') throw new ApiError(400, 'Cannot delete the primary admin');
    if (String(user._id) === String(req.user._id)) throw new ApiError(400, 'Cannot delete yourself');
    await user.deleteOne();
    res.json({ success: true, message: 'User removed' });
});