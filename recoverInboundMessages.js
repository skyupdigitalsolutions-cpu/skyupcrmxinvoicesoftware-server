/**
 * recoverInboundMessages.js
 *
 * One-time script to fetch missed inbound WhatsApp messages from MSG91
 * and store them in MongoDB.
 *
 * Run from your server project root:
 *   node recoverInboundMessages.js
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import fetch from 'node-fetch';

dotenv.config();

// ── Set the date range for the missed period ──────────────────────────────────
const START_DATE = '2026-07-01'; // adjust to when webhook broke
const END_DATE   = '2026-08-08'; // today

const uri = process.env.MONGO_URI;
if (!uri) { console.error('✗ MONGO_URI not set in .env'); process.exit(1); }

const { Lead }            = await import('./src/models/Lead.js');
const { WhatsAppMessage } = await import('./src/models/WhatsAppMessage.js');
const { Company }         = await import('./src/models/Company.js');

await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
console.log('✓ Connected to MongoDB\n');

// ── Get authKey and company from DB ───────────────────────────────────────────
const company = await Company.findOne({ 'msg91.enabled': true }).select('+msg91.authKey');
if (!company) { console.error('✗ No MSG91-enabled company found'); process.exit(1); }

const authKey = company.msg91?.authKey;
if (!authKey) { console.error('✗ MSG91 authKey not set in company settings'); process.exit(1); }

console.log(`✓ Company: ${company.name || company._id}`);
console.log(`✓ AuthKey found (${authKey.slice(0,8)}...)\n`);

// ── Fetch from MSG91 report API ───────────────────────────────────────────────
console.log(`Fetching inbound messages ${START_DATE} → ${END_DATE}…`);

const url = `https://api.msg91.com/api/v5/report?authkey=${authKey}&type=2&start_date=${START_DATE}&end_date=${END_DATE}&limit=500`;
console.log(`URL: ${url.replace(authKey, authKey.slice(0,8)+'...')}\n`);

let rawData;
try {
    const res = await fetch(url);
    const text = await res.text();
    console.log('MSG91 raw response:\n', text.slice(0, 500), '\n');
    rawData = JSON.parse(text);
} catch (err) {
    console.error('✗ Failed to fetch from MSG91:', err.message);
    await mongoose.disconnect();
    process.exit(1);
}

// Print the structure so we can see exact field names
console.log('Response keys:', Object.keys(rawData || {}));
if (rawData?.data?.length) {
    console.log('First message sample:', JSON.stringify(rawData.data[0], null, 2));
}

const messages = rawData?.data || rawData?.logs || rawData?.messages || [];
console.log(`\nFound ${messages.length} message(s)\n`);

if (!messages.length) {
    console.log('No messages found. Either:');
    console.log('1. No inbound messages in this date range in MSG91');
    console.log('2. MSG91 report API uses a different endpoint for your account');
    console.log('3. MSG91 plan does not include inbound message history');
    await mongoose.disconnect();
    process.exit(0);
}

// ── Store each message ─────────────────────────────────────────────────────────
let stored = 0, skipped = 0, notFound = 0;

for (const msg of messages) {
    // Adjust field names based on what MSG91 actually returns (shown above)
    const from   = String(msg.mobile || msg.from || msg.customer_number || msg.sender || '').replace(/\D/g, '');
    const text   = msg.message || msg.text || msg.body || msg.content || '';
    const sentAt = msg.sent_at || msg.created_at || msg.timestamp || msg.date || null;

    if (!from || !text) { skipped++; continue; }

    // Skip if already stored (check by content + number + approximate time)
    const createdAt = sentAt
        ? (typeof sentAt === 'number' ? new Date(sentAt * 1000) : new Date(sentAt))
        : new Date();

    const exists = await WhatsAppMessage.findOne({
        company: company._id,
        contactNumber: { $regex: from.slice(-9) + '$' },
        direction: 'in',
        text,
    });
    if (exists) { console.log(`  → Already exists: ${from} — skipping`); skipped++; continue; }

    // Find lead by mobileKey
    let lead = await Lead.findOne({ company: company._id, mobileKey: from });
    if (!lead && from.length >= 9) {
        lead = await Lead.findOne({
            company: company._id,
            mobileKey: new RegExp(from.slice(-9) + '$'),
        });
    }

    if (lead) {
        await WhatsAppMessage.create({
            company: company._id, lead: lead._id,
            contactName: lead.name, contactNumber: from, contactCountry: lead.country,
            direction: 'in', kind: 'session', text,
            status: 'replied', seen: true,
            createdAt, updatedAt: createdAt,
        });
        console.log(`  ✓ Stored: ${lead.name} (${from}) — "${text.slice(0, 60)}"`);
        stored++;
    } else {
        await WhatsAppMessage.create({
            company: company._id, lead: null,
            contactName: '', contactNumber: from, contactCountry: '',
            direction: 'in', kind: 'session', text,
            status: 'replied', seen: true,
            createdAt, updatedAt: createdAt,
        });
        console.log(`  ⚠ No lead found for ${from} — stored unlinked`);
        notFound++;
    }
}

console.log('\n── Summary ──────────────────');
console.log(`  Stored linked:   ${stored}`);
console.log(`  Stored unlinked: ${notFound}`);
console.log(`  Skipped:         ${skipped}`);
console.log('\n✅ Done. Refresh Communication page to see recovered messages.');

await mongoose.disconnect();