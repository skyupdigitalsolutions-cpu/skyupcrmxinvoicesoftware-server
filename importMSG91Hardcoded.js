/**
 * importMSG91Hardcoded.js
 * Imports the 8 inbound messages from MSG91 export directly — no CSV file needed.
 * Run: node importMSG91Hardcoded.js
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

const company = await Company.findOne({ 'msg91.enabled': true });
if (!company) { console.error('✗ No MSG91 company'); process.exit(1); }
console.log(`✓ Company: ${company.name}\n`);

// Inbound messages extracted from MSG91 CSV export (07-Aug to 08-Aug 2026)
const messages = [
    { from: '2348038685410', text: 'Yes',          date: '2026-08-08T02:59:31Z', mediaUrl: '' },
    { from: '97470754430',   text: '',              date: '2026-08-07T22:20:13Z', mediaUrl: 'https://whatsapp.phone91.com/whatsapp-haptik-media/971561778944/1070250969279888', mediaType: 'audio' },
    { from: '971569402786',  text: '',              date: '2026-08-07T22:10:28Z', mediaUrl: 'https://whatsapp.phone91.com/whatsapp-haptik-media/971561778944/1070250969279888', mediaType: 'audio' },
    { from: '971569402786',  text: 'Hello',         date: '2026-08-07T22:10:26Z', mediaUrl: '' },
    { from: '971569402786',  text: 'Hhhhhh',        date: '2026-08-07T21:57:10Z', mediaUrl: '' },
    { from: '25761300523',   text: 'Hello how are you', date: '2026-08-07T21:53:26Z', mediaUrl: '' },
    { from: '243896644614',  text: "Merci pour votre message. Nous ne sommes pas disponibles pour l'instant, mais nous vous répondrons dès que possible.", date: '2026-08-07T21:53:23Z', mediaUrl: '' },
    { from: '243896644614',  text: "Merci d'avoir contacté F - ENERGIE ! Dites-nous en quoi nous pouvons vous aider.", date: '2026-08-07T21:53:22Z', mediaUrl: '' },
];

let stored = 0, skipped = 0;

for (const msg of messages) {
    const { from, text, date, mediaUrl = '', mediaType = '' } = msg;

    // Skip if already in DB
    const checkText = text || '[Media attachment]';
    const exists = await WhatsAppMessage.findOne({
        company: company._id,
        direction: 'in',
        contactNumber: { $regex: from.slice(-9) + '$' },
        ...(text ? { text } : { mediaUrl }),
    });
    if (exists) {
        console.log(`  → Already exists: ${from} — skipping`);
        skipped++;
        continue;
    }

    const createdAt = new Date(date);

    // Find lead by exact mobileKey then suffix
    let lead = await Lead.findOne({ company: company._id, mobileKey: from });
    if (!lead && from.length >= 9) {
        lead = await Lead.findOne({
            company: company._id,
            mobileKey: new RegExp(from.slice(-9) + '$'),
        });
    }

    await WhatsAppMessage.create({
        company: company._id,
        lead: lead?._id || null,
        contactName: lead?.name || '',
        contactNumber: from,
        contactCountry: lead?.country || '',
        direction: 'in',
        kind: 'session',
        text: text || '',
        mediaUrl,
        mediaType,
        status: 'replied',
        seen: false,
        createdAt,
        updatedAt: createdAt,
    });

    // Mark last outbound as replied
    if (lead) {
        const lastOut = await WhatsAppMessage.findOne({ lead: lead._id, direction: 'out' }).sort({ createdAt: -1 });
        if (lastOut && lastOut.status !== 'replied') {
            lastOut.status = 'replied';
            await lastOut.save();
        }
        console.log(`  ✓ ${lead.name} (${from}): "${(text || '[media]').slice(0, 60)}"`);
    } else {
        console.log(`  ⚠ No lead found for ${from}: "${(text || '[media]').slice(0, 60)}"`);
    }
    stored++;
}

console.log(`\n── Done: ${stored} stored, ${skipped} skipped ──`);
console.log('Refresh Communication page to see recovered messages.');
await mongoose.disconnect();