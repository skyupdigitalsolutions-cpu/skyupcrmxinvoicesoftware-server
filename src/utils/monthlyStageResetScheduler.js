/**
 * monthlyStageResetScheduler.js
 *
 * On the 1st of every month (at 00:05 server time), resets all leads whose
 * status is 'Won' but have NOT been converted into an order back to
 * 'Interested' — moving them from the Buyer stage back to Opportunity.
 *
 * Leads that ARE converted (i.e. have an actual order via convertLead) are
 * left untouched — they are real buyers with an order record and should
 * remain Won permanently.
 *
 * This automation is what causes the "Buyer → Opportunity" monthly reset
 * the sales team expects at the start of each month.
 *
 * Call startMonthlyStageResetScheduler() once during server startup.
 */

import { Lead } from '../models/Lead.js';
import { Company } from '../models/Company.js';
import { notifyUsers, adminsOf } from './notify.js';

// Returns true if today is the 1st day of the month (server local time).
const isFirstOfMonth = () => new Date().getDate() === 1;

// Returns today as YYYY-MM-DD (server local time).
const todayStr = () => new Date().toISOString().slice(0, 10);

async function tick() {
    if (!isFirstOfMonth()) return;

    const today = todayStr();
    console.log(`[monthlyReset] Running monthly Buyer → Opportunity reset for ${today}`);

    // Get all active companies.
    const companies = await Company.find({ active: true }).select('_id name').lean();

    let totalReset = 0;

    for (const company of companies) {
        try {
            // Find leads that are:
            // - status 'Won' (showing as Buyer stage)
            // - NOT converted into an order (converted: false or undefined)
            //   Converted leads have a real order and must stay as Buyers.
            const result = await Lead.updateMany(
                {
                    company: company._id,
                    status: 'Won',
                    converted: { $ne: true },
                },
                {
                    $set: { status: 'Interested', monthlyReset: true },
                    $push: {
                        editHistory: {
                            by: null,
                            byName: 'Monthly Reset (auto)',
                            at: new Date(),
                            changes: [{
                                field: 'status',
                                from: 'Won',
                                to: 'Interested — monthly Buyer → Opportunity reset',
                            }],
                        },
                    },
                }
            );

            if (result.modifiedCount > 0) {
                totalReset += result.modifiedCount;
                console.log(`[monthlyReset] ${company.name}: reset ${result.modifiedCount} lead(s) Won → Interested`);

                // Notify admins of this company.
                try {
                    const admins = await adminsOf(company._id);
                    if (admins.length) {
                        await notifyUsers({
                            company: company._id,
                            recipients: admins,
                            type: 'monthly-reset',
                            title: 'Monthly stage reset completed',
                            body: `${result.modifiedCount} lead(s) moved from Buyer → Opportunity for the new month.`,
                            link: '/leads',
                        });
                    }
                } catch (notifyErr) {
                    console.error(`[monthlyReset] Notification failed for ${company.name}:`, notifyErr.message);
                }
            }
        } catch (err) {
            console.error(`[monthlyReset] Failed for company ${company.name}:`, err.message);
        }
    }

    console.log(`[monthlyReset] Done. Total leads reset: ${totalReset}`);
}

export function startMonthlyStageResetScheduler() {
    // Check every hour whether it's the 1st of the month.
    // Staggered 20s after startup so DB is fully ready.
    // The tick itself is idempotent — once leads are reset to 'Interested'
    // they no longer match the Won + !converted query, so repeated runs
    // within the same day are safe.
    setTimeout(() => {
        tick().catch((e) => console.error('[monthlyReset] tick error:', e));
        setInterval(
            () => tick().catch((e) => console.error('[monthlyReset] tick error:', e)),
            60 * 60 * 1000 // every hour
        );
    }, 20_000);

    console.log('[scheduler] Monthly stage reset scheduler started.');
}