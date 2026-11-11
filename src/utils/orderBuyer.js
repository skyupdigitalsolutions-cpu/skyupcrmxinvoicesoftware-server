/**
 * orderBuyer.js — makes sure a customer who places an order becomes a Buyer.
 *
 * Previously this relied ONLY on the order form calling POST /leads/:id/mark-buyer
 * after the order saved, with any failure swallowed — so a failed lookup, a network
 * blip or a lead that couldn't be saved left an order with no Buyer. createOrder now
 * calls these helpers itself, and backfillBuyersFromOrders.js repairs older orders.
 */
import { Lead, normalizePhone } from '../models/Lead.js';
import { Order } from '../models/Order.js';
import { statusTimeline, normalizeStatus, indexBuyerOrders, ordersForLead } from './leadStatusAt.js';

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Digits the user actually typed (the dial code that normalizePhone prepends must not count towards "long enough").
const typedDigits = (order) => String(order.mobile || '').replace(/\D/g, '').replace(/^0+/, '');
export const last9 = (k) => { const d = String(k || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };

/**
 * Find the CRM lead an order belongs to. Mirrors — and is deliberately a bit wider than —
 * the duplicate guard in createLead, because creating a SECOND lead for the same person is the
 * mistake to avoid. Tried in order:
 *   1. exact phone key (dial code + number)
 *   2. the typed digits as a suffix of a stored key (lead saved under another/wrong dial code)
 *   3. the last 9 digits of the key
 *   4. the lead's alternate mobile number (separators ignored)
 */
export async function findLeadForOrder(order) {
    const scope = { company: order.company };
    const typed = typedDigits(order);
    if (typed.length < 5) return null;
    const key = normalizePhone(order.mobile, order.country);
    if (!key) return null;

    const exact = await Lead.findOne({...scope, mobileKey: key });
    if (exact) return exact;

    if (typed.length >= 7) {
        const bySuffix = await Lead.findOne({...scope, mobileKey: new RegExp(`${esc(typed)}$`) });
        if (bySuffix) return bySuffix;
    }
    const tail = last9(key);
    if (tail) {
        const byTail = await Lead.findOne({...scope, mobileKey: new RegExp(`${esc(tail)}$`) });
        if (byTail) return byTail;
    }
    if (typed.length >= 7) {
        // alt number is stored as typed ("+971 50-123 4567"), so allow separators between digits
        const digits = typed.slice(-9).split('').join('\\D*');
        const byAlt = await Lead.findOne({...scope, altMobile: new RegExp(`${digits}\\D*$`) });
        if (byAlt) return byAlt;
    }
    return null;
}

/**
 * Mark `lead` as a Buyer (Won) because of `order`.
 * Uses updateOne (not save) so unrelated legacy sub-document validation can never block it.
 * Returns true if the lead changed, false if it was already a Buyer.
 *   opts.at     — when it happened (defaults to now; the backfill passes the order's time)
 *   opts.byUser — acting user (omit for system/backfill)
 *   opts.byName — label stored in the edit history
 */
export async function markLeadAsBuyer(lead, order, { at = new Date(), byUser = null, byName = '' } = {}) {
    if (lead.status === 'Won') return false;

    const set = { status: 'Won', converted: true, orderNo: order.orderNo };
    // The orderNo change tags this Won event with the order that caused it, so
    // cancelling that order later can find and undo exactly this event.
    const changes = [{ field: 'status', from: lead.status, to: 'Won' }, { field: 'orderNo', from: lead.orderNo ?? null, to: order.orderNo }];

    // The customer belongs to the salesperson on the order.
    if (order.salesperson && String(lead.owner) !== String(order.salesperson)) {
        changes.push({ field: 'owner', from: lead.ownerName || String(lead.owner), to: order.salespersonName || '' });
        set.owner = order.salesperson;
        set.ownerName = order.salespersonName || lead.ownerName || '';
    }

    const entry = { byName: byName || (byUser && byUser.name) || 'Order created', at, changes };
    if (byUser && byUser._id) entry.by = byUser._id;

    const res = await Lead.updateOne({ _id: lead._id, status: { $ne: 'Won' } }, { $set: set, $push: { editHistory: entry } });
    return res.modifiedCount > 0;
}

// Serialises "look up, then create" per customer phone inside this server process, so two orders
// for the same brand-new customer arriving together can't both create a lead.
const lockTails = new Map();
async function withLock(key, fn) {
    const prev = lockTails.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((r) => { release = r; });
    const tail = prev.then(() => gate);
    lockTails.set(key, tail);
    await prev;
    try { return await fn(); }
    finally { release(); if (lockTails.get(key) === tail) lockTails.delete(key); }
}

/** Raw create of a Buyer lead for an order. Use createBuyerLeadSafely — it is the duplicate-proof wrapper. */
export async function createBuyerLeadForOrder(order, { at = new Date(), byName = 'Order created', byUser = null } = {}) {
    const owner = order.salesperson || order.createdBy || (byUser && byUser._id);
    if (!owner || !order.customer) return null;
    const entry = { byName, at, changes: [{ field: 'status', from: 'New', to: 'Won' }, { field: 'orderNo', from: null, to: order.orderNo }] };
    if (byUser && byUser._id) entry.by = byUser._id;
    return Lead.create({
        company: order.company, name: order.customer, mobile: order.mobile || '', country: order.country || 'UAE',
        city: order.city || '', delivery: order.delivery || '', source: 'Walk-in', status: 'Won', converted: true,
        orderNo: order.orderNo, owner, ownerName: order.salespersonName || (byUser && byUser.name) || '',
        remark: 'Auto-created from order', editHistory: [entry],
    });
}

/**
 * Create a Buyer lead ONLY if the customer truly has none — never a duplicate.
 *   1. serialised per phone number within this process
 *   2. re-checks for an existing lead right before creating (using the wide matching above)
 *   3. a unique-index collision (code 11000) falls back to the lead that won
 *   4. after creating, if another lead with the same phone now exists (another server process,
 *      or the unique index is missing in the database), the OLDEST one is kept and this new one
 *      is removed — every racer reaches the same answer.
 * Returns { lead, created } — `created: false` means an existing lead was used.
 */
export async function createBuyerLeadSafely(order, opts = {}) {
    const key = normalizePhone(order.mobile, order.country);
    return withLock(`${order.company}:${key}`, async () => {
        const existing = await findLeadForOrder(order);
        if (existing) return { lead: existing, created: false };

        let lead;
        try {
            lead = await createBuyerLeadForOrder(order, opts);
        } catch (e) {
            if (e && e.code === 11000) {
                const winner = await findLeadForOrder(order);
                if (winner) return { lead: winner, created: false };
            }
            throw e;
        }
        if (!lead) return { lead: null, created: false };

        const same = await Lead.find({ company: order.company, mobileKey: lead.mobileKey }).sort({ createdAt: 1, _id: 1 });
        if (same.length > 1 && String(same[0]._id) !== String(lead._id)) {
            await Lead.deleteOne({ _id: lead._id });
            return { lead: same[0], created: false };
        }
        return { lead, created: true };
    });
}

/**
 * The one call createOrder makes: whoever places an order is a Buyer.
 *   - lead exists  → mark it Won (and assign it to the order's salesperson)
 *   - no lead      → create one as a Buyer, without ever duplicating (needs a usable phone number)
 * Returns 'marked' | 'already' | 'created' | 'skipped'. Throws only on unexpected errors.
 */
export async function ensureBuyerForOrder(order, { byUser = null } = {}) {
    let lead = await findLeadForOrder(order);
    if (!lead) {
        if (typedDigits(order).length < 5) return 'skipped';   // no usable number → can't dedupe safely
        const r = await createBuyerLeadSafely(order, { byUser, byName: (byUser && byUser.name) || 'Order created' });
        if (r.created) return 'created';
        lead = r.lead;
        if (!lead) return 'skipped';
    }
    return (await markLeadAsBuyer(lead, order, { byUser })) ? 'marked' : 'already';
}

// 'YYYY-MM' (UTC) of a date — orders store their date as UTC midnight of the calendar day.
const monthKeyOf = (d) => { const x = new Date(d); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`; };

/**
 * Undo ensureBuyerForOrder when an order is CANCELLED.
 *
 * Previously cancelling only changed order.status, so the customer stayed a Buyer (Won)
 * and every report kept counting them. Now:
 *   - the Won event this order created is VOIDED (a `buyerVoid` change in editHistory), so
 *     date-range / monthly reports stop counting it — even for a past month that the monthly
 *     reset has already rolled over (see statusTimeline in leadStatusAt.js)
 *   - if the lead is still Won because of this order, it goes back to the status it had
 *     before it became a Buyer (falls back to 'Interested')
 *   - `converted` / `orderNo` are updated to reflect the customer's remaining orders
 * Nothing is reverted while the customer still has another live (non-cancelled) order in the
 * same month — they are still a Buyer for that month.
 * Returns 'reverted' | 'voided' | 'kept' | 'no_lead'.
 */
export async function revokeBuyerForCancelledOrder(order, { byUser = null } = {}) {
    const lead = await findLeadForOrder(order);
    if (!lead) return 'no_lead';

    // The same customer's OTHER live orders (any date). Narrow by phone digits / orderNo in
    // the query, then confirm with the same matching the reports use.
    const tail = last9(lead.mobileKey) || typedDigits(order).slice(-9);
    const or = [];
    if (tail.length >= 7) or.push({ mobile: new RegExp(`${tail.split('').join('\\D*')}\\D*$`) });
    if (lead.orderNo && lead.orderNo !== order.orderNo) or.push({ orderNo: lead.orderNo });
    const candidates = or.length ?
        await Order.find({ company: order.company, _id: { $ne: order._id }, status: { $ne: 'Cancelled' }, $or: or })
            .select('orderNo mobile country date createdAt').lean() : [];
    const others = ordersForLead(lead, indexBuyerOrders(candidates));
    const hasOtherIn = (monthKey) => others.some((o) => monthKeyOf(o.date) === monthKey);

    // Won events still in effect (already-voided ones are filtered out by statusTimeline).
    const wins = statusTimeline(lead).filter((c) => c.to === 'Won' && c.from !== 'Won');
    const lastWin = wins[wins.length - 1] || null;
    // The Won event this order caused: tagged with an orderNo change (markLeadAsBuyer /
    // createBuyerLeadForOrder); older history has no tag, so fall back to a Won logged
    // within minutes of the order being saved.
    const tagged = new Set();
    for (const h of lead.editHistory || []) {
        if ((h.changes || []).some((c) => c.field === 'orderNo' && Number(c.to) === Number(order.orderNo))) tagged.add(new Date(h.at).getTime());
    }
    const createdAt = new Date(order.createdAt || order.date).getTime();
    const isThisOrdersWin = (w) => tagged.has(w.at.getTime()) ||
        (w.at.getTime() >= createdAt - 5 * 60 * 1000 && w.at.getTime() <= createdAt + 10 * 60 * 1000);
    const orderWin = [...wins].reverse().find(isThisOrdersWin) || null;

    const changes = [];
    const set = {};

    // 1) Void this order's Won event unless another live order makes them a Buyer that month.
    const voidWin = orderWin && !hasOtherIn(monthKeyOf(orderWin.at)) ? orderWin : null;
    if (voidWin) changes.push({ field: 'buyerVoid', from: voidWin.at.toISOString(), to: order.orderNo });

    // 2) Current status: only undo a Won that came from THIS order (never a manual Won, and
    //    never while another live order this month keeps them a Buyer).
    const wonFromThisOrder = (voidWin && voidWin === lastWin) || (!lastWin && lead.orderNo === order.orderNo);
    if (lead.status === 'Won' && wonFromThisOrder && !hasOtherIn(monthKeyOf(new Date()))) {
        let prev = normalizeStatus(lastWin && lastWin.from);
        if (!prev || prev === 'Won') prev = 'Interested';
        set.status = prev;
        changes.push({ field: 'status', from: 'Won', to: prev });
    }

    // 3) Keep converted / orderNo in line with the orders that remain.
    if (!others.length && lead.converted) set.converted = false;
    if (lead.orderNo === order.orderNo) {
        const latest = [...others].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
        set.orderNo = latest ? latest.orderNo : null;
    }

    if (!changes.length && !Object.keys(set).length) return 'kept';
    const update = { $set: set };
    if (changes.length) {
        const entry = { byName: `${(byUser && byUser.name) || 'System'} (order #${order.orderNo} cancelled)`, at: new Date(), changes };
        if (byUser && byUser._id) entry.by = byUser._id;
        update.$push = { editHistory: entry };
    }
    await Lead.updateOne({ _id: lead._id }, update);
    return set.status ? 'reverted' : (voidWin ? 'voided' : 'kept');
}

/** UTC [start, end) for 'YYYY-MM' — orders store their date as a plain calendar date (UTC midnight). */
export function monthBounds(month) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
    if (!m) return null;
    const Y = Number(m[1]), M = Number(m[2]);
    if (M < 1 || M > 12) return null;
    return { start: new Date(Date.UTC(Y, M - 1, 1)), end: new Date(Date.UTC(Y, M, 1)) };
}

/** Non-cancelled orders of a month (optionally one company). */
export const monthOrders = (month, company) => {
    const b = monthBounds(month);
    if (!b) return Promise.resolve([]);
    return Order.find({ ...(company ? { company } : {}), date: { $gte: b.start, $lt: b.end }, status: { $ne: 'Cancelled' } })
        .sort({ date: 1, orderNo: 1 });
};

/**
 * Walk every order of a month and report / repair its Buyer.
 *   row.state: 'ok' (already Buyer) | 'missing' (lead found, not a Buyer — dry run) | 'fixed'
 *              | 'no_lead' | 'created' | 'error'
 * apply=false changes nothing. createMissing (needs apply) adds a Won lead for orders with no CRM lead.
 */
export async function reconcileOrderBuyers({ month, company, apply = false, createMissing = false }) {
    const orders = await monthOrders(month, company);
    const cache = new Map();
    const rows = [];
    for (const o of orders) {
        const row = { orderNo: o.orderNo, date: o.date, customer: o.customer, mobile: o.mobile, country: o.country,
            salespersonName: o.salespersonName || '', state: '', leadId: null, leadName: '', leadStatus: '', error: '' };
        try {
            let lead = await findLeadForOrder(o);
            if (lead) { const k = String(lead._id); lead = cache.get(k) || (cache.set(k, lead), lead); }
            if (!lead) {
                if (apply && createMissing && (o.salesperson || o.createdBy)) {
                    const r = await createBuyerLeadSafely(o, { at: o.createdAt, byName: 'Backfill from orders' });
                    if (!r.lead) { row.state = 'no_lead'; }
                    else {
                        // `created: false` = a lead for this phone appeared meanwhile → use it, don't duplicate.
                        if (!r.created) await markLeadAsBuyer(r.lead, o, { at: o.createdAt, byName: 'Backfill from orders' });
                        r.lead.status = 'Won';
                        cache.set(String(r.lead._id), r.lead);
                        Object.assign(row, { state: r.created ? 'created' : 'fixed', leadId: r.lead._id, leadName: r.lead.name, leadStatus: 'Won' });
                    }
                } else row.state = 'no_lead';
            } else {
                Object.assign(row, { leadId: lead._id, leadName: lead.name, leadStatus: lead.status });
                if (lead.status === 'Won') row.state = 'ok';
                else if (apply) {
                    await markLeadAsBuyer(lead, o, { at: o.createdAt, byName: 'Backfill from orders' });
                    lead.status = 'Won';
                    row.state = 'fixed';
                } else row.state = 'missing';
            }
        } catch (e) { row.state = 'error'; row.error = e.message; }
        rows.push(row);
    }
    const count = (st) => rows.filter((r) => r.state === st).length;
    const summary = { orders: rows.length, ok: count('ok'), missing: count('missing'), fixed: count('fixed'),
        noLead: count('no_lead'), created: count('created'), errors: count('error'),
        distinctCustomers: new Set(rows.filter((r) => r.leadId).map((r) => String(r.leadId))).size };
    return { rows, summary };
}
