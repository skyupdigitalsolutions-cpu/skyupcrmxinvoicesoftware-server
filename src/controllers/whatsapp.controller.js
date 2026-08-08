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
    // Stored as digits-only (no '+', spaces, or leading zeros) so it matches
    // exactly what MSG91's inbound webhook sends for `integrated_number` —
    // whatever format an admin types it in as (+971..., 00971..., spaces,
    // dashes) is normalized here rather than trusted verbatim.
    if (integratedNumber !== undefined) {
        let digits = String(integratedNumber).replace(/\D/g, '');
        if (digits.startsWith('00')) digits = digits.slice(2);
        company.msg91.integratedNumber = digits;
    }
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
// `leadIds` sends to existing leads as before. `contacts` (new) sends
// directly to numbers imported from a CSV that don't match any existing
// lead yet — nothing requires them to be added as a lead first. Once one of
// them replies, the Communication page prompts to add them as a lead (see
// the webhook handler and relinkContact below); until then their messages
// are tracked by phone number alone (lead: null).
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

    // ── Raw contacts that aren't leads yet (from CSV import) ─────────────────
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
// One row per lead OR per raw contact number (for numbers sent to directly
// from a CSV import that aren't leads yet) — this is the "all leads' shared
// template and their response" table, extended to also surface not-yet-lead
// contacts so a reply from one of them is never invisible.
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

    // Employees only see LEAD conversations they themselves added/own — same
    // restriction already applied to the main Leads list for the 'sales'
    // role. Not-yet-lead contact rows have no owner to check yet, so they
    // stay visible to whoever sent to them until someone converts one to a
    // lead (from that point on, normal ownership rules apply).
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
                    // ownerName and ownerId power the employee filter + owner badge in the UI
                    ownerId:   lead.owner   ? String(lead.owner)   : null,
                    ownerName: lead.ownerName || '',
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
        // Unread conversations always float to the top, regardless of timestamp,
        // so a new reply is never buried under older but more recent sends.
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

    // Opening the thread is what counts as "seen" — clear the unread flag on
    // every inbound message for this lead so it drops out of the "unread"
    // sort/highlight on the conversations list.
    await WhatsAppMessage.updateMany(
        { lead: lead._id, direction: 'in', seen: false },
        { $set: { seen: true } }
    );
    // Reflect that in the response too (messages were fetched before the
    // update above), so the client doesn't see a stale seen:false.
    messages.forEach((m) => { if (m.direction === 'in') m.seen = true; });

    res.json({ success: true, lead: { id: lead._id, name: lead.name, mobile: lead.mobile }, messages: messages.map((m) => m.toSafeJSON()) });
});

// Full thread for a raw contact number that isn't a lead yet (a number sent
// to directly from a CSV import). Same "mark as seen on open" behavior as
// getThread above, just keyed by phone number instead of a lead ID.
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

// Once a not-yet-lead contact has been added as a proper lead (via the
// normal leadApi.create() call, which already handles required-field
// validation and duplicate-phone checks), this reassigns their prior message
// history from the raw contactNumber over to the new lead — so nothing from
// before they were "official" is lost once they are.
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

// ── Session window ────────────────────────────────────────────────────────────
// WhatsApp allows free-form replies only within 24 hours of the last inbound
// message from the customer. This endpoint tells the UI whether that window
// is currently open so it can show the countdown banner and enable/disable
// the text input accordingly.
// GET /whatsapp/session-window/:leadId
// Response: { open: bool, expiresAt: ISO|null, lastInboundAt: ISO|null }
export const getSessionWindow = asyncHandler(async (req, res) => {
    const lead = await Lead.findOne({ _id: req.params.leadId, ...tenantScope(req) });
    if (!lead) throw new ApiError(404, 'Lead not found');

    // Find the most recent inbound message for this lead
    const lastInbound = await WhatsAppMessage.findOne(
        { lead: lead._id, ...tenantScope(req), direction: 'in' }
    ).sort({ createdAt: -1 });

    if (!lastInbound) {
        // No inbound messages yet — window is not open (customer hasn't replied)
        return res.json({ success: true, open: false, expiresAt: null, lastInboundAt: null });
    }

    const lastInboundAt = lastInbound.createdAt;
    const expiresAt     = new Date(lastInboundAt.getTime() + 24 * 60 * 60 * 1000);
    const open          = Date.now() < expiresAt.getTime();

    res.json({ success: true, open, expiresAt: expiresAt.toISOString(), lastInboundAt: lastInboundAt.toISOString() });
});

// ── Template sent status ──────────────────────────────────────────────────────
// Returns a map of { [leadId]: { status, sentAt, templateName } } so the bulk
// send modal can show which leads have already received a template and grey
// them out. Pass templateName='__any__' to get the most recently sent template
// for each lead regardless of name (used for the "exclude already sent" toggle).
// POST /whatsapp/template-sent-status
// Body: { leadIds: string[], templateName: string }
export const getTemplateSentStatus = asyncHandler(async (req, res) => {
    const { leadIds, templateName } = req.body || {};
    if (!Array.isArray(leadIds) || !leadIds.length) {
        return res.json({ success: true, statuses: {} });
    }

    // Build query — '__any__' means any outbound template message ever sent
    const msgQuery = {
        ...tenantScope(req),
        lead: { $in: leadIds },
        direction: 'out',
        kind: 'template',
        status: { $in: ['sent', 'delivered', 'read', 'replied'] },
    };
    if (templateName && templateName !== '__any__') {
        msgQuery.templateName = templateName;
    }

    // Fetch the most recent matching message per lead — sort descending so
    // the first result for each lead is the most recent.
    const messages = await WhatsAppMessage.find(msgQuery)
        .sort({ createdAt: -1 })
        .select('lead templateName status createdAt')
        .lean();

    // Build map keyed by leadId string — first hit per lead wins (most recent)
    const statuses = {};
    for (const msg of messages) {
        const key = String(msg.lead);
        if (!statuses[key]) {
            statuses[key] = {
                status:       msg.status,
                sentAt:       msg.createdAt,
                templateName: msg.templateName || '',
            };
        }
    }

    res.json({ success: true, statuses });
});

// ── Inbound webhook (MSG91 → us) ─────────────────────────────────────────────
// No auth middleware — MSG91 calls this directly. Verified by a shared secret
// query param instead (?token=WHATSAPP_WEBHOOK_SECRET, set as an env var).
// Handles both delivery/read status callbacks and inbound reply messages.
// MSG91's exact webhook payload shape can vary; this reads defensively from
// a few common locations rather than assuming one fixed structure.
export const webhook = asyncHandler(async (req, res) => {
    const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
    // Fail CLOSED: if secret is not configured, reject all webhook calls.
    // Previously used `if (secret && ...)` which meant an unset secret let
    // anyone POST fake WhatsApp messages into the CRM with no authentication.
    if (!secret || req.query.token !== secret) {
        return res.json({ success: true, ignored: true });
    }

    const body = req.body || {};
    // Raw payload logging — development only. Never log in production as
    // it exposes customer phone numbers and message content to server logs.
    if (process.env.NODE_ENV !== 'production') {
        console.log('[webhook] raw payload:', JSON.stringify(body, null, 2));
    }

    const entries = Array.isArray(body.entry) ? body.entry : (Array.isArray(body) ? body : [body]);
    const ALLOWED_MEDIA_TYPES = ['image', 'document', 'video', 'audio'];

    for (const entry of entries) {
        // MSG91's confirmed WhatsApp inbound payload nests the real data
        // under `messages[0]` and `contacts[0]` (WhatsApp Cloud API-style
        // shape), while status callbacks use flatter top-level fields.
        // Check the nested structure first since it's the one that
        // actually shows up for inbound replies; keep the flat fields as
        // fallbacks for other payload variants (status callbacks, older
        // MSG91 formats, etc). Never log `secret`/token values below.
        const message = Array.isArray(entry.messages) ? entry.messages[0] : entry.message;
        const contact = Array.isArray(entry.contacts) ? entry.contacts[0] : entry.contact;

        const from        = entry.sender || entry.customerNumber || entry.from || message?.from || contact?.wa_id || '';
        const toNumber     = entry.integrated_number || entry.integratedNumber || entry.to || '';
        const requestId    = entry.message_uuid || entry.messageUuid || message?.id || entry.requestId || entry.request_id || entry.msg_id || entry.message_id || '';
        const statusValue  = entry.reason || entry.status || (entry.type === 'status' ? entry.status : '');
        const text         = (typeof entry.text === 'string' ? entry.text : (entry.text && entry.text.body)) || message?.text?.body || entry.body || entry.caption || '';
        const contactName  = entry.customer_name || entry.customerName || contact?.profile?.name || '';

        // Media: MSG91's nested `messages[0].type` (e.g. "image") points to
        // a same-named sub-object (`messages[0].image.link` etc.) in the
        // WhatsApp Cloud API shape; some MSG91 accounts instead send a flat
        // `url`/`messageType`/`filename` on the entry itself. Support both
        // without assuming one fixed shape, same as the rest of this parser.
        const inboundMsgType = message?.type && message.type !== 'text' ? message.type : '';
        const rawMediaType   = entry.messageType || inboundMsgType || '';
        const mediaType      = ALLOWED_MEDIA_TYPES.includes(rawMediaType) ? rawMediaType : '';
        const mediaNode      = message && mediaType ? message[mediaType] : null;
        const mediaUrl       = entry.url || mediaNode?.link || mediaNode?.url || '';
        const mediaFilename  = entry.filename || mediaNode?.filename || '';

        // A status/reason field alone does NOT mean this is a status
        // callback — MSG91 can carry unrelated fields on inbound message
        // payloads too. Only treat it as a status callback when there is
        // no actual inbound message content (see rule 5 in the review).
        const hasInboundContent = Boolean(message) || Boolean(text) || Boolean(mediaUrl);

        if (!from && !requestId && !hasInboundContent) {
            console.warn('[webhook] Skipping payload — no usable from/requestId/message content found');
            continue;
        }

        console.log('[webhook] received', {
            kind: hasInboundContent ? 'inbound' : (statusValue ? 'status' : 'unknown'),
            from, toNumber, requestId,
        });

        // ── Company identification — strictly by integrated number ──────────
        // Never fall back to a global/ambiguous guess: a reply that can't be
        // tied to a company must never be matched against another tenant's
        // leads. Safely acknowledge (so MSG91 stops retrying) and log why.
        //
        // Matched on DIGITS ONLY rather than exact string equality. MSG91
        // always sends `integrated_number` as plain digits, but the number
        // saved on Company.msg91.integratedNumber may have been typed with a
        // '+', a leading '00', or spaces/dashes — an exact-string match
        // would silently fail to find a real, correctly-configured company.
        let company = null;
        const toDigitsRaw = String(toNumber).replace(/\D/g, '');
        const toDigits = toDigitsRaw.startsWith('00') ? toDigitsRaw.slice(2) : toDigitsRaw;
        if (toDigits) {
            const candidates = await Company.find({
                'msg91.integratedNumber': { $exists: true, $ne: '' },
            }).select('_id msg91.integratedNumber');
            company = candidates.find((c) => {
                let d = String(c.msg91?.integratedNumber || '').replace(/\D/g, '');
                if (d.startsWith('00')) d = d.slice(2);
                return d === toDigits;
            }) || null;
        }

        console.log('[webhook] company identification', {
            toNumber, toDigits, companyId: company ? String(company._id) : null,
        });

        if (!company) {
            console.warn('[webhook] Unable to identify company for inbound MSG91 payload — dropping safely (no matching integratedNumber). toNumber:', toNumber || '(missing)');
            continue;
        }

        // ── Status callback (delivery/read/failed) — outbound messages only ──
        if (!hasInboundContent && statusValue && requestId) {
            const mapped = statusValue === 'delivered' ? 'delivered'
                : statusValue === 'read' ? 'read'
                : statusValue === 'failed' ? 'failed'
                : null;
            if (mapped) {
                // Scoped to this company AND direction:'out' — a status
                // callback must never touch an inbound message, even if an
                // inbound msg91RequestId happens to collide.
                const result = await WhatsAppMessage.updateOne(
                    { company: company._id, msg91RequestId: requestId, direction: 'out' },
                    { $set: { status: mapped } }
                );
                console.log('[webhook] status callback processed', { requestId, mapped, matched: result.matchedCount });
            } else {
                console.log('[webhook] status callback with unrecognized status value, ignoring', { statusValue, requestId });
            }
            continue;
        }

        // ── Inbound reply message ─────────────────────────────────────────
        if (hasInboundContent && from && (text || mediaUrl)) {
            // Duplicate webhook-retry protection: MSG91 may redeliver the
            // same inbound message. Never create a second copy.
            if (requestId) {
                const existing = await WhatsAppMessage.findOne({
                    company: company._id, direction: 'in', msg91RequestId: requestId,
                });
                if (existing) {
                    console.log('[webhook] duplicate inbound message — already processed, skipping create', { requestId, companyId: String(company._id) });
                    continue;
                }
            }

            const digits = String(from).replace(/\D/g, '');
            // Every lookup below is scoped to `company._id` — a lead in
            // another company can never be matched by this reply.
            let lead = await Lead.findOne({ company: company._id, mobileKey: digits });
            if (!lead && digits.length >= 9) {
                lead = await Lead.findOne({ company: company._id, mobileKey: new RegExp(`${digits.slice(-9)}$`) });
            }

            console.log('[webhook] lead lookup', { companyId: String(company._id), leadFound: !!lead });

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
                    msg91RequestId: requestId || '',
                    seen: false,
                });
                console.log('[webhook] inbound message saved (linked to lead)', { leadId: String(lead._id), companyId: String(company._id) });

                const lastOut = await WhatsAppMessage.findOne({ company: company._id, lead: lead._id, direction: 'out' }).sort({ createdAt: -1 });
                if (lastOut) { lastOut.status = 'replied'; await lastOut.save(); }

                if (lead.status === 'New') {
                    lead.status = 'Contacted';
                    lead.editHistory.push({
                        by: lead.owner,
                        byName: 'WhatsApp (auto)',
                        changes: [{ field: 'status', from: 'New', to: 'Contacted — lead replied on WhatsApp' }],
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

            } else {
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
                    msg91RequestId: requestId || '',
                    seen: false,
                });
                console.log('[webhook] inbound message saved (unlinked contact)', { companyId: String(company._id) });

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
        } else {
            console.log('[webhook] payload had neither a recognizable status callback nor usable inbound content, skipping', { from, requestId });
        }
    }

    res.json({ success: true });
});