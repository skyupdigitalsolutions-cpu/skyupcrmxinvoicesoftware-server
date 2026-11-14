// Run: node tests/tallySync.test.mjs — planner + save helper with stubbed models (no database).
import assert from 'node:assert/strict';
import { TallySyncJob } from '../src/models/TallySyncJob.js';
import { TallyConnector } from '../src/models/TallyConnector.js';
import { TallyMapping } from '../src/models/TallyMapping.js';
import { Company } from '../src/models/Company.js';
import { planTallyChange, saveWithTally } from '../src/utils/tallySync.js';

let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
const lean = (v) => ({ lean: async () => v });

const settings = { tallyCompanyName: 'Neo Spotek - Test', baseCurrency: 'AED', salesOrderVoucherType: 'Sales Order',
  purchaseOrderVoucherType: 'Purchase Order', salesLedger: 'Sales Account', purchaseLedger: 'Purchase Account', godown: 'Main Location', timezone: 'Asia/Dubai' };
TallyConnector.findOne = () => lean({ settings });
Company.findById = () => lean({ currency: { code: 'AED' } });
TallyMapping.find = () => lean([
  { kind: 'customer', crmKey: 'crm test customer', tallyName: 'CRM Test Customer' },
  { kind: 'item', crmKey: 'p1|*', tallyName: 'CRM Test Product', tallyUnit: 'PCS' },
]);

let currentJob = null;
const updates = [];
TallySyncJob.findOne = () => lean(currentJob);
let updateResult = 1;
TallySyncJob.updateOne = async (filter, upd) => { updates.push({ filter, upd }); return { modifiedCount: updateResult }; };

const order = (over = {}) => ({ _id: 'o1', orderNo: 7, date: new Date('2026-11-12T08:00:00Z'), customer: 'CRM Test Customer', status: 'Confirmed',
  discount: 0, grandTotal: 200, items: [{ modelCode: 'P1', qty: 2, price: 100, unit: 'PAIR' }], ...over });
const lastPayload = { operation: 'CREATE', date: '20261112', voucherTypeName: 'Sales Order', tallyCompany: 'Neo Spotek - Test', dueDate: '20261112',
  partyLedger: 'CRM Test Customer', accountLedger: 'Sales Account', godown: 'Main Location', narration: 'CRM Order #7', total: 200,
  lines: [{ stockItem: 'CRM Test Product', unit: 'PCS', qty: 2, rate: 100, amount: 200 }], reference: 'CRM-SO-7' };
const synced = (over = {}) => ({ _id: 'j1', reference: 'CRM-SO-7', status: 'SYNCED', operation: 'CREATE', syncedAt: new Date(), tallyState: 'ACTIVE',
  updatedAt: new Date('2026-11-12'), payloadSnapshot: lastPayload, lastSyncedPayload: lastPayload, ...over });
const args = (over) => ({ company: 'c1', sourceType: 'SALES_ORDER', sourceId: 'o1', user: { _id: 'u1' }, ...over });

await ok('no job → plan is a no-op and save runs exactly as before', async () => {
  currentJob = null; updates.length = 0;
  const plan = await planTallyChange(args({ action: 'edit', docAfter: order() }));
  assert.equal(plan.commit, null);
  let saved = 0; await saveWithTally({ plan, save: async () => { saved++; } });
  assert.equal(saved, 1); assert.equal(updates.length, 0);
});

await ok('edit of a synced order with a qty change → ALTER queued after save, with previous date', async () => {
  currentJob = synced(); updates.length = 0;
  const doc = order({ items: [{ modelCode: 'P1', qty: 3, price: 100 }], grandTotal: 300, date: new Date('2026-11-14T08:00:00Z') });
  const plan = await planTallyChange(args({ action: 'edit', docAfter: doc }));
  const order_ = []; await saveWithTally({ plan, replan: () => null, save: async () => order_.push('save') });
  order_.push(...updates.map(() => 'queue'));
  assert.deepEqual(order_, ['save', 'queue']);
  const set = updates[0].upd.$set;
  assert.equal(set.status, 'PENDING'); assert.equal(set.operation, 'ALTER');
  assert.equal(set.payloadSnapshot.lines[0].qty, 3);
  assert.equal(set.payloadSnapshot.date, '20261114');
  assert.deepEqual(set.payloadSnapshot.previous, { date: '20261112', voucherTypeName: 'Sales Order' });
});

await ok('edit that changes nothing Tally cares about (e.g. mobile) → no job', async () => {
  currentJob = synced(); updates.length = 0;
  const plan = await planTallyChange(args({ action: 'edit', docAfter: order({ mobile: '0500000000' }) }));
  assert.equal(plan.commit, null);
});

await ok('edit adding an unmapped item → 422 before anything is saved', async () => {
  currentJob = synced();
  await assert.rejects(planTallyChange(args({ action: 'edit', docAfter: order({ items: [{ modelCode: 'NEW', qty: 1, price: 200 }] }) })),
    (e) => e.statusCode === 422 && /Tally can't accept/.test(e.message));
});

await ok('cancel → CANCEL with the voucher data Tally holds', async () => {
  currentJob = synced(); updates.length = 0;
  const plan = await planTallyChange(args({ action: 'status', docAfter: order({ status: 'Cancelled' }) }));
  await plan.commit();
  assert.equal(updates[0].upd.$set.operation, 'CANCEL');
  assert.equal(updates[0].upd.$set.payloadSnapshot.lines[0].qty, 2);
});

await ok('delete → DELETE queued', async () => {
  currentJob = synced(); updates.length = 0;
  const plan = await planTallyChange(args({ action: 'delete', docAfter: null }));
  await plan.commit();
  assert.equal(updates[0].upd.$set.operation, 'DELETE');
});

await ok('connector mid-job → 409, nothing saved', async () => {
  currentJob = synced({ status: 'PROCESSING' });
  await assert.rejects(planTallyChange(args({ action: 'edit', docAfter: order() })), (e) => e.statusCode === 409);
});

await ok('queue update loses a race → re-plans once and queues against the fresh job', async () => {
  currentJob = synced(); updates.length = 0;
  const doc = order({ items: [{ modelCode: 'P1', qty: 5, price: 100 }], grandTotal: 500 });
  const plan = await planTallyChange(args({ action: 'edit', docAfter: doc }));
  updateResult = 0;                     // first commit misses (job changed)
  const replan = async () => { updateResult = 1; currentJob = synced({ updatedAt: new Date() }); return planTallyChange(args({ action: 'edit', docAfter: doc })); };
  await saveWithTally({ plan, replan, save: async () => {} });
  assert.equal(updates.length, 2);
  assert.equal(updates[1].upd.$set.operation, 'ALTER');
});

await ok('queue cannot be updated at all → clear 500 after save (admin can Resend)', async () => {
  currentJob = synced(); updates.length = 0; updateResult = 0;
  const doc = order({ items: [{ modelCode: 'P1', qty: 6, price: 100 }], grandTotal: 600 });
  const plan = await planTallyChange(args({ action: 'edit', docAfter: doc }));
  let saved = 0;
  await assert.rejects(saveWithTally({ plan, replan: () => planTallyChange(args({ action: 'edit', docAfter: doc })), save: async () => { saved++; } }),
    (e) => e.statusCode === 500 && /Resend/.test(e.message));
  assert.equal(saved, 1);
  updateResult = 1;
});

console.log(`\n${n} tally sync planner tests passed`);
process.exit(0);
