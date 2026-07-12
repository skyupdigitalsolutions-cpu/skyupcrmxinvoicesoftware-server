/**
 * expiryReminderScheduler.js
 * Once a day, notify each active company's admins when their subscription is
 * within the configured number of days of its renewal/expiry date — so they
 * can renew before the account is paused.
 *
 * In-app notifications always fire. Email is sent via the PLATFORM-wide Brevo
 * connection (PlatformSettings.expiryEmail), not each company's own Brevo —
 * one platform key, addressed to each company's admin email.
 *
 * Sends a reminder on EACH day of the countdown window (e.g. on all 5 days
 * before expiry), once per day — tracked via subscription.expiryReminderSentFor
 * which stores the date the last reminder was sent. When the developer sets a
 * new renewal date, the stamp is cleared so the new cycle's reminders fire.
 *
 * Call startExpiryReminderScheduler() once during server startup.
 */
import { Company } from '../models/Company.js';
import { PlatformSettings } from '../models/PlatformSettings.js';
import { notifyUsers, adminsOf } from './notify.js';
import { sendBrevoEmailRaw } from './sendEmail.js';

const DEFAULT_REMIND_DAYS = 5;
const MAX_WINDOW_DAYS = 60; // query ceiling regardless of configured remindDays
const DAY_MS = 24 * 60 * 60 * 1000;

const sameDay = (a, b) =>
  a && b && new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

const fmt = (d) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const buildHtml = (brandName, daysLeft, renewal) => `
  <div style="font-family:sans-serif;max-width:520px;margin:auto">
    <div style="background:#6D28D9;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">
      <h2 style="margin:0;font-size:18px">${brandName}</h2>
      <p style="margin:4px 0 0;opacity:.85">Subscription Reminder</p>
    </div>
    <div style="background:#F9FAFB;padding:22px;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 8px 8px">
      <p style="font-size:15px;color:#111;margin:0 0 12px">
        Your subscription expires in <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>
        (on <strong>${fmt(renewal)}</strong>).
      </p>
      <p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 16px">
        Please renew before the expiry date to avoid your account being paused.
        Once paused, your team won't be able to access the system until the
        payment status is updated.
      </p>
      <p style="font-size:12px;color:#9CA3AF;margin:0">This is an automated reminder.</p>
    </div>
  </div>`;

async function tick() {
  const now = new Date();

  // Load the platform-wide expiry-email config (with the secret key).
  const platform = await PlatformSettings.getSingleton(true);
  const pe = platform.expiryEmail || {};
  const remindDays = Math.min(MAX_WINDOW_DAYS, Math.max(1, pe.remindDays || DEFAULT_REMIND_DAYS));
  const emailReady = !!(pe.enabled && pe.brevoApiKey && pe.senderEmail);

  const windowEnd = new Date(now.getTime() + remindDays * DAY_MS);

  // Active companies whose renewal date is between now and remindDays ahead,
  // and that aren't already cancelled/expired.
  const companies = await Company.find({
    active: true,
    'subscription.renewalDate': { $ne: null, $gte: now, $lte: windowEnd },
    'subscription.status': { $nin: ['Cancelled', 'Expired'] },
  });

  for (const company of companies) {
    const renewal = company.subscription?.renewalDate;
    if (!renewal) continue;

    // Skip if we've already sent a reminder TODAY for this company. This makes
    // the reminder fire once on EACH day of the countdown window (e.g. all 5
    // days before expiry), not just once per renewal date.
    if (sameDay(company.subscription.expiryReminderSentFor, now)) continue;

    try {
      const admins = await adminsOf(company._id);
      const daysLeft = Math.max(0, Math.ceil((new Date(renewal).getTime() - now.getTime()) / DAY_MS));

      // In-app notification to each admin (always).
      if (admins.length) {
        await notifyUsers({
          company: company._id,
          recipients: admins,
          type: 'subscription-expiry',
          title: `Subscription expiring in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
          body: `Your subscription renews/expires on ${fmt(renewal)}. Please renew before then to avoid your account being paused.`,
          link: '/dashboard',
          dueAt: renewal,
        });
      }

      // Email via the PLATFORM Brevo connection → each company's admin email.
      if (emailReady) {
        const to = [company.emailReport?.adminEmail, company.contactEmail].filter(Boolean);
        if (to.length) {
          const brandName = company.branding?.headerName || company.name;
          await sendBrevoEmailRaw({
            apiKey: pe.brevoApiKey,
            senderEmail: pe.senderEmail,
            senderName: pe.senderName || 'Subscriptions',
            to,
            bcc: pe.ccOwnerEmail || undefined,
            subject: `Subscription expiring in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — ${brandName}`,
            html: buildHtml(brandName, daysLeft, renewal),
          });
        }
      }

      // Stamp so we don't remind again for this renewal date.
      // Stamp TODAY so we don't send again today, but will tomorrow (next day
      // of the countdown) until the renewal date passes or is updated.
      company.subscription.expiryReminderSentFor = now;
      await company.save();
      console.log(`[expiry] Reminder sent -> ${company.name} (${daysLeft}d left)${emailReady ? ' + email' : ''}`);
    } catch (err) {
      console.error(`[expiry] Reminder FAILED for ${company.name}:`, err.message);
    }
  }
}

export function startExpiryReminderScheduler() {
  // First tick 12 s after startup (staggered from the other schedulers), then hourly.
  setTimeout(() => {
    tick().catch((e) => console.error('[expiry] tick error', e));
    setInterval(() => tick().catch((e) => console.error('[expiry] tick error', e)), 60 * 60 * 1000);
  }, 12_000);
  console.log('[scheduler] Subscription expiry reminder scheduler started.');
}
