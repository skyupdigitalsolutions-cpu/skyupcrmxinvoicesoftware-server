import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { User } from '../models/User.js';
import { Company } from '../models/Company.js';
import { Counter } from '../models/Counter.js';

const run = async () => {
  await connectDB();

  // 1. Ensure a seed company exists — all admin/sales users must belong to one.
  //    tenantScope() throws 403 for any non-developer user with company === null.
  let company = await Company.findOne({ slug: 'seed-company' });
  if (!company) {
    company = await Company.create({ name: 'Seed Company', slug: 'seed-company' });
    console.log('✓ created company: seed-company');
  } else {
    console.log('• company seed-company exists, skipping');
  }

  const seedUsers = [
    { name: 'Admin', username: 'admin', password: process.env.SEED_ADMIN_PASSWORD || 'admin123', role: 'admin', company: company._id },
    { name: 'Rahul Sharma', username: 'sales1', password: 'sales123', role: 'sales', company: company._id },
    { name: 'Priya Nair', username: 'sales2', password: 'sales456', role: 'sales', company: company._id },
  ];

  for (const u of seedUsers) {
    const existing = await User.findOne({ username: u.username });
    if (existing) {
      // Patch existing users that were seeded without a company (the original bug).
      if (!existing.company) {
        await User.updateOne({ _id: existing._id }, { $set: { company: company._id } });
        console.log(`✓ patched missing company on existing user: ${u.username}`);
      } else {
        console.log(`• ${u.username} exists, skipping`);
      }
      continue;
    }
    await User.create(u);
    console.log(`✓ created ${u.role}: ${u.username}`);
  }

  // Match the original system's starting counters
  await Counter.ensure('orderNo', 159);
  await Counter.ensure('invoiceNo', 196);
  await Counter.ensure('leadNo', 0);
  console.log('✓ counters ensured (orderNo=159, invoiceNo=196, leadNo=0)');

  await mongoose.connection.close();
  console.log('✓ seed complete');
  process.exit(0);
};

run().catch((e) => { console.error(e); process.exit(1); });