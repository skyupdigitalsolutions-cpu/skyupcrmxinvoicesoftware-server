/**
 * followUpReminderScheduler.js
 * Polls every minute for leads whose follow-up time has arrived and sends a
 * "follow-up is due now" notification to the lead owner and the company admins.
 *
 * Fires exactly once per scheduled follow-up: we stamp `followUpRemindedFor`
 * with the followUpAt value we reminded for. If the owner reschedules (changes
 * followUpAt), the stamp no longer matches and a fresh reminder becomes eligible.
 *
 * A grace window prevents very old follow-ups from spamming reminders if the
 * server was down for a while — only follow-ups due within the last GRACE_MIN
 * minutes are reminded.
 *
 * Call startFollowUpReminderScheduler() once during server startup.
 */
import { Lead } from '../models/Lead.js';
import { notifyUsers, ownerAndAdmins } from './notify.js';

const GRACE_MIN = 60; // don't remind for follow-ups overdue by more than this

const fmt = (d) =>
  new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

async function tick() {
  const now = new Date();
  const floor = new Date(now.getTime() - GRACE_MIN * 60_000);

  // Eligible: due (followUpAt between floor and now), still open, and either
  // never reminded or reminded for a different (older) followUpAt value.
  const leads = await Lead.find({
    followUpAt: { $ne: null, $lte: now, $gte: floor },
    status: { $nin: ['Won', 'Lost'] },
  }).lean();

  for (const lead of leads) {
    // Skip if we've already reminded for this exact follow-up time.
    if (lead.followUpRemindedFor && new Date(lead.followUpRemindedFor).getTime() === new Date(lead.followUpAt).getTime()) {
      continue;
    }

    try {
      const recipients = await ownerAndAdmins(lead.company, lead.owner);
      await notifyUsers({
        company: lead.company,
        recipients,
        type: 'lead-followup-due',
        title: `Follow-up due now: ${lead.name}`,
        body: `${lead.name}${lead.mobile ? ` (${lead.mobile})` : ''} — follow-up was scheduled for ${fmt(lead.followUpAt)}.`,
        link: `/leads/${lead._id}`,
        lead: lead._id,
        dueAt: lead.followUpAt,
      });

      // Stamp so we don't remind again for this same follow-up time.
      await Lead.updateOne(
        { _id: lead._id },
        { $set: { followUpRemindedFor: lead.followUpAt } }
      );
      console.log(`[followup] Reminder sent → ${lead.name} (${lead.company})`);
    } catch (err) {
      console.error(`[followup] Reminder FAILED for lead ${lead._id}:`, err.message);
    }
  }
}

export function startFollowUpReminderScheduler() {
  // First tick 8 s after startup (staggered from the report scheduler), then every 60 s.
  setTimeout(() => {
    tick().catch((e) => console.error('[followup] tick error', e));
    setInterval(() => tick().catch((e) => console.error('[followup] tick error', e)), 60_000);
  }, 8_000);
  console.log('[scheduler] Follow-up reminder scheduler started.');
}