import assert from 'node:assert/strict';
import { applyAsOf } from '../src/utils/leadStatusAt.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const month = (y, m) => ({ start: new Date(y, m - 1, 1), end: new Date(y, m, 0, 23, 59, 59, 999) });

// Same arithmetic as report.controller monthlyComparison
function compute(leads, orders, { start, end }) {
  const from = ymd(start), to = ymd(end);
  const buyerOrders = orders.filter((o) => o.status !== 'Cancelled' && new Date(o.date).toISOString().slice(0, 10) >= from && new Date(o.date).toISOString().slice(0, 10) <= to);
  const asOf = applyAsOf(leads, { asOf: to, from, tz: start.getTimezoneOffset(), orders: buyerOrders });
  const createdIn = (l) => { const t = new Date(l.createdAt).getTime(); return t >= start.getTime() && t <= end.getTime(); };
  const monthLeads = asOf.filter(createdIn);
  return {
    buyers: asOf.filter((l) => l.status === 'Won' && (createdIn(l) || l.buyerActivityInRange)).length,
    opportunity: monthLeads.filter((l) => l.status === 'Interested' || l.status === 'Contacted').length,
    enquiry: monthLeads.filter((l) => l.status === 'Follow-up').length,
    total: monthLeads.length,
  };
}

const leads = [
  // A: created Sep, bought 20 Oct (logged), monthly reset 1 Nov → live status Interested
  { _id: 'A', createdAt: '2026-09-10T08:00:00Z', status: 'Interested', mobileKey: '971500000001', editHistory: [
      { at: '2026-10-20T09:00:00Z', changes: [{ field: 'status', from: 'Interested', to: 'Won' }] },
      { at: '2026-11-01T00:05:00Z', changes: [{ field: 'status', from: 'Won', to: 'Interested' }] } ] },
  // B: created Oct, still Interested
  { _id: 'B', createdAt: '2026-10-12T08:00:00Z', status: 'Interested', mobileKey: '971500000002', editHistory: [] },
  // C: created Sep, NO history at all (old reset never logged), but has an order dated 5 Oct
  { _id: 'C', createdAt: '2026-09-02T08:00:00Z', status: 'Interested', mobileKey: '971500000003', editHistory: [] },
  // D: created Oct, Enquiry
  { _id: 'D', createdAt: '2026-10-15T08:00:00Z', status: 'Follow-up', mobileKey: '971500000004', editHistory: [] },
];
const orders = [{ orderNo: 1, mobile: '500000003', country: 'UAE', date: new Date('2026-10-05'), status: 'Pending' }];

const oct = compute(leads, orders, month(2026, 10));
console.log('October', oct);
assert.equal(oct.buyers, 2, 'A (logged purchase) and C (order) are October buyers although created in September');
assert.equal(oct.total, 2); assert.equal(oct.opportunity, 1); assert.equal(oct.enquiry, 1);
console.log('  ✓ October: 2 buyers (incl. leads created earlier), stage mix of the 2 leads created in October');

const nov = compute(leads, [], month(2026, 11));
console.log('November', nov);
assert.equal(nov.buyers, 0); assert.equal(nov.total, 0);
console.log('  ✓ November: last month\'s buyers are NOT counted again after the reset');

const sep = compute(leads, orders, month(2026, 9));
console.log('September', sep);
assert.equal(sep.buyers, 0); assert.equal(sep.opportunity, 2);   // A and C created in Sep, not yet bought
console.log('  ✓ September: A and C were Opportunities then');
process.exit(0);
