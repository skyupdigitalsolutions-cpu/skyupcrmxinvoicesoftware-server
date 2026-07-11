import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { User } from '../models/User.js';

// Diagnose login failures for the developer account.
//
// Run locally with the EXACT MONGO_URI that Render uses:
//   Windows CMD : set MONGO_URI=your_render_uri && node src/utils/checkDev.js
//   PowerShell  : $env:MONGO_URI="your_render_uri"; node src/utils/checkDev.js
//
// To also (re)create the developer with a known password, add RESET=1:
//   set MONGO_URI=... && set DEV_USERNAME=developer && set DEV_PASSWORD=NewPass123 && set RESET=1 && node src/utils/checkDev.js
const run = async () => {
  await connectDB();

  // Which database are we actually on? (This is the #1 cause of "wrong password".)
  console.log(`\n  Connected DB name: "${mongoose.connection.name}"`);
  console.log('  (This MUST match the database your Render server reads from.)\n');

  const all = await User.find({}).select('username role active').lean();
  console.log(`  Total users in this DB: ${all.length}`);
  all.forEach((u) => console.log(`    - ${u.username}  [${u.role}]  active=${u.active}`));

  const username = (process.env.DEV_USERNAME || 'developer').toLowerCase();
  const dev = await User.findOne({ username }).select('+password role active');

  if (!dev) {
    console.log(`\n  ✗ No user with username "${username}" in this database.`);
  } else {
    console.log(`\n  ✓ Found "${username}" → role=${dev.role}, active=${dev.active}`);
    if (dev.role !== 'developer') console.log('  ⚠ role is NOT "developer" — login works but no dev panel access.');
    if (dev.active === false)     console.log('  ⚠ user is INACTIVE — login is rejected with 401.');

    const testPw = process.env.DEV_PASSWORD;
    if (testPw) {
      const ok = await dev.comparePassword(testPw);
      console.log(`  Password "${testPw}" matches: ${ok ? 'YES ✓' : 'NO ✗'}`);
    }
  }

  // Optional: create/reset the developer account in THIS database.
  if (process.env.RESET === '1') {
    const password = process.env.DEV_PASSWORD || 'developer123';
    const name     = process.env.DEV_NAME || 'Platform Developer';
    let user = await User.findOne({ username });
    if (user) {
      user.role = 'developer'; user.company = null; user.active = true; user.password = password;
      await user.save();
      console.log(`\n  ✓ RESET existing "${username}" → developer / ${password}`);
    } else {
      await User.create({ name, username, password, role: 'developer', company: null });
      console.log(`\n  ✓ CREATED developer "${username}" / ${password}`);
    }
  }

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((e) => { console.error(e); process.exit(1); });
