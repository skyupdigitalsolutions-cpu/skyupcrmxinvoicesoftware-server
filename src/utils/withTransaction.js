import mongoose from 'mongoose';

// Runs `work(session)` inside a transaction when the deployment supports it
// (replica set / Atlas). Falls back to a plain sequential run on standalone
// mongod, where transactions aren't available.
export async function runTransactional(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } catch (err) {
    const noTxn =
      err?.code === 20 ||
      /Transaction numbers are only allowed|replica set|not supported/i.test(err?.message || '');
    if (noTxn) {
      await session.endSession();
      return work(null); // run without a session
    }
    throw err;
  } finally {
    session.endSession();
  }
}

