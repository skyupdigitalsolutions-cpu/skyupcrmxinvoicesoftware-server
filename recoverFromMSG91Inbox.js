/**
 * recoverFromMSG91Inbox.js
 * Fetches inbound messages from MSG91's Ticket/Helpdesk inbox API
 * and stores them in MongoDB linked to the correct leads.
 *
 * Run: node recoverFromMSG91Inbox.js
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();

const uri = process.env.MONGO_URI;
if (!uri) { console.error('✗ MONGO_URI not set'); process.exit(1); }

const { Lead }            = await import('./src/models/Lead.js');
const { WhatsAppMessage } = await import('./src/models/WhatsAppMessage.js');
const { Company }         = await import('./src/models/Company.js');

await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
console.log('✓ Connected to MongoDB\n');

const company = await Company.findOne({ 'msg91.enabled': true }).select('+msg91.authKey');
if (!company) { console.error('✗ No MSG91 company found'); process.exit(1); }
const authKey = company.msg91?.authKey;
if (!authKey) { console.error('✗ No authKey in company settings'); process.exit(1); }
console.log(`✓ Company: ${company.name}`);
console.log(`✓ AuthKey: ${authKey.slice(0,8)}...\n`);

// Try MSG91 ticket/helpdesk endpoints
const endpoints = [
    { url: `https://api.msg91.com/api/v5/whatsapp/ticket?authkey=${authKey}&status=open&limit=100`, label: 'tickets/open' },
    { url: `https://api.msg91.com/api/v5/whatsapp/ticket?authkey=${authKey}&limit=100`, label: 'tickets/all' },
    { url: `https://api.msg91.com/api/v5/ticket?authkey=${authKey}&channel=whatsapp&limit=100`, label: 'v5/ticket' },
    { url: `https://api.msg91.com/api/v5/whatsapp/conversation?authkey=${authKey}&limit=100`, label: 'conversations' },
    { url: `https://api.msg91.com/api/v5/helpdesk/ticket?authkey=${authKey}&limit=100`, label: 'helpdesk/ticket' },
];

let tickets = [];
let foundEndpoint = '';

for (const ep of endpoints) {
    process.stdout.write(`Trying ${ep.label} ... `);
    try {
        const res  = await fetch(ep.url);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { console.log(`non-JSON: ${text.slice(0,80)}`); continue; }
        console.log(`keys: [${Object.keys(data || {}).join(', ')}]`);
        const arr = data?.data || data?.tickets || data?.conversations || data?.result || [];
        if (Array.isArray(arr) && arr.length > 0) {
            tickets = arr;
            foundEndpoint = ep.label;
            console.log(`\n✓ Found ${arr.length} ticket(s)!`);
            console.log('Sample:', JSON.stringify(arr[0], null, 2).slice(0, 500));
            break;
        }
    } catch (err) { console.log(`✗ ${err.message}`); }
}

if (!tickets.length) {
    console.log('\n── Trying individual ticket fetch by number ──');
    // Try fetching conversation by specific number from the screenshot
    const testNumbers = ['966', '973']; // Saudi, Bahrain prefixes seen in screenshot
    const testUrl = `https://api.msg91.com/api/v5/whatsapp/chat?authkey=${authKey}&number=966500646679`;
    process.stdout.write(`Trying chat by number ... `);
    try {
        const res  = await fetch(testUrl);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { console.log(`non-JSON: ${text.slice(0,200)}`); }
        if (data) console.log('Response:', JSON.stringify(data).slice(0,300));
    } catch (err) { console.log(`✗ ${err.message}`); }

    console.log('\n──────────────────────────────────────────');
    console.log('Could not fetch tickets via API.');
    console.log('\nManual recovery option:');
    console.log('In MSG91 inbox, click each conversation, note the customer number');
    console.log('and message text, then add as call log on the lead in your CRM.');
    await mongoose.disconnect();
    process.exit(0);
}

// Process tickets
console.log(`\nProcessing ${tickets.length} ticket(s)...\n`);
let stored = 0, skipped = 0;

for (const ticket of tickets) {
    // Extract fields — adjust based on actual response structure
    const from = String(
        ticket.customer_number || ticket.from || ticket.mobile ||
        ticket.contact?.phone || ticket.sender || ''
    ).replace(/\D/g, '');

    const messages = ticket.messages || ticket.chats || ticket.conversation || [];
    const inboundMsgs = Array.isArray(messages)
        ? messages.filter(m => m.direction === 'inbound' || m.type === 'inbound' || m.from !== 'agent')
        : [{ text: ticket.last_message || ticket.message || ticket.body || '', sent_at: ticket.created_at }];

    for (const msg of inboundMsgs) {
        const text    = msg.text || msg.message || msg.body || msg.content || '';
        const sentAt  = msg.sent_at || msg.created_at || msg.timestamp || ticket.created_at;
        if (!from || !text) { skipped++; continue; }

        const exists = await WhatsAppMessage.findOne({
            company: company._id,
            contactNumber: { $regex: from.slice(-9) + '$' },
            direction: 'in', text,
        });
        if (exists) { skipped++; continue; }

        const createdAt = sentAt
            ? (typeof sentAt === 'number' ? new Date(sentAt * 1000) : new Date(sentAt))
            : new Date();

        let lead = await Lead.findOne({ company: company._id, mobileKey: from });
        if (!lead && from.length >= 9) {
            lead = await Lead.findOne({ company: company._id, mobileKey: new RegExp(from.slice(-9) + '$') });
        }

        await WhatsAppMessage.create({
            company: company._id, lead: lead?._id || null,
            contactName: lead?.name || ticket.customer_name || '',
            contactNumber: from, contactCountry: lead?.country || '',
            direction: 'in', kind: 'session', text,
            status: 'replied', seen: true, createdAt, updatedAt: createdAt,
        });
        console.log(`✓ ${lead?.name || from}: "${text.slice(0,60)}"`);
        stored++;
    }
}

console.log(`\n── Done: ${stored} stored, ${skipped} skipped ──`);
await mongoose.disconnect();