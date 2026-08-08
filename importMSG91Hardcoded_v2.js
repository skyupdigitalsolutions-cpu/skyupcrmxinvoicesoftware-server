/**
 * importMSG91Hardcoded_v2.js
 * Saves 8 inbound messages from MSG91 export into MongoDB.
 * Also fixes seen:true to seen:false on existing ones so green dot shows.
 * Run: node importMSG91Hardcoded_v2.js
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

let stored = 0, updated = 0, skipped = 0;

for (const msg of messages) {
    const { from, text, date, mediaUrl = '', mediaType = '' } = msg;
    const createdAt = new Date(date);

    // Check if already exists
    const exists = await WhatsAppMessage.findOne({
        company: company._id,
        direction: 'in',
        contactNumber: { $regex: from.slice(-9) + '$' },
        ...(text ? { text } : { mediaUrl }),
    });

    if (exists) {
        // Fix seen:true → seen:false so green dot shows
        if (exists.seen !== false) {
            await WhatsAppMessage.updateOne({ _id: exists._id }, { $set: { seen: false } });
            console.log(`  ✓ Fixed seen:false for ${from}: "${(text || '[media]').slice(0, 50)}"`);
            updated++;
        } else {
            console.log(`  → Already correct: ${from}`);
            skipped++;
        }
        continue;
    }

    // Find lead
    let lead = await Lead.findOne({ company: company._id, mobileKey: from });
    if (!lead && from.length >= 9) {
        lead = await Lead.findOne({ company: company._id, mobileKey: new RegExp(from.slice(-9) + '$') });
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
        seen: false,  // ← false so green dot shows
        createdAt,
        updatedAt: createdAt,
    });

    if (lead) {
        const lastOut = await WhatsAppMessage.findOne({ lead: lead._id, direction: 'out' }).sort({ createdAt: -1 });
        if (lastOut && lastOut.status !== 'replied') { lastOut.status = 'replied'; await lastOut.save(); }
        console.log(`  ✓ Stored: ${lead.name} (${from}): "${(text || '[media]').slice(0, 60)}"`);
    } else {
        console.log(`  ⚠ No lead: ${from}: "${(text || '[media]').slice(0, 60)}"`);
    }
    stored++;
}

console.log(`\n── Done: ${stored} new, ${updated} fixed, ${skipped} unchanged ──`);
console.log('Refresh Communication page to see green dots on unread conversations.');
await mongoose.disconnect();