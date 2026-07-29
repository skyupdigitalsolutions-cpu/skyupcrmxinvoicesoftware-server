import { asyncHandler } from '../utils/asyncHandler.js';
import { Order } from '../models/Order.js';
import { Invoice } from '../models/Invoice.js';
import { Lead, LEAD_STATUSES, LEAD_SOURCES } from '../models/Lead.js';
import { Attendance } from '../models/Attendance.js';
import { AttendanceConfig } from '../models/AttendanceConfig.js';
import { User } from '../models/User.js';
import { tenantScope, tenantCompanyId } from '../middleware/auth.js';

// A lead counts as a "buyer"/conversion once it is marked Won OR has been
// converted into an order. convertLead sets BOTH, but a lead can also be marked
// Won manually (without an order), so both conditions must be checked. Using
// only `converted` (as the dashboard previously did) made the Buyers stat and
// the Buyers-over-time chart under-report and disagree with the Won status
// count / pipeline on the same page. This is the single source of truth.
const isBuyer = (l) => l.status === 'Won' || l.converted === true;

const buildRange = (period, from, to) => {
    const now = new Date();
    let start, end = new Date();
    if (from || to) {
        start = from ? new Date(from) : new Date(0);
        end = to ? new Date(to) : new Date();
        end.setHours(23, 59, 59, 999);
        return { start, end };
    }
    switch (period) {
        case 'today':
            start = new Date(now.setHours(0, 0, 0, 0));
            break;
        case 'week':
            { const d = new Date();d.setDate(d.getDate() - 7);start = d; break; }
        case 'month':
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        case 'year':
            start = new Date(now.getFullYear(), 0, 1);
            break;
        default:
            return null; // all time
    }
    return { start, end };
};

// Local YYYY-MM-DD key for a date (office-local day, not UTC).
const dayKey = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

// Build ordered time buckets for the leads-over-time chart based on range.
// Returns { buckets:[{key,label}], keyOf:(date)=>bucketKey }.
const buildBuckets = (range) => {
    const now = new Date();
    if (range === 'monthly') {
        // Last 6 calendar months.
        const buckets = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-US', { month: 'short' }) });
        }
        const keyOf = (date) => { const x = new Date(date); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };
        return { buckets, keyOf };
    }
    if (range === 'weekly') {
        // Last 8 weeks (week starts Monday). Key = the week's Monday date.
        const monday = (d) => {
            const x = new Date(d);
            const day = (x.getDay() + 6) % 7;
            x.setDate(x.getDate() - day);
            x.setHours(0, 0, 0, 0);
            return x;
        };
        const buckets = [];
        for (let i = 7; i >= 0; i--) {
            const m = monday(now);
            m.setDate(m.getDate() - i * 7);
            buckets.push({ key: dayKey(m), label: m.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }) });
        }
        const keyOf = (date) => dayKey(monday(date));
        return { buckets, keyOf };
    }
    // daily (default): last 7 days.
    const buckets = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        buckets.push({ key: dayKey(d), label: d.toLocaleDateString('en-US', { weekday: 'short' }) });
    }
    return { buckets, keyOf: (date) => dayKey(date) };
};

// ── Attendance helpers (mirrors attendance.controller.js logic) ─────────────
const DEFAULT_ATT_CFG = {
    lateAfterMinutes: 9 * 60 + 30,
    halfDayMinMinutes: 240,
    fullDayMinMinutes: 480,
    weeklyOffDays: [0],
    holidays: [],
};

const deriveAttendanceStatus = (rec, cfg = DEFAULT_ATT_CFG) => {
    if (rec.crmStatus) return rec.crmStatus;
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

const formatWorkHrs = (mins) => {
    const m = Math.max(0, mins || 0);
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

export const dashboard = asyncHandler(async(req, res) => {
    const t = tenantScope(req);
    const isSales = req.user.role === 'sales';
    const orderScope = isSales ? {...t, salesperson: req.user._id } : t;
    const leadScope = isSales ? {...t, owner: req.user._id } : t;

    const [orders, leads] = await Promise.all([
        Order.find(orderScope).sort({ createdAt: -1 }),
        Lead.find(leadScope).sort({ createdAt: -1 }),
    ]);

    // ── Orders ────────────────────────────────────────────────────────────────
    const byStatus = {};
    const byCountry = {};
    let totalRevenue = 0,
        due = 0;
    orders.forEach((o) => {
        byStatus[o.status] = (byStatus[o.status] || 0) + 1;
        byCountry[o.country] = (byCountry[o.country] || 0) + 1;
        totalRevenue += o.grandTotal;
        due += o.due || 0;
    });

    // ── Leads ─────────────────────────────────────────────────────────────────
    const leadByStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
    const leadBySource = Object.fromEntries(LEAD_SOURCES.map((s) => [s, 0]));
    const campaigns = new Set();
    let buyers = 0;
    leads.forEach((l) => {
        if (leadByStatus[l.status] !== undefined) leadByStatus[l.status] += 1;
        if (leadBySource[l.source] !== undefined) leadBySource[l.source] += 1;
        if (l.campaign) campaigns.add(l.campaign.trim().toLowerCase());
        if (isBuyer(l)) buyers += 1;
    });

    // Drop zero-count sources so the bars only show real channels.
    const activeSources = Object.fromEntries(Object.entries(leadBySource).filter(([, v]) => v > 0));

    // Leads-over-time: new vs buyers, bucketed by range (daily/weekly/monthly).
    const range = ['daily', 'weekly', 'monthly'].includes(req.query.range) ? req.query.range : 'daily';
    const { buckets, keyOf } = buildBuckets(range);
    const idx = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    const newSeries = buckets.map(() => 0);
    const convSeries = buckets.map(() => 0);
    leads.forEach((l) => {
        const created = idx[keyOf(l.createdAt)];
        if (created !== undefined) newSeries[created] += 1;
        if (isBuyer(l)) {
            const conv = idx[keyOf(l.updatedAt)];
            if (conv !== undefined) convSeries[conv] += 1;
        }
    });
    const leadsOverTime = buckets.map((b, i) => ({ label: b.label, date: b.key, newLeads: newSeries[i], converted: convSeries[i] }));

    // Top employees by lead count (admin only — employees see just themselves).
    // Group by the stable owner ID, not the per-lead ownerName snapshot —
    // that snapshot is written once at assignment time and goes stale if the
    // user's name/username is changed later, which used to split one person
    // into two separate rows (old leads under the old name, new leads under
    // the new one). Resolving the CURRENT name after grouping keeps one row
    // per person regardless of how many times their name has changed.
    const empMap = {};
    leads.forEach((l) => {
        const key = String(l.owner || 'unknown');
        if (!empMap[key]) empMap[key] = { key, leads: 0, converted: 0 };
        empMap[key].leads += 1;
        if (isBuyer(l)) empMap[key].converted += 1;
    });
    const ownerIds = Object.keys(empMap).filter((k) => k !== 'unknown');
    const owners = ownerIds.length ? await User.find({ _id: { $in: ownerIds } }).select('name').lean() : [];
    const nameById = new Map(owners.map((u) => [String(u._id), u.name]));
    const topEmployees = Object.values(empMap)
        .map((e) => ({ name: nameById.get(e.key) || 'Unknown', leads: e.leads, converted: e.converted }))
        .sort((a, b) => b.leads - a.leads)
        .slice(0, 6);

    res.json({
        success: true,
        stats: {
            totalOrders: orders.length,
            pending: byStatus['Pending'] || 0,
            delivered: byStatus['Delivered'] || 0,
            invoiced: byStatus['Invoiced'] || 0,
            totalRevenue: Number(totalRevenue.toFixed(2)),
            due: Number(due.toFixed(2)),
            totalLeads: leads.length,
            buyers,
            sources: Object.keys(activeSources).length,
            campaigns: campaigns.size,
        },
        byStatus,
        byCountry,
        leads: {
            byStatus: leadByStatus,
            bySource: activeSources,
            overTime: leadsOverTime,
            overTimeRange: range,
            topEmployees,
        },
        recentOrders: orders.slice(0, 8),
        recentLeads: leads.slice(0, 8).map((l) => ({
            _id: l._id,
            name: l.name,
            status: l.status,
            ownerName: l.ownerName,
            source: l.source,
            createdAt: l.createdAt,
        })),
        recentUpdates: orders
            .flatMap((o) => o.statusHistory.map((h) => ({ orderNo: o.orderNo, customer: o.customer, ...(typeof h.toObject === "function" ? h.toObject() : h) })))
            .sort((a, b) => new Date(b.at) - new Date(a.at))
            .slice(0, 8),
    });
});

export const salesReport = asyncHandler(async(req, res) => {
    const { period, from, to, employee, country } = req.query;
    const range = buildRange(period, from, to);
    const t = tenantScope(req);

    // `employee` must be a valid Mongo ObjectId (a user id). Older clients
    // occasionally sent a name here, which made User.findOne({_id: name}) throw
    // a CastError → 400 and broke the whole report. Treat anything that isn't a
    // 24-hex id as "no employee filter" so the report still renders.
    const validEmployee = employee && /^[0-9a-fA-F]{24}$/.test(String(employee)) ? employee : null;

    const match = {...t };
    if (range) match.date = { $gte: range.start, $lte: range.end };
    if (validEmployee) match.salesperson = validEmployee;
    if (country) match.country = country;

    const invoiceMatch = {...t, ...(range ? { date: { $gte: range.start, $lte: range.end } } : {}) };
    if (country) invoiceMatch.country = country;
    let employeeName = null;
    if (validEmployee) {
        const u = await User.findOne({ _id: validEmployee, ...t }).select('name').lean();
        employeeName = (u && u.name) || null;
        if (employeeName) invoiceMatch.salespersonName = employeeName;
    }

    const orders = await Order.find(match);
    const invoices = await Invoice.find(invoiceMatch);

    const bySalespersonMap = {};
    const byCountry = {};
    const byStatus = {};
    let revenue = 0,
        units = 0;

    orders.forEach((o) => {
        revenue += o.grandTotal;
        const u = o.items.reduce((s, it) => s + it.qty, 0);
        units += u;
        // Group by the stable salesperson ID, not the per-order salespersonName
        // snapshot — that snapshot is written once when the order is created
        // and goes stale if the user's name/username is changed later, which
        // used to split one person into two separate rows in this panel
        // (same issue as the Top Employees widget above).
        const key = String(o.salesperson || 'unknown');
        if (!bySalespersonMap[key]) bySalespersonMap[key] = { orders: 0, revenue: 0 };
        bySalespersonMap[key].orders += 1;
        bySalespersonMap[key].revenue += o.grandTotal;
        byCountry[o.country] = (byCountry[o.country] || 0) + o.grandTotal;
        byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    });

    // Resolve each salesperson's CURRENT name after grouping, so a later
    // name/username change can't split them into two rows.
    const spIds = Object.keys(bySalespersonMap).filter((k) => k !== 'unknown');
    const spUsers = spIds.length ? await User.find({ _id: { $in: spIds } }).select('name').lean() : [];
    const spNameById = new Map(spUsers.map((u) => [String(u._id), u.name]));
    const bySalesperson = {};
    Object.entries(bySalespersonMap).forEach(([key, val]) => {
        const name = key === 'unknown' ? '—' : (spNameById.get(key) || '—');
        bySalesperson[name] = bySalesperson[name] || { orders: 0, revenue: 0 };
        bySalesperson[name].orders += val.orders;
        bySalesperson[name].revenue += val.revenue;
    });

    const vatCollected = invoices.reduce((s, v) => s + v.vatAmt, 0);

    res.json({
        success: true,
        period: range ? { from: range.start, to: range.end } : null,
        summary: {
            totalOrders: orders.length,
            totalRevenue: Number(revenue.toFixed(2)),
            totalUnits: units,
            totalInvoices: invoices.length,
            vatCollected: Number(vatCollected.toFixed(2)),
            invoicedRevenue: Number(invoices.reduce((s, v) => s + v.total, 0).toFixed(2)),
        },
        bySalesperson,
        byCountry,
        byStatus,
    });
});

// ── Admin Daily Report (/reports/daily?date=YYYY-MM-DD) ─────────────────────
// Single source of truth for the DailyReport page. Counts leads created on the
// given day, plus follow-ups due relative to that day. Admin sees everyone;
// other roles see only their own leads.
export const dailyReport = asyncHandler(async(req, res) => {
    const t = tenantScope(req);
    const scope = req.user.role === 'sales' ? {...t, owner: req.user._id } : t;

    // Resolve the target day [start, end] in server-local time.
    const base = req.query.date ? new Date(`${req.query.date}T00:00:00`) : new Date();
    const start = new Date(base);
    start.setHours(0, 0, 0, 0);
    const end = new Date(base);
    end.setHours(23, 59, 59, 999);
    const prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 1);
    const prevEnd = new Date(end);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const dateKey = dayKey(start);

    const [dayLeads, prevLeads, allOpen, dayOrders, dayInvoices, attendanceUsers, attendanceRecords] = await Promise.all([
        Lead.find({...scope, createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 }).lean(),
        Lead.find({...scope, createdAt: { $gte: prevStart, $lte: prevEnd } }).lean(),
        // Open follow-ups: scheduled, not yet Won/Lost.
        Lead.find({...scope, followUpAt: { $ne: null }, status: { $nin: ['Won', 'Lost'] } }).sort({ followUpAt: 1 }).lean(),
        // Orders placed on the day (admin sees all; sales sees their own).
        Order.find({
            ...t,
            ...(req.user.role === 'sales' ? { salesperson: req.user._id } : {}),
            createdAt: { $gte: start, $lte: end },
        }).sort({ createdAt: -1 }).lean(),
        // Invoices raised on the day.
        // Invoices raised on the day. Sales users see only invoices they created
        // (matches the per-salesperson scoping used for orders/deliveries) so the
        // employee daily report never exposes other employees' invoices/revenue.
        Invoice.find({
            ...t,
            ...(req.user.role === 'sales' ? { createdBy: req.user._id } : {}),
            createdAt: { $gte: start, $lte: end },
        }).sort({ createdAt: -1 }).lean(),
        // Users for the employee/attendance section. Sales sees only themselves;
        // admins see all active sales staff. Admins are not tracked in attendance,
        // so they are excluded here (they get no attendance status row).
        User.find({
            ...t,
            ...(req.user.role === 'sales' ? { _id: req.user._id } : { role: 'sales' }),
        }).select('name username role active').lean(),
        // Attendance for the day. Sales sees only their own record.
        Attendance.find({
            ...t,
            ...(req.user.role === 'sales' ? { user: req.user._id } : {}),
            date: dateKey,
        }).lean(),
    ]);

    // Map real lead statuses → report display buckets.
    const isContacted = (s) => ['Contacted', 'Interested', 'Follow-up', 'Won'].includes(s);
    const isInProgress = (s) => ['Contacted', 'Interested', 'Follow-up'].includes(s);

    const count = (arr, pred) => arr.filter(pred).length;
    const total = dayLeads.length;
    const converted = count(dayLeads, (l) => isBuyer(l));
    const contacted = count(dayLeads, (l) => isContacted(l.status));
    const inProgress = count(dayLeads, (l) => isInProgress(l.status));
    const notInterested = count(dayLeads, (l) => l.status === 'Lost');
    const newLeads = count(dayLeads, (l) => l.status === 'New');
    const unassigned = count(dayLeads, (l) => !l.owner);

    const prevTotal = prevLeads.length;
    const prevConverted = count(prevLeads, (l) => isBuyer(l));

    const callsToday = dayLeads.reduce(
        (s, l) => s + (l.callLogs || []).filter((c) => new Date(c.at) >= start && new Date(c.at) <= end).length, 0
    );

    // Sources for the day.
    const srcMap = {};
    dayLeads.forEach((l) => { srcMap[l.source] = (srcMap[l.source] || 0) + 1; });
    const sources = Object.entries(srcMap).map(([label, c]) => ({ label, count: c })).sort((a, b) => b.count - a.count);

    // Per-employee activity (admin: all; employee: just self).
    const empMap = {};
    dayLeads.forEach((l) => {
        const name = l.ownerName || 'Unassigned';
        empMap[name] = empMap[name] || { name, leads: 0, callsToday: 0, inProgress: 0, converted: 0 };
        empMap[name].leads += 1;
        empMap[name].callsToday += (l.callLogs || []).filter((c) => new Date(c.at) >= start && new Date(c.at) <= end).length;
        if (isInProgress(l.status)) empMap[name].inProgress += 1;
        if (isBuyer(l)) empMap[name].converted += 1;
    });

    // Fold in attendance so every active user shows up even with zero lead
    // activity that day, and so the Employee tab can show clock-in/out + status.
    const attCfg = req.user.role === 'developer' ?
        DEFAULT_ATT_CFG :
        await AttendanceConfig.getForCompany(tenantCompanyId(req)).catch(() => DEFAULT_ATT_CFG);
    const attByUser = {};
    attendanceRecords.forEach((r) => { attByUser[String(r.user)] = r; });
    const relevantUsers = req.user.role === 'sales' ?
        attendanceUsers.filter((u) => String(u._id) === String(req.user._id)) :
        attendanceUsers;
    relevantUsers.forEach((u) => {
        const name = u.name || 'Unassigned';
        empMap[name] = empMap[name] || { name, leads: 0, callsToday: 0, inProgress: 0, converted: 0 };
        const rec = attByUser[String(u._id)];
        const derived = deriveAttendanceStatus(rec || { date: dateKey, loginTime: null }, attCfg);
        empMap[name].attendanceStatus = derived;
        empMap[name].loginTime = (rec && rec.loginTime) || null;
        empMap[name].logoutTime = (rec && rec.logoutTime) || null;
        empMap[name].workingHours = formatWorkHrs(rec && rec.totalWorkMinutes);
    });
    const employees = Object.values(empMap).sort((a, b) => b.leads - a.leads);

    // ── Orders placed on the day ────────────────────────────────────────────
    const orders = dayOrders.map((o) => ({
        _id: o._id,
        orderNo: o.orderNo,
        date: o.date,
        customer: o.customer,
        city: o.city,
        country: o.country,
        mobile: o.mobile,
        salespersonName: o.salespersonName,
        status: o.status,
        itemCount: (o.items || []).reduce((s, it) => s + (it.qty || 0), 0),
        subTotal: o.subTotal,
        discount: o.discount,
        grandTotal: o.grandTotal,
        due: o.due,
        delivery: o.delivery,
        payTerms: o.payTerms,
    }));
    const ordersRevenue = dayOrders.reduce((s, o) => s + (o.grandTotal || 0), 0);
    const ordersDue = dayOrders.reduce((s, o) => s + (o.due || 0), 0);

    // ── Invoices raised on the day ──────────────────────────────────────────
    const invoices = dayInvoices.map((v) => ({
        _id: v._id,
        invoiceNo: v.invoiceNo,
        date: v.date,
        orderNo: v.orderNo,
        customer: v.customer,
        country: v.country,
        salespersonName: v.salespersonName,
        paymentStatus: v.paymentStatus || 'Unpaid',
        subTotal: v.subTotal,
        vatAmt: v.vatAmt,
        total: v.total,
    }));
    const invoicedRevenue = dayInvoices.reduce((s, v) => s + (v.total || 0), 0);
    const vatCollected = dayInvoices.reduce((s, v) => s + (v.vatAmt || 0), 0);

    // ── Delivery activity: orders whose status moved into a delivery stage
    // (Shipped / Out for Delivery / Delivered) on this day, per statusHistory.
    const DELIVERY_STAGES = ['Shipped', 'Out for Delivery', 'Delivered'];
    const deliveryScope = req.user.role === 'sales' ? {...t, salesperson: req.user._id } : t;
    const allOrdersForDelivery = await Order.find({...deliveryScope, status: { $in: [...DELIVERY_STAGES, 'Invoiced'] } })
        .select('orderNo customer city country mobile salespersonName status delivery statusHistory')
        .lean();
    const deliveries = [];
    allOrdersForDelivery.forEach((o) => {
        (o.statusHistory || []).forEach((h) => {
            const at = new Date(h.at);
            if (DELIVERY_STAGES.includes(h.status) && at >= start && at <= end) {
                deliveries.push({
                    _id: `${o._id}-${at.getTime()}`,
                    orderNo: o.orderNo,
                    customer: o.customer,
                    city: o.city,
                    country: o.country,
                    mobile: o.mobile,
                    salespersonName: o.salespersonName,
                    stage: h.status,
                    note: h.note,
                    by: h.byName,
                    at: h.at,
                    deliveryDetails: o.delivery,
                    currentStatus: o.status,
                });
            }
        });
    });
    deliveries.sort((a, b) => new Date(b.at) - new Date(a.at));

    // ── Delivery pending: orders still awaiting delivery (current state, not
    // limited to the selected day). Excludes Delivered and Cancelled orders;
    // Invoiced orders are included until their delivery stage reaches
    // 'Delivered'. Stage is read from the status log (invoiced ⇒ at least
    // 'Confirmed', matching the Delivery Tracker).
    const STAGE_ORDER = ['Pending', 'Confirmed', 'Market Delay', 'Packed', 'Out for Delivery', 'Delivered'];
    const openOrders = await Order.find({
            ...deliveryScope,
            status: { $nin: ['Delivered', 'Cancelled'] },
        })
        .select('orderNo customer city country mobile salespersonName status delivery deliveryStatus invoiceId statusHistory createdAt date')
        .sort({ createdAt: -1 })
        .lean();
    const stageOfOrder = (o) => {
        const hits = (o.statusHistory || [])
            .filter((h) => STAGE_ORDER.includes(h.status))
            .sort((a, b) => new Date(b.at) - new Date(a.at));
        let stage = hits[0] ? hits[0].status :
            (STAGE_ORDER.includes(o.status) ? o.status : 'Pending');
        const invoiced = o.status === 'Invoiced' || o.invoiceId;
        if (invoiced && STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf('Confirmed')) stage = 'Confirmed';
        return stage;
    };
    const pendingDeliveries = openOrders
        .map((o) => ({ o, stage: stageOfOrder(o) }))
        .filter(({ stage }) => stage !== 'Delivered')
        .map(({ o, stage }) => ({
            _id: o._id,
            orderNo: o.orderNo,
            customer: o.customer,
            city: o.city,
            country: o.country,
            mobile: o.mobile,
            salespersonName: o.salespersonName,
            stage,
            invoiced: o.status === 'Invoiced' || Boolean(o.invoiceId),
            deliveryDetails: o.delivery,
            orderedAt: o.date || o.createdAt,
        }));

    // Follow-ups with urgency relative to the selected day.
    const DOT = { overdue: '#DC2626', today: '#D97706', upcoming: '#2563EB' };
    const followUps = allOpen.map((l) => {
        const f = new Date(l.followUpAt);
        f.setHours(0, 0, 0, 0);
        const diffDays = Math.round((f - start) / 86400000);
        const urgency = diffDays < 0 ? 'overdue' : diffDays === 0 ? 'today' : 'upcoming';
        const daysLabel = diffDays < 0 ? `${Math.abs(diffDays)}d overdue` : diffDays === 0 ? 'Due today' : `In ${diffDays}d`;
        return {
            _id: l._id,
            name: l.name,
            mobile: l.mobile,
            country: l.country,
            note: l.remark,
            assignedUser: l.ownerName,
            urgency,
            daysLabel,
            dotColor: DOT[urgency],
        };
    });

    res.json({
        success: true,
        date: dateKey,
        summary: {
            total,
            contacted,
            converted,
            inProgress,
            notInterested,
            newLeads,
            unassigned,
            convRate: total ? Math.round((converted / total) * 100) : 0,
            callsMadeToday: callsToday,
            trendTotal: total - prevTotal,
            trendConverted: converted - prevConverted,
            totalOrders: orders.length,
            ordersRevenue: Number(ordersRevenue.toFixed(2)),
            ordersDue: Number(ordersDue.toFixed(2)),
            totalInvoices: invoices.length,
            invoicedRevenue: Number(invoicedRevenue.toFixed(2)),
            vatCollected: Number(vatCollected.toFixed(2)),
            totalDeliveries: deliveries.length,
            pendingDeliveries: pendingDeliveries.length,
        },
        leads: dayLeads.map((l) => ({
            _id: l._id,
            name: l.name,
            mobile: l.mobile,
            country: l.country,
            source: l.source,
            campaign: l.campaign,
            assignedUserName: l.ownerName,
            status: l.status,
            date: l.createdAt,
            remark: l.remark,
        })),
        sources,
        employees,
        orders,
        invoices,
        deliveries,
        pendingDeliveries,
        followUps,
        conversions: dayLeads
            .filter((l) => isBuyer(l))
            .map((l) => ({ _id: l._id, name: l.name, campaign: l.campaign, assignedUserName: l.ownerName, source: l.source })),
    });
});