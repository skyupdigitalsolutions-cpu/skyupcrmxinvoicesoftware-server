/**
 * reportScheduler.js
 * Polls every minute, and at the configured sendAt time (HH:MM) for each
 * active company that has email reports enabled, fires off the daily report.
 *
 * Call startReportScheduler() once during server startup.
 */
import { Company } from '../models/Company.js';
import { sendDailyReport } from './dailyReportEmail.js';

// Track which companies we've already emailed today so we don't double-send.
// Key = `${companyId}:${YYYY-MM-DD}`, value = true.
const sent = new Map();

const todayKey = () => new Date().toISOString().slice(0, 10);
const nowHHMM  = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

async function tick() {
  const hhmm = nowHHMM();
  const today = todayKey();

  // Load only enabled companies that have a Brevo key, sender, and recipient configured.
  // brevoApiKey is select:false — must be explicitly included with the '+' prefix.
  const companies = await Company.find({
    active: true,
    'emailReport.enabled': true,
    'emailReport.brevoApiKey': { $nin: [null, ''] },
    'emailReport.senderEmail': { $nin: [null, ''] },
    'emailReport.adminEmail':  { $nin: [null, ''] },
  }).select('+emailReport.brevoApiKey').lean({ virtuals: false });

  for (const company of companies) {
    const sendAt = company.emailReport?.sendAt || '08:00';
    if (sendAt !== hhmm) continue;

    const key = `${company._id}:${today}`;
    if (sent.get(key)) continue; // already sent this minute

    sent.set(key, true);
    sendDailyReport(company, new Date())
      .then(() => console.log(`[scheduler] Report sent → ${company.name} (${company.emailReport.adminEmail})`))
      .catch((err) => console.error(`[scheduler] Report FAILED for ${company.name}:`, err.message));
  }

  // Prune yesterday's keys to keep memory bounded.
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yKey = yesterday.toISOString().slice(0, 10);
  for (const k of sent.keys()) { if (k.endsWith(`:${yKey}`)) sent.delete(k); }
}

export function startReportScheduler() {
  // First tick 5 s after startup, then every 60 s.
  setTimeout(() => {
    tick().catch((e) => console.error('[scheduler] tick error', e));
    setInterval(() => tick().catch((e) => console.error('[scheduler] tick error', e)), 60_000);
  }, 5_000);
  console.log('[scheduler] Daily report scheduler started.');
}
