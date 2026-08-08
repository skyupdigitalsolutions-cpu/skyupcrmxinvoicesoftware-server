/**
 * recoverInboundMessages.js — tries multiple MSG91 endpoints to find inbound logs
 * Run from server project root: node recoverInboundMessages.js
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();

const START_DATE = '2026-07-01';
const END_DATE   = '2026-08-08';

const uri = process.env.MONGO_URI;
if (!uri) { console.error('✗ MONGO_URI not set'); process.exit(1); }

const { Lead }            = await import('./src/models/Lead.js');
const { WhatsAppMessage } = await import('./src/models/WhatsAppMessage.js');
const { Company }         = await import('./src/models/Company.js');

await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
console.log('✓ Connected\n');

const company = await Company.findOne({ 'msg91.enabled': true }).select('+msg91.authKey');
if (!company) { console.error('✗ No MSG91 company'); process.exit(1); }
const authKey = company.msg91?.authKey;
if (!authKey) { console.error('✗ No authKey'); process.exit(1); }
console.log(`✓ Company: ${company.name}`);
console.log(`✓ AuthKey: ${authKey.slice(0,8)}...\n`);

// Try every known MSG91 endpoint for inbound message history
const endpoints = [
    `https://api.msg91.com/api/v5/whatsapp/logs?authkey=${authKey}&type=inbound&start_date=${START_DATE}&end_date=${END_DATE}&limit=500`,
    `https://api.msg91.com/api/v5/whatsapp/inbound?authkey=${authKey}&start_date=${START_DATE}&end_date=${END_DATE}&limit=500`,
    `https://api.msg91.com/api/v5/whatsapp/message/logs?authkey=${authKey}&start_date=${START_DATE}&end_date=${END_DATE}`,
    `https://api.msg91.com/api/v2/whatsapp/logs?authkey=${authKey}&direction=inbound&start_date=${START_DATE}&end_date=${END_DATE}`,
    `https://api.msg91.com/api/v5/report/whatsapp?authkey=${authKey}&type=inbound&start_date=${START_DATE}&end_date=${END_DATE}`,
    `https://api.msg91.com/api/v5/whatsapp/report?authkey=${authKey}&start_date=${START_DATE}&end_date=${END_DATE}`,
    `https://api.msg91.com/api/v5/whatsapp?authkey=${authKey}&action=logs&start_date=${START_DATE}&end_date=${END_DATE}`,
];

let messages = [];
let found = false;

for (const url of endpoints) {
    const display = url.replace(authKey, authKey.slice(0,8)+'***');
    process.stdout.write(`Trying ${display.split('?')[0].split('/').slice(-2).join('/')} ... `);
    try {
        const res  = await fetch(url);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { console.log(`✗ non-JSON: ${text.slice(0,80)}`); continue; }
        const arr = data?.data || data?.logs || data?.messages || data?.report || data?.result || [];
        console.log(`keys: [${Object.keys(data).join(', ')}]${Array.isArray(arr) ? ` — ${arr.length} items` : ''}`);
        if (Array.isArray(arr) && arr.length > 0) {
            messages = arr;
            console.log(`\n✓ Working! First item:\n${JSON.stringify(arr[0], null, 2)}\n`);
            found = true;
            break;
        }
    } catch (err) { console.log(`✗ ${err.message}`); }
}

if (!found) {
    console.log('\n──────────────────────────────────────');
    console.log('None of the endpoints returned inbound messages.');
    console.log('MSG91 likely does not expose inbound history via REST API.');
    console.log('\nAlternative options:');
    console.log('1. Go to MSG91 Dashboard → WhatsApp → Reports');
    console.log('   Download the inbound log CSV and run this script with that data.');
    console.log('2. Ask customers to resend their replies — webhook now works correctly.');
    await mongoose.disconnect();
    process.exit(0);
}

// Process and store messages
let stored = 0, skipped = 0;
for (const msg of messages) {
    const from = String(msg.mobile || msg.from || msg.customer_number || msg.sender || msg.number || '').replace(/\D/g, '');
    const text = msg.message || msg.text || msg.body || msg.content || '';
    const sentAt = msg.sent_at || msg.created_at || msg.timestamp || msg.date || null;
    if (!from || !text) { skipped++; continue; }

    const exists = await WhatsAppMessage.findOne({ company: company._id, contactNumber: { $regex: from.slice(-9) + '$' }, direction: 'in', text });
    if (exists) { skipped++; continue; }

    const createdAt = sentAt ? (typeof sentAt === 'number' ? new Date(sentAt * 1000) : new Date(sentAt)) : new Date();
    let lead = await Lead.findOne({ company: company._id, mobileKey: from });
    if (!lead && from.length >= 9) lead = await Lead.findOne({ company: company._id, mobileKey: new RegExp(from.slice(-9) + '$') });

    await WhatsAppMessage.create({
        company: company._id, lead: lead?._id || null,
        contactName: lead?.name || '', contactNumber: from, contactCountry: lead?.country || '',
        direction: 'in', kind: 'session', text, status: 'replied', seen: true, createdAt, updatedAt: createdAt,
    });
    console.log(`✓ ${lead ? lead.name : 'unlinked'} (${from}): "${text.slice(0,60)}"`);
    stored++;
}

console.log(`\n── Done: ${stored} stored, ${skipped} skipped ──`);
await mongoose.disconnect();