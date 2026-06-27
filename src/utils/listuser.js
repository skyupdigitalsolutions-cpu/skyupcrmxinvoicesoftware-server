import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { User } from '../models/User.js';

// Lists every user in the DB the server is actually connected to.
// Run:  node src/utils/listUsers.js
const run = async () => {
  await connectDB();
  const users = await User.find().select('+password').lean();
  if (!users.length) {
    console.log('\n  (no users found in this database)\n');
  } else {
    console.log(`\n  ${users.length} user(s):\n`);
    users.forEach((u) => {
      console.log(
        `   • username="${u.username}"  role=${u.role}  active=${u.active}  ` +
        `company=${u.company || 'null'}  passwordHashed=${u.password?.startsWith('$2') ? 'yes' : 'NO/plaintext'}`
      );
    });
    console.log('');
  }
  await mongoose.connection.close();
  process.exit(0);
};

run().catch((e) => { console.error(e); process.exit(1); });