import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import app from './app.js';
import { startReportScheduler } from './utils/reportScheduler.js';
import { startFollowUpReminderScheduler } from './utils/followUpReminderScheduler.js';
import { startExpiryReminderScheduler } from './utils/expiryReminderScheduler.js';

const start = async () => {
  await connectDB();
  const server = app.listen(env.port, () =>
    console.log(`✓ API running on http://localhost:${env.port} (${env.nodeEnv})`)
  );
  startReportScheduler();
  startFollowUpReminderScheduler();
  startExpiryReminderScheduler();
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
    server.close(() => process.exit(1));
  });
};

start();