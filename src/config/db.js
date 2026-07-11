import mongoose from 'mongoose';

export const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('✗ MONGO_URI is not set. Add your Atlas connection string to .env');
    process.exit(1);
  }
  try {
    mongoose.set('strictQuery', true);
    const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    // Log the DATABASE NAME as well as the host. If this name differs from the
    // one you seeded into, that's why logins fail with "wrong username or
    // password" — the users live in a different database on the same cluster.
    console.log(`✓ MongoDB connected: host=${conn.connection.host} db="${conn.connection.name}"`);
  } catch (err) {
    console.error('✗ MongoDB connection error:', err.message);
    process.exit(1);
  }
};
