/**
 * fixWrongDialcodeDuplicates.js
 *
 * One-time repair for leads created with the wrong dial code due to the
 * case-sensitivity bug in normalizePhone (e.g. 'IRAN' not matching 'Iran'
 * → silent fallback to 971/UAE → mobileKey '9719173745442' instead of
 * '989173745442').
 *
 * What this script does:
 *   1. Loads every lead and groups them by (company + raw digit suffix).
 *      Leads sharing the same raw digits are duplicates regardless of which
 *      dial code was prepended.
 *   2. For each duplicate group, keeps the OLDEST lead, recomputes its
 *      mobileKey correctly using the fixed normalizePhone, merges call logs /
 *      notes / edit history from the others into it, reassigns Cheques /
 *      WhatsApp messages / Notifications, archives the removed leads to
 *      Deleted Contacts, then deletes them.
 *   3. Reports a full summary at the end.
 *
 * Run from your server project root (same folder as .env / package.json):
 *   node fixWrongDialcodeDuplicates.js
 *
 * Safe to run more than once — groups with only 1 lead are skipped.
 * Deploy the fixed Lead.js BEFORE running this so normalizePhone is correct.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('✗ MONGO_URI not set. Run from server project root where .env lives.');
  process.exit(1);
}

// Import models — uses the FIXED Lead.js (with case-insensitive dialCode).
const { Lead, normalizePhone } = await import('./src/models/Lead.js');
const { Cheque }               = await import('./src/models/Cheque.js');
const { WhatsAppMessage }      = await import('./src/models/WhatsAppMessage.js');
const { Notification }         = await import('./src/models/Notification.js');
const { DeletedContact }       = await import('./src/models/DeletedContact.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip everything except digits, remove a leading 0, return raw local digits. */
function rawDigits(mobile) {
  let p = String(mobile || '').replace(/\D/g, '');
  if (p.startsWith('0')) p = p.slice(1);
  return p;
}

/**
 * From a mobileKey like '9719173745442', extract the longest suffix that
 * looks like a local number (≥ 6 digits). We do this by stripping common
 * dial code prefixes (1–3 digits) until what remains is ≥ 6 digits.
 * The result is the raw local number used as the grouping key.
 */
function localSuffix(mobileKey) {
  const digits = String(mobileKey || '').replace(/\D/g, '');
  // Try stripping 1, 2, then 3 digit prefixes and return the longest remainder
  // that is still a plausible local number (≥ 6 digits). We favour the
  // longest remainder (shortest stripped prefix) that is ≥ 6 digits.
  for (let prefixLen = 1; prefixLen <= 3; prefixLen++) {
    const remainder = digits.slice(prefixLen);
    if (remainder.length >= 6) return remainder; // first match wins (shortest prefix)
  }
  return digits; // fallback: return as-is
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log(`✓ Connected: ${mongoose.connection.host}\n`);

  // Load ALL leads (only fields needed for grouping + merge).
  console.log('Loading all leads…');
  const allLeads = await Lead.find({})
    .select('_id company name mobile mobileKey country city source status interest ownerName owner callLogs notes editHistory createdAt converted orderNo')
    .lean();
  console.log(`  Loaded ${allLeads.length} leads.\n`);

  // ── Step 1: Group by (company + raw digit suffix) ─────────────────────────
  console.log('── Step 1: Grouping by raw phone digits ──');
  const groups = new Map(); // key: `${companyId}::${localDigits}` → [lead, …]

  for (const lead of allLeads) {
    if (!lead.mobileKey) continue; // skip leads with no phone
    const suffix = localSuffix(lead.mobileKey);
    if (suffix.length < 6) continue;
    const groupKey = `${String(lead.company)}::${suffix}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(lead);
  }

  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  console.log(`  Found ${dupGroups.length} duplicate group(s) (same raw digits, different dial code or same).\n`);

  if (!dupGroups.length) {
    console.log('✅ No cross-key duplicates found. Checking for same-key duplicates...\n');
  }

  // ── Step 2: Merge each group ──────────────────────────────────────────────
  console.log('── Step 2: Merging duplicate groups ──\n');
  let totalMerged = 0;

  for (const group of dupGroups) {
    // Sort oldest first — keep the oldest lead.
    group.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const keepLean = group[0];
    const dupLeans  = group.slice(1);

    // Re-fetch the keep lead as a full Mongoose document so .save() works.
    const keepDoc = await Lead.findById(keepLean._id);
    if (!keepDoc) { console.warn(`  ⚠ Keep lead ${keepLean._id} not found — skipping group.`); continue; }

    const names = group.map((l) => `"${l.name}"`).join(', ');
    const keys  = group.map((l) => l.mobileKey).join(' / ');
    console.log(`  Group: ${names}`);
    console.log(`    keys: ${keys}`);
    console.log(`    keeping: "${keepDoc.name}" (${keepDoc._id}), created ${keepDoc.createdAt.toISOString().slice(0,10)}`);

    // Fix the kept lead's mobileKey using the corrected normalizePhone.
    const correctKey = normalizePhone(keepDoc.mobile, keepDoc.country);
    if (correctKey && correctKey !== keepDoc.mobileKey) {
      console.log(`    fixing mobileKey: ${keepDoc.mobileKey} → ${correctKey}`);
      // Temporarily bypass the unique index by setting directly (pre-save hook
      // will recompute, but we need to force mobile to re-trigger it).
      keepDoc.mobileKey = correctKey;
    }

    for (const dupLean of dupLeans) {
      const dupDoc = await Lead.findById(dupLean._id);
      if (!dupDoc) { console.warn(`    ⚠ Duplicate ${dupLean._id} not found — skipping.`); continue; }

      console.log(`    merging: "${dupDoc.name}" (${dupDoc._id})`);

      // Merge discussion history into the kept lead.
      if (dupDoc.callLogs?.length)   keepDoc.callLogs.push(...dupDoc.callLogs);
      if (dupDoc.notes?.length)      keepDoc.notes.push(...dupDoc.notes);
      if (dupDoc.editHistory?.length) keepDoc.editHistory.push(...dupDoc.editHistory);

      keepDoc.editHistory.push({
        by:     keepDoc.owner,
        byName: 'Repair script (fixWrongDialcodeDuplicates)',
        changes: [{ field: 'merged', from: null, to: `Merged duplicate "${dupDoc.name}" (${dupDoc._id}) — had mobileKey ${dupDoc.mobileKey}` }],
      });

      // Reassign any linked records.
      const [cheques, waMessages, notifs] = await Promise.all([
        Cheque.updateMany({ lead: dupDoc._id }, { $set: { lead: keepDoc._id } }),
        WhatsAppMessage.updateMany({ lead: dupDoc._id }, { $set: { lead: keepDoc._id } }),
        Notification.updateMany({ lead: dupDoc._id }, { $set: { lead: keepDoc._id } }),
      ]);
      if (cheques.modifiedCount)    console.log(`      reassigned ${cheques.modifiedCount} cheque(s)`);
      if (waMessages.modifiedCount) console.log(`      reassigned ${waMessages.modifiedCount} WhatsApp message(s)`);
      if (notifs.modifiedCount)     console.log(`      reassigned ${notifs.modifiedCount} notification(s)`);

      // Archive to Deleted Contacts.
      try {
        await DeletedContact.create({
          company:         dupDoc.company,
          name:            dupDoc.name || '',
          mobile:          dupDoc.mobile || '',
          mobileKey:       dupDoc.mobileKey || '',
          email:           dupDoc.email || '',
          country:         dupDoc.country || '',
          city:            dupDoc.city || '',
          source:          dupDoc.source || '',
          status:          dupDoc.status || '',
          interest:        dupDoc.interest || '',
          ownerName:       dupDoc.ownerName || '',
          originalLeadId:  dupDoc._id,
          deletedBy:       null,
          deletedByName:   'Repair script (fixWrongDialcodeDuplicates)',
          leadCreatedAt:   dupDoc.createdAt || null,
        });
      } catch (err) {
        console.warn(`      ⚠ Could not archive to Deleted Contacts: ${err.message}`);
      }

      await dupDoc.deleteOne();
      console.log(`      ✓ Deleted duplicate "${dupDoc.name}"`);
      totalMerged++;
    }

    // Save the kept lead (also triggers pre-save hook to recompute mobileKey correctly).
    try {
      await keepDoc.save();
      console.log(`    ✓ Saved kept lead with corrected mobileKey: ${keepDoc.mobileKey}\n`);
    } catch (err) {
      console.error(`    ✗ Failed to save kept lead: ${err.message}\n`);
    }
  }

  // ── Step 3: Merge same-mobileKey duplicates (created after mobileKey fix) ──
  console.log('── Step 3: Merging same-mobileKey duplicates ──');
  const samekeyGroups = await Lead.aggregate([
    { $match: { mobileKey: { $gt: '' } } },
    { $group: { _id: { company: '$company', mobileKey: '$mobileKey' }, ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  console.log(`  Found ${samekeyGroups.length} same-mobileKey duplicate group(s).\n`);
  let samekeyMerged = 0;

  for (const group of samekeyGroups) {
    const leads = await Lead.find({ _id: { $in: group.ids } }).sort({ createdAt: 1 });
    if (leads.length < 2) continue;
    const keepDoc = leads[0];
    const dupDocs = leads.slice(1);
    console.log(`  Group mobileKey: ${group._id.mobileKey}`);
    console.log(`    keeping: "${keepDoc.name}" (${keepDoc._id}) created ${keepDoc.createdAt.toISOString().slice(0,10)}`);

    for (const dupDoc of dupDocs) {
      console.log(`    merging: "${dupDoc.name}" (${dupDoc._id})`);
      if (dupDoc.callLogs?.length)    keepDoc.callLogs.push(...dupDoc.callLogs);
      if (dupDoc.notes?.length)       keepDoc.notes.push(...dupDoc.notes);
      if (dupDoc.editHistory?.length) keepDoc.editHistory.push(...dupDoc.editHistory);
      keepDoc.editHistory.push({
        by: keepDoc.owner,
        byName: 'Repair script (fixWrongDialcodeDuplicates)',
        changes: [{ field: 'merged', from: null, to: `Merged duplicate "${dupDoc.name}" (${dupDoc._id})` }],
      });
      await Promise.all([
        Cheque.updateMany({ lead: dupDoc._id }, { $set: { lead: keepDoc._id } }),
        WhatsAppMessage.updateMany({ lead: dupDoc._id }, { $set: { lead: keepDoc._id } }),
        Notification.updateMany({ lead: dupDoc._id }, { $set: { lead: keepDoc._id } }),
      ]);
      try {
        await DeletedContact.create({
          company: dupDoc.company, name: dupDoc.name || '', mobile: dupDoc.mobile || '',
          mobileKey: dupDoc.mobileKey || '', email: dupDoc.email || '', country: dupDoc.country || '',
          city: dupDoc.city || '', source: dupDoc.source || '', status: dupDoc.status || '',
          interest: dupDoc.interest || '', ownerName: dupDoc.ownerName || '',
          originalLeadId: dupDoc._id, deletedBy: null,
          deletedByName: 'Repair script (fixWrongDialcodeDuplicates)', leadCreatedAt: dupDoc.createdAt || null,
        });
      } catch (err) { console.warn(`      ⚠ Archive failed: ${err.message}`); }
      await dupDoc.deleteOne();
      console.log(`      ✓ Deleted duplicate "${dupDoc.name}"`);
      samekeyMerged++;
    }
    await keepDoc.save();
    console.log(`    ✓ Saved kept lead\n`);
  }
  console.log(`  Same-mobileKey duplicates removed: ${samekeyMerged}\n`);

  // ── Step 4: Fix mobileKeys on remaining leads with wrong dial code ──────────
  console.log('── Step 4: Fixing mobileKey on remaining leads with wrong dial code ──');
  const remaining = await Lead.find({ mobile: { $exists: true, $ne: '' } }).select('_id mobile country mobileKey');
  let fixedCount = 0;

  for (const lead of remaining) {
    const correct = normalizePhone(lead.mobile, lead.country);
    if (correct && correct !== lead.mobileKey) {
      try {
        await Lead.updateOne({ _id: lead._id }, { $set: { mobileKey: correct } });
        fixedCount++;
      } catch (err) {
        console.warn(`  ⚠ Could not fix mobileKey for lead ${lead._id} (${lead.mobileKey} → ${correct}): ${err.message}`);
      }
    }
  }
  console.log(`  Fixed mobileKey on ${fixedCount} lead(s) that had wrong dial codes but no duplicate.\n`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('── Summary ──');
  console.log(`  Duplicate groups merged : ${dupGroups.length}`);
  console.log(`  Duplicate leads removed : ${totalMerged}`);
  console.log(`  Solo wrong-key leads fixed: ${fixedCount}`);
  console.log('\n✅ Done. Deploy the fixed Lead.js to prevent this recurring.\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ Script failed:', err.message, err.stack);
  process.exit(1);
});