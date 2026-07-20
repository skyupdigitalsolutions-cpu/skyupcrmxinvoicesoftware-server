/**
 * chequeReminderScheduler.js
 * Polls periodically for cheques whose collection date is today and sends a
 * "cheque collection due today" notification to the cheque's owner and the
 * company admins.
 *
 * Fires exactly once per collection date: we stamp `reminderSentFor` with
 * today's day-start once reminded. If the date is later rescheduled to a
 * different day, the stamp no longer matches and a fresh reminder becomes
 * eligible on the new date. Mirrors followUpReminderScheduler.js.
 *
 * Call startChequeReminderScheduler() once during server startup.
 */
import { Cheque } from '../models/Cheque.js';
import { notifyUsers, ownerAndAdmins } from './notify.js';

const fmt = (d) =>
    new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

async function tick() {
    const now = new Date();
    // Today's window in UTC. dayStart also doubles as the idempotency stamp
    // written to reminderSentFor once a reminder has gone out.
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

    const cheques = await Cheque.find({
        chequeDate: { $gte: dayStart, $lte: dayEnd },
        status: 'Pending',
    }).lean();

    for (const cheque of cheques) {
        // Skip if already reminded today for this collection date.
        if (cheque.reminderSentFor && new Date(cheque.reminderSentFor).getTime() === dayStart.getTime()) {
            continue;
        }

        try {
            const recipients = await ownerAndAdmins(cheque.company, cheque.owner);
            const chequeRef = cheque.chequeNumber ? ` (Cheque #${cheque.chequeNumber})` : '';
            const bankRef = cheque.bank ? ` — ${cheque.bank}` : '';
            await notifyUsers({
                company: cheque.company,
                recipients,
                type: 'cheque-collection-due',
                title: `Cheque collection due today: ${cheque.customer}`,
                body: `${cheque.customer}${chequeRef}${bankRef} — collection scheduled for ${fmt(cheque.chequeDate)}.`,
                link: `/cheques`,
                dueAt: cheque.chequeDate,
            });

            await Cheque.updateOne(
                { _id: cheque._id },
                { $set: { reminderSentFor: dayStart } }
            );
            console.log(`[cheque] Reminder sent → ${cheque.customer} (${cheque.company})`);
        } catch (err) {
            console.error(`[cheque] Reminder FAILED for cheque ${cheque._id}:`, err.message);
        }
    }
}

export function startChequeReminderScheduler() {
    // First tick 16 s after startup (staggered from the other schedulers), then every 60 s.
    setTimeout(() => {
        tick().catch((e) => console.error('[cheque] tick error', e));
        setInterval(() => tick().catch((e) => console.error('[cheque] tick error', e)), 60_000);
    }, 16_000);
    console.log('[scheduler] Cheque reminder scheduler started.');
}