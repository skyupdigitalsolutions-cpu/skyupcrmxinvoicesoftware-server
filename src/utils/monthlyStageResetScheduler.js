/**
 * monthlyStageResetScheduler.js
 *
 * From the start of every month, resets every lead that is still 'Won' from a
 * PREVIOUS month back to 'Interested' — Buyer → Opportunity. Reports for past
 * dates still show them as Buyers because the change is recorded in editHistory
 * (see utils/leadStatusAt.js).
 *
 * This automation is what causes the "Buyer → Opportunity" monthly reset
 * the sales team expects at the start of each month.
 *
 * Call startMonthlyStageResetScheduler() once during server startup.
 *
 * ── FIX NOTE ────────────────────────────────────────────────────────────────
 * Previously this scheduler pushed `by: null` into editHistory via
 * updateMany(). Because updateMany() bypasses Mongoose validation, the null
 * was stored fine — but when a human later edited the same lead, Mongoose 8
 * re-validated ALL subdocuments in the editHistory array during lead.save(),
 * and threw "editHistory.N.by: Path 'by' is required" for the auto-reset
 * entry. Fix: omit `by` from the $push entirely and let the schema default
 * (null, required: false) handle it cleanly. The Lead model's editHistorySchema
 * has also been updated with `required: false` and a null-safe validator.
 *
 * A one-time migration (fixNullEditHistoryBy) runs at startup to unset the
 * `by` field on any existing entries that were stored as null by the old code,
 * so legacy data no longer blocks saves on already-affected leads.
 * ────────────────────────────────────────────────────────────────────────────
 */

import mongoose from 'mongoose';
import { Lead } from '../models/Lead.js';
import { Company } from '../models/Company.js';
import { notifyUsers, adminsOf } from './notify.js';

// Returns today as YYYY-MM-DD (server local time).
const todayStr = () => new Date().toISOString().slice(0, 10);

// ── One-time migration ───────────────────────────────────────────────────────
// Finds all editHistory entries stored with `by: null` (written by the old
// scheduler code) and converts them to `by: undefined` (i.e. the field is
// absent), which is how Mongoose 8 expects a truly optional ObjectId to look.
// This runs once at startup and is safe to re-run — leads already migrated
// won't match the query again.
async function fixNullEditHistoryBy() {
    try {
        const result = await Lead.collection.updateMany(
            { 'editHistory.by': null },
            { $unset: { 'editHistory.$[elem].by': '' } },
            { arrayFilters: [{ 'elem.by': null }] }
        );
        if (result.modifiedCount > 0) {
            console.log(
                `[monthlyReset] Migration: cleared null 'by' from editHistory on ${result.modifiedCount} lead(s).`
            );
        }
    } catch (err) {
        // Non-fatal — the Lead model's validator also tolerates null, so even
        // un-migrated leads will save correctly after the schema fix. Log and
        // continue rather than crashing startup.
        console.error('[monthlyReset] Migration fixNullEditHistoryBy failed (non-fatal):', err.message);
    }
}

// ── Monthly reset tick ───────────────────────────────────────────────────────
export async function tick() {
    // Start of the current month (server local time). Any Buyer whose last
    // update is BEFORE this moment is a previous-month Buyer and gets reset.
    // This replaces the old "only run if today is the 1st" gate, so a server
    // that was down or redeployed on the 1st still catches up on the next
    // hourly tick, while a customer who buys this month (updatedAt >= monthStart)
    // is never reset early. The query is idempotent.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const today = todayStr();
    console.log(`[monthlyReset] Checking Buyer → Opportunity reset for ${today} (cut-off ${monthStart.toISOString()})`);

    // Get all active companies.
    const companies = await Company.find({ active: true }).select('_id name').lean();

    let totalReset = 0;

    for (const company of companies) {
        try {
            // Find leads that are still 'Won' (Buyer) from a PREVIOUS month —
            // converted or not (see the query below).
            const result = await Lead.updateMany(
                {
                    company: company._id,
                    status: 'Won',
                    // Only Buyers from BEFORE this month. Anyone who bought
                    // (or was touched) since the 1st stays a Buyer until the
                    // next month. `converted` is left as-is on purpose — it
                    // means "has an order", not "is a Buyer this month".
                    updatedAt: { $lt: monthStart },
                },
                {
                    $set: { status: 'Interested', monthlyReset: true },
                    $push: {
                        editHistory: {
                            // NOTE: `by` is deliberately omitted here (not `by: null`).
                            // Omitting it lets MongoDB store the field as absent, which
                            // Mongoose 8 treats as the schema default (null, required: false)
                            // and will not reject on the next lead.save(). Previously
                            // `by: null` was written here, which caused Mongoose 8 to throw
                            // "Path 'by' is required" when a human later saved the same lead.
                            byName: 'Monthly Reset (auto)',
                            at: new Date(),
                            changes: [{
                                field: 'status',
                                from: 'Won',
                                // Must be a real status value: reports replay editHistory
                                // to find a lead's stage on a past date (utils/leadStatusAt.js).
                                to: 'Interested',
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
                            body: `${result.modifiedCount} lead(s) reset from Buyer → Opportunity for the new month (including converted buyers).`,
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

// ── Scheduler entry point ────────────────────────────────────────────────────
export function startMonthlyStageResetScheduler() {
    // Run the one-time migration 5 seconds after startup (gives the DB
    // connection time to settle without blocking server boot).
    setTimeout(() => {
        fixNullEditHistoryBy().catch((e) =>
            console.error('[monthlyReset] Migration error:', e)
        );
    }, 5_000);

    // Check every hour. The tick is cheap and idempotent (see monthStart above).
    // Staggered 20s after startup so DB is fully ready.
    // The tick itself is idempotent — once leads are reset to 'Interested'
    // they no longer match the Won + updatedAt < monthStart query, so repeated
    // runs are safe.
    setTimeout(() => {
        tick().catch((e) => console.error('[monthlyReset] tick error:', e));
        setInterval(
            () => tick().catch((e) => console.error('[monthlyReset] tick error:', e)),
            60 * 60 * 1000 // every hour
        );
    }, 20_000);

    console.log('[scheduler] Monthly stage reset scheduler started.');
}