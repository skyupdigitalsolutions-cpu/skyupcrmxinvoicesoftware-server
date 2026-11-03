/**
 * leadStatusAt.js
 *
 * Reconstructs what a lead's status WAS on a given date, from its editHistory.
 * This is what makes "report for the 30th shows Buyer, report for this month
 * shows Opportunity" possible even though the monthly reset overwrites the
 * live `status` on the 1st.
 *
 * Rules
 *  - Only editHistory entries with a `status` change are used.
 *  - The state on date D is the `from` of the first status change AFTER D (it
 *    is the state right before that change, so it also captures status changes
 *    that were never logged). If no later change exists, the live status is
 *    still the state on D.
 *  - Legacy entries such as "Interested — all Buyers reset to Opportunity
 *    monthly" or "Contacted — replied on WhatsApp" are normalised to the real
 *    status ("Interested" / "Contacted").
 *  - A lead created after D did not exist on D → status is null.
 */
import { LEAD_STATUSES, normalizePhone } from '../models/Lead.js';

// "Interested — all Buyers reset…" → "Interested". Unknown values → null.
export function normalizeStatus(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (LEAD_STATUSES.includes(s)) return s;
    const hit = LEAD_STATUSES.find(
        (x) => s.startsWith(x) && !/[A-Za-z0-9]/.test(s.charAt(x.length) || ' ')
    );
    return hit || null;
}

// Sorted (oldest first) list of {at, from, to} status transitions.
export function statusTimeline(lead) {
    const out = [];
    for (const h of lead.editHistory || []) {
        for (const c of h.changes || []) {
            if (c.field !== 'status') continue;
            out.push({ at: new Date(h.at), from: normalizeStatus(c.from), to: normalizeStatus(c.to) });
        }
    }
    return out.sort((a, b) => a.at - b.at);
}

// Status of `lead` at the end of moment `asOf` (a Date). null = didn't exist yet.
export function statusAsOf(lead, asOf) {
    if (!asOf) return lead.status;
    if (lead.createdAt && new Date(lead.createdAt) > asOf) return null;
    const tl = statusTimeline(lead);
    const idx = tl.findIndex((c) => c.at > asOf);
    if (idx === -1) return lead.status;               // nothing logged after D
    if (tl[idx].from) return tl[idx].from;            // state right before next change
    for (let i = idx - 1; i >= 0; i--) if (tl[i].to) return tl[i].to;
    return 'New';
}

// Dates on which the lead moved INTO Won (used for "buyers over time").
export function wonDates(lead) {
    return statusTimeline(lead).filter((c) => c.to === 'Won' && c.from !== 'Won').map((c) => c.at);
}

// Did the lead become a Buyer (→ Won) or stop being one (Won →) inside
// [start, end]? Used so a date-range report also lists customers who bought
// earlier but were created before the range (and their monthly reset).
export function buyerChangedBetween(lead, start, end) {
    return statusTimeline(lead).some((c) => c.at >= start && c.at <= end && (c.to === 'Won' || c.from === 'Won'));
}

// Did the lead move INTO Won (a purchase) inside [start, end]? Unlike
// buyerChangedBetween this ignores Won → X resets, so it answers "did this
// customer buy during the period?".
export function becameBuyerBetween(lead, start, end) {
    return statusTimeline(lead).some((c) => c.at >= start && c.at <= end && c.to === 'Won' && c.from !== 'Won');
}

/**
 * Orders are the strongest "this customer bought" signal. A lead's Won event is
 * stamped when the order FORM is saved (and the browser call that does it is
 * fire-and-forget), whereas the Orders / Sales reports filter on the order's own
 * date — so the two could disagree about who bought in a period. These helpers let
 * a date-range lead list also treat "has a non-cancelled order dated in the range"
 * as a purchase in that range.
 *
 * `orders`: [{ orderNo, mobile, country, salesperson }] already restricted to the
 * range and to non-cancelled orders by the caller.
 */
const last9 = (k) => { const d = String(k || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };

export function indexBuyerOrders(orders) {
    const byNo = new Map(), byKey = new Map(), byTail = new Map();
    const add = (m, k, o) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(o); };
    for (const o of orders || []) {
        const key = normalizePhone(o.mobile, o.country);
        add(byNo, o.orderNo, o);
        add(byKey, key, o);
        add(byTail, last9(key), o);   // tolerates legacy leads stored with a wrong dial code
    }
    return { byNo, byKey, byTail };
}

export function ordersForLead(lead, idx) {
    if (!idx) return [];
    const hit = new Set();
    (idx.byNo.get(lead.orderNo) || []).forEach((o) => hit.add(o));
    (idx.byKey.get(lead.mobileKey) || []).forEach((o) => hit.add(o));
    (idx.byTail.get(last9(lead.mobileKey)) || []).forEach((o) => hit.add(o));
    return [...hit];
}

// 'YYYY-MM-DD' + client tz offset (minutes, = Date#getTimezoneOffset) → UTC Date.
export function dayBoundary(dateStr, tzOffsetMin = 0, end = false) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!m) return null;
    const base = end ? Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999) : Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
    return new Date(base + (Number(tzOffsetMin) || 0) * 60000);
}

/**
 * Turn raw leads (with editHistory) into the list payload "as of" a date.
 *  - `status` becomes the as-of status (live one kept as `currentStatus`)
 *  - leads that didn't exist yet are dropped
 *  - when a [from, asOf] range is given, a lead that BOUGHT (→ Won) inside the range is
 *    reported as Won even if the monthly reset has since moved it back to Opportunity,
 *    so a range report's Buyers count / Buyer stage filter includes everyone who
 *    bought in that period (`boughtInRange` flags these, `statusAtEnd` keeps the raw as-of status)
 *  - `buyerActivityInRange` marks leads that became/stopped being a Buyer inside [from, asOf]
 *  - editHistory is stripped (admin-only data never reaches the browser)
 */
export function applyAsOf(leads, { asOf, from, tz = 0, orders = null }) {
    const end = dayBoundary(asOf, tz, true);
    if (!end) return leads;
    const start = from ? dayBoundary(from, tz, false) : null;
    const orderIdx = start && orders && orders.length ? indexBuyerOrders(orders) : null;
    const out = [];
    for (const l of leads) {
        const statusAtEnd = statusAsOf(l, end);
        if (statusAtEnd === null) continue;
        let st = statusAtEnd;
        let boughtInRange = false;
        if (start && st !== 'Won' && becameBuyerBetween(l, start, end)) {
            st = 'Won';
            boughtInRange = true;
        }
        // A non-cancelled order dated inside the range also makes this lead a Buyer
        // for the range (even if its Won event is missing, or was logged on a
        // different day than the order's date).
        const matched = orderIdx ? ordersForLead(l, orderIdx) : [];
        if (matched.length) {
            if (st !== 'Won') st = 'Won';
            boughtInRange = true;
        }
        const { editHistory, ...rest } = l;
        out.push({
            ...rest,
            currentStatus: l.status,
            statusAtEnd,
            boughtInRange,
            // Salespeople on the orders in range — lets the employee filter find a
            // buyer whose lead is owned by someone else (e.g. admin keyed the order).
            orderSalespersons: [...new Set(matched.map((o) => o.salesperson && String(o.salesperson)).filter(Boolean))],
            status: st,
            buyerActivityInRange: start ? (matched.length > 0 || buyerChangedBetween(l, start, end)) : false,
        });
    }
    return out;
}

/**
 * Default (no date filter) list view: a lead with a non-cancelled order dated in the current
 * month counts as a Buyer even if its stored status hasn't caught up (the order form's
 * follow-up call failed, the monthly reset ran early, …). The stored status stays available
 * as `currentStatus`. Leads without such an order are returned untouched.
 */
export function overlayBuyers(leads, orders) {
    if (!orders || !orders.length) return leads;
    const idx = indexBuyerOrders(orders);
    return leads.map((l) => {
        const matched = ordersForLead(l, idx);
        if (!matched.length) return l;
        const orderSalespersons = [...new Set(matched.map((o) => o.salesperson && String(o.salesperson)).filter(Boolean))];
        if (l.status === 'Won') return { ...l, orderSalespersons };
        return { ...l, currentStatus: l.status, status: 'Won', boughtInRange: true, orderSalespersons };
    });
}

/**
 * How this month's orders map onto the visible leads — shown on the Buyers card so a gap
 * between "orders" and "buyers" is explained instead of mysterious.
 *   orders        non-cancelled orders this month
 *   customers     distinct leads that have at least one of them (= Buyers from orders)
 *   withoutLead   orders that match no lead at all
 */
export function orderCoverage(leads, orders) {
    const idx = indexBuyerOrders(orders || []);
    const matched = new Set();
    let customers = 0;
    for (const l of leads) {
        const m = ordersForLead(l, idx);
        if (m.length) { customers += 1; m.forEach((o) => matched.add(o)); }
    }
    return { orders: (orders || []).length, customers, withoutLead: (orders || []).length - matched.size };
}
