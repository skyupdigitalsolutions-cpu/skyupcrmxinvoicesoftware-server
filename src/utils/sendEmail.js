/**
 * sendEmail.js
 * All Brevo (Sendinblue) email sending for the platform.
 *
 * Three exported senders:
 *  1. sendBrevoEmail      – per-company daily report (uses company's own key)
 *  2. sendBrevoEmailRaw   – arbitrary HTML with explicit credentials (expiry reminders)
 *  3. sendPasswordResetEmail – platform system email using BREVO_* env vars
 */
import * as brevo from '@getbrevo/brevo';
import { env } from '../config/env.js';

// ── 1. Per-company sender (daily report) ──────────────────────────────────────
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

// ── 2. Raw sender (platform expiry reminders) ──────────────────────────────────
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

// ── 3. Verify a Brevo API key (no email sent) ─────────────────────────────────
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
    return { valid: true, email: data.email || '', plan: data.plan?.[0]?.type || '' };
  } catch (err) {
    return { valid: false, error: err.message || 'Could not reach Brevo API.' };
  }
}

// ── 4. Password reset email (uses platform BREVO_* env vars) ─────────────────
/**
 * @param {Object} opts
 * @param {string}   opts.to        – recipient email address
 * @param {string}   opts.resetUrl  – full URL the user clicks to reset
 * @param {string}   [opts.userName] – first name / full name for greeting
 */
export async function sendPasswordResetEmail({ to, resetUrl, userName }) {
  const { apiKey, senderEmail, senderName } = env.brevo;

  if (!apiKey || !senderEmail) {
    console.warn(
      '[email] BREVO_API_KEY or BREVO_SENDER_EMAIL not configured; ' +
      'password reset email not sent. Set them in your .env file.'
    );
    return false;
  }

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:auto">
      <div style="background:#6D28D9;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">Password Reset Request</h2>
      </div>
      <div style="background:#F9FAFB;padding:22px 24px;border:1px solid #E5E7EB;border-top:none">
        <p style="font-size:14px;color:#111;margin:0 0 10px">Hi ${userName || 'there'},</p>
        <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 20px">
          We received a request to reset the password for your CRM account.
          Click the button below to choose a new password.
          This link is valid for <strong>1 hour</strong> and can only be used once.
        </p>
        <div style="text-align:center;margin:0 0 22px">
          <a href="${resetUrl}"
             style="display:inline-block;padding:12px 30px;background:#6D28D9;color:#fff;
                    font-weight:700;font-size:14px;border-radius:8px;text-decoration:none;
                    letter-spacing:.3px">
            Reset My Password
          </a>
        </div>
        <p style="font-size:12px;color:#6B7280;margin:0 0 10px">
          If you did not request a password reset, you can safely ignore this email —
          your password will not be changed.
        </p>
        <p style="font-size:11px;color:#9CA3AF;margin:0;word-break:break-all">
          If the button above doesn't work, copy and paste this link into your browser:<br>
          ${resetUrl}
        </p>
      </div>
      <div style="background:#F3F4F6;padding:10px 24px;border:1px solid #E5E7EB;border-top:none;
                  border-radius:0 0 8px 8px;font-size:11px;color:#9CA3AF">
        Sent by CRM Platform · Do not reply to this email.
      </div>
    </div>
  `;

  return sendBrevoEmailRaw({
    apiKey,
    senderEmail,
    senderName: senderName || 'CRM Platform',
    to,
    subject: 'Reset your CRM password',
    html,
  });
}
