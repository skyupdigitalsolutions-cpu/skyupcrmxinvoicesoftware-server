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
import { LEAD_STATUSES } from '../models/Lead.js';

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
 *  - `buyerActivityInRange` marks leads that became/stopped being a Buyer inside [from, asOf]
 *  - editHistory is stripped (admin-only data never reaches the browser)
 */
export function applyAsOf(leads, { asOf, from, tz = 0 }) {
    const end = dayBoundary(asOf, tz, true);
    if (!end) return leads;
    const start = from ? dayBoundary(from, tz, false) : null;
    const out = [];
    for (const l of leads) {
        const st = statusAsOf(l, end);
        if (st === null) continue;
        const { editHistory, ...rest } = l;
        out.push({
            ...rest,
            currentStatus: l.status,
            status: st,
            buyerActivityInRange: start ? buyerChangedBetween(l, start, end) : false,
        });
    }
    return out;
}
