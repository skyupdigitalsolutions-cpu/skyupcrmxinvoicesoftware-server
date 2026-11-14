// Run: node tests/tallyDecide.test.mjs   (no database needed)
import assert from 'node:assert/strict';
import { decideTallyChange as d } from '../src/utils/tallyDecide.js';
import { tallyRelevantEqual } from '../src/utils/tallyPayload.js';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };
const active = { status: 'Confirmed' };
const cancelled = { status: 'Cancelled' };
const job = (over) => ({ reference: 'CRM-SO-1', status: 'SYNCED', operation: 'CREATE', syncedAt: new Date(), tallyState: 'ACTIVE', ...over });

ok('no job / unlinked job → normal CRM behaviour', () => {
  assert.equal(d({ job: null, action: 'edit', docAfter: active }).kind, 'NONE');
  assert.equal(d({ job: job({ status: 'DETACHED' }), action: 'delete' }).kind, 'NONE');
});
ok('busy or under review → blocked', () => {
  assert.equal(d({ job: job({ status: 'PROCESSING' }), action: 'edit', docAfter: active }).kind, 'BLOCK');
  assert.equal(d({ job: job({ status: 'NEEDS_REVIEW' }), action: 'delete' }).kind, 'BLOCK');
});
ok('queued but never sent: edit refreshes, cancel/delete removes from queue', () => {
  const q = job({ status: 'PENDING', syncedAt: null, tallyState: '' });
  assert.equal(d({ job: q, action: 'edit', docAfter: active }).kind, 'REFRESH_CREATE');
  assert.equal(d({ job: q, action: 'status', docAfter: cancelled }).kind, 'DETACH_PENDING');
  assert.equal(d({ job: q, action: 'delete' }).kind, 'DETACH_PENDING');
  assert.equal(d({ job: q, action: 'status', docAfter: { status: 'Packed' } }).kind, 'NONE');
});
ok('failed create (nothing in Tally): free edits; delete detaches', () => {
  const f = job({ status: 'FAILED', syncedAt: null, tallyState: '' });
  assert.equal(d({ job: f, action: 'edit', docAfter: active }).kind, 'NONE');
  assert.equal(d({ job: f, action: 'delete' }).kind, 'DETACH_PENDING');
});
ok('in Tally: edit → ALTER, cancel → CANCEL, delete → DELETE', () => {
  assert.deepEqual(d({ job: job(), action: 'edit', docAfter: active }), { kind: 'ENQUEUE', operation: 'ALTER' });
  assert.deepEqual(d({ job: job(), action: 'status', docAfter: cancelled }), { kind: 'ENQUEUE', operation: 'CANCEL' });
  assert.deepEqual(d({ job: job(), action: 'delete' }), { kind: 'ENQUEUE', operation: 'DELETE' });
});
ok('delivery stage change does not touch Tally', () => {
  assert.equal(d({ job: job(), action: 'status', docAfter: { status: 'Delivered' } }).kind, 'NONE');
});
ok('pending ALTER + another edit → ALTER again (latest data wins)', () => {
  assert.equal(d({ job: job({ status: 'PENDING', operation: 'ALTER' }), action: 'edit', docAfter: active }).operation, 'ALTER');
});
ok('cancel queued then un-cancelled before sending → withdrawn', () => {
  assert.equal(d({ job: job({ status: 'PENDING', operation: 'CANCEL' }), action: 'status', docAfter: active }).kind, 'WITHDRAW');
});
ok('cancelled in Tally, reactivated in CRM → ALTER with reactivate', () => {
  assert.deepEqual(d({ job: job({ tallyState: 'CANCELLED', operation: 'CANCEL' }), action: 'status', docAfter: active }),
    { kind: 'ENQUEUE', operation: 'ALTER', reactivate: true });
});
ok('editing an order that is cancelled in CRM and Tally → CRM only', () => {
  assert.equal(d({ job: job({ tallyState: 'CANCELLED', operation: 'CANCEL' }), action: 'edit', docAfter: cancelled }).kind, 'NONE');
});
ok('failed ALTER (voucher still in Tally) + edit → ALTER again', () => {
  assert.equal(d({ job: job({ status: 'FAILED', operation: 'ALTER' }), action: 'edit', docAfter: active }).operation, 'ALTER');
});
ok('tallyRelevantEqual ignores CRM-only changes', () => {
  const a = { date: '20261112', partyLedger: 'X', accountLedger: 'S', godown: 'G', narration: 'n', total: 10, voucherTypeName: 'Sales Order', lines: [{ stockItem: 'I', unit: 'PCS', qty: 1, rate: 10, amount: 10 }] };
  assert.equal(tallyRelevantEqual(a, { ...a, source: { id: 'z' } }), true);
  assert.equal(tallyRelevantEqual(a, { ...a, lines: [{ ...a.lines[0], qty: 2, amount: 20 }] }), false);
});
console.log(`\n${n} tally decision tests passed`);
