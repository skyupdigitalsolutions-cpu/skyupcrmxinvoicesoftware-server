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

const cloudCredsFor = (company) =>
    company && company.cloudinary && company.cloudinary.cloudName ? {
        cloudName: company.cloudinary.cloudName,
        apiKey: company.cloudinary.apiKey,
        apiSecret: company.cloudinary.apiSecret,
    } : null;

// ── Settings ──────────────────────────────────────────────────────────────────
export const getSettings = asyncHandler(async (req, res) => {
    const companyId = tenantCompanyId(req);
    const company = await Company.findById(companyId).select('+msg91.authKey');
    if (!company) throw new ApiError(404, 'Company not found');
    res.json({ success: true, msg91: company.toSafeJSON().msg91 });
});

export const setSettings = asyncHandler(async (req, res) => {
    requireAdmin(req);
    const companyId = tenantCompanyId(req);
    const company = await Company.findById(companyId).select('+msg91.authKey');
    if (!company) throw new ApiError(404, 'Company not found');
    const { enabled, authKey, integratedNumber, senderName } = req.body || {};
    if (!company.msg91) company.msg91 = {};
    if (enabled !== undefined) company.msg91.enabled = !!enabled;
    if (authKey !== undefined && String(authKey).trim()) company.msg91.authKey = String(authKey).trim();
    if (integratedNumber !== undefined) company.msg91.integratedNumber = String(integratedNumber).trim();
    if (senderName !== undefined) company.msg91.senderName = String(senderName).trim();
    company.markModified('msg91');
    await company.save();
    res.json({ success: true, msg91: company.toSafeJSON().msg91 });
});

// ── Templates ─────────────────────────────────────────────────────────────────
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

// ── Send template ─────────────────────────────────────────────────────────────
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
            const sendRes = await sendTemplateMessage({ authKey: company.msg91.authKey, integratedNumber: company.msg91.integratedNumber, to, templateName, language, variables: vars });
            await WhatsAppMessage.create({ ...base, status: 'sent', msg91RequestId: sendRes.requestId });
            results.push({ leadId: lead._id, status: 'sent' });
        } catch (err) {
            console.error(`[whatsapp] sendTemplate FAILED for lead ${lead._id}:`, err.message, '| status:', err.msg91Status, '| raw:', err.msg91RawText || '');
            await WhatsAppMessage.create({ ...base, status: 'failed', error: err.message || 'Send failed' });
            results.push({ leadId: lead._id, status: 'failed', error: err.message });
        }
    }
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
                const sendRes = await sendTemplateMessage({ authKey: company.msg91.authKey, integratedNumber: company.msg91.integratedNumber, to, templateName, language, variables: vars });
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

// ── Send reply ────────────────────────────────────────────────────────────────
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
    const session = await getSessionWindow(leadId, companyId);
    if (!session.open) {
        return res.status(403).json({
            success: false, code: 'SESSION_WINDOW_EXPIRED',
            message: session.lastInboundAt
                ? `The 24-hour reply window expired. Last customer message: ${new Date(session.lastInboundAt).toLocaleString()}. Send a template message to re-open the conversation.`
                : 'No inbound message found from this customer. Send a template message to start the conversation.',
            lastInboundAt: session.lastInboundAt, expiresAt: session.expiresAt,
        });
    }
    try {
        const sendRes = await sendSessionMessage({ authKey: company.msg91.authKey, integratedNumber: company.msg91.integratedNumber, to, text });
        const msg = await WhatsAppMessage.create({ company: companyId, lead: lead._id, direction: 'out', kind: 'session', text, status: 'sent', msg91RequestId: sendRes.requestId, sentBy: req.user._id });
        res.status(201).json({ success: true, savedMessage: msg.toSafeJSON() });
    } catch (err) {
        console.error('[whatsapp] sendReply FAILED:', err.message, '| status:', err.msg91Status, '| raw:', err.msg91RawText || '');
        const msg = await WhatsAppMessage.create({ company: companyId, lead: lead._id, direction: 'out', kind: 'session', text, status: 'failed', error: err.message || 'Send failed', sentBy: req.user._id });
        const reason = err.message || 'Send failed';
        res.status(502).json({ success: false, message: reason, error: reason, savedMessage: msg.toSafeJSON() });
    }
});

// ── Send media ────────────────────────────────────────────────────────────────
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
        const sendRes = await sendMediaMessage({ authKey: company.msg91.authKey, integratedNumber: company.msg91.integratedNumber, to, mediaType, mediaUrl: uploaded.url, caption: caption || '', filename: filename || '' });
        const msg = await WhatsAppMessage.create({ company: companyId, lead: lead._id, direction: 'out', kind: 'session', text: caption || '', mediaUrl: uploaded.url, mediaType, mediaFilename: filename || '', status: 'sent', msg91RequestId: sendRes.requestId, sentBy: req.user._id });
        res.status(201).json({ success: true, savedMessage: msg.toSafeJSON() });
    } catch (err) {
        console.error('[whatsapp] sendMedia FAILED:', err.message);
        const msg = await WhatsAppMessage.create({ company: companyId, lead: lead._id, direction: 'out', kind: 'session', text: caption || '', mediaUrl: uploaded.url, mediaType, mediaFilename: filename || '', status: 'failed', error: err.message || 'Send failed', sentBy: req.user._id });
        const reason = err.message || 'Send failed';
        res.status(502).json({ success: false, message: reason, error: reason, savedMessage: msg.toSafeJSON() });
    }
});

// ── List conversations ────────────────────────────────────────────────────────
// Uses DB-side aggregation instead of loading 5000 messages into Node memory.
export const listConversations = asyncHandler(async (req, res) => {
    const scope = tenantScope(req);

    // Single aggregation: get last outbound + last inbound + unseen count per lead/contact
    const agg = await WhatsAppMessage.aggregate([
        { $match: scope },
        { $sort: { createdAt: -1 } },
        {
            $group: {
                _id: { lead: '$lead', contactNumber: { $cond: ['$lead', null, '$contactNumber'] } },
                lastOut:      { $first: { $cond: [{ $eq: ['$direction', 'out'] }, '$$ROOT', null] } },
                lastIn:       { $first: { $cond: [{ $eq: ['$direction', 'in'] }, '$$ROOT', null] } },
                hasUnseen:    { $max: { $cond: [{ $and: [{ $eq: ['$direction', 'in'] }, { $eq: ['$seen', false] }] }, 1, 0] } },
                contactName:  { $first: '$contactName' },
                leadId:       { $first: '$lead' },
                contactNumber:{ $first: { $cond: ['$lead', null, '$contactNumber'] } },
            },
        },
    ]);

    // Collect lead IDs to fetch names/owners in one query
    const leadIds = agg.filter(r => r.leadId).map(r => String(r.leadId));
    const leads = leadIds.length
        ? await Lead.find({ _id: { $in: leadIds } }).select('name mobile mobileKey country status owner ownerName').lean()
        : [];
    const leadById = new Map(leads.map(l => [String(l._id), l]));

    const restrictToOwner = req.user.role === 'sales';

    // Build mobile → leadId map to suppress duplicate raw-contact rows
    const mobileToLeadId = new Map();
    for (const lead of leads) {
        const raw = String(lead.mobile || '').replace(/\D/g, '');
        if (raw) mobileToLeadId.set(raw, String(lead._id));
        if (lead.mobileKey) mobileToLeadId.set(lead.mobileKey, String(lead._id));
    }
    // Also load all company leads with mobile to catch leads that have no messages yet
    const allLeadsWithMobile = await Lead.find(
        { ...scope, mobile: { $exists: true, $ne: '' } },
        { _id: 1, mobile: 1, mobileKey: 1 }
    ).lean();
    for (const l of allLeadsWithMobile) {
        const raw = String(l.mobile || '').replace(/\D/g, '');
        if (raw && !mobileToLeadId.has(raw)) mobileToLeadId.set(raw, String(l._id));
        if (l.mobileKey && !mobileToLeadId.has(l.mobileKey)) mobileToLeadId.set(l.mobileKey, String(l._id));
    }

    const rows = agg.map(r => {
        const { lastOut, lastIn, hasUnseen, contactName, leadId, contactNumber } = r;

        if (leadId) {
            const lead = leadById.get(String(leadId));
            if (!lead) return null;
            if (restrictToOwner && String(lead.owner) !== String(req.user._id)) return null;
            return {
                key: `L:${leadId}`,
                leadId: String(leadId), isLead: true, contactNumber: '',
                leadName: lead.name, mobile: lead.mobile,
                ownerName: lead.ownerName || '',
                ownerId: lead.owner ? String(lead.owner) : '',
                lastTemplate: lastOut ? lastOut.templateName || '' : '',
                lastStatus: lastOut ? lastOut.status : '',
                lastSentAt: lastOut ? lastOut.createdAt : null,
                lastResponse: lastIn ? lastIn.text : '',
                lastResponseAt: lastIn ? lastIn.createdAt : null,
                unread: hasUnseen === 1,
            };
        }

        if (!contactNumber) return null;

        // Suppress raw-contact rows for numbers that belong to a known lead
        const rawDigits = String(contactNumber).replace(/\D/g, '');
        let matchedLeadId = rawDigits ? mobileToLeadId.get(rawDigits) : null;
        if (!matchedLeadId && rawDigits.length >= 7) {
            for (const [k, v] of mobileToLeadId) {
                const kd = String(k).replace(/\D/g, '');
                if (kd.length >= 7 && (rawDigits.endsWith(kd.slice(-9)) || kd.endsWith(rawDigits.slice(-9)))) {
                    matchedLeadId = v; break;
                }
            }
        }
        if (matchedLeadId) return null;

        return {
            key: `N:${contactNumber}`,
            leadId: null, isLead: false, contactNumber,
            leadName: contactName || contactNumber, mobile: contactNumber,
            ownerName: '', ownerId: '',
            lastTemplate: lastOut ? lastOut.templateName || '' : '',
            lastStatus: lastOut ? lastOut.status : '',
            lastSentAt: lastOut ? lastOut.createdAt : null,
            lastResponse: lastIn ? lastIn.text : '',
            lastResponseAt: lastIn ? lastIn.createdAt : null,
            unread: hasUnseen === 1,
        };
    })
    .filter(Boolean)
    .sort((a, b) => {
        if (a.unread !== b.unread) return a.unread ? -1 : 1;
        return new Date(b.lastSentAt || b.lastResponseAt || 0) - new Date(a.lastSentAt || a.lastResponseAt || 0);
    });

    res.json({ success: true, conversations: rows });
});

// ── Session window ────────────────────────────────────────────────────────────
async function getSessionWindow(leadId, companyId) {
    const lastInbound = await WhatsAppMessage.findOne({ lead: leadId, company: companyId, direction: 'in' })
        .sort({ createdAt: -1 }).lean();
    if (!lastInbound) return { open: false, expiresAt: null, lastInboundAt: null };
    const lastInboundAt = new Date(lastInbound.createdAt);
    const expiresAt = new Date(lastInboundAt.getTime() + 24 * 60 * 60 * 1000);
    const open = Date.now() < expiresAt.getTime();
    return { open, expiresAt, lastInboundAt };
}

export const getSessionWindowStatus = asyncHandler(async (req, res) => {
    const { leadId } = req.params;
    const companyId = tenantCompanyId(req);
    const lead = await Lead.findOne({ _id: leadId, ...tenantScope(req) });
    // Lead deleted — return closed window (200) instead of 404 to avoid console errors
    if (!lead) return res.json({ success: true, open: false, expiresAt: null, lastInboundAt: null });
    const session = await getSessionWindow(leadId, companyId);
    res.json({ success: true, ...session });
});

export const getTemplateSentStatus = asyncHandler(async (req, res) => {
    const { leadIds, templateName } = req.query;
    if (!templateName) throw new ApiError(400, 'templateName is required.');
    const companyId = tenantCompanyId(req);
    const ids = String(leadIds || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return res.json({ success: true, statuses: {} });
    const query = { company: companyId, lead: { $in: ids }, kind: 'template', direction: 'out' };
    if (templateName !== '__any__') query.templateName = templateName;
    const messages = await WhatsAppMessage.find(query).sort({ createdAt: -1 }).lean();
    const statuses = {};
    for (const msg of messages) {
        const leadId = String(msg.lead);
        if (!statuses[leadId]) {
            statuses[leadId] = { sent: true, status: msg.status, sentAt: msg.createdAt, sentBy: msg.sentBy || null, templateName: msg.templateName };
        }
    }
    res.json({ success: true, statuses });
});

export const getThread = asyncHandler(async (req, res) => {
    // No owner filter — sales users only see their own leads in listConversations
    // so they only arrive here via their own rows. Removing the owner scope
    // prevents 404s on reassigned leads or stale client state.
    const lead = await Lead.findOne({ _id: req.params.leadId, ...tenantScope(req) });
    if (!lead) throw new ApiError(404, 'Lead not found');
    const messages = await WhatsAppMessage.find({ lead: lead._id, ...tenantScope(req) }).sort({ createdAt: 1 });
    await WhatsAppMessage.updateMany({ lead: lead._id, direction: 'in', seen: false }, { $set: { seen: true } });
    messages.forEach((m) => { if (m.direction === 'in') m.seen = true; });
    res.json({ success: true, lead: { id: lead._id, name: lead.name, mobile: lead.mobile }, messages: messages.map((m) => m.toSafeJSON()) });
});

export const getThreadByNumber = asyncHandler(async (req, res) => {
    const contactNumber = req.params.contactNumber;
    if (!contactNumber) throw new ApiError(400, 'contactNumber is required.');
    const q = { ...tenantScope(req), contactNumber, lead: null };
    const messages = await WhatsAppMessage.find(q).sort({ createdAt: 1 });
    if (!messages.length) return res.json({ success: true, lead: { id: null, name: contactNumber, mobile: contactNumber, country: 'UAE' }, messages: [] });
    await WhatsAppMessage.updateMany({ ...q, direction: 'in', seen: false }, { $set: { seen: true } });
    messages.forEach((m) => { if (m.direction === 'in') m.seen = true; });
    const withName = messages.find((m) => m.contactName);
    const withCountry = messages.find((m) => m.contactCountry);
    res.json({
        success: true,
        lead: { id: null, name: (withName && withName.contactName) || contactNumber, mobile: contactNumber, country: (withCountry && withCountry.contactCountry) || 'UAE' },
        messages: messages.map((m) => m.toSafeJSON()),
    });
});

export const relinkContact = asyncHandler(async (req, res) => {
    const { contactNumber, leadId } = req.body || {};
    if (!contactNumber || !leadId) throw new ApiError(400, 'contactNumber and leadId are required.');
    const lead = await Lead.findOne({ _id: leadId, ...tenantScope(req) });
    if (!lead) throw new ApiError(404, 'Lead not found');
    const result = await WhatsAppMessage.updateMany({ ...tenantScope(req), contactNumber, lead: null }, { $set: { lead: lead._id } });
    res.json({ success: true, message: `Linked ${result.modifiedCount} message(s) to ${lead.name}.`, modifiedCount: result.modifiedCount });
});

// ── Inbound webhook (MSG91 → us) ──────────────────────────────────────────────
// Verified by shared secret query param (?token=WHATSAPP_WEBHOOK_SECRET).
// Handles:
//   direction:"outbound" + status  → delivery/read status update
//   direction:"inbound"  + content → customer reply
//   no direction + status+requestId → legacy status update
//   no direction + from+text/media  → legacy inbound
//
// TEXT EXTRACTION — MSG91 uses different shapes per message type:
//   Flat fields:  entry.message / entry.text / entry.body / entry.caption
//   Nested:       entry.content.body_1.text  (template reply envelope)
//
// Always logs full payload so inbound issues are visible in Render logs.
export const webhook = asyncHandler(async (req, res) => {
    const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
    if (!secret || req.query.token !== secret) {
        console.log('[webhook] REJECTED — token:', !!req.query.token, 'secret set:', !!secret);
        return res.json({ success: true, ignored: true });
    }

    const body = req.body || {};
    // Always log full payload — remove once inbound is confirmed working
    console.log('[webhook] RAW PAYLOAD:', JSON.stringify(body, null, 2));

    const entries = Array.isArray(body.entry) ? body.entry : (Array.isArray(body) ? body : [body]);

    for (const entry of entries) {
        const from         = entry.customer_number || entry.customerNumber || entry.from || (entry.contact && entry.contact.wa_id) || '';
        const toNumber     = entry.integrated_number || entry.integratedNumber || entry.to || '';
        const requestId    = entry.request_id || entry.requestId || entry.msg_id || entry.message_id || '';
        const statusValue  = entry.status || entry.reason || '';
        const contactName  = entry.customer_name || entry.customerName || '';
        const direction    = entry.direction || '';

        // ── Text extraction ───────────────────────────────────────────────────
        // Support both flat fields and MSG91's nested content envelope.
        // content.body_1.text is used for template reply callbacks.
        const contentText = entry.content
            ? (
                (entry.content.body_1 && entry.content.body_1.text) ||
                (entry.content.body && entry.content.body.text) ||
                (typeof entry.content.text === 'string' ? entry.content.text : '') ||
                ''
              )
            : '';
        const text = entry.message
            || (typeof entry.text === 'string' ? entry.text : ((entry.text && entry.text.body) || ''))
            || entry.body
            || entry.caption
            || contentText
            || '';

        // ── Media extraction ──────────────────────────────────────────────────
        const contentHeader = entry.content && entry.content.header_1;
        const contentMediaUrl = (contentHeader && contentHeader.type !== 'text')
            ? ((contentHeader.document && contentHeader.document.link) ||
               (contentHeader.image && contentHeader.image.link) ||
               (contentHeader.video && contentHeader.video.link) || '')
            : '';
        const mediaUrl      = entry.url || entry.media_url || contentMediaUrl || '';
        const mediaFilename = entry.filename || (contentHeader && contentHeader.document && contentHeader.document.filename) || '';

        // Only treat message_type as media when it actually is media.
        // "template" / "text" are message kinds, not media types.
        const MEDIA_TYPES = ['image', 'document', 'video', 'audio'];
        const rawMsgType  = entry.message_type || entry.messageType || '';
        const mediaType   = MEDIA_TYPES.includes(rawMsgType) ? rawMsgType : '';

        console.log(`[webhook] from=${from} direction=${direction || 'none'} status=${statusValue} msgType=${rawMsgType} text="${text.slice(0, 80)}" media=${!!mediaUrl} requestId=${requestId}`);

        if (!from && !requestId) { console.log('[webhook] skip — no from and no requestId'); continue; }

        // ── Company lookup ────────────────────────────────────────────────────
        let company = null;
        if (toNumber) {
            const toDigits = toNumber.replace(/\D/g, '');
            company = await Company.findOne({ $or: [
                { 'msg91.integratedNumber': toNumber },
                { 'msg91.integratedNumber': toDigits },
                { 'msg91.integratedNumber': new RegExp(toDigits.slice(-10) + '$') },
            ]});
        }
        if (!company) company = await Company.findOne({ 'msg91.enabled': true });
        console.log(`[webhook] company: ${company ? company.name : 'NOT FOUND'}`);

        // ── Outbound status callback ──────────────────────────────────────────
        if (direction === 'outbound') {
            const mapped = statusValue === 'delivered' ? 'delivered'
                : statusValue === 'read'      ? 'read'
                : statusValue === 'failed'    ? 'failed'
                : null;
            if (mapped && requestId) {
                // Bulk template sends share one requestId for all recipients.
                // Use customer_number to match the right record.
                const fromDigits = from ? String(from).replace(/\D/g, '') : null;
                const filter = fromDigits
                    ? { msg91RequestId: requestId, $or: [{ contactNumber: fromDigits }, { contactNumber: new RegExp(fromDigits.slice(-9) + '$') }] }
                    : { msg91RequestId: requestId };
                const r = await WhatsAppMessage.updateOne(filter, { $set: { status: mapped } });
                console.log(`[webhook] outbound status=${mapped} matched=${r.matchedCount} modified=${r.modifiedCount}`);
            }
            continue;
        }

        // ── Legacy: no direction + status + requestId → status update ─────────
        if (!direction && statusValue && requestId) {
            const mapped = statusValue === 'delivered' ? 'delivered'
                : statusValue === 'read'   ? 'read'
                : statusValue === 'failed' ? 'failed'
                : null;
            if (mapped) {
                const r = await WhatsAppMessage.updateOne({ msg91RequestId: requestId }, { $set: { status: mapped } });
                console.log(`[webhook] legacy status=${mapped} matched=${r.matchedCount}`);
            }
            continue;
        }

        // ── Inbound message ───────────────────────────────────────────────────
        if (from && (text || mediaUrl)) {
            const digits = String(from).replace(/\D/g, '');
            console.log(`[webhook] INBOUND from=${digits} text="${text.slice(0, 80)}" media=${!!mediaUrl}`);

            const leadQuery = company ? { company: company._id } : {};
            let lead = await Lead.findOne({ ...leadQuery, mobileKey: digits });
            if (!lead && digits.length >= 9)  lead = await Lead.findOne({ ...leadQuery, mobileKey: new RegExp(`${digits.slice(-9)}$`) });
            if (!lead && digits.length >= 10) lead = await Lead.findOne({ ...leadQuery, mobileKey: new RegExp(`${digits.slice(-10)}$`) });

            console.log(`[webhook] lead: ${lead ? lead.name + ' (' + lead._id + ')' : 'NOT FOUND'}`);

            const msgBase = {
                direction: 'in', kind: 'session',
                text: text || '', mediaUrl: mediaUrl || '', mediaType, mediaFilename,
                status: 'replied', seen: false,
            };

            if (lead) {
                await WhatsAppMessage.create({
                    company: lead.company, lead: lead._id,
                    contactName: contactName || lead.name,
                    contactNumber: digits, contactCountry: lead.country,
                    ...msgBase,
                });
                console.log(`[webhook] ✓ stored for lead ${lead.name}`);

                const lastOut = await WhatsAppMessage.findOne({ lead: lead._id, direction: 'out' }).sort({ createdAt: -1 });
                if (lastOut) { lastOut.status = 'replied'; await lastOut.save(); }

                if (lead.status === 'New') {
                    lead.status = 'Contacted';
                    lead.editHistory.push({ by: lead.owner, byName: 'WhatsApp (auto)', changes: [{ field: 'status', from: 'New', to: 'Contacted — lead replied on WhatsApp' }] });
                    await lead.save();
                }

                try {
                    const recipients = await ownerAndAdmins(lead.company, lead.owner);
                    const preview = text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : `[${rawMsgType || 'media'} received]`;
                    await notifyUsers({ company: lead.company, recipients, type: 'whatsapp-reply', title: `${lead.name} replied on WhatsApp`, body: preview, link: '/communication' });
                } catch (e) { console.error('[whatsapp] notify FAILED:', e.message); }

            } else if (company) {
                // Secondary suffix pass before giving up
                if (digits.length >= 9) {
                    lead = await Lead.findOne({ company: company._id, mobileKey: new RegExp(digits.slice(-9) + '$') });
                }

                if (lead) {
                    await WhatsAppMessage.create({
                        company: lead.company, lead: lead._id,
                        contactName: contactName || lead.name,
                        contactNumber: digits, contactCountry: lead.country,
                        ...msgBase,
                    });
                    console.log(`[webhook] ✓ stored via secondary match for lead ${lead.name}`);
                    const lastOut2 = await WhatsAppMessage.findOne({ lead: lead._id, direction: 'out' }).sort({ createdAt: -1 });
                    if (lastOut2) { lastOut2.status = 'replied'; await lastOut2.save(); }
                    try {
                        const r2 = await ownerAndAdmins(lead.company, lead.owner);
                        const p2 = text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : `[${rawMsgType || 'media'} received]`;
                        await notifyUsers({ company: lead.company, recipients: r2, type: 'whatsapp-reply', title: `${lead.name} replied on WhatsApp`, body: p2, link: '/communication' });
                    } catch (e) { console.error('[whatsapp] notify FAILED:', e.message); }
                } else {
                    // Unknown number — store unlinked
                    await WhatsAppMessage.create({
                        company: company._id, lead: null,
                        contactName: contactName || '', contactNumber: digits, contactCountry: '',
                        ...msgBase,
                    });
                    console.log(`[webhook] ✓ stored unlinked from ${digits}`);
                    const lastOut3 = await WhatsAppMessage.findOne({ company: company._id, contactNumber: digits, lead: null, direction: 'out' }).sort({ createdAt: -1 });
                    if (lastOut3) { lastOut3.status = 'replied'; await lastOut3.save(); }
                    try {
                        const admins = await adminsOf(company._id);
                        const preview = text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : `[${rawMsgType || 'media'} received]`;
                        await notifyUsers({ company: company._id, recipients: admins, type: 'whatsapp-reply-unlinked', title: `${digits} replied on WhatsApp — not yet a lead`, body: preview, link: '/communication' });
                    } catch (e) { console.error('[whatsapp] unlinked notify FAILED:', e.message); }
                }
            } else {
                console.log(`[webhook] ✗ no company found for toNumber=${toNumber} — dropped`);
            }
        } else {
            console.log(`[webhook] skip — from=${from} text="${text}" media=${!!mediaUrl} (nothing to store)`);
        }
    }

    res.json({ success: true });
});