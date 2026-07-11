import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { User } from '../models/User.js';

// Reset ANY user's password without changing their role/company/active flag.
// Run locally with the EXACT Render MONGO_URI (must point at the same db the
// server logs — currently "skyupcrminvoicesoftware", note: no "x").
//
// List everyone (no changes):
//   set MONGO_URI=... && node src/utils/resetPassword.js
//
// Reset a specific user's password:
//   set MONGO_URI=... && set USERNAME=admin && set PASSWORD=NewPass123 && node src/utils/resetPassword.js
const run = async () => {
  await connectDB();
  console.log(`\n  DB: "${mongoose.connection.name}"  (must match the live server's log)\n`);

  const username = (process.env.USERNAME || '').toLowerCase().trim();
  const password = process.env.PASSWORD || '';

  if (!username) {
    const all = await User.find({}).select('username role active company').lean();
    console.log(`  ${all.length} user(s):`);
    all.forEach((u) =>
      console.log(`    - ${u.username}  [${u.role}]  active=${u.active}  company=${u.company || 'none'}`));
    console.log('\n  Re-run with USERNAME=<name> PASSWORD=<newpass> to reset one.\n');
    await mongoose.connection.close();
    return process.exit(0);
  }

  const user = await User.findOne({ username }).select('+password role active company');
  if (!user) {
    console.log(`  ✗ No user "${username}" in this database.`);
    await mongoose.connection.close();
    return process.exit(1);
  }

  console.log(`  Found "${username}" → role=${user.role}, active=${user.active}, company=${user.company || 'none'}`);

  if (!password) {
    console.log('  (No PASSWORD given — nothing changed. Set PASSWORD=... to reset.)');
    await mongoose.connection.close();
    return process.exit(0);
  }
  if (password.length < 6) {
    console.log('  ✗ PASSWORD must be at least 6 characters.');
    await mongoose.connection.close();
    return process.exit(1);
  }

  user.password = password;   // hashed once by the pre-save hook
  if (user.active === false) { user.active = true; console.log('  • user was inactive → reactivated'); }
  await user.save();

  const check = await User.findOne({ username }).select('+password');
  const ok = await check.comparePassword(password);
  console.log(`  ✓ Password reset. Verify compare("${password}"): ${ok ? 'YES ✓' : 'NO ✗'}`);
  console.log(`\n  Log in with:  username: ${username}   password: ${password}\n`);

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((e) => { console.error(e); process.exit(1); });
