import assert from 'node:assert/strict';
import { Lead } from '../src/models/Lead.js';
import { ensureBuyerForOrder, findLeadForOrder, createBuyerLeadSafely } from '../src/utils/orderBuyer.js';
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };

let store, creates, seq, onCreate;
const m = (v, x) => (v instanceof RegExp ? v.test(x ?? '') : v === x);
const reset = () => {
  seq = 0; creates = []; onCreate = null;
  store = [
    { _id: 'L1', company: 'c', name: 'Known', mobileKey: '971506731305', altMobile: '', status: 'New', owner: 'u9', ownerName: 'Old', createdAt: 1 },
    { _id: 'L2', company: 'c', name: 'Legacy wrong dial', mobileKey: '91711876534', altMobile: '', status: 'Contacted', owner: 'u1', createdAt: 2 },   // Kenyan number saved under +91
    { _id: 'L3', company: 'c', name: 'Has alt', mobileKey: '971500000001', altMobile: '+971 50-777 8899', status: 'Interested', owner: 'u1', createdAt: 3 },
    { _id: 'X',  company: 'other', name: 'Other tenant', mobileKey: '971555111222', altMobile: '', status: 'New', owner: 'z', createdAt: 4 },
  ];
};
const match = (l, q) => Object.entries(q).every(([k, v]) => m(v, l[k]));
Lead.findOne = async (q) => store.find((l) => match(l, q)) || null;
Lead.find = (q) => ({ sort: async () => store.filter((l) => match(l, q)).sort((a, b) => a.createdAt - b.createdAt || String(a._id).localeCompare(String(b._id))) });
Lead.updateOne = async (f, u) => { const l = store.find((x) => x._id === f._id); if (!l || l.status === 'Won') return { modifiedCount: 0 }; Object.assign(l, u.$set); return { modifiedCount: 1 }; };
Lead.deleteOne = async (f) => { store = store.filter((l) => l._id !== f._id); return { deletedCount: 1 }; };
Lead.create = async (d) => {
  await new Promise((r) => setTimeout(r, 5));            // yield, like a real DB round-trip
  const l = { _id: 'N' + (++seq), createdAt: 100 + seq, altMobile: '', mobileKey: '971' + String(d.mobile).replace(/\D/g, '').replace(/^0+/, ''), ...d };
  store.push(l); creates.push(l);
  if (onCreate) onCreate(l);
  return l;
};
const user = { _id: 'admin1', name: 'Admin' };
const order = (o) => ({ company: 'c', orderNo: 370, customer: 'Sam Trading', mobile: '555111222', country: 'UAE', salesperson: 'u1', salespersonName: 'Revanth Kumar', ...o });

reset();
await ok('exact phone → existing lead used, nothing created', async () => {
  assert.equal(await ensureBuyerForOrder(order({ mobile: '506731305' }), { byUser: user }), 'marked');
  assert.equal(creates.length, 0); assert.equal(store[0].status, 'Won');
});
await ok('typed with leading 0 and spaces still matches', async () => {
  reset();
  assert.equal((await findLeadForOrder(order({ mobile: '050 673 1305' })))._id, 'L1');
});
await ok('lead saved under a WRONG dial code is found by the typed digits (no duplicate)', async () => {
  reset();
  const l = await findLeadForOrder(order({ mobile: '0711876534', country: 'Kenya' }));
  assert.equal(l._id, 'L2');
});
await ok("customer's ALTERNATE number matches the same lead (no duplicate)", async () => {
  reset();
  const l = await findLeadForOrder(order({ mobile: '507778899' }));
  assert.equal(l._id, 'L3');
  assert.equal(await ensureBuyerForOrder(order({ mobile: '507778899' }), { byUser: user }), 'marked');
  assert.equal(creates.length, 0);
});
await ok('other companies are never matched', async () => {
  reset();
  assert.equal(await findLeadForOrder(order({ mobile: '555111222' })), null);
});
await ok('brand-new customer → exactly one lead created', async () => {
  reset();
  assert.equal(await ensureBuyerForOrder(order(), { byUser: user }), 'created');
  assert.equal(creates.length, 1); assert.equal(creates[0].status, 'Won'); assert.equal(creates[0].owner, 'u1');
});
await ok('TWO orders for the same new customer at the same moment → ONE lead', async () => {
  reset();
  const res = await Promise.all([
    ensureBuyerForOrder(order({ orderNo: 380 }), { byUser: user }),
    ensureBuyerForOrder(order({ orderNo: 381 }), { byUser: user }),
    ensureBuyerForOrder(order({ orderNo: 382 }), { byUser: user }),
  ]);
  assert.equal(creates.length, 1, 'only one lead may be created');
  assert.equal(store.filter((l) => l.mobileKey === '971555111222' && l.company === 'c').length, 1);
  assert.deepEqual(res.sort(), ['already', 'already', 'created']);
});
await ok('cross-server race (no unique index): another process inserts the same phone first → keep the OLDEST, remove ours', async () => {
  reset();
  onCreate = () => { store.push({ _id: 'A-OTHER', company: 'c', name: 'Other server', mobileKey: '971555111222', altMobile: '', status: 'New', owner: 'u3', createdAt: 50 }); };
  const r = await createBuyerLeadSafely(order(), { byUser: user });
  assert.equal(r.created, false); assert.equal(r.lead._id, 'A-OTHER');
  assert.equal(store.filter((l) => l.mobileKey === '971555111222' && l.company === 'c').length, 1);
  assert.equal(await ensureBuyerForOrder(order(), { byUser: user }), 'marked'); // that surviving lead becomes the Buyer
  assert.equal(store.find((l) => l._id === 'A-OTHER').status, 'Won');
});
await ok('unusable phone number → skipped, no junk lead', async () => {
  reset();
  assert.equal(await ensureBuyerForOrder(order({ mobile: '12' }), { byUser: user }), 'skipped');
  assert.equal(creates.length, 0);
});
await ok('second order from the same customer later → already a Buyer, still one lead', async () => {
  reset();
  await ensureBuyerForOrder(order(), { byUser: user });
  assert.equal(await ensureBuyerForOrder(order({ orderNo: 371 }), { byUser: user }), 'already');
  assert.equal(creates.length, 1);
});
console.log(`\n${n} passed`);
process.exit(0);
