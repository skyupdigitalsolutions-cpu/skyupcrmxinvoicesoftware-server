import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { PlatformSettings } from '../models/PlatformSettings.js';
import { sendBrevoEmailRaw } from '../utils/sendEmail.js';

// GET /platform/settings — developer only
export const getPlatformSettings = asyncHandler(async (_req, res) => {
  const doc = await PlatformSettings.getSingleton();
  res.json({ success: true, settings: doc.toSafeJSON() });
});

// PATCH /platform/expiry-email — update the platform Brevo config for expiry mails
export const setExpiryEmail = asyncHandler(async (req, res) => {
  const doc = await PlatformSettings.getSingleton(true);
  if (!doc.expiryEmail) doc.expiryEmail = {};

  const { enabled, brevoApiKey, senderEmail, senderName, remindDays, ccOwnerEmail } = req.body || {};
  if (enabled      !== undefined) doc.expiryEmail.enabled      = !!enabled;
  if (senderEmail  !== undefined) doc.expiryEmail.senderEmail  = String(senderEmail).trim().toLowerCase();
  if (senderName   !== undefined) doc.expiryEmail.senderName   = String(senderName).trim();
  if (ccOwnerEmail !== undefined) doc.expiryEmail.ccOwnerEmail = String(ccOwnerEmail).trim().toLowerCase();
  if (remindDays   !== undefined) doc.expiryEmail.remindDays   = Math.min(60, Math.max(1, Number(remindDays) || 5));
  // Only overwrite the key if a non-empty value was submitted (blank = keep existing).
  if (brevoApiKey  !== undefined && String(brevoApiKey).trim() !== '') {
    doc.expiryEmail.brevoApiKey = String(brevoApiKey).trim();
  }

  await doc.save();
  res.json({ success: true, settings: doc.toSafeJSON() });
});

// POST /platform/expiry-email/test — send a test expiry email to a given address
export const testExpiryEmail = asyncHandler(async (req, res) => {
  const doc = await PlatformSettings.getSingleton(true);
  const cfg = doc.expiryEmail || {};
  if (!cfg.brevoApiKey) throw new ApiError(400, 'Platform Brevo API key must be set before testing.');
  if (!cfg.senderEmail) throw new ApiError(400, 'Sender email must be set before testing.');

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
    apiKey: cfg.brevoApiKey,
    senderEmail: cfg.senderEmail,
    senderName: cfg.senderName || 'Platform',
    to,
    subject: 'Test — Platform Expiry Email Connection',
    html,
  });

  if (!ok) throw new ApiError(502, 'Brevo rejected the test send. Check the API key and sender.');
  res.json({ success: true, message: `Test email sent to ${to}` });
});
