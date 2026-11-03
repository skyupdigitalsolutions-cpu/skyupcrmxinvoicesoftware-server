import assert from 'node:assert/strict';
import { orderCoverage } from '../src/utils/leadStatusAt.js';
const orders = [
  { orderNo: 1, mobile: '506731305', country: 'UAE' },
  { orderNo: 2, mobile: '506731305', country: 'UAE' },   // same customer as #1
  { orderNo: 3, mobile: '500000009', country: 'UAE' },
  { orderNo: 4, mobile: '555111222', country: 'UAE' },   // no lead
];
const leads = [{ mobileKey: '971506731305' }, { mobileKey: '971500000009' }, { mobileKey: '971500000777' }];
const c = orderCoverage(leads, orders);
assert.deepEqual(c, { orders: 4, customers: 2, withoutLead: 1 });
console.log('  ✓ 4 orders → 2 customers, 1 order with no lead');
assert.deepEqual(orderCoverage(leads, []), { orders: 0, customers: 0, withoutLead: 0 });
console.log('  ✓ no orders');
process.exit(0);
