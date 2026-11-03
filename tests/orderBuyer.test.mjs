import assert from 'node:assert/strict';
import { Lead } from '../src/models/Lead.js';
import { findLeadForOrder, markLeadAsBuyer } from '../src/utils/orderBuyer.js';
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };

const leads = [
  { _id: 'L1', company: 'c1', mobileKey: '971506731305', status: 'Interested', owner: 'u9', ownerName: 'Old Owner' },
  { _id: 'L2', company: 'c1', mobileKey: '91711876534', status: 'Contacted', owner: 'u1', ownerName: 'Rose ann' }, // wrong dial code stored (Kenya number saved as +91)
  { _id: 'L3', company: 'c2', mobileKey: '971506731305', status: 'New', owner: 'u5' },                              // other tenant
];
Lead.findOne = async (q) => leads.find((l) => l.company === q.company && (q.mobileKey instanceof RegExp ? q.mobileKey.test(l.mobileKey) : l.mobileKey === q.mobileKey)) || null;
const updates = [];
Lead.updateOne = async (filter, upd) => { updates.push({ filter, upd }); return { modifiedCount: 1 }; };

await ok('exact phone match, same company only', async () => {
  const l = await findLeadForOrder({ company: 'c1', mobile: '506731305', country: 'UAE' });
  assert.equal(l._id, 'L1');
});
await ok('wrong-dial-code legacy lead matched by last 9 digits', async () => {
  const l = await findLeadForOrder({ company: 'c1', mobile: '0711876534', country: 'Kenya' });
  assert.equal(l._id, 'L2');
});
await ok('no match → null; never crosses tenants', async () => {
  assert.equal(await findLeadForOrder({ company: 'c1', mobile: '555000111222', country: 'UAE' }), null);
  assert.equal(await findLeadForOrder({ company: 'c3', mobile: '506731305', country: 'UAE' }), null);
});
await ok('markLeadAsBuyer sets Won/converted/orderNo, reassigns to order salesperson, logs history', async () => {
  const changed = await markLeadAsBuyer(leads[0], { orderNo: 369, salesperson: 'u1', salespersonName: 'Rose ann' }, { byUser: { _id: 'admin1', name: 'Admin' } });
  assert.equal(changed, true);
  const { filter, upd } = updates.at(-1);
  assert.deepEqual(filter, { _id: 'L1', status: { $ne: 'Won' } });
  assert.deepEqual(upd.$set, { status: 'Won', converted: true, orderNo: 369, owner: 'u1', ownerName: 'Rose ann' });
  assert.equal(upd.$push.editHistory.by, 'admin1');
  assert.equal(upd.$push.editHistory.changes[0].to, 'Won');
});
await ok('already a Buyer → untouched', async () => {
  const before = updates.length;
  assert.equal(await markLeadAsBuyer({ ...leads[0], status: 'Won' }, { orderNo: 370 }), false);
  assert.equal(updates.length, before);
});
await ok('system backfill: no "by" on history entry, keeps owner when order has no salesperson', async () => {
  await markLeadAsBuyer(leads[1], { orderNo: 371 }, { at: new Date('2026-11-02'), byName: 'Backfill from orders' });
  const { upd } = updates.at(-1);
  assert.equal(upd.$push.editHistory.by, undefined);
  assert.equal(upd.$push.editHistory.byName, 'Backfill from orders');
  assert.equal(upd.$set.owner, undefined);
});
console.log(`\n${n} passed`);
process.exit(0);
