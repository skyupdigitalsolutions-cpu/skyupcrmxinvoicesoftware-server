import crypto from 'crypto';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/User.js';
import { Company } from '../models/Company.js';
import { env } from '../config/env.js';
import { sendPasswordResetEmail } from '../utils/sendEmail.js';
import {
  signAccessToken, signRefreshToken, verifyRefresh,
  hashToken, compareToken, refreshCookieOptions,
} from '../utils/tokens.js';

const issueTokens = async (user, res) => {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  user.refreshTokenHash = await hashToken(refreshToken);
  await user.save();
  res.cookie('refreshToken', refreshToken, refreshCookieOptions);
  return accessToken;
};

const userPayload = async (user) => {
  const safe = user.toSafeJSON();
  if (user.company) {
    const company = await Company.findById(user.company).lean();
    if (company) {
      const c = new Company(company);
      const cs = c.toSafeJSON();
      safe.company = {
        id:       String(company._id),
        name:     company.name,
        slug:     company.slug,
        currency: cs.currency,
        branding: cs.branding,
        subscription: {
          status:      company.subscription?.status || 'Trial',
          renewalDate: company.subscription?.renewalDate || null,
          plan:        company.subscription?.plan || 'Free',
        },
      };
    }
  }
  return safe;
};

export const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username: username.toLowerCase() }).select('+password +refreshTokenHash');
  if (!user || !user.active) throw new ApiError(401, 'Wrong username or password');

  const ok = await user.comparePassword(password);
  if (!ok) throw new ApiError(401, 'Wrong username or password');

  const accessToken = await issueTokens(user, res);
  res.json({ success: true, accessToken, user: await userPayload(user) });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) throw new ApiError(401, 'No refresh token');

  let payload;
  try { payload = verifyRefresh(token); }
  catch { throw new ApiError(401, 'Invalid refresh token'); }

  const user = await User.findById(payload.sub).select('+refreshTokenHash');
  if (!user || !user.refreshTokenHash) throw new ApiError(401, 'Session expired');

  const match = await compareToken(token, user.refreshTokenHash);
  if (!match) throw new ApiError(401, 'Session expired');

  const accessToken = await issueTokens(user, res);
  res.json({ success: true, accessToken, user: await userPayload(user) });
});

export const logout = asyncHandler(async (req, res) => {
  if (req.user) { req.user.refreshTokenHash = null; await req.user.save(); }
  res.clearCookie('refreshToken', { ...refreshCookieOptions, maxAge: 0 });
  res.json({ success: true, message: 'Logged out' });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: await userPayload(req.user) });
});

// ── Forgot password ────────────────────────────────────────────────────────────
// Accepts an email address, finds all active admin/sales users with that email,
// generates a unique signed reset link for each and sends it via Brevo.
// Always returns the same success message to prevent user enumeration.
export const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();

  // Generic response — never reveal whether an email exists in the system.
  const generic = { success: true, message: 'If that email is registered, a reset link has been sent.' };

  if (!email) return res.json(generic);

  // Developers cannot use this flow — they have server access.
  const users = await User.find({
    email,
    active: true,
    role: { $in: ['admin', 'sales'] },
  }).select('+passwordResetToken +passwordResetExpires');

  if (!users.length) return res.json(generic);

  // Send a separate reset link for each matching account (multi-tenant).
  await Promise.all(users.map(async (user) => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    user.passwordResetToken   = hashedToken;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${env.clientUrl}/reset-password?token=${rawToken}`;

    await sendPasswordResetEmail({ to: email, resetUrl, userName: user.name })
      .catch((err) => console.error(`[forgot-password] email failed for ${user.username}:`, err.message));
  }));

  res.json(generic);
});

// ── Reset password ─────────────────────────────────────────────────────────────
// Validates the raw token, updates the password, and invalidates all sessions.
export const resetPassword = asyncHandler(async (req, res) => {
  const rawToken = String(req.body.token || '').trim();
  const newPassword = String(req.body.password || '');

  if (!rawToken) throw new ApiError(400, 'Reset token is required.');
  if (!newPassword || newPassword.length < 6) throw new ApiError(400, 'Password must be at least 6 characters.');

  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  const user = await User.findOne({
    passwordResetToken:   hashedToken,
    passwordResetExpires: { $gt: Date.now() },
    active: true,
  }).select('+password +passwordResetToken +passwordResetExpires +refreshTokenHash');

  if (!user) throw new ApiError(400, 'This reset link is invalid or has expired. Please request a new one.');

  // Update password and clear the reset token + all active sessions.
  user.password             = newPassword; // hashed by pre-save hook
  user.passwordResetToken   = null;
  user.passwordResetExpires = null;
  user.refreshTokenHash     = null;        // invalidate all existing sessions
  await user.save();

  res.json({ success: true, message: 'Password reset successfully. You can now log in with your new password.' });
});
