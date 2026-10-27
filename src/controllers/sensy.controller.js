// controllers/sensy.controller.js
//
// Handles incoming webhooks from Sensy (sensytalk.com) and creates CRM leads.
//
// FLOW:
//   Sensy → POST /api/sensy/webhook?secret=<COMPANY_WEBHOOK_SECRET>
//           body = { contact: { name, phone, ... }, ... }
//   We find the company by webhookSecret, resolve the default owner (admin),
//   and upsert a Lead using the same dedup logic as createLead.
//
// SETUP (per company, done in Developer panel):
//   1. Generate a webhook secret and save to company.sensy.webhookSecret
//   2. Set the Sensy Webhook URL to:
//        https://<YOUR_API>/api/sensy/webhook?secret=<webhookSecret>
//   3. Optional: set company.sensy.defaultOwner to a User _id

import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError }      from '../utils/ApiError.js';
import { Lead, normalizePhone } from '../models/Lead.js';
import { Company }       from '../models/Company.js';
import { User }          from '../models/User.js';

// ── Inbound Sensy Webhook ─────────────────────────────────────────────────────
export const sensyWebhook = asyncHandler(async (req, res) => {
  const secret = req.query.secret || req.headers['x-sensy-secret'];
  if (!secret) {
    return res.status(401).json({ success: false, message: 'Missing webhook secret.' });
  }

  // Identify company by secret
  const company = await Company.findOne({ 'sensy.webhookSecret': secret });
  if (!company) {
    return res.status(401).json({ success: false, message: 'Unknown webhook secret.' });
  }
  if (!company.active) {
    return res.status(403).json({ success: false, message: 'Company account is inactive.' });
  }

  // ── Parse Sensy payload ─────────────────────────────────────────────────────
  // Sensy sends different payload shapes depending on the trigger.
  // We normalise to { name, phone, email, source } here.
  const body = req.body || {};

  // Support top-level or nested under "contact" / "data"
  const contact = body.contact || body.data || body;

  const rawPhone = String(
    contact.phone || contact.mobile || contact.whatsapp || contact.number || ''
  ).trim();
  const name     = String(contact.name || contact.full_name || contact.firstName || 'Unknown').trim();
  const email    = String(contact.email || '').trim().toLowerCase();
  const city     = String(contact.city  || contact.location || '').trim();
  const interest = String(contact.interest || contact.product || contact.message || '').trim();
  // Sensy contacts are always from WhatsApp
  const source   = 'WhatsApp';

  if (!rawPhone) {
    // Log and ack — Sensy retries on non-2xx
    console.warn('[Sensy] Webhook received with no phone number:', JSON.stringify(body).slice(0, 300));
    return res.json({ success: true, action: 'skipped', reason: 'no_phone' });
  }

  // ── Resolve default owner ───────────────────────────────────────────────────
  let ownerId, ownerName;

  if (company.sensy?.defaultOwner) {
    const u = await User.findOne({ _id: company.sensy.defaultOwner, company: company._id });
    if (u) { ownerId = u._id; ownerName = u.name; }
  }
  // Fallback: first admin of the company
  if (!ownerId) {
    const admin = await User.findOne({ company: company._id, role: 'admin' }).sort({ createdAt: 1 });
    if (!admin) {
      console.error(`[Sensy] Company ${company._id} has no admin user — cannot create lead.`);
      return res.status(422).json({ success: false, message: 'No admin user found for this company.' });
    }
    ownerId   = admin._id;
    ownerName = admin.name;
  }

  // Normalise phone
  const country = company.sensy?.defaultCountry || 'UAE';
  const mobileKey = normalizePhone(rawPhone, country);

  // ── Dedup: check if lead already exists ────────────────────────────────────
  if (mobileKey) {
    const existing = await Lead.findOne({ mobileKey, company: company._id });
    if (existing) {
      console.log(`[Sensy] Lead already exists for ${mobileKey} in company ${company._id}`);
      return res.json({ success: true, action: 'duplicate', leadId: existing._id });
    }
    // Suffix fallback
    const rawDigits = rawPhone.replace(/\D/g, '');
    if (rawDigits.length >= 6) {
      const suffixRx = new RegExp(rawDigits.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
      const byDigits = await Lead.findOne({ mobileKey: suffixRx, company: company._id });
      if (byDigits) {
        return res.json({ success: true, action: 'duplicate', leadId: byDigits._id });
      }
    }
  }

  // ── Lead limit guard ────────────────────────────────────────────────────────
  const leadLimit = company.limits?.maxLeads || 0;
  if (leadLimit > 0) {
    const count = await Lead.countDocuments({ company: company._id });
    if (count >= leadLimit) {
      console.warn(`[Sensy] Lead limit ${leadLimit} reached for company ${company._id}`);
      return res.status(429).json({ success: false, message: 'Lead limit reached.' });
    }
  }

  // ── Create the lead ─────────────────────────────────────────────────────────
  try {
    const lead = await Lead.create({
      company: company._id,
      name,
      mobile:   rawPhone,
      country,
      city,
      email,
      source,
      interest,
      status:   'New',
      owner:    ownerId,
      ownerName,
      remark:   `Imported via Sensy on ${new Date().toLocaleDateString()}`,
      campaign: body.campaign || body.flow_name || '',
    });

    console.log(`[Sensy] Lead created: ${lead._id} (${name}, ${rawPhone}) for company ${company._id}`);
    return res.status(201).json({ success: true, action: 'created', leadId: lead._id });
  } catch (err) {
    if (err.code === 11000) {
      // Race condition — another request created this lead simultaneously
      return res.json({ success: true, action: 'duplicate' });
    }
    throw err;
  }
});

// ── GET /api/sensy/settings — return sensy config for current company ─────────
export const getSensySettings = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.user.company);
  if (!company) throw new ApiError(404, 'Company not found');

  const s = company.sensy || {};
  res.json({
    success: true,
    settings: {
      webhookSecret:  s.webhookSecret  || '',
      defaultCountry: s.defaultCountry || 'UAE',
      defaultOwner:   s.defaultOwner   || null,
      webhookUrl:     s.webhookSecret
        ? `${process.env.API_BASE_URL || ''}/api/sensy/webhook?secret=${s.webhookSecret}`
        : '',
    },
  });
});

// ── PATCH /api/sensy/settings — save sensy config ────────────────────────────
export const setSensySettings = asyncHandler(async (req, res) => {
  const { webhookSecret, defaultCountry, defaultOwner } = req.body;
  const company = await Company.findById(req.user.company);
  if (!company) throw new ApiError(404, 'Company not found');

  company.sensy = {
    webhookSecret:  String(webhookSecret  || '').trim(),
    defaultCountry: String(defaultCountry || 'UAE').trim(),
    defaultOwner:   defaultOwner || null,
  };
  await company.save();

  res.json({
    success: true,
    settings: {
      webhookSecret:  company.sensy.webhookSecret,
      defaultCountry: company.sensy.defaultCountry,
      defaultOwner:   company.sensy.defaultOwner,
      webhookUrl:     company.sensy.webhookSecret
        ? `${process.env.API_BASE_URL || ''}/api/sensy/webhook?secret=${company.sensy.webhookSecret}`
        : '',
    },
  });
});
