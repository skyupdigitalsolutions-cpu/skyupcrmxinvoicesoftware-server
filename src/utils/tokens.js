import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

export const signAccessToken = (user) =>
  jwt.sign(
    { sub: String(user._id), role: user.role, username: user.username, company: user.company ? String(user.company) : null },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessExpires }
  );

export const signRefreshToken = (user) =>
  jwt.sign({ sub: String(user._id) }, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshExpires });

export const verifyAccess = (token) => jwt.verify(token, env.jwt.accessSecret);
export const verifyRefresh = (token) => jwt.verify(token, env.jwt.refreshSecret);

export const hashToken = (token) => bcrypt.hash(token, 10);
export const compareToken = (token, hash) => bcrypt.compare(token, hash);

// ── Refresh-cookie transport ──────────────────────────────────────────────────
// The frontend (Cloudflare Pages) and this API (Render) are DIFFERENT sites, so
// the browser only sends the refresh cookie back on a cross-site request if it
// is set with SameSite=None; Secure. If it's SameSite=Lax / not-Secure (the old
// behaviour whenever NODE_ENV wasn't exactly "production") the cookie is
// silently dropped and users get logged out on every reload / token refresh.
//
// We DO NOT key this off NODE_ENV — a forgotten env var must not be able to
// break auth. Render always injects a `RENDER` env var, so any deployed
// instance uses the secure cross-site cookie. Only a genuine localhost client
// (local dev over http) falls back to the relaxed Lax/insecure cookie.
const isDeployed      = !!process.env.RENDER || env.isProd;
const clientLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(env.clientUrl || '');
const crossSite       = isDeployed || !clientLocalhost;

export const refreshCookieOptions = {
  httpOnly: true,
  secure: crossSite,               // required whenever SameSite=None
  sameSite: crossSite ? 'none' : 'lax',
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

