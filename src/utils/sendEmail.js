/**
 * sendEmail.js
 * Minimal reusable Brevo (Sendinblue) transactional email sender for plain
 * HTML notifications (no attachment). Uses the SAME per-company config as the
 * daily report:
 *   company.emailReport.brevoApiKey  (select:false — caller must select it)
 *   company.emailReport.senderEmail  – verified sender in Brevo
 *   company.emailReport.senderName   – optional display name
 *
 * Returns true on success, false (logged) on any failure — callers in
 * schedulers must never crash because mail couldn't be sent.
 */
import * as brevo from '@getbrevo/brevo';

/**
 * @param {Object} opts
 * @param {Object} opts.company   – Company doc WITH emailReport.brevoApiKey selected
 * @param {string|string[]} opts.to – recipient email(s); falls back to company.emailReport.adminEmail
 * @param {string} opts.subject
 * @param {string} opts.html
 */
export async function sendBrevoEmail({ company, to, subject, html }) {
  try {
    const cfg = company?.emailReport || {};
    if (!cfg.brevoApiKey) { console.warn(`[email] No Brevo key for ${company?.name}; skipping.`); return false; }
    if (!cfg.senderEmail) { console.warn(`[email] No sender email for ${company?.name}; skipping.`); return false; }

    const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
    const finalTo = recipients.length ? recipients : (cfg.adminEmail ? [cfg.adminEmail] : []);
    if (!finalTo.length) { console.warn(`[email] No recipient for ${company?.name}; skipping.`); return false; }

    const apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.authentications['api-key'].apiKey = cfg.brevoApiKey;

    const msg = new brevo.SendSmtpEmail();
    msg.sender = { name: cfg.senderName || company.name, email: cfg.senderEmail };
    msg.to = finalTo.map((email) => ({ email }));
    msg.subject = subject;
    msg.htmlContent = html;

    await apiInstance.sendTransacEmail(msg);
    return true;
  } catch (err) {
    console.error(`[email] send failed for ${company?.name}:`, err.message);
    return false;
  }
}

/**
 * Verify a Brevo API key is valid without sending any email.
 * Calls Brevo's GET /account endpoint — lightweight, no side effects.
 *
 * @param {string} apiKey  – the xkeysib-… key to validate
 * @returns {{ valid: boolean, email?: string, plan?: string, error?: string }}
 */
export async function verifyBrevoApiKey(apiKey) {
  if (!apiKey?.trim()) return { valid: false, error: 'No API key provided.' };
  try {
    const res = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': apiKey.trim(), accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { valid: false, error: body?.message || `Brevo rejected the key (HTTP ${res.status}).` };
    }
    const data = await res.json();
    return {
      valid: true,
      email: data.email || '',
      plan: data.plan?.[0]?.type || '',
    };
  } catch (err) {
    return { valid: false, error: err.message || 'Could not reach Brevo API.' };
  }
}

/**
 * Send an HTML email with explicit Brevo credentials (not tied to a company's
 * emailReport config). Used for the PLATFORM-wide expiry mailer.
 * @param {Object} opts
 * @param {string} opts.apiKey       – Brevo API key
 * @param {string} opts.senderEmail  – verified sender
 * @param {string} [opts.senderName]
 * @param {string|string[]} opts.to
 * @param {string|string[]} [opts.bcc]
 * @param {string} opts.subject
 * @param {string} opts.html
 */
export async function sendBrevoEmailRaw({ apiKey, senderEmail, senderName, to, bcc, subject, html }) {
  try {
    if (!apiKey || !senderEmail) { console.warn('[email] raw send missing apiKey/sender; skipping.'); return false; }
    const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
    if (!recipients.length) { console.warn('[email] raw send has no recipient; skipping.'); return false; }

    const apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.authentications['api-key'].apiKey = apiKey;

    const msg = new brevo.SendSmtpEmail();
    msg.sender = { name: senderName || 'Platform', email: senderEmail };
    msg.to = recipients.map((email) => ({ email }));
    const bccList = (Array.isArray(bcc) ? bcc : [bcc]).filter(Boolean);
    if (bccList.length) msg.bcc = bccList.map((email) => ({ email }));
    msg.subject = subject;
    msg.htmlContent = html;

    await apiInstance.sendTransacEmail(msg);
    return true;
  } catch (err) {
    console.error('[email] raw send failed:', err.message);
    return false;
  }
}