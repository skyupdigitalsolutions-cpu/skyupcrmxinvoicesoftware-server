/**
 * msg91.js
 * Thin wrapper around MSG91's WhatsApp Business API (v5). All actual HTTP
 * calls to MSG91 live in this one file — if MSG91 tweaks a field name on
 * their side, this is the only place to change.
 *
 * NOTE: MSG91's exact payload shape can vary slightly by account/integration
 * type. This follows their documented "Send Template Message" / "Send
 * Session Message" pattern (integrated_number + payload.template /
 * payload.text). If your MSG91 dashboard shows different field names for
 * your integration, adjust buildTemplatePayload / buildSessionPayload below
 * — everything else in the app (models, routes, UI) stays the same.
 */

const MSG91_BASE = 'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message';

function buildTemplatePayload({ integratedNumber, to, templateName, language, variables }) {
    const components = {};
    (variables || []).forEach((v, i) => {
        components[`body_${i + 1}`] = { type: 'text', value: String(v) };
    });
    return {
        integrated_number: integratedNumber,
        content_type: 'template',
        payload: {
            messaging_product: 'whatsapp',
            type: 'template',
            template: {
                name: templateName,
                language: { code: language || 'en', policy: 'deterministic' },
                to_and_components: [{ to: [to], components }],
            },
        },
    };
}

function buildSessionPayload({ integratedNumber, to, text }) {
    return {
        integrated_number: integratedNumber,
        recipient_number: to, // top-level, NOT nested in payload — confirmed by MSG91's "recipient_number not found in request" error
        content_type: 'text',
        text, // ALSO top-level — confirmed by MSG91's follow-up "text not found in request" error once recipient_number was fixed
        payload: {
            messaging_product: 'whatsapp',
            type: 'text',
            text: { body: text },
        },
    };
}

// Media message (image/document/video/audio) — sent via a public URL rather
// than uploading bytes directly to MSG91 (the attachment is hosted on
// Cloudinary first; see uploadChatAttachment). Uses the same
// top-level recipient_number shape as the text session message, since both
// go through the non-bulk single-message endpoint.
function buildMediaPayload({ integratedNumber, to, mediaType, mediaUrl, caption, filename }) {
    // MSG91 media payload — mirrors the session message shape with top-level
    // recipient_number + content_type, plus a payload wrapper containing the
    // media object. The payload.type must be the media kind (document/image/video/audio).
    const mediaObj = {
        link: mediaUrl,
        ...(caption ? { caption } : {}),
        ...(mediaType === 'document' && filename ? { filename } : {}),
    };
    return {
        integrated_number: integratedNumber,
        recipient_number: to,
        content_type: mediaType,          // top-level hint
        attachment_url: mediaUrl,          // some MSG91 account types read this
        ...(caption ? { caption } : {}),
        ...(mediaType === 'document' && filename ? { filename } : {}),
        payload: {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: mediaType,
            [mediaType]: mediaObj,         // e.g. payload.document = { link, filename }
        },
    };
}

// Digs a human-readable message out of whatever shape MSG91 (or the
// underlying Meta Graph API it proxies) returned. Different MSG91 endpoints
// and account types have been observed using different error shapes:
//   { message: '...' }
//   { error: '...' }
//   { error: { message: '...', type: '...', code: ... } }   (Meta Graph API style)
//   { errors: [{ message: '...' }] }
// This tries each in order rather than assuming one fixed shape.
function extractMsg91ErrorMessage(data, rawText, status) {
    if (data) {
        if (typeof data.message === 'string' && data.message) return data.message;
        if (typeof data.error === 'string' && data.error) return data.error;
        if (data.error && typeof data.error === 'object' && data.error.message) return data.error.message;
        if (Array.isArray(data.errors) && data.errors[0] && data.errors[0].message) return data.errors[0].message;
    }
    if (rawText && rawText.trim()) return rawText.trim().slice(0, 300);
    return `MSG91 request failed (HTTP ${status})`;
}

async function callMsg91(authKey, body, { bulk = true } = {}) {
    // MSG91's /bulk/ endpoint only accepts template messages — confirmed by
    // their own error response ("for now, only template is supported for
    // bulk"). Free-text/session messages (the manual "continue chat" reply)
    // must go to the base (non-bulk) single-message endpoint instead.
    const url = bulk ? `${MSG91_BASE}/bulk/` : `${MSG91_BASE}/`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: authKey },
        body: JSON.stringify(body),
    });
    // Read as text first — MSG91 can return a non-JSON body (e.g. an HTML
    // error page or plain text) on some failure modes, and .json() would
    // otherwise throw and hide that content entirely.
    const rawText = await res.text();
    let data = null;
    try { data = rawText ? JSON.parse(rawText) : null; } catch (e) { data = null; }

    if (!res.ok) {
        const message = extractMsg91ErrorMessage(data, rawText, res.status);
        const err = new Error(message);
        err.msg91Response = data;
        err.msg91RawText = rawText;
        err.msg91Status = res.status;
        throw err;
    }
    return data;
}

// Sends one approved WhatsApp template to one recipient. `to` must be a full
// international number with no leading + (e.g. "971501234567").
export async function sendTemplateMessage({ authKey, integratedNumber, to, templateName, language, variables }) {
    const body = buildTemplatePayload({ integratedNumber, to, templateName, language, variables });
    const data = await callMsg91(authKey, body, { bulk: true });
    return { requestId: (data && (data.request_id || data.requestId)) || '', raw: data };
}

// Sends a free-text session message (only deliverable within WhatsApp's 24h
// customer-service window after the lead last messaged in) — used for the
// manual "continue chat" reply box.
export async function sendSessionMessage({ authKey, integratedNumber, to, text }) {
    const body = buildSessionPayload({ integratedNumber, to, text });
    const data = await callMsg91(authKey, body, { bulk: false });
    return { requestId: (data && (data.request_id || data.requestId)) || '', raw: data };
}

// Sends an image/document/video/audio message from a public URL (the file is
// uploaded to Cloudinary first — see uploadChatAttachment in cloudinary.js).
// Subject to the same 24h session-window rule as sendSessionMessage.
export async function sendMediaMessage({ authKey, integratedNumber, to, mediaType, mediaUrl, caption, filename }) {
    const body = buildMediaPayload({ integratedNumber, to, mediaType, mediaUrl, caption, filename });
    const data = await callMsg91(authKey, body, { bulk: false });
    return { requestId: (data && (data.request_id || data.requestId)) || '', raw: data };
}