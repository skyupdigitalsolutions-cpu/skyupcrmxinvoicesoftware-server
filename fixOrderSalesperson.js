/**
 * fixOrderSalesperson.js
 * One-time repair — fills in the salesperson on old orders that have none, so
 * the "By Salesperson (Orders)" report stops showing "—".
 *
 * For each order with no salesperson (or a salesperson whose name is blank) it
 * uses, in this order:
 *   1) the user who created the order (createdBy)
 *   2) the owner of the lead that was converted to this order (same orderNo)
 * and writes salesperson + salespersonName. Orders it cannot resolve are
 * listed so you can assign them by hand (Order edit → Salesperson).
 *
 * Run from your server project root (where .env lives):
 *   node fixOrderSalesperson.js            # DRY RUN — only shows what it would do
 *   node fixOrderSalesperson.js --apply    # actually writes the changes
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();
const uri = process.env.MONGO_URI;
if (!uri) { console.error('✗ MONGO_URI is not set. Run this from your server project root.'); process.exit(1); }
const APPLY = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(`✓ Connected: ${mongoose.connection.host}  (${APPLY ? 'APPLY' : 'DRY RUN'})\n`);
  const db = mongoose.connection.db;
  const orders = db.collection('orders');
  const users = db.collection('users');
  const leads = db.collection('leads');

  const userName = new Map((await users.find({}, { projection: { name: 1 } }).toArray()).map((u) => [String(u._id), u.name]));

  const broken = await orders.find({
    $or: [
      { salesperson: { $in: [null, undefined] } }, { salesperson: { $exists: false } },
      { salespersonName: { $in: [null, ''] } }, { salespersonName: { $exists: false } },
    ],
  }).toArray();
  console.log(`Orders missing a salesperson or name: ${broken.length}\n`);

  let fixed = 0; const unresolved = [];
  for (const o of broken) {
    let spId = o.salesperson || null;
    if (!spId && o.createdBy) spId = o.createdBy;
    if (!spId) {
      const lead = await leads.findOne({ company: o.company, orderNo: o.orderNo }, { projection: { owner: 1 } });
      if (lead?.owner) spId = lead.owner;
    }
    const name = spId ? userName.get(String(spId)) : null;
    if (!spId || !name) { unresolved.push(`#${o.orderNo} ${o.customer}`); continue; }
    console.log(`  #${o.orderNo}  ${o.customer}  →  ${name}`);
    if (APPLY) await orders.updateOne({ _id: o._id }, { $set: { salesperson: spId, salespersonName: name } });
    fixed++;
  }

  console.log(`\n${APPLY ? 'Updated' : 'Would update'}: ${fixed}`);
  if (unresolved.length) {
    console.log(`Could not resolve ${unresolved.length} order(s) — assign these manually:`);
    unresolved.slice(0, 50).forEach((s) => console.log('  ' + s));
  }
  if (!APPLY && fixed) console.log('\nRe-run with --apply to save these changes.');
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
