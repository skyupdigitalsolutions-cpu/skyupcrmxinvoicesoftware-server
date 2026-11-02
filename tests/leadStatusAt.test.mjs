import assert from 'node:assert/strict';
import { statusAsOf, applyAsOf, wonDates, normalizeStatus } from '../src/utils/leadStatusAt.js';

const IST = -330; // Date#getTimezoneOffset() for Asia/Kolkata
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };

// Customer created 5 Oct, order placed (→ Won) 30 Oct 14:00 IST, auto-reset 1 Nov 00:05
const legacyReset = {
  _id: 'A', createdAt: '2026-10-05T04:00:00Z', status: 'Interested', converted: true,
  editHistory: [
    { at: '2026-10-30T08:30:00Z', changes: [{ field: 'status', from: 'Interested', to: 'Won' }] },
    // exactly what the OLD scheduler wrote:
    { at: '2026-10-31T18:35:00Z', changes: [{ field: 'status', from: 'Won', to: 'Interested — all Buyers reset to Opportunity monthly' }] },
  ],
};
console.log('Scenario: buy on 30 Oct, reset on 1 Nov');
ok('report for 30 Oct → Buyer',          () => assert.equal(statusAsOf(legacyReset, new Date('2026-10-30T18:29:59.999Z')), 'Won'));
ok('report for 31 Oct → still Buyer',    () => assert.equal(statusAsOf(legacyReset, new Date('2026-10-31T18:29:59.999Z')), 'Won'));
ok('report for 2 Nov  → Opportunity',    () => assert.equal(statusAsOf(legacyReset, new Date('2026-11-02T18:29:59.999Z')), 'Interested'));
ok('report for 4 Oct  → did not exist',  () => assert.equal(statusAsOf(legacyReset, new Date('2026-10-04T18:29:59.999Z')), null));
ok('report for 10 Oct → Interested (pre-order)', () => assert.equal(statusAsOf(legacyReset, new Date('2026-10-10T18:29:59.999Z')), 'Interested'));

console.log('applyAsOf (what the /leads?asOf= endpoint returns)');
const raw = [legacyReset];
ok('30 Oct list: Buyer, editHistory stripped', () => {
  const [r] = applyAsOf(raw, { asOf: '2026-10-30', from: '2026-10-30', tz: IST });
  assert.equal(r.status, 'Won'); assert.equal(r.currentStatus, 'Interested');
  assert.equal(r.editHistory, undefined); assert.equal(r.buyerActivityInRange, true);
});
ok('Nov list: Opportunity, shown because reset happened in range', () => {
  const [r] = applyAsOf(raw, { asOf: '2026-11-02', from: '2026-11-01', tz: IST });
  assert.equal(r.status, 'Interested'); assert.equal(r.buyerActivityInRange, true);
});
ok('non-Buyer status change does NOT count as buyer activity', () => {
  const l = { createdAt: '2026-01-01T00:00:00Z', status: 'Contacted', editHistory: [
    { at: '2026-11-02T00:00:00Z', changes: [{ field: 'status', from: 'New', to: 'Contacted' }] }] };
  const [r] = applyAsOf([l], { asOf: '2026-11-30', from: '2026-11-01', tz: IST });
  assert.equal(r.buyerActivityInRange, false);
});
ok('lead created later is dropped', () => assert.equal(applyAsOf(raw, { asOf: '2026-10-01', tz: IST }).length, 0));

console.log('Robustness');
ok('unlogged conversion (convertLead) before a logged reset is still Buyer', () => {
  const l = { createdAt: '2026-09-01T00:00:00Z', status: 'Interested', editHistory: [
    { at: '2026-09-05T00:00:00Z', changes: [{ field: 'status', from: 'New', to: 'Contacted' }] },
    { at: '2026-10-31T18:35:00Z', changes: [{ field: 'status', from: 'Won', to: 'Interested' }] }] };
  assert.equal(statusAsOf(l, new Date('2026-10-30T12:00:00Z')), 'Won');
});
ok('no history → live status', () => assert.equal(statusAsOf({ createdAt: '2026-01-01', status: 'Won', editHistory: [] }, new Date('2026-10-30')), 'Won'));
ok('repeat buyer: two Won events', () => {
  const l = { editHistory: [
    { at: '2026-10-30T00:00:00Z', changes: [{ field: 'status', from: 'Interested', to: 'Won' }] },
    { at: '2026-10-31T18:35:00Z', changes: [{ field: 'status', from: 'Won', to: 'Interested' }] },
    { at: '2026-11-05T00:00:00Z', changes: [{ field: 'status', from: 'Interested', to: 'Won' }] }] };
  assert.equal(wonDates(l).length, 2);
});
ok('normalizeStatus', () => {
  assert.equal(normalizeStatus('Contacted — replied on WhatsApp'), 'Contacted');
  assert.equal(normalizeStatus('Follow-up'), 'Follow-up');
  assert.equal(normalizeStatus('Wonderful'), null);
});
console.log(`\n${n} passed`);
