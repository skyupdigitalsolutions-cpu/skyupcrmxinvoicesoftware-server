// Run: node tests/tallyPayload.test.mjs   (no database needed)
import assert from 'node:assert/strict';
import {
  buildTallySnapshot, collectMappingKeys, itemKey, itemAnySizeKey, toTallyDate, normalizeKey,
  SALES_ORDER, PURCHASE_ORDER,
} from '../src/utils/tallyPayload.js';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };

const settings = {
  tallyCompanyName: 'Neo Spotek - Test', baseCurrency: 'AED', salesOrderVoucherType: 'Sales Order',
  purchaseOrderVoucherType: 'Purchase Order', salesLedger: 'Sales Account', purchaseLedger: 'Purchase Account',
  godown: 'Main Location', timezone: 'Asia/Dubai',
};
const maps = () => ({
  party: new Map([['crm test customer', { tallyName: 'CRM Test Customer' }], ['crm test supplier', { tallyName: 'CRM Test Supplier' }]]),
  item: new Map([[itemAnySizeKey('CRM-PROD'), { tallyName: 'CRM Test Product', tallyUnit: 'PCS' }]]),
  unit: new Map([['pair', { tallyName: 'PCS' }]]),
});
const order = (over = {}) => ({
  _id: 'o1', orderNo: 1024, date: new Date('2026-11-11T21:30:00Z'), customer: '  CRM  Test Customer ',
  status: 'Confirmed', discount: 0, grandTotal: 200, salespersonName: 'Rose',
  items: [{ modelCode: 'CRM-PROD', size: '42', unit: 'PAIR', qty: 2, price: 100 }], ...over,
});

ok('date converts to Dubai calendar day (UTC 21:30 → next day)', () => {
  assert.equal(toTallyDate(new Date('2026-11-11T21:30:00Z'), 'Asia/Dubai'), '20261112');
  assert.equal(toTallyDate('garbage'), null);
});

ok('keys normalize case and spacing; any-size fallback', () => {
  assert.equal(normalizeKey('  Al  Noor '), 'al noor');
  assert.equal(itemKey('SS-201', ''), 'ss-201|*');
  assert.equal(itemKey('SS-201', '42'), 'ss-201|42');
});

ok('controlled test order builds the exact brief payload', () => {
  const r = buildTallySnapshot({ sourceType: SALES_ORDER, doc: order(), companyId: 'c1', currencyCode: 'AED', settings, maps: maps() });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const p = r.payload;
  assert.equal(p.reference, 'CRM-SO-1024');
  assert.equal(p.idempotencyKey, 'SO:c1:1024');
  assert.equal(p.date, '20261112');
  assert.equal(p.partyLedger, 'CRM Test Customer');
  assert.deepEqual(p.lines.map(({ crm, ...l }) => l), [{ stockItem: 'CRM Test Product', unit: 'PCS', qty: 2, rate: 100, amount: 200 }]);
  assert.equal(p.total, 200);
});

ok('discount % is folded into rate', () => {
  const r = buildTallySnapshot({ sourceType: SALES_ORDER, doc: order({ discount: 10, grandTotal: 180 }), companyId: 'c1', currencyCode: 'AED', settings, maps: maps() });
  assert.equal(r.ok, true);
  assert.equal(r.payload.lines[0].rate, 90);
  assert.equal(r.payload.lines[0].amount, 180);
});

ok('pending order, wrong currency, unmapped item are all reported', () => {
  const r = buildTallySnapshot({
    sourceType: SALES_ORDER, companyId: 'c1', currencyCode: 'INR', settings, maps: maps(),
    doc: order({ status: 'Pending', items: [{ modelCode: 'NOPE', qty: 1, price: 5 }], grandTotal: 5 }),
  });
  assert.equal(r.ok, false);
  const codes = r.errors.map((e) => e.code);
  assert.ok(codes.includes('INVALID_STATUS'));
  assert.ok(codes.includes('CURRENCY_MISMATCH'));
  assert.ok(codes.includes('UNMAPPED_MASTER'));
});

ok('amount mismatch is caught', () => {
  const r = buildTallySnapshot({ sourceType: SALES_ORDER, doc: order({ grandTotal: 999 }), companyId: 'c1', currencyCode: 'AED', settings, maps: maps() });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'AMOUNT_MISMATCH');
});

ok('zero qty line rejected', () => {
  const r = buildTallySnapshot({ sourceType: SALES_ORDER, doc: order({ items: [{ modelCode: 'CRM-PROD', qty: 0, price: 1 }], grandTotal: 0 }), companyId: 'c1', currencyCode: 'AED', settings, maps: maps() });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'INVALID_LINE'));
});

ok('purchase order: only Ordered/Received; unit comes from item mapping', () => {
  const po = { _id: 'p1', poNo: 55, date: new Date('2026-11-12T08:00:00Z'), supplierName: 'CRM Test Supplier', status: 'Draft',
    grandTotal: 300, items: [{ modelCode: 'CRM-PROD', qty: 3, price: 100 }] };
  const bad = buildTallySnapshot({ sourceType: PURCHASE_ORDER, doc: po, companyId: 'c1', currencyCode: 'AED', settings, maps: maps() });
  assert.equal(bad.ok, false);
  const good = buildTallySnapshot({ sourceType: PURCHASE_ORDER, doc: { ...po, status: 'Ordered' }, companyId: 'c1', currencyCode: 'AED', settings, maps: maps() });
  assert.equal(good.ok, true, JSON.stringify(good.errors));
  assert.equal(good.payload.reference, 'CRM-PO-55');
  assert.equal(good.payload.accountLedger, 'Purchase Account');
  assert.equal(good.payload.lines[0].unit, 'PCS');
});

ok('missing ledger setting blocks sync', () => {
  const r = buildTallySnapshot({ sourceType: SALES_ORDER, doc: order(), companyId: 'c1', currencyCode: 'AED', settings: { ...settings, salesLedger: '' }, maps: maps() });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'SETTINGS_MISSING'));
});

ok('collectMappingKeys asks for exact size and any-size', () => {
  const k = collectMappingKeys(SALES_ORDER, order());
  assert.equal(k.partyKind, 'customer');
  assert.equal(k.partyKey, 'crm test customer');
  assert.deepEqual(k.itemKeys.sort(), ['crm-prod|*', 'crm-prod|42']);
  assert.deepEqual(k.unitKeys, ['pair']);
});

console.log(`\n${n} tally payload tests passed`);
