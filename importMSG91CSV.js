/**
 * importMSG91CSV.js
 * Imports inbound messages from MSG91 CSV export into CRM.
 * Run: node importMSG91CSV.js
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
dotenv.config();

const CSV_FILE = './501070_07-08-2026_08-08-2026_5ttVlYVUX5GEfw331hTp_000000000000.csv';

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

// Parse CSV
const lines = [];
const rl = createInterface({ input: createReadStream(CSV_FILE) });
for await (const line of rl) lines.push(line);

// Parse header
const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"' && line[i+1] === '"') { current += '"'; i++; }
        else if (line[i] === '"') inQuotes = !inQuotes;
        else if (line[i] === ',' && !inQuotes) { result.push(current); current = ''; }
        else current += line[i];
    }
    result.push(current);
    return result;
}

function extractText(content) {
    try {
        const data = JSON.parse(content);
        if (data.button) return data.button.text || data.button.payload || '';
        if (data.text) return data.text;
        if (data.attachment_url) return '[Media attachment]';
        return JSON.stringify(data);
    } catch { return content; }
}

// Process rows
const seen = new Set();
let stored = 0, skipped = 0;

for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => row[h] = (cols[idx] || '').trim());

    if (row['Direction'] !== '0') continue; // only inbound

    const from    = String(row['Customer Number'] || '').replace(/\D/g, '');
    const content = row['Content'] || '';
    const text    = extractText(content);
    const dateStr = row['Date Time'] || '';

    if (!from || !text) { skipped++; continue; }

    const dedupeKey = `${from}|${text}`;
    if (seen.has(dedupeKey)) { skipped++; continue; }
    seen.add(dedupeKey);

    // Check already in DB
    const exists = await WhatsAppMessage.findOne({
        company: company._id,
        direction: 'in',
        text,
        contactNumber: { $regex: from.slice(-9) + '$' },
    });
    if (exists) { console.log(`  → Already exists: ${from} — skipping`); skipped++; continue; }

    const createdAt = dateStr ? new Date(dateStr) : new Date();

    // Find lead
    let lead = await Lead.findOne({ company: company._id, mobileKey: from });
    if (!lead && from.length >= 9) {
        lead = await Lead.findOne({ company: company._id, mobileKey: new RegExp(from.slice(-9) + '$') });
    }

    const mediaUrl = (() => { try { return JSON.parse(content).attachment_url || ''; } catch { return ''; } })();

    await WhatsAppMessage.create({
        company: company._id,
        lead: lead?._id || null,
        contactName: lead?.name || '',
        contactNumber: from,
        contactCountry: lead?.country || '',
        direction: 'in',
        kind: 'session',
        text: text === '[Media attachment]' ? '' : text,
        mediaUrl,
        mediaType: mediaUrl ? 'audio' : '',
        status: 'replied',
        seen: false,
        createdAt,
        updatedAt: createdAt,
    });

    if (lead) {
        // Update last outbound message status to 'replied'
        const lastOut = await WhatsAppMessage.findOne({ lead: lead._id, direction: 'out' }).sort({ createdAt: -1 });
        if (lastOut) { lastOut.status = 'replied'; await lastOut.save(); }
        console.log(`  ✓ ${lead.name} (${from}): "${text.slice(0,60)}"`);
    } else {
        console.log(`  ⚠ No lead for ${from}: "${text.slice(0,60)}"`);
    }
    stored++;
}

console.log(`\n── Done: ${stored} stored, ${skipped} skipped ──`);
console.log('Refresh Communication page to see recovered messages.');
await mongoose.disconnect();