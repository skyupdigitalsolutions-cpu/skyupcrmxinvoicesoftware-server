/**
 * backfillBuyersFromOrders.js
 * Diagnoses — and optionally repairs — orders whose customer is NOT a Buyer on the Leads page.
 *
 * The Leads page "Buyers" count = leads whose status is Won (this month's buyers; the monthly
 * reset turns last month's back into Opportunity). Before createOrder linked the lead itself,
 * an order only produced a Buyer if the order form's follow-up call succeeded, so some orders
 * were left with no Buyer. This lists every order of the month with what happened to its lead.
 *
 *   node backfillBuyersFromOrders.js                     → DRY RUN for the current month (changes nothing)
 *   node backfillBuyersFromOrders.js --apply             → mark the matched leads as Buyers
 *   node backfillBuyersFromOrders.js --apply --create-missing
 *                                                         → also create a lead (status Won) for orders with no CRM lead
 *   node backfillBuyersFromOrders.js --month 2026-10     → dry run for another month (--apply is refused for past
 *                                                          months: the lead's status is "now", so it would make them
 *                                                          this month's buyers)
 *
 * Run from the server project root (needs MONGO_URI in .env). Safe to re-run.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();
const uri = process.env.MONGO_URI;
if (!uri) { console.error('✗ MONGO_URI is not set. Run this from your server project root.'); process.exit(1); }

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const CREATE = args.includes('--create-missing');
const mi = args.indexOf('--month');
const now = new Date();
const monthStr = mi >= 0 ? args[mi + 1] : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
if (!/^\d{4}-\d{2}$/.test(monthStr || '')) { console.error('✗ --month must look like 2026-11'); process.exit(1); }
const isCurrentMonth = monthStr === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
if (APPLY && !isCurrentMonth) {
  console.error(`✗ --apply only works for the current month. A past month's buyers can't be created now (they would be reset anyway).`);
  process.exit(1);
}
if (CREATE && !APPLY) { console.error('✗ --create-missing needs --apply'); process.exit(1); }

const [Y, M] = monthStr.split('-').map(Number);
const start = new Date(Date.UTC(Y, M - 1, 1));
const end = new Date(Date.UTC(Y, M, 1));

const { reconcileOrderBuyers } = await import('./src/utils/orderBuyer.js');

await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
console.log(`✓ Connected: ${mongoose.connection.host}`);
console.log(`Orders dated ${monthStr} (non-cancelled) — ${APPLY ? 'APPLYING CHANGES' : 'DRY RUN, nothing will be changed'}\n`);

const { rows, summary } = await reconcileOrderBuyers({ month: monthStr, apply: APPLY, createMissing: CREATE });
const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);
const LABEL = {
  ok: (r) => `ok — "${r.leadName}" is already a Buyer`,
  missing: (r) => `MISSING BUYER — "${r.leadName}" is still "${r.leadStatus}"`,
  fixed: (r) => `FIXED — "${r.leadName}" is now a Buyer`,
  no_lead: () => 'NO LEAD in CRM (no lead matches this phone number)',
  created: (r) => `NO LEAD → lead "${r.leadName}" created as Buyer`,
  error: (r) => `ERROR — ${r.error}`,
};
console.log(`${pad('ORDER', 7)}${pad('DATE', 11)}${pad('CUSTOMER', 28)}${pad('MOBILE', 16)}RESULT`);
rows.forEach((r) => console.log(`${pad('#' + r.orderNo, 7)}${pad(new Date(r.date).toISOString().slice(0, 10), 11)}${pad(r.customer, 28)}${pad(r.mobile, 16)}${LABEL[r.state](r)}`));

console.log('\n── Summary ──');
console.log(`Orders this month:          ${summary.orders}  (from ${summary.distinctCustomers} distinct CRM customers — several orders from one customer = one Buyer)`);
console.log(`Already a Buyer:            ${summary.ok}`);
if (APPLY) { console.log(`Marked as Buyer now:        ${summary.fixed}`); if (CREATE) console.log(`Leads created:              ${summary.created}`); }
else console.log(`Missing a Buyer (fixable):  ${summary.missing}`);
console.log(`No lead in CRM:             ${summary.noLead}${summary.noLead && !CREATE ? '   (re-run with --apply --create-missing to add them)' : ''}`);
if (summary.errors) console.log(`Errors:                     ${summary.errors}`);
if (!APPLY && (summary.missing || summary.noLead)) console.log('\nRe-run with --apply to fix the "MISSING BUYER" rows.');

await mongoose.disconnect();
process.exit(0);
