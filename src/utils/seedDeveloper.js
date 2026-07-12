import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { User } from '../models/User.js';

// Creates (or updates) a platform developer account.
// Developers have role: 'developer' and company: null — they manage tenants.
//
// Run:  npm run seed:dev
// Or override creds:  DEV_USERNAME=me DEV_PASSWORD=secret npm run seed:dev
const run = async () => {
  await connectDB();

  const username = (process.env.DEV_USERNAME || 'developer').toLowerCase();
  const password = process.env.DEV_PASSWORD || 'developer123';
  const name     = process.env.DEV_NAME || 'Platform Developer';

  let user = await User.findOne({ username });
  if (user) {
    user.role = 'developer';
    user.company = null;
    user.active = true;
    user.password = password; // re-hashed by the pre-save hook
    await user.save();
    console.log(`✓ updated existing user "${username}" → developer`);
  } else {
    user = await User.create({ name, username, password, role: 'developer', company: null });
    console.log(`✓ created developer: ${username}`);
  }

  console.log('\n  Login with:');
  console.log(`    username: ${username}`);
  console.log(`    password: ${password}\n`);

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((e) => { console.error(e); process.exit(1); });
