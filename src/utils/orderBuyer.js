/**
 * orderBuyer.js — makes sure a customer who places an order becomes a Buyer.
 *
 * Previously this relied ONLY on the order form calling POST /leads/:id/mark-buyer
 * after the order saved, with any failure swallowed — so a failed lookup, a network
 * blip or a lead that couldn't be saved left an order with no Buyer. createOrder now
 * calls these helpers itself, and backfillBuyersFromOrders.js repairs older orders.
 */
import { Lead, normalizePhone } from '../models/Lead.js';

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
