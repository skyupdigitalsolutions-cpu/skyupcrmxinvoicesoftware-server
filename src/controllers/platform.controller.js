import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { PlatformSettings } from '../models/PlatformSettings.js';
import { sendBrevoEmailRaw } from '../utils/sendEmail.js';
import { env } from '../config/env.js';

// GET /platform/settings — developer only
export const getPlatformSettings = asyncHandler(async (_req, res) => {
  const doc = await PlatformSettings.getSingleton();
  res.json({ success: true, settings: doc.toSafeJSON() });
});

// PATCH /platform/expiry-email — update expiry-reminder BEHAVIOR settings.
// The Brevo connection itself is no longer stored here — it's read from
// BREVO_API_KEY / BREVO_SENDER_EMAIL / BREVO_SENDER_NAME on the server.
export const setExpiryEmail = asyncHandler(async (req, res) => {
  const doc = await PlatformSettings.getSingleton();
  if (!doc.expiryEmail) doc.expiryEmail = {};

  const { enabled, remindDays, ccOwnerEmail } = req.body || {};
  if (enabled      !== undefined) doc.expiryEmail.enabled      = !!enabled;
  if (ccOwnerEmail !== undefined) doc.expiryEmail.ccOwnerEmail = String(ccOwnerEmail).trim().toLowerCase();
  if (remindDays   !== undefined) doc.expiryEmail.remindDays   = Math.min(60, Math.max(1, Number(remindDays) || 5));

  await doc.save();
  res.json({ success: true, settings: doc.toSafeJSON() });
});

// POST /platform/expiry-email/test — send a test expiry email to a given address
export const testExpiryEmail = asyncHandler(async (req, res) => {
  const { apiKey, senderEmail, senderName } = env.brevo;
  if (!apiKey) throw new ApiError(400, 'BREVO_API_KEY is not set on the server.');
  if (!senderEmail) throw new ApiError(400, 'BREVO_SENDER_EMAIL is not set on the server.');

  const doc = await PlatformSettings.getSingleton();
  const cfg = doc.expiryEmail || {};
  const to = String(req.body?.to || cfg.ccOwnerEmail || '').trim();
  if (!to) throw new ApiError(400, 'Provide a recipient email to send the test to.');

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:auto">
      <div style="background:#6D28D9;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">Platform Expiry Email — Test</h2>
      </div>
      <div style="background:#F9FAFB;padding:22px;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 8px 8px">
        <p style="font-size:14px;color:#111;margin:0">
          This is a test of the platform-wide subscription-expiry email connection. If you received
          this, your Brevo settings are working.
        </p>
      </div>
    </div>`;

  const ok = await sendBrevoEmailRaw({
    apiKey,
    senderEmail,
    senderName: senderName || 'Platform',
    to,
    subject: 'Test — Platform Expiry Email Connection',
    html,
  });

  if (!ok) throw new ApiError(502, 'Brevo rejected the test send. Check BREVO_API_KEY / BREVO_SENDER_EMAIL on the server.');
  res.json({ success: true, message: `Test email sent to ${to}` });
});