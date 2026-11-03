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

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const last9 = (k) => { const d = String(k || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };

/** Find the CRM lead for an order: exact phone key first, then the last 9 digits (tolerates a wrong dial code on legacy leads). */
export async function findLeadForOrder(order) {
    const scope = { company: order.company };
    const key = normalizePhone(order.mobile, order.country);
    if (key && key.replace(/\D/g, '').length >= 5) {
        const exact = await Lead.findOne({...scope, mobileKey: key });
        if (exact) return exact;
        const tail = last9(key);
        if (tail) {
            const fuzzy = await Lead.findOne({...scope, mobileKey: new RegExp(`${esc(tail)}$`) });
            if (fuzzy) return fuzzy;
        }
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
    const changes = [{ field: 'status', from: lead.status, to: 'Won' }];

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
                    const created = await Lead.create({
                        company: o.company, name: o.customer, mobile: o.mobile, country: o.country || 'UAE', city: o.city || '',
                        delivery: o.delivery || '', source: 'Walk-in', status: 'Won', converted: true, orderNo: o.orderNo,
                        owner: o.salesperson || o.createdBy, ownerName: o.salespersonName || '',
                        remark: 'Auto-created from order backfill',
                        editHistory: [{ byName: 'Backfill from orders', at: o.createdAt, changes: [{ field: 'status', from: 'New', to: 'Won' }] }],
                    });
                    cache.set(String(created._id), created);
                    Object.assign(row, { state: 'created', leadId: created._id, leadName: created.name, leadStatus: 'Won' });
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
