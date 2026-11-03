import assert from 'node:assert/strict';
import { overlayBuyers } from '../src/utils/leadStatusAt.js';
import { Lead } from '../src/models/Lead.js';
import { Order } from '../src/models/Order.js';
import { reconcileOrderBuyers, monthBounds } from '../src/utils/orderBuyer.js';
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };

// ── overlayBuyers (default Leads view) ─────────────────────────────────────
const orders = [
  { orderNo: 369, mobile: '506731305', country: 'UAE', salesperson: 'u1' },
  { orderNo: 368, mobile: '0711876534', country: 'Kenya', salesperson: 'u1' },
];
const leads = [
  { _id: 'A', status: 'Interested', mobileKey: '971506731305' },   // has order, status not caught up
  { _id: 'B', status: 'Won', mobileKey: '971500000001' },          // already buyer, no order
  { _id: 'C', status: 'Contacted', mobileKey: '971500000002' },    // no order
  { _id: 'D', status: 'Won', mobileKey: '254711876534' },          // buyer with order
];
await ok('lead with an order this month counts as Buyer; stored status kept as currentStatus', async () => {
  const out = overlayBuyers(leads, orders);
  assert.equal(out[0].status, 'Won'); assert.equal(out[0].currentStatus, 'Interested'); assert.equal(out[0].boughtInRange, true);
  assert.equal(out.filter((l) => l.status === 'Won').length, 3);   // A, B, D
});
await ok('leads without orders untouched; no orders → same array', async () => {
  const out = overlayBuyers(leads, orders);
  assert.equal(out[2], leads[2]); assert.equal(out[1], leads[1]);
  assert.equal(overlayBuyers(leads, []), leads);
});
await ok('two orders, one customer → one Buyer', async () => {
  const two = [...orders, { orderNo: 400, mobile: '506731305', country: 'UAE', salesperson: 'u2' }];
  const out = overlayBuyers([leads[0]], two);
  assert.equal(out.length, 1); assert.deepEqual(out[0].orderSalespersons.sort(), ['u1', 'u2']);
});

// ── reconcileOrderBuyers (check + repair) with stubbed models ──────────────
const store = [
  { _id: 'L1', company: 'c', name: 'Dipama', mobileKey: '97150673130', status: 'Interested', owner: 'u9', ownerName: 'X' },
  { _id: 'L2', company: 'c', name: 'Gulas', mobileKey: '971500000009', status: 'Won', owner: 'u1', ownerName: 'Rose ann' },
];
const ordersDb = [
  { company: 'c', orderNo: 1, customer: 'Dipama', mobile: '50673130', country: 'UAE', salesperson: 'u1', salespersonName: 'Rose ann', date: new Date('2026-11-02'), createdAt: new Date('2026-11-02T08:00:00Z') },
  { company: 'c', orderNo: 2, customer: 'Gulas', mobile: '500000009', country: 'UAE', salesperson: 'u1', salespersonName: 'Rose ann', date: new Date('2026-11-02'), createdAt: new Date('2026-11-02T09:00:00Z') },
  { company: 'c', orderNo: 3, customer: 'Nobody Ltd', mobile: '555111222', country: 'UAE', salesperson: 'u1', salespersonName: 'Rose ann', date: new Date('2026-11-01'), createdAt: new Date('2026-11-01T09:00:00Z') },
];
Order.find = () => ({ sort: async () => ordersDb });
Lead.findOne = async (q) => store.find((l) => l.company === q.company && (q.mobileKey instanceof RegExp ? q.mobileKey.test(l.mobileKey) : l.mobileKey === q.mobileKey)) || null;
Lead.updateOne = async (f, u) => { const l = store.find((x) => x._id === f._id); if (l.status === 'Won') return { modifiedCount: 0 }; Object.assign(l, u.$set); return { modifiedCount: 1 }; };
Lead.create = async (d) => { const l = { _id: 'NEW' + store.length, ...d }; store.push(l); return l; };

await ok('monthBounds', async () => {
  assert.equal(monthBounds('2026-11').start.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(monthBounds('2026-12').end.toISOString(), '2027-01-01T00:00:00.000Z');
  assert.equal(monthBounds('nope'), null);
});
await ok('dry run reports ok / missing / no_lead and changes nothing', async () => {
  const { rows, summary } = await reconcileOrderBuyers({ month: '2026-11', company: 'c' });
  assert.deepEqual(rows.map((r) => r.state), ['missing', 'ok', 'no_lead']);
  assert.equal(summary.missing, 1); assert.equal(summary.noLead, 1); assert.equal(store[0].status, 'Interested');
});
await ok('apply fixes the missing buyer and reassigns owner to the order salesperson', async () => {
  const { rows, summary } = await reconcileOrderBuyers({ month: '2026-11', company: 'c', apply: true });
  assert.deepEqual(rows.map((r) => r.state), ['fixed', 'ok', 'no_lead']);
  assert.equal(store[0].status, 'Won'); assert.equal(store[0].owner, 'u1'); assert.equal(summary.fixed, 1);
});
await ok('apply + createMissing adds a Won lead for the unmatched order', async () => {
  const { rows, summary } = await reconcileOrderBuyers({ month: '2026-11', company: 'c', apply: true, createMissing: true });
  assert.equal(rows[2].state, 'created'); assert.equal(summary.created, 1);
  assert.equal(store.at(-1).status, 'Won'); assert.equal(store.at(-1).orderNo, 3);
});
console.log(`\n${n} passed`);
process.exit(0);
