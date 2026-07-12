/**
 * subscriptionStatus.js
 * Single source of truth for whether a company is currently "paused" (locked)
 * due to its subscription state. A paused company's admin/sales users are
 * blocked from all data routes until a developer updates the payment/subscription
 * status back to Active/Trial (and typically sets a future renewal date).
 *
 * Rules:
 *   • status Expired / Past Due / Cancelled  → paused
 *   • renewalDate in the past AND status not Active/Trial → paused
 *   • renewalDate in the past while still Active/Trial → treated as expired
 *     (grace removed) so access locks even if nobody flipped the status yet.
 *   • Active / Trial with a future (or no) renewal date → not paused
 *
 * The developer role is never paused (handled by the caller).
 */

const PAUSED_STATUSES = ['Expired', 'Past Due', 'Cancelled'];
const OK_STATUSES = ['Active', 'Trial'];

export function subscriptionState(company) {
  const sub = company?.subscription || {};
  const status = sub.status || 'Trial';
  const renewal = sub.renewalDate ? new Date(sub.renewalDate) : null;
  const now = new Date();

  const renewalPassed = !!(renewal && renewal.getTime() < now.getTime());

  let paused = false;
  let reason = '';

  if (PAUSED_STATUSES.includes(status)) {
    paused = true;
    reason = status === 'Cancelled'
      ? 'This account has been cancelled.'
      : 'This account is past due / expired.';
  } else if (renewalPassed && !OK_STATUSES.includes(status)) {
    paused = true;
    reason = 'This account has expired.';
  } else if (renewalPassed && OK_STATUSES.includes(status)) {
    // Renewal date has passed but status wasn't updated — lock it anyway.
    paused = true;
    reason = 'This account has expired.';
  }

  return { paused, reason, status, renewalDate: renewal };
}

export function isCompanyPaused(company) {
  return subscriptionState(company).paused;
}
