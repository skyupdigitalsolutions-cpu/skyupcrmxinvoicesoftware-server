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

export const refreshCookieOptions = {
  httpOnly: true,
  secure: env.isProd,
  sameSite: env.isProd ? 'none' : 'lax',
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};