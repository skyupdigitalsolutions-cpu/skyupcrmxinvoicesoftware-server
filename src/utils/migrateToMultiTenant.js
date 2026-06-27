import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { Company } from '../models/Company.js';
import { User } from '../models/User.js';
import { Counter } from '../models/Counter.js';

// ─────────────────────────────────────────────────────────────────────────────
// One-time migration to turn the single-tenant install into multi-tenant.
//
// It is IDEMPOTENT — safe to run more than once. It:
//   1. Creates (or finds) a default Company for all existing data.
//   2. Creates (or finds) the platform `developer` super-admin account.
//   3. Assigns every user that has no company to the default company.
//   4. Stamps every existing business document (orders, leads, invoices,
//      attendance, attendance config) that has no company with the default one.
//   5. Re-keys the global counters to per-company keys so numbering continues.
//
// Run:  node src/utils/migrateToMultiTenant.js
//
// Env you can set:
//   DEFAULT_COMPANY_NAME   (default: "Sole & Stride")
//   DEFAULT_COMPANY_SLUG   (default: "sole-and-stride")
//   DEV_USERNAME           (default: "developer")
//   DEV_PASSWORD           (default: "developer123"  — CHANGE THIS after first login)
// ─────────────────────────────────────────────────────────────────────────────

// Collections that need a `company` stamp. We use the raw driver so this works
// even before the model files have the `company` field, and so it stays decoupled.
const TENANT_COLLECTIONS = ['orders', 'leads', 'invoices', 'attendances', 'attendanceconfigs'];

const run = async () => {
  await connectDB();
  const db = mongoose.connection.db;

  // 1. Default company ──────────────────────────────────────────────────────
  const name = process.env.DEFAULT_COMPANY_NAME || 'Sole & Stride';
  const slug = process.env.DEFAULT_COMPANY_SLUG || 'sole-and-stride';

  let company = await Company.findOne({ slug });
  if (!company) {
    company = await Company.create({
      name, slug, active: true,
      limits: { maxAdmins: 5, maxEmployees: 50 },
    });
    console.log(`✓ created default company "${name}" (${company._id})`);
  } else {
    console.log(`• default company "${slug}" already exists (${company._id})`);
  }
  const companyId = company._id;

  // 2. Developer super-admin ────────────────────────────────────────────────
  const devUsername = (process.env.DEV_USERNAME || 'developer').toLowerCase();
  let dev = await User.findOne({ username: devUsername });
  if (!dev) {
    dev = await User.create({
      name: 'Developer',
      username: devUsername,
      password: process.env.DEV_PASSWORD || 'developer123',
      role: 'developer',
      company: null,
    });
    console.log(`✓ created developer account: ${devUsername}  (change the password after first login!)`);
  } else {
    if (dev.role !== 'developer') { dev.role = 'developer'; dev.company = null; await dev.save(); }
    console.log(`• developer account "${devUsername}" already exists`);
  }

  // 3. Assign company-less users (excluding the developer) ──────────────────
  const userRes = await User.updateMany(
    { company: { $in: [null, undefined] }, role: { $ne: 'developer' } },
    { $set: { company: companyId } }
  );
  console.log(`✓ users assigned to default company: ${userRes.modifiedCount}`);

  // 4. Stamp existing business documents ────────────────────────────────────
  for (const coll of TENANT_COLLECTIONS) {
    const exists = await db.listCollections({ name: coll }).hasNext();
    if (!exists) { console.log(`• collection ${coll} not found, skipping`); continue; }
    const res = await db.collection(coll).updateMany(
      { company: { $in: [null, undefined] } },
      { $set: { company: companyId } }
    );
    console.log(`✓ ${coll}: stamped ${res.modifiedCount} document(s)`);
  }

  // 5. Re-key counters to per-company (orderNo -> orderNo:<companyId>) ────────
  // Copy the current global seq into the company-scoped key so numbering
  // continues from where it was. Keep the old global doc as a harmless backup.
  for (const base of ['orderNo', 'invoiceNo', 'leadNo']) {
    const global = await Counter.findById(base);
    if (!global) continue;
    const scopedId = `${base}:${companyId}`;
    const scoped = await Counter.findById(scopedId);
    if (!scoped) {
      await Counter.create({ _id: scopedId, seq: global.seq });
      console.log(`✓ counter ${scopedId} = ${global.seq}`);
    } else {
      console.log(`• counter ${scopedId} already exists (${scoped.seq})`);
    }
  }

  await mongoose.connection.close();
  console.log('\n✓ multi-tenant migration complete');
  process.exit(0);
};

run().catch((e) => { console.error('✗ migration failed:', e); process.exit(1); });