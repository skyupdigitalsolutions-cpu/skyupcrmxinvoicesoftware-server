import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/User.js';
import { Company } from '../models/Company.js';
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

// Build the client-facing user object, enriched with the tenant's branding +
// currency so the web app can white-label the sidebar, receipts and amounts
// without an extra round-trip. Developers have no company → company stays null.
const userPayload = async (user) => {
  const safe = user.toSafeJSON();
  if (user.company) {
    const company = await Company.findById(user.company).lean();
    if (company) {
      const c = new Company(company); // reuse toSafeJSON shape
      const cs = c.toSafeJSON();
      safe.company = {
        id:       String(company._id),
        name:     company.name,
        slug:     company.slug,
        currency: cs.currency,
        branding: cs.branding,
        // Lightweight subscription summary so the dashboard can show an expiry
        // banner. No billing secrets — just status + renewal date.
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

  const accessToken = await issueTokens(user, res); // rotation
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