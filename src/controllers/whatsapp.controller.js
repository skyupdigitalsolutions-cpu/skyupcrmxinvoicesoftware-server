import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Company } from '../models/Company.js';
import { Lead } from '../models/Lead.js';
import { WhatsAppTemplate } from '../models/WhatsAppTemplate.js';
import { WhatsAppMessage } from '../models/WhatsAppMessage.js';
import { tenantScope, tenantCompanyId } from '../middleware/auth.js';
import { sendTemplateMessage, sendSessionMessage, sendMediaMessage } from '../utils/msg91.js';
import { uploadChatAttachment } from '../utils/cloudinary.js';
import { toE164 } from '../utils/phone.js';
import { notifyUsers, ownerAndAdmins } from '../utils/notify.js';

const requireAdmin = (req) => {
    if (req.user.role !== 'admin' && req.user.role !== 'developer') {
        throw new ApiError(403, 'Only an admin can manage WhatsApp settings.');
    }
};

// Per-company Cloudinary credentials, or null to fall back to the platform
// (env-var) account. Mirrors the pattern used by invoice.controller.js.
const cloudCredsFor = (company) =>
    company && company.cloudinary && company.cloudinary.cloudName ? {
        cloudName: company.cloudinary.cloudName,
        apiKey: company.cloudinary.apiKey,
        apiSecret: company.cloudinary.apiSecret,
    } :
    null;

// ── Settings (MSG91 credentials) ─────────────────────────────────────────────
export const getSettings = asyncHandler(async (req, res) => {
    const companyId = tenantCompanyId(req);
    // Must select authKey (select: false in the schema) even though it's
    // never returned to the client — toSafeJSON() checks whether it's set
    // to compute hasAuthKey, and without this select that check always sees
    // undefined and reports hasAuthKey: false regardless of what's actually
    // saved in the database.
    const company = await Company.findById(companyId).select('+msg91.authKey');
    if (!company) throw new ApiError(404, 'Company not found');
    res.json({ success: true, msg91: company.toSafeJSON().msg91 });
});

export const setSettings = asyncHandler(async (req, res) => {
    requireAdmin(req);
    const companyId = tenantCompanyId(req);
    // authKey has `select: false` in the schema (never returned by default,
    // like a password) — it must be explicitly selected here even though
    // we're only writing to it, otherwise Mongoose doesn't know the path
    // exists on this document and can silently fail to persist the change.
    // (Every other handler that touches authKey already does this; this one
    // — the one place that actually needs to WRITE it — was missing it.)
    const company = await Company.findById(companyId).select('+msg91.authKey');
    if (!company) throw new ApiError(404, 'Company not found');

    const { enabled, authKey, integratedNumber, senderName } = req.body || {};
    if (!company.msg91) company.msg91 = {};
    if (enabled !== undefined) company.msg91.enabled = !!enabled;
    if (authKey !== undefined && String(authKey).trim()) company.msg91.authKey = String(authKey).trim();
    if (integratedNumber !== undefined) company.msg91.integratedNumber = String(integratedNumber).trim();
    if (senderName !== undefined) company.msg91.senderName = String(senderName).trim();
    // msg91 is a nested plain-object path, not a real Mongoose sub-schema —
    // explicitly mark it modified so a direct property assignment like the
    // ones above is never silently missed on save.
    company.markModified('msg91');

    await company.save();
    res.json({ success: true, msg91: company.toSafeJSON().msg91 });
});

// ── Templates (local reference list) ─────────────────────────────────────────
export const listTemplates = asyncHandler(async (req, res) => {
    const templates = await WhatsAppTemplate.find({ ...tenantScope(req) }).sort({ name: 1 });
    res.json({ success: true, templates: templates.map((t) => t.toSafeJSON()) });
});

export const createTemplate = asyncHandler(async (req, res) => {
    requireAdmin(req);
    const { name, language, bodyPreview, variableCount } = req.body || {};
    if (!name || !String(name).trim()) throw new ApiError(400, 'Template name is required (must match the name approved on MSG91).');

    const companyId = tenantCompanyId(req);
    const template = await WhatsAppTemplate.create({
        company: companyId,
        name: String(name).trim(),
        language: language || 'en',
        bodyPreview: bodyPreview || '',
        variableCount: Number.isFinite(Number(variableCount)) ? Number(variableCount) : 0,
    });
    res.status(201).json({ success: true, template: template.toSafeJSON() });
});

export const updateTemplate = asyncHandler(async (req, res) => {
    requireAdmin(req);
    const template = await WhatsAppTemplate.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!template) throw new ApiError(404, 'Template not found');

    const fields = ['name', 'language', 'bodyPreview', 'variableCount', 'active'];
    fields.forEach((f) => { if (req.body[f] !== undefined) template[f] = req.body[f]; });
    await template.save();
    res.json({ success: true, template: template.toSafeJSON() });
});

export const deleteTemplate = asyncHandler(async (req, res) => {
    requireAdmin(req);
    const template = await WhatsAppTemplate.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!template) throw new ApiError(404, 'Template not found');
    await template.deleteOne();
    res.json({ success: true, message: 'Template deleted' });
});

// ── Sending a template to one or more leads ──────────────────────────────────
export const sendTemplate = asyncHandler(async (req, res) => {
    const { leadIds, templateName, language, variables, autoFillNameVar } = req.body || {};
    if (!Array.isArray(leadIds) || !leadIds.length) throw new ApiError(400, 'Select at least one lead.');
    if (!templateName) throw new ApiError(400, 'Select a template.');

    const companyId = tenantCompanyId(req);
    const company = await Company.findById(companyId).select('+msg91.authKey');
    if (!company || !company.msg91 || !company.msg91.enabled || !company.msg91.authKey || !company.msg91.integratedNumber) {
        throw new ApiError(400, 'MSG91 is not configured/enabled for this company yet.');
    }

    const leads = await Lead.find({ _id: { $in: leadIds }, ...tenantScope(req) });
    const results = [];

    for (const lead of leads) {
        const to = toE164(lead.mobile, lead.country);
        let vars = Array.isArray(variables) ? [...variables] : [];
        // Optionally substitute the first variable with each lead's own name
        // (handy for templates that open with "Hi {{1}}, ...").
        if (autoFillNameVar && vars.length) vars[0] = lead.name || vars[0];

        if (!to) {
            results.push({ leadId: lead._id, status: 'failed', error: 'Could not resolve a valid phone number for this lead.' });
            await WhatsAppMessage.create({
                company: companyId, lead: lead._id, direction: 'out', kind: 'template',
                templateName, variables: vars, text: '', status: 'failed',
                error: 'Could not resolve phone number', sentBy: req.user._id,
            });
            continue;
        }

        try {
            const sendRes = await sendTemplateMessage({
                authKey: company.msg91.authKey,
                integratedNumber: company.msg91.integratedNumber,
                to, templateName, language, variables: vars,
            });
            await WhatsAppMessage.create({
                company: companyId, lead: lead._id, direction: 'out', kind: 'template',
                templateName, variables: vars, text: '', status: 'sent',
                msg91RequestId: sendRes.requestId, sentBy: req.user._id,
            });
            results.push({ leadId: lead._id, status: 'sent' });
        } catch (err) {
            console.error(`[whatsapp] sendTemplate FAILED for lead ${lead._id}:`, err.message, '| status:', err.msg91Status, '| raw:', err.msg91RawText || '');
            await WhatsAppMessage.create({
                company: companyId, lead: lead._id, direction: 'out', kind: 'template',
                templateName, variables: vars, text: '', status: 'failed',
                error: err.message || 'Send failed', sentBy: req.user._id,
            });
            results.push({ leadId: lead._id, status: 'failed', error: err.message });
        }
    }

    res.json({ success: true, results });
});

// ── Manual continue-chat reply ───────────────────────────────────────────────
export const sendReply = asyncHandler(async (req, res) => {
    const { leadId, text } = req.body || {};
    if (!leadId || !text || !String(text).trim()) throw new ApiError(400, 'Lead and message text are required.');

    const companyId = tenantCompanyId(req);
    const company = await Company.findById(companyId).select('+msg91.authKey');
    if (!company || !company.msg91 || !company.msg91.enabled || !company.msg91.authKey || !company.msg91.integratedNumber) {
        throw new ApiError(400, 'MSG91 is not configured/enabled for this company yet.');
    }
    const lead = await Lead.findOne({ _id: leadId, ...tenantScope(req) });
    if (!lead) throw new ApiError(404, 'Lead not found');

    const to = toE164(lead.mobile, lead.country);
    if (!to) throw new ApiError(400, 'Could not resolve a valid phone number for this lead.');

    try {
        const sendRes = await sendSessionMessage({
            authKey: company.msg91.authKey, integratedNumber: company.msg91.integratedNumber, to, text,
        });
        const msg = await WhatsAppMessage.create({
            company: companyId, lead: lead._id, direction: 'out', kind: 'session',
            text, status: 'sent', msg91RequestId: sendRes.requestId, sentBy: req.user._id,
        });
        res.status(201).json({ success: true, savedMessage: msg.toSafeJSON() });
    } catch (err) {
        console.error('[whatsapp] sendReply FAILED:', err.message, '| status:', err.msg91Status, '| raw:', err.msg91RawText || '');
        const msg = await WhatsAppMessage.create({
            company: companyId, lead: lead._id, direction: 'out', kind: 'session',
            text, status: 'failed', error: err.message || 'Send failed', sentBy: req.user._id,
        });
        // 'message' here is a plain STRING (not the saved record — that's
        // 'savedMessage' below) because the client's apiError() helper reads
        // response.data.message as the error text for every endpoint's
        // toasts. Without it, the toast falls back to axios's generic
        // "Request failed with status code 502" instead of the real reason.
        const reason = err.message || 'Send failed';
        res.status(502).json({ success: false, message: reason, error: reason, savedMessage: msg.toSafeJSON() });
    }
});

// ── Manual continue-chat: send an image/document/video/audio attachment ─────
// The file arrives as a base64 data URL (same pattern as company logo
// uploads), gets hosted on Cloudinary first (WhatsApp/MSG91 need a public
// URL, not raw bytes), then sent via MSG91. Subject to the same 24h
// session-window rule as a free-text reply.
export const sendMedia = asyncHandler(async (req, res) => {
    const { leadId, dataUrl, mediaType, filename, caption } = req.body || {};
    if (!leadId || !dataUrl) throw new ApiError(400, 'Lead and a file are required.');
    if (!['image', 'document', 'video', 'audio'].includes(mediaType)) {
        throw new ApiError(400, 'mediaType must be one of image, document, video, audio.');
    }

    const companyId = tenantCompanyId(req);
    const company = await Company.findById(companyId).select('+msg91.authKey +cloudinary.apiSecret');
    if (!company || !company.msg91 || !company.msg91.enabled || !company.msg91.authKey || !company.msg91.integratedNumber) {
        throw new ApiError(400, 'MSG91 is not configured/enabled for this company yet.');
    }
    const lead = await Lead.findOne({ _id: leadId, ...tenantScope(req) });
    if (!lead) throw new ApiError(404, 'Lead not found');

    const to = toE164(lead.mobile, lead.country);
    if (!to) throw new ApiError(400, 'Could not resolve a valid phone number for this lead.');

    let uploaded;
    try {
        const publicId = `${companyId}/${Date.now()}-${(filename || 'file').replace(/[^\w.-]/g, '_')}`;
        uploaded = await uploadChatAttachment(dataUrl, publicId, cloudCredsFor(company));
    } catch (err) {
        throw new ApiError(500, `File upload failed: ${err.message || 'unknown error'}`);
    }

    try {
        const sendRes = await sendMediaMessage({
            authKey: company.msg91.authKey, integratedNumber: company.msg91.integratedNumber,
            to, mediaType, mediaUrl: uploaded.url, caption: caption || '', filename: filename || '',
        });
        const msg = await WhatsAppMessage.create({
            company: companyId, lead: lead._id, direction: 'out', kind: 'session',
            text: caption || '', mediaUrl: uploaded.url, mediaType, mediaFilename: filename || '',
            status: 'sent', msg91RequestId: sendRes.requestId, sentBy: req.user._id,
        });
        res.status(201).json({ success: true, savedMessage: msg.toSafeJSON() });
    } catch (err) {
        console.error('[whatsapp] sendMedia FAILED:', err.message, '| status:', err.msg91Status, '| raw:', err.msg91RawText || '');
        const msg = await WhatsAppMessage.create({
            company: companyId, lead: lead._id, direction: 'out', kind: 'session',
            text: caption || '', mediaUrl: uploaded.url, mediaType, mediaFilename: filename || '',
            status: 'failed', error: err.message || 'Send failed', sentBy: req.user._id,
        });
        const reason = err.message || 'Send failed';
        res.status(502).json({ success: false, message: reason, error: reason, savedMessage: msg.toSafeJSON() });
    }
});

// ── Conversation log for the Communication page ──────────────────────────────
// One row per lead: last message, its status, and the lead's last reply —
// this is the "all leads' shared template and their response" table.
export const listConversations = asyncHandler(async (req, res) => {
    const q = { ...tenantScope(req) };
    const messages = await WhatsAppMessage.find(q).sort({ createdAt: -1 }).limit(2000).lean();

    const byLead = new Map();
    for (const m of messages) {
        const key = String(m.lead);
        if (!byLead.has(key)) byLead.set(key, { lastOut: null, lastIn: null });
        const entry = byLead.get(key);
        if (m.direction === 'out' && !entry.lastOut) entry.lastOut = m;
        if (m.direction === 'in' && !entry.lastIn) entry.lastIn = m;
    }

    const leadIds = [...byLead.keys()];
    const leads = await Lead.find({ _id: { $in: leadIds } }).select('name mobile country stage status').lean();
    const leadById = new Map(leads.map((l) => [String(l._id), l]));

    const rows = leadIds
        .map((id) => {
            const lead = leadById.get(id);
            if (!lead) return null;
            const { lastOut, lastIn } = byLead.get(id);
            return {
                leadId: id,
                leadName: lead.name,
                mobile: lead.mobile,
                lastTemplate: lastOut ? lastOut.templateName || '' : '',
                lastStatus: lastOut ? lastOut.status : '',
                lastSentAt: lastOut ? lastOut.createdAt : null,
                lastResponse: lastIn ? lastIn.text : '',
                lastResponseAt: lastIn ? lastIn.createdAt : null,
            };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.lastSentAt || b.lastResponseAt || 0) - new Date(a.lastSentAt || a.lastResponseAt || 0));

    res.json({ success: true, conversations: rows });
});

// Full thread for one lead (used by the "Continue Chat" drawer).
export const getThread = asyncHandler(async (req, res) => {
    const lead = await Lead.findOne({ _id: req.params.leadId, ...tenantScope(req) });
    if (!lead) throw new ApiError(404, 'Lead not found');
    const messages = await WhatsAppMessage.find({ lead: lead._id, ...tenantScope(req) }).sort({ createdAt: 1 });
    res.json({ success: true, lead: { id: lead._id, name: lead.name, mobile: lead.mobile }, messages: messages.map((m) => m.toSafeJSON()) });
});

// ── Inbound webhook (MSG91 → us) ─────────────────────────────────────────────
// No auth middleware — MSG91 calls this directly. Verified by a shared secret
// query param instead (?token=WHATSAPP_WEBHOOK_SECRET, set as an env var).
// Handles both delivery/read status callbacks and inbound reply messages.
// MSG91's exact webhook payload shape can vary; this reads defensively from
// a few common locations rather than assuming one fixed structure.
export const webhook = asyncHandler(async (req, res) => {
    const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
    if (secret && req.query.token !== secret) {
        // Acknowledge with 200 regardless so MSG91 doesn't retry forever on a
        // misconfigured secret, but do nothing.
        return res.json({ success: true, ignored: true });
    }

    const body = req.body || {};
    const entries = Array.isArray(body.entry) ? body.entry : (Array.isArray(body) ? body : [body]);

    for (const entry of entries) {
        const from = entry.from || (entry.contact && entry.contact.wa_id) || '';
        const toNumber = entry.integrated_number || entry.to || '';
        const statusValue = entry.status || (entry.type === 'status' ? entry.status : '');
        const requestId = entry.request_id || entry.msg_id || entry.message_id || '';
        const text = (entry.text && entry.text.body) || entry.body || '';

        if (!from && !requestId) continue;

        // Route to the right tenant by matching the number the message was
        // sent to/from against each company's configured integratedNumber.
        const company = toNumber
            ? await Company.findOne({ 'msg91.integratedNumber': toNumber })
            : null;

        if (statusValue && requestId) {
            // Delivery/read status update for a message we sent.
            const mapped = statusValue === 'delivered' ? 'delivered' : statusValue === 'read' ? 'read' : statusValue === 'failed' ? 'failed' : null;
            if (mapped) {
                await WhatsAppMessage.updateOne({ msg91RequestId: requestId }, { $set: { status: mapped } });
            }
            continue;
        }

        if (from && text) {
            // Inbound reply — match to a lead in the routed company (or any
            // company if we couldn't resolve one from the number). mobileKey
            // is stored as country-code + local number with no leading zero
            // (see Lead.js normalizePhone), matching MSG91's "from" format —
            // try an exact match first, then fall back to a last-9-digit
            // match for edge cases (e.g. a custom country code we don't know).
            const digits = String(from).replace(/\D/g, '');
            const leadQuery = company ? { company: company._id } : {};
            let lead = await Lead.findOne({ ...leadQuery, mobileKey: digits });
            if (!lead && digits.length >= 9) {
                lead = await Lead.findOne({ ...leadQuery, mobileKey: new RegExp(`${digits.slice(-9)}$`) });
            }
            if (lead) {
                await WhatsAppMessage.create({
                    company: lead.company, lead: lead._id, direction: 'in', kind: 'session',
                    text, status: 'replied',
                });
                // Flip the most recent outbound message for this lead to "replied"
                // so the conversations table reflects an active response.
                const lastOut = await WhatsAppMessage.findOne({ lead: lead._id, direction: 'out' }).sort({ createdAt: -1 });
                if (lastOut) {
                    lastOut.status = 'replied';
                    await lastOut.save();
                }

                // Notify the lead's owner + company admins that a reply came in,
                // via the same notification bell used for follow-up/cheque reminders.
                try {
                    const recipients = await ownerAndAdmins(lead.company, lead.owner);
                    const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
                    await notifyUsers({
                        company: lead.company,
                        recipients,
                        type: 'whatsapp-reply',
                        title: `${lead.name} replied on WhatsApp`,
                        body: preview,
                        link: '/communication',
                    });
                } catch (notifyErr) {
                    console.error('[whatsapp] Reply notification FAILED:', notifyErr.message);
                }
            }
        }
    }

    res.json({ success: true });
});