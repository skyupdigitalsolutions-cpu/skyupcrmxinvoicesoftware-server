/**
 * checkDuplicateIndex.js
 * One-time diagnostic — checks whether the unique (company, mobileKey) index
 * on the Lead collection actually exists in your live MongoDB, and if not,
 * lists exactly which phone numbers are still duplicated (the most likely
 * reason the index failed to build).
 *
 * Run from your server project root:
 *   node checkDuplicateIndex.js
 *
 * Requires the same MONGO_URI your app already uses (reads it from .env).
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('✗ MONGO_URI is not set. Run this from your server project root (where .env lives).');
  process.exit(1);
}

async function main() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(`✓ Connected: ${mongoose.connection.host}\n`);

  const leadsCollection = mongoose.connection.db.collection('leads');

  // ── 1) Does the unique index actually exist? ────────────────────────────
  const indexes = await leadsCollection.indexes();
  console.log('── Indexes currently on the "leads" collection ──');
  indexes.forEach((idx) => {
    const keyStr = JSON.stringify(idx.key);
    const flags = [idx.unique ? 'UNIQUE' : null, idx.partialFilterExpression ? 'PARTIAL' : null].filter(Boolean).join(', ');
    console.log(`  ${idx.name}  ${keyStr}${flags ? `  [${flags}]` : ''}`);
  });

  const uniqueIndex = indexes.find(
    (idx) => idx.unique && idx.key && idx.key.company === 1 && idx.key.mobileKey === 1
  );

  console.log('');
  if (uniqueIndex) {
    console.log('✅ The unique (company, mobileKey) index EXISTS and is active.');
    console.log('   Duplicate leads with the same phone number should now be impossible to create.');
  } else {
    console.log('❌ The unique (company, mobileKey) index is MISSING.');
    console.log('   This means duplicate-phone protection at the database level is NOT currently active,');
    console.log('   even though the application code expects it to be. This almost always happens because');
    console.log('   duplicate phone numbers already existed in the collection when MongoDB tried to build it —');
    console.log('   MongoDB refuses to create a unique index over data that already violates it.');
  }

  // ── 2) Find any phone numbers that are STILL duplicated right now ──────
  console.log('\n── Scanning for leads that currently share the same phone number ──');
  const dupes = await leadsCollection.aggregate([
    { $match: { mobileKey: { $ne: '' } } },
    { $group: { _id: { company: '$company', mobileKey: '$mobileKey' }, count: { $sum: 1 }, names: { $push: '$name' }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  if (!dupes.length) {
    console.log('✅ No duplicate phone numbers found in the collection right now.');
    if (!uniqueIndex) {
      console.log('   The data is clean — if the index is still missing, try restarting the server now;');
      console.log('   Mongoose should be able to build it successfully against clean data.');
    }
  } else {
    console.log(`❌ Found ${dupes.length} phone number(s) still duplicated:\n`);
    dupes.forEach((d) => {
      console.log(`   ${d._id.mobileKey}  (company ${d._id.company}) — ${d.count} leads: ${d.names.join(', ')}`);
      console.log(`      ids: ${d.ids.join(', ')}`);
    });
    console.log('\n   → Use the "Duplicates" button on the Leads page to merge these, then restart the server.');
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ Diagnostic failed:', err.message);
  process.exit(1);
});