import { ApiError } from '../utils/ApiError.js';
import { verifyAccess } from '../utils/tokens.js';
import { User } from '../models/User.js';
import { Company } from '../models/Company.js';
import { subscriptionState } from '../utils/subscriptionStatus.js';

export const protect = async (req, _res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new ApiError(401, 'Not authenticated');

    const payload = verifyAccess(token);
    const user = await User.findById(payload.sub);
    if (!user || !user.active) throw new ApiError(401, 'User no longer active');

    req.user = user;

    // ── Subscription pause enforcement ─────────────────────────────────────
    // A company whose subscription is expired / past due / cancelled (or whose
    // renewal date has passed) is "paused": its admin & sales users are locked
    // out of all protected routes until a developer updates the payment status.
    // The developer (platform owner) is never locked, since they fix billing.
    if (user.role !== 'developer' && user.company) {
      // Always allow logout, even for a paused company, so the user can leave.
      const isLogout = req.method === 'POST' && req.originalUrl.includes('/auth/logout');
      const company = await Company.findById(user.company).lean();
      if (!company || company.active === false) {
        if (!isLogout) throw new ApiError(403, 'This company account has been deactivated. Please contact support.');
      } else {
        const state = subscriptionState(company);
        if (state.paused && !isLogout) {
          // 402 Payment Required — the client shows a dedicated "account paused" screen.
          throw new ApiError(402, `${state.reason} Access is paused until the subscription is renewed. Please contact support.`);
        }
        req.company = company;
      }
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return next(new ApiError(401, 'Access token expired'));
    if (err.name === 'JsonWebTokenError') return next(new ApiError(401, 'Invalid token'));
    next(err);
  }
};

// Role-based access control
export const authorize = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new ApiError(403, 'You do not have permission to perform this action'));
  }
  next();
};

// Convenience guard for the platform super-admin only.
export const developerOnly = authorize('developer');

// ── Multi-tenant scoping ─────────────────────────────────────────────────────
//
// tenantScope(req) returns a Mongo filter that restricts a query to the
// caller's company. Controllers MUST spread this into every find/update/delete
// so one company can never read or change another company's data.
//
//   - admin / sales : always locked to their own company.
//   - developer     : sees ALL companies by default, but may narrow to one by
//                     passing ?company=<id> (useful for the dev panel).
//
// It throws if a non-developer somehow has no company (mis-provisioned user),
// failing closed rather than leaking data.
export const tenantScope = (req) => {
  const u = req.user;
  if (!u) throw new ApiError(401, 'Not authenticated');

  if (u.role === 'developer') {
    const c = req.query?.company || req.body?.company;
    return c ? { company: c } : {}; // {} = all companies
  }

  if (!u.company) throw new ApiError(403, 'User is not assigned to a company');
  return { company: u.company };
};

// tenantCompanyId(req) returns the company id to STAMP on newly created docs.
//   - admin / sales : their own company.
//   - developer     : must specify ?company / body.company (can't create
//                     orphaned tenant data).
export const tenantCompanyId = (req) => {
  const u = req.user;
  if (u.role === 'developer') {
    const c = req.query?.company || req.body?.company;
    if (!c) throw new ApiError(400, 'Developer must specify a target company for this action');
    return c;
  }
  if (!u.company) throw new ApiError(403, 'User is not assigned to a company');
  return u.company;
};
