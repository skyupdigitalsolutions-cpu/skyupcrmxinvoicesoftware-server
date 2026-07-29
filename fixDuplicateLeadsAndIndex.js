/**
 * fixDuplicateLeadsAndIndex.js
 * One-time repair script. Run this ONCE to:
 *   1. Merge any leads that currently share the same phone number (same logic
 *      as the app's "Duplicates" merge feature — combines call logs/notes/
 *      edit history into the oldest lead, reassigns any Cheque/WhatsApp
 *      message/Notification records, archives the removed lead(s) to
 *      Deleted Contacts, then deletes them).
 *   2. Fix the (company, mobileKey) index itself: your database currently has
 *      a PLAIN (non-unique) index under that name from before the unique
 *      constraint was added. MongoDB does not auto-upgrade an existing
 *      index's options — it has to be dropped and recreated. This script
 *      does that safely, only once the data is confirmed duplicate-free.
 *
 * Run from your server project root (same folder as .env / package.json):
 *   node fixDuplicateLeadsAndIndex.js
 *
 * Safe to run more than once — if there are no duplicates and the index is
 * already correct, it just confirms that and exits.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('✗ MONGO_URI is not set. Run this from your server project root (where .env lives).');
  process.exit(1);
}

const { Lead } = await import('./src/models/Lead.js');
const { Cheque } = await import('./src/models/Cheque.js');
const { WhatsAppMessage } = await import('./src/models/WhatsAppMessage.js');
const { Notification } = await import('./src/models/Notification.js');
const { DeletedContact } = await import('./src/models/DeletedContact.js');

async function mergeGroup(group) {
  // Oldest lead (by createdAt) is kept, matching the app's default.
  const ids = group.ids;
  const leads = await Lead.find({ _id: { $in: ids } }).sort({ createdAt: 1 });
  if (leads.length < 2) return null;

  const keepLead = leads[0];
  const duplicates = leads.slice(1);

  let mergedCallLogs = 0;
  let mergedNotes = 0;

  for (const dup of duplicates) {
    if (dup.callLogs && dup.callLogs.length) {
      keepLead.callLogs.push(...dup.callLogs);
      mergedCallLogs += dup.callLogs.length;
    }
    if (dup.notes && dup.notes.length) {
      keepLead.notes.push(...dup.notes);
      mergedNotes += dup.notes.length;
    }
    if (dup.editHistory && dup.editHistory.length) {
      keepLead.editHistory.push(...dup.editHistory);
    }
    keepLead.editHistory.push({
      by: keepLead.owner,
      byName: 'Repair script',
      changes: [{ field: 'merged', from: null, to: `Merged duplicate lead "${dup.name}" (${dup._id}) into this one` }],
    });

    await Promise.all([
      Cheque.updateMany({ lead: dup._id }, { $set: { lead: keepLead._id } }),
      WhatsAppMessage.updateMany({ lead: dup._id }, { $set: { lead: keepLead._id } }),
      Notification.updateMany({ lead: dup._id }, { $set: { lead: keepLead._id } }),
    ]);

    try {
      await DeletedContact.create({
        company: dup.company,
        name: dup.name || '',
        mobile: dup.mobile || '',
        mobileKey: dup.mobileKey || '',
        email: dup.email || '',
        country: dup.country || '',
        city: dup.city || '',
        source: dup.source || '',
        status: dup.status || '',
        interest: dup.interest || '',
        ownerName: dup.ownerName || '',
        originalLeadId: dup._id,
        deletedBy: null,
        deletedByName: 'Repair script',
        leadCreatedAt: dup.createdAt || null,
      });
    } catch (err) {
      console.error(`   ⚠ Could not archive duplicate ${dup._id} to Deleted Contacts:`, err.message);
    }
  }

  await keepLead.save();
  await Lead.deleteMany({ _id: { $in: duplicates.map((d) => d._id) } });

  return { keptName: keepLead.name, keptId: keepLead._id, mergedCount: duplicates.length, mergedCallLogs, mergedNotes };
}

async function main() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(`✓ Connected: ${mongoose.connection.host}\n`);

  const leadsCollection = mongoose.connection.db.collection('leads');

  // ── Step 1: find & merge any remaining duplicates ─────────────────────────
  console.log('── Step 1: Scanning for duplicate phone numbers ──');
  const dupes = await leadsCollection.aggregate([
    { $match: { mobileKey: { $ne: '' } } },
    { $group: { _id: { company: '$company', mobileKey: '$mobileKey' }, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  if (!dupes.length) {
    console.log('✅ No duplicate phone numbers found — nothing to merge.\n');
  } else {
    console.log(`Found ${dupes.length} duplicate group(s). Merging…\n`);
    for (const group of dupes) {
      const result = await mergeGroup(group);
      if (result) {
        console.log(`  ✓ Merged ${result.mergedCount} duplicate(s) into "${result.keptName}" (${result.keptId}) — combined ${result.mergedCallLogs} call log(s) and ${result.mergedNotes} note(s).`);
      }
    }
    console.log('');
  }

  // ── Step 2: fix the index itself ──────────────────────────────────────────
  console.log('── Step 2: Checking the (company, mobileKey) index ──');
  const indexes = await leadsCollection.indexes();
  const existing = indexes.find((idx) => idx.key && idx.key.company === 1 && idx.key.mobileKey === 1);

  if (existing && existing.unique) {
    console.log('✅ The unique index already exists and is correctly configured. Nothing to do.\n');
  } else {
    if (existing) {
      console.log(`Found an existing NON-unique index "${existing.name}" on the same fields — MongoDB won't`);
      console.log('upgrade it in place, so it has to be dropped and recreated with the unique option.');
      await leadsCollection.dropIndex(existing.name);
      console.log(`  ✓ Dropped old index "${existing.name}".`);
    }

    // Re-verify the data is actually clean right now before creating a
    // unique index — if a merge above failed partway, this would throw a
    // clear "duplicate key" error rather than silently failing again.
    try {
      await leadsCollection.createIndex(
        { company: 1, mobileKey: 1 },
        { unique: true, partialFilterExpression: { mobileKey: { $gt: '' } }, name: 'company_1_mobileKey_1' }
      );
      console.log('  ✓ Created the unique (company, mobileKey) index successfully.\n');
    } catch (err) {
      console.error('  ✗ Failed to create the unique index:', err.message);
      console.error('    There may still be a duplicate the merge step above missed — re-run this script,');
      console.error('    or check checkDuplicateIndex.js again to see what remains.\n');
    }
  }

  // ── Final confirmation ─────────────────────────────────────────────────────
  const finalIndexes = await leadsCollection.indexes();
  const finalUnique = finalIndexes.find((idx) => idx.unique && idx.key && idx.key.company === 1 && idx.key.mobileKey === 1);
  console.log('── Final state ──');
  console.log(finalUnique ? '✅ Unique duplicate-phone protection is now ACTIVE.' : '❌ Still not active — see errors above.');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ Repair script failed:', err.message);
  process.exit(1);
});