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
import { notifyUsers, ownerAndAdmins, adminsOf } from '../utils/notify.js';

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
    if (integratedNumber !== undefined) company.msg91.integratedNumber = String(integratedNumber).trim().replace(/^\+/, ''); // strip leading + for consistent lookup
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

// ── Sending a template to one or more leads AND/OR raw CSV contacts ─────────
export const sendTemplate = asyncHandler(async (req, res) => {
    const { leadIds, contacts, templateName, language, variables, autoFillNameVar } = req.body || {};
    const hasLeadIds = Array.isArray(leadIds) && leadIds.length > 0;
    const hasContacts = Array.isArray(contacts) && contacts.length > 0;
    if (!hasLeadIds && !hasContacts) throw new ApiError(400, 'Select at least one lead or contact.');
    if (!templateName) throw new ApiError(400, 'Select a template.');

    const companyId = tenantCompanyId(req);
    const company = await Company.findById(companyId).select('+msg91.authKey');
    if (!company || !company.msg91 || !company.msg91.enabled || !company.msg91.authKey || !company.msg91.integratedNumber) {
        throw new ApiError(400, 'MSG91 is not configured/enabled for this company yet.');
    }

    const results = [];

    // ── Existing leads ───────────────────────────────────────────────────────
    const leads = hasLeadIds ? await Lead.find({ _id: { $in: leadIds }, ...tenantScope(req) }) : [];
    for (const lead of leads) {
        const to = toE164(lead.mobile, lead.country);
        let vars = Array.isArray(variables) ? [...variables] : [];
        if (autoFillNameVar && vars.length) vars[0] = lead.name || vars[0];

        const base = {
            company: companyId, lead: lead._id,
            contactName: lead.name, contactNumber: to || (lead.mobile || ''), contactCountry: lead.country,
            direction: 'out', kind: 'template', templateName, variables: vars, text: '', sentBy: req.user._id,
        };

        if (!to) {
            results.push({ leadId: lead._id, status: 'failed', error: 'Could not resolve a valid phone number for this lead.' });
            await WhatsAppMessage.create({ ...base, status: 'failed', error: 'Could not resolve phone number' });
            continue;
        }
        try {
            const sendRes = await sendTemplateMessage({
                authKey: company.msg91.authKey, integratedNumber: company.msg91.integratedNumber,
                to, templateName, language, variables: vars,
            });
            await WhatsAppMessage.create({ ...base, status: 'sent', msg91RequestId: sendRes.requestId });
            results.push({ leadId: lead._id, status: 'sent' });
        } catch (err) {
            console.error(`[whatsapp] sendTemplate FAILED for lead ${lead._id}:`, err.message, '| status:', err.msg91Status, '| raw:', err.msg91RawText || '');
            await WhatsAppMessage.create({ ...base, status: 'failed', error: err.message || 'Send failed' });
            results.push({ leadId: lead._id, status: 'failed', error: err.message });
        }
    }

    // ── Raw contacts (from CSV import) ────────────────────────────────────────
    if (hasContacts) {
        for (const c of contacts) {
            const country = c.country || 'UAE';
            const to = toE164(c.mobile, country);
            let vars = Array.isArray(variables) ? [...variables] : [];
            if (autoFillNameVar && vars.length) vars[0] = c.name || vars[0];

            const base = {
                company: companyId, lead: null,
                contactName: c.name || '', contactNumber: to || (c.mobile || ''), contactCountry: country,
                direction: 'out', kind: 'template', templateName, variables: vars, text: '', sentBy: req.user._id,
            };

            if (!to) {
                results.push({ contactNumber: c.mobile, status: 'failed', error: 'Could not resolve a valid phone number.' });
                await WhatsAppMessage.create({ ...base, status: 'failed', error: 'Could not resolve phone number' });
                continue;
            }
            try {
                const sendRes = await sendTemplateMessage({
                    authKey: company.msg91.authKey, integratedNumber: company.msg91.integratedNumber,
                    to, templateName, language, variables: vars,
                });
                await WhatsAppMessage.create({ ...base, status: 'sent', msg91RequestId: sendRes.requestId });
                results.push({ contactNumber: to, status: 'sent' });
            } catch (err) {
                console.error(`[whatsapp] sendTemplate FAILED for contact ${to}:`, err.message, '| status:', err.msg91Status, '| raw:', err.msg91RawText || '');
                await WhatsAppMessage.create({ ...base, status: 'failed', error: err.message || 'Send failed' });
                results.push({ contactNumber: to, status: 'failed', error: err.message });
            }
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
        const reason = err.message || 'Send failed';
        res.status(502).json({ success: false, message: reason, error: reason, savedMessage: msg.toSafeJSON() });
    }
});

// ── Manual continue-chat: send an image/document/video/audio attachment ─────
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
export const listConversations = asyncHandler(async (req, res) => {
    const q = { ...tenantScope(req) };
    const messages = await WhatsAppMessage.find(q).sort({ createdAt: -1 }).limit(2000).lean();

    const byKey = new Map();
    for (const m of messages) {
        const key = m.lead ? `L:${m.lead}` : `N:${m.contactNumber}`;
        if (!byKey.has(key)) {
            byKey.set(key, {
                lastOut: null, lastIn: null, hasUnseen: false,
                leadId: m.lead || null, contactNumber: m.contactNumber || '', contactName: m.contactName || '',
            });
        }
        const entry = byKey.get(key);
        if (m.direction === 'out' && !entry.lastOut) entry.lastOut = m;
        if (m.direction === 'in' && !entry.lastIn) entry.lastIn = m;
        if (m.direction === 'in' && !m.seen) entry.hasUnseen = true;
        if (!entry.contactName && m.contactName) entry.contactName = m.contactName;
    }

    const leadIds = [...byKey.values()].filter((v) => v.leadId).map((v) => String(v.leadId));
    const leads = await Lead.find({ _id: { $in: leadIds } }).select('name mobile country stage status owner').lean();
    const leadById = new Map(leads.map((l) => [String(l._id), l]));

    const restrictToOwner = req.user.role === 'sales';

    const rows = [...byKey.entries()]
        .map(([key, entry]) => {
            const { lastOut, lastIn, hasUnseen, leadId, contactNumber, contactName } = entry;

            if (leadId) {
                const lead = leadById.get(String(leadId));
                if (!lead) return null;
                if (restrictToOwner && String(lead.owner) !== String(req.user._id)) return null;
                return {
                    key, leadId: String(leadId), isLead: true, contactNumber: '',
                    leadName: lead.name, mobile: lead.mobile,
                    lastTemplate: lastOut ? lastOut.templateName || '' : '',
                    lastStatus: lastOut ? lastOut.status : '',
                    lastSentAt: lastOut ? lastOut.createdAt : null,
                    lastResponse: lastIn ? lastIn.text : '',
                    lastResponseAt: lastIn ? lastIn.createdAt : null,
                    unread: hasUnseen,
                };
            }

            return {
                key, leadId: null, isLead: false, contactNumber,
                leadName: contactName || contactNumber,
                mobile: contactNumber,
                lastTemplate: lastOut ? lastOut.templateName || '' : '',
                lastStatus: lastOut ? lastOut.status : '',
                lastSentAt: lastOut ? lastOut.createdAt : null,
                lastResponse: lastIn ? lastIn.text : '',
                lastResponseAt: lastIn ? lastIn.createdAt : null,
                unread: hasUnseen,
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (a.unread !== b.unread) return a.unread ? -1 : 1;
            return new Date(b.lastSentAt || b.lastResponseAt || 0) - new Date(a.lastSentAt || a.lastResponseAt || 0);
        });

    res.json({ success: true, conversations: rows });
});

// Full thread for one lead (used by the "Continue Chat" drawer).
export const getThread = asyncHandler(async (req, res) => {
    const scope = { ...tenantScope(req) };
    if (req.user.role === 'sales') scope.owner = req.user._id;
    const lead = await Lead.findOne({ _id: req.params.leadId, ...scope });
    if (!lead) throw new ApiError(404, 'Lead not found');
    const messages = await WhatsAppMessage.find({ lead: lead._id, ...tenantScope(req) }).sort({ createdAt: 1 });

    await WhatsAppMessage.updateMany(
        { lead: lead._id, direction: 'in', seen: false },
        { $set: { seen: true } }
    );
    messages.forEach((m) => { if (m.direction === 'in') m.seen = true; });

    res.json({ success: true, lead: { id: lead._id, name: lead.name, mobile: lead.mobile }, messages: messages.map((m) => m.toSafeJSON()) });
});

// Full thread for a raw contact number that isn't a lead yet.
export const getThreadByNumber = asyncHandler(async (req, res) => {
    const contactNumber = req.params.contactNumber;
    if (!contactNumber) throw new ApiError(400, 'contactNumber is required.');

    const q = { ...tenantScope(req), contactNumber, lead: null };
    const messages = await WhatsAppMessage.find(q).sort({ createdAt: 1 });
    if (!messages.length) throw new ApiError(404, 'No conversation found for that number.');

    await WhatsAppMessage.updateMany(
        { ...q, direction: 'in', seen: false },
        { $set: { seen: true } }
    );
    messages.forEach((m) => { if (m.direction === 'in') m.seen = true; });

    const withName = messages.find((m) => m.contactName);
    const contactName = withName ? withName.contactName : '';
    const withCountry = messages.find((m) => m.contactCountry);
    const contactCountry = withCountry ? withCountry.contactCountry : 'UAE';

    res.json({
        success: true,
        lead: { id: null, name: contactName || contactNumber, mobile: contactNumber, country: contactCountry },
        messages: messages.map((m) => m.toSafeJSON()),
    });
});

// Reassigns prior message history from raw contactNumber to a new lead.
export const relinkContact = asyncHandler(async (req, res) => {
    const { contactNumber, leadId } = req.body || {};
    if (!contactNumber || !leadId) throw new ApiError(400, 'contactNumber and leadId are required.');

    const lead = await Lead.findOne({ _id: leadId, ...tenantScope(req) });
    if (!lead) throw new ApiError(404, 'Lead not found');

    const result = await WhatsAppMessage.updateMany(
        { ...tenantScope(req), contactNumber, lead: null },
        { $set: { lead: lead._id } }
    );

    res.json({ success: true, message: `Linked ${result.modifiedCount} message(s) to ${lead.name}.`, modifiedCount: result.modifiedCount });
});

// ── Inbound webhook (MSG91 → us) ─────────────────────────────────────────────
// No auth middleware — MSG91 calls this directly. Verified by a shared secret
// query param instead (?token=WHATSAPP_WEBHOOK_SECRET, set as an env var).
// Handles both delivery/read status callbacks and inbound reply messages.
//
// Supports both the new MSG91 flat payload format and the old entry-array format:
// New format (2026): flat object with top-level sender/text/content_type/integrated_number
// Old format: { entry: [ { customerNumber, integratedNumber, ... } ] }
export const webhook = asyncHandler(async (req, res) => {
    const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
    // Fail CLOSED: if secret is not configured, reject all webhook calls.
    if (!secret || req.query.token !== secret) {
        return res.json({ success: true, ignored: true });
    }

    const body = req.body || {};

    // Support both new flat format and old entry-array format.
    // New format has top-level `sender` or `integrated_number`.
    const isNewFormat = !!body.sender || !!body.integrated_number;
    const entries = isNewFormat
        ? [body]
        : (Array.isArray(body.entry) ? body.entry : (Array.isArray(body) ? body : [body]));

    for (const entry of entries) {
        // New format fields take priority; old format fields are fallbacks.
        const from        = entry.sender || entry.customerNumber || entry.from || (entry.contact && entry.contact.wa_id) || '';
        const toNumber    = entry.integrated_number || entry.integratedNumber || entry.to || '';
        const requestId   = entry.message_uuid || entry.requestId || entry.request_id || entry.msg_id || entry.message_id || '';
        const statusValue = entry.reason || entry.status || '';

        // direction: 0 = inbound (customer → us), 1 = outbound (us → customer).
        // Skip outbound echoes — we already save those when sending.
        // Also skip MSG91 keyword 'Callback' entries — these are auto-reply
        // triggers fired by MSG91 when a keyword is matched (e.g. "Hello",
        // "Callback"). They duplicate the actual inbound message and have no
        // real content to save.
        const directionVal = entry.direction;
        const isOutbound = directionVal === 1 || directionVal === '1' || directionVal === 'OUTBOUND';
        const isCallback = (entry.inbound_setting || entry.inbound_type || '') === 'Callback'
                        || String(entry.inbound_setting || '').toLowerCase() === 'callback';
        if (isOutbound || isCallback) continue;

        // Text: new format has top-level `text` string; old format had entry.text.body or entry.body
        const text = (typeof entry.text === 'string' ? entry.text : (entry.text && entry.text.body))
                    || (entry.messages && entry.messages[0] && entry.messages[0].text && entry.messages[0].text.body)
                    || entry.body || entry.caption || '';

        // Contact name: new format uses customer_name; old used customerName
        const contactName = entry.customer_name || entry.customerName || '';

        // Media: new format uses attachment_url; old used url
        const mediaUrl      = entry.attachment_url || entry.url || '';

        // Media type: new format uses content_type (but 'text' is not a media type)
        const mediaType     = (entry.content_type && entry.content_type !== 'text') ? entry.content_type : (entry.messageType || '');
        const mediaFilename = entry.filename || '';

        if (!from && !requestId) continue;

        const company = toNumber
            ? await Company.findOne({
                // Strip leading + so '+971561778944' matches '971561778944' and vice versa
                'msg91.integratedNumber': { $in: [toNumber, '+' + toNumber, toNumber.replace(/^\+/, '')] }
              })
            : null;

        // Delivery/read status update — only when there's a status value
        // AND the entry has a requestId but no sender (pure status callback).
        // Guard: if `from` is set alongside statusValue, it's an inbound
        // message with a status field — treat it as a message, not a status update.
        if (statusValue && requestId && !from) {
            const mapped = statusValue === 'delivered' ? 'delivered'
                : statusValue === 'read' ? 'read'
                : statusValue === 'failed' ? 'failed'
                : null;
            if (mapped) {
                await WhatsAppMessage.updateOne({ msg91RequestId: requestId }, { $set: { status: mapped } });
            }
            continue;
        }

        if (from && (text || mediaUrl)) {
            const digits = String(from).replace(/\D/g, '');
            const leadQuery = company ? { company: company._id } : {};
            let lead = await Lead.findOne({ ...leadQuery, mobileKey: digits });
            if (!lead && digits.length >= 9) {
                lead = await Lead.findOne({ ...leadQuery, mobileKey: new RegExp(`${digits.slice(-9)}$`) });
            }

            if (lead) {
                await WhatsAppMessage.create({
                    company: lead.company, lead: lead._id,
                    contactName: contactName || lead.name,
                    contactNumber: digits, contactCountry: lead.country,
                    direction: 'in', kind: 'session',
                    text: text || '',
                    mediaUrl: mediaUrl || '',
                    mediaType: mediaType || '',
                    mediaFilename: mediaFilename || '',
                    status: 'replied',
                });

                const lastOut = await WhatsAppMessage.findOne({ lead: lead._id, direction: 'out' }).sort({ createdAt: -1 });
                if (lastOut) { lastOut.status = 'replied'; await lastOut.save(); }

                // Auto-promote lead stage when they reply on WhatsApp:
                // New → Contacted (Lead stage)
                // Contacted → Interested (Opportunity stage)
                if (lead.status === 'New' || lead.status === 'Contacted') {
                    const prevStatus = lead.status;
                    lead.status = lead.status === 'New' ? 'Contacted' : 'Interested';
                    lead.editHistory.push({
                        by: null,
                        byName: 'WhatsApp (auto)',
                        changes: [{ field: 'status', from: prevStatus, to: `${lead.status} — lead replied on WhatsApp` }],
                    });
                    await lead.save();
                }

                try {
                    const recipients = await ownerAndAdmins(lead.company, lead.owner);
                    const preview = text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : `[${mediaType || 'media'} received]`;
                    await notifyUsers({
                        company: lead.company, recipients,
                        type: 'whatsapp-reply',
                        title: `${lead.name} replied on WhatsApp`,
                        body: preview, link: '/communication',
                    });
                } catch (notifyErr) {
                    console.error('[whatsapp] Reply notification FAILED:', notifyErr.message);
                }

            } else if (company) {
                await WhatsAppMessage.create({
                    company: company._id, lead: null,
                    contactName: contactName || '',
                    contactNumber: digits, contactCountry: '',
                    direction: 'in', kind: 'session',
                    text: text || '',
                    mediaUrl: mediaUrl || '',
                    mediaType: mediaType || '',
                    mediaFilename: mediaFilename || '',
                    status: 'replied',
                });

                const lastOut = await WhatsAppMessage.findOne({ company: company._id, contactNumber: digits, lead: null, direction: 'out' }).sort({ createdAt: -1 });
                if (lastOut) { lastOut.status = 'replied'; await lastOut.save(); }

                try {
                    const admins = await adminsOf(company._id);
                    const preview = text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : `[${mediaType || 'media'} received]`;
                    await notifyUsers({
                        company: company._id, recipients: admins,
                        type: 'whatsapp-reply-unlinked',
                        title: `${digits} replied on WhatsApp — not yet a lead`,
                        body: preview, link: '/communication',
                    });
                } catch (notifyErr) {
                    console.error('[whatsapp] Unlinked-reply notification FAILED:', notifyErr.message);
                }
            }
        }
    }

    res.json({ success: true });
});