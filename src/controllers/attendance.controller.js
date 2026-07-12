import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Attendance } from '../models/Attendance.js';
import { AttendanceConfig } from '../models/AttendanceConfig.js';
import { tenantScope, tenantCompanyId } from '../middleware/auth.js';
import { User } from '../models/User.js';

// ── Helpers ────────────────────────────────────────────────────────────────
// Local-date string (not UTC) so the day boundary matches the office's clock
// rather than shifting at UTC midnight.
const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Great-circle distance between two lat/lng points, in metres.
const haversineMeters = (lat1, lng1, lat2, lng2) => {
    const R = 6371000; // earth radius (m)
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
};

// Fallback defaults if no config doc exists yet (mirror the model defaults).
const DEFAULT_CFG = {
    lateAfterMinutes: 9 * 60 + 30,
    halfDayMinMinutes: 240,
    fullDayMinMinutes: 480,
    weeklyOffDays: [0],
    holidays: [],
};

// Status is now derived against the admin-configured rules (cfg). When no
// login exists we still respect weekly-off and holidays so those days aren't
// shown as plain "absent".
const deriveStatus = (rec, cfg = DEFAULT_CFG) => {
    if (rec.crmStatus) return rec.crmStatus; // manual override wins

    const holiday = (cfg.holidays || []).some((h) => h.date === rec.date);

    if (!rec.loginTime) {
        if (holiday) return 'holiday';
        const dow = new Date(`${rec.date}T00:00:00`).getDay();
        if ((cfg.weeklyOffDays || []).includes(dow)) return 'leave';
        return 'absent';
    }

    const t = new Date(rec.loginTime);
    const minutesIntoDay = t.getHours() * 60 + t.getMinutes();
    if (minutesIntoDay > cfg.lateAfterMinutes) return 'late';
    if (rec.totalWorkMinutes > 0 && rec.totalWorkMinutes < cfg.halfDayMinMinutes) return 'half_day';
    return 'present';
};

const formatHrs = (mins) => {
    const m = Math.max(0, mins || 0);
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

const enrich = (rec, cfg = DEFAULT_CFG) => ({
    ...rec,
    derivedStatus: deriveStatus(rec, cfg),
    workingHours: formatHrs(rec.totalWorkMinutes),
});

// ── Self-service: clock in / out / break (any authenticated user) ──────────

export const clockIn = asyncHandler(async(req, res) => {
    const date = todayStr();
    const companyId = tenantCompanyId(req);

    // ── Geofence enforcement ──────────────────────────────────────────────
    // Each employee may have their OWN clock-in location (clockInLocation.enabled).
    // If set, it overrides the company office geofence — but the allowed radius is
    // still the company's configured radius. Otherwise the company office applies.
    const cfg = await AttendanceConfig.getForCompany(companyId);

    const emp = req.user.clockInLocation || {};
    const usingEmployeeLoc = !!(emp.enabled && emp.lat != null && emp.lng != null);
    const companyRadius = (cfg.office && cfg.office.radiusMeters) || 100;

    const fence = usingEmployeeLoc ?
        { lat: emp.lat, lng: emp.lng, radiusMeters: companyRadius, label: emp.label || 'your assigned location' } :
        (cfg.office && cfg.office.enabled && cfg.office.lat != null && cfg.office.lng != null) ?
        { lat: cfg.office.lat, lng: cfg.office.lng, radiusMeters: cfg.office.radiusMeters, label: 'the office' } :
        null;

    const body = req.body || {};
    const hasCoords = typeof body.lat === 'number' && typeof body.lng === 'number';
    const capturedLoc = hasCoords ?
        { lat: body.lat, lng: body.lng, accuracy: typeof body.accuracy === 'number' ? body.accuracy : null, at: new Date() } :
        null;

    if (fence) {
        if (!hasCoords) {
            throw new ApiError(400, 'Location required to clock in. Please enable location access and try again.');
        }
        const distance = haversineMeters(body.lat, body.lng, fence.lat, fence.lng);
        if (distance > fence.radiusMeters) {
            throw new ApiError(
                403,
                `You are ${Math.round(distance)}m from ${fence.label}. You must be within ${fence.radiusMeters}m to clock in.`
            );
        }
    }

    let record = await Attendance.findOne({ user: req.user._id, date, company: companyId });

    if (record && record.loginTime && !record.logoutTime) {
        throw new ApiError(400, 'Already clocked in for today');
    }

    if (record && record.loginTime) {
        // Re-clock-in the same day: resume the existing session rather than
        // resetting loginTime, so the original start time and accrued work
        // are preserved.
        record.logoutTime = null;
        record.status = 'active';
        record.crmStatus = null;
        if (capturedLoc) record.loginLocation = capturedLoc;
        await record.save();
    } else if (record) {
        record.loginTime = new Date();
        record.status = 'active';
        if (capturedLoc) record.loginLocation = capturedLoc;
        await record.save();
    } else {
        record = await Attendance.create({
            company: companyId,
            user: req.user._id,
            date,
            loginTime: new Date(),
            status: 'active',
            loginLocation: capturedLoc,
        });
    }

    res.json({ success: true, record });
});

export const clockOut = asyncHandler(async(req, res) => {
    const date = todayStr();
    const record = await Attendance.findOne({ user: req.user._id, date, company: req.user.company });
    if (!record || !record.loginTime) throw new ApiError(400, 'Not clocked in');
    if (record.logoutTime) throw new ApiError(400, 'Already clocked out');

    // Capture where the employee clocked out (no geofence enforced on the way out).
    const body = req.body || {};
    if (typeof body.lat === 'number' && typeof body.lng === 'number') {
        record.logoutLocation = {
            lat: body.lat,
            lng: body.lng,
            accuracy: typeof body.accuracy === 'number' ? body.accuracy : null,
            at: new Date(),
        };
    }

    // Close any open break first
    const openBreak = record.breaks.find((b) => !b.endTime);
    if (openBreak) openBreak.endTime = new Date();

    record.logoutTime = new Date();
    record.status = 'logged_out';
    record.recalcBreakMinutes();
    const elapsed = Math.round((record.logoutTime - record.loginTime) / 60000);
    record.totalWorkMinutes = Math.max(0, elapsed - record.totalBreakMinutes);
    await record.save();

    res.json({ success: true, record });
});

export const startBreak = asyncHandler(async(req, res) => {
    const date = todayStr();
    const record = await Attendance.findOne({ user: req.user._id, date, company: req.user.company });
    if (!record || !record.loginTime || record.logoutTime) throw new ApiError(400, 'Not clocked in');
    if (record.breaks.some((b) => !b.endTime)) throw new ApiError(400, 'Already on break');

    record.breaks.push({ startTime: new Date(), reason: req.body.reason || 'Break' });
    record.status = 'on_break';
    await record.save();
    res.json({ success: true, record });
});

export const endBreak = asyncHandler(async(req, res) => {
    const date = todayStr();
    const record = await Attendance.findOne({ user: req.user._id, date, company: req.user.company });
    const openBreak = record && record.breaks.find((b) => !b.endTime);
    if (!record || !openBreak) throw new ApiError(400, 'Not on break');

    openBreak.endTime = new Date();
    record.recalcBreakMinutes();
    record.status = 'active';
    await record.save();
    res.json({ success: true, record });
});

export const getMyToday = asyncHandler(async(req, res) => {
    const record = await Attendance.findOne({ user: req.user._id, date: todayStr(), company: req.user.company });
    res.json({ success: true, record: record || null });
});

// ── Admin: attendance management table ──────────────────────────────────────

export const getReport = asyncHandler(async(req, res) => {
    const today = todayStr();
    const { startDate = today, endDate = today, userId, status } = req.query;

    const companyId = req.user.role === 'developer' ?
        (req.query.company || null) :
        req.user.company;

    const userQuery = req.user.role === 'sales' ?
        { _id: req.user._id } :
        {...(companyId ? { company: companyId } : {}), role: 'sales' }; // admins are not tracked in attendance
    const users = await User.find(userQuery).select('name username role active');
    const userIds = users.map((u) => String(u._id));

    const query = { date: { $gte: startDate, $lte: endDate } };
    if (companyId) query.company = companyId;
    if (userId) {
        if (!userIds.includes(String(userId))) return res.json({ success: true, records: [] });
        query.user = userId;
    } else {
        query.user = { $in: userIds };
    }

    const records = await Attendance.find(query)
        .populate('user', 'name username')
        .sort({ date: -1, createdAt: -1 })
        .lean();

    // Use the company's config; fall back to defaults when developer views "all".
    const cfg = companyId ?
        await AttendanceConfig.getForCompany(companyId) :
        { lateAfterMinutes: 570, halfDayMinMinutes: 240, fullDayMinMinutes: 480, weeklyOffDays: [0], holidays: [], office: {} };
    let enriched = records.map((r) => enrich(r, cfg));

    // Synthetic "absent" rows for users with no record, single-day view only
    if (!userId && startDate === endDate) {
        const recorded = new Set(records.map((r) => String((r.user && r.user._id) || r.user)));
        const absentUsers = users.filter((u) => !recorded.has(String(u._id)) && u.active);
        enriched = enriched.concat(
            absentUsers.map((u) => {
                const base = {
                    _id: null,
                    user: { _id: u._id, name: u.name, username: u.username },
                    date: startDate,
                    loginTime: null,
                    logoutTime: null,
                    totalWorkMinutes: 0,
                    totalBreakMinutes: 0,
                    breaks: [],
                    remarks: '',
                };
                return {...base, derivedStatus: deriveStatus(base, cfg), workingHours: '0h 00m' };
            })
        );
    }

    if (status) enriched = enriched.filter((r) => r.derivedStatus === status);

    res.json({ success: true, records: enriched });
});

export const listAttendanceUsers = asyncHandler(async(req, res) => {
    const userQuery = req.user.role === 'sales' ?
        { _id: req.user._id } :
        {...tenantScope(req), active: true, role: 'sales' }; // admins excluded from attendance
    const users = await User.find(userQuery).select('name username').sort({ name: 1 });
    res.json({ success: true, users });
});

// Create or correct a day's record for a given user (covers synthetic
// "absent" rows that have no _id yet, and lets admin backfill leave/holiday).
export const upsertAttendance = asyncHandler(async(req, res) => {
    const { user, date, loginTime, logoutTime, crmStatus, remarks } = req.body;

    const target = await User.findOne({ _id: user, ...tenantScope(req) });
    if (!target) throw new ApiError(404, 'User not found');
    const companyId = target.company;

    let record = await Attendance.findOne({ user, date, company: companyId });
    if (!record) record = new Attendance({ company: companyId, user, date, breaks: [] });

    if (loginTime !== undefined) record.loginTime = loginTime ? new Date(loginTime) : null;
    if (logoutTime !== undefined) record.logoutTime = logoutTime ? new Date(logoutTime) : null;
    if (crmStatus !== undefined) record.crmStatus = crmStatus || null;
    if (remarks !== undefined) record.remarks = remarks;

    if (record.loginTime && record.logoutTime) {
        record.recalcBreakMinutes();
        const elapsed = Math.round((record.logoutTime - record.loginTime) / 60000);
        record.totalWorkMinutes = Math.max(0, elapsed - record.totalBreakMinutes);
        record.status = 'logged_out';
    }

    await record.save();
    res.json({ success: true, record });
});

export const updateAttendance = asyncHandler(async(req, res) => {
    const record = await Attendance.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!record) throw new ApiError(404, 'Attendance record not found');

    const { loginTime, logoutTime, crmStatus, remarks } = req.body;
    if (loginTime !== undefined) record.loginTime = loginTime ? new Date(loginTime) : null;
    if (logoutTime !== undefined) record.logoutTime = logoutTime ? new Date(logoutTime) : null;
    if (crmStatus !== undefined) record.crmStatus = crmStatus || null;
    if (remarks !== undefined) record.remarks = remarks;

    if (record.loginTime && record.logoutTime) {
        record.recalcBreakMinutes();
        const elapsed = Math.round((record.logoutTime - record.loginTime) / 60000);
        record.totalWorkMinutes = Math.max(0, elapsed - record.totalBreakMinutes);
        record.status = 'logged_out';
    }

    await record.save();
    res.json({ success: true, record });
});

export const deleteAttendance = asyncHandler(async(req, res) => {
    const record = await Attendance.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!record) throw new ApiError(404, 'Attendance record not found');
    await record.deleteOne();
    res.json({ success: true, message: 'Attendance record deleted' });
});

// ── Admin: attendance rules / config ────────────────────────────────────────

export const getConfig = asyncHandler(async(req, res) => {
    const cfg = await AttendanceConfig.getForCompany(tenantCompanyId(req));
    res.json({ success: true, config: cfg });
});

export const saveConfig = asyncHandler(async(req, res) => {
    const {
        lateAfterMinutes,
        halfDayMinMinutes,
        fullDayMinMinutes,
        weeklyOffDays,
        holidays,
        office,
    } = req.body;

    const update = {};
    if (lateAfterMinutes !== undefined) update.lateAfterMinutes = lateAfterMinutes;
    if (halfDayMinMinutes !== undefined) update.halfDayMinMinutes = halfDayMinMinutes;
    if (fullDayMinMinutes !== undefined) update.fullDayMinMinutes = fullDayMinMinutes;
    if (weeklyOffDays !== undefined) update.weeklyOffDays = weeklyOffDays;
    if (holidays !== undefined) update.holidays = holidays;
    if (office !== undefined) {
        update.office = {
            enabled: !!office.enabled,
            lat: office.lat === '' || office.lat == null ? null : Number(office.lat),
            lng: office.lng === '' || office.lng == null ? null : Number(office.lng),
            radiusMeters: Number(office.radiusMeters) || 100,
        };
    }

    const companyId = tenantCompanyId(req);
    const cfg = await AttendanceConfig.findOneAndUpdate({ company: companyId }, { $set: update, $setOnInsert: { company: companyId } }, { new: true, upsert: true, setDefaultsOnInsert: true });
    res.json({ success: true, config: cfg });
});
