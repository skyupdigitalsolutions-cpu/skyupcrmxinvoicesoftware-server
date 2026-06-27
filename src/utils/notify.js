import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';

/**
 * Create notification rows. Accepts a single recipient id or an array.
 * Silently skips falsy / duplicate recipient ids. Never throws into the
 * caller's request flow — notification failures must not break the action
 * that triggered them.
 *
 * @param {Object}   opts
 * @param {ObjectId} opts.company   – tenant id (required)
 * @param {ObjectId|ObjectId[]} opts.recipients – user id(s) to notify
 * @param {string}   opts.type
 * @param {string}   opts.title
 * @param {string}   [opts.body]
 * @param {string}   [opts.link]
 * @param {ObjectId} [opts.lead]
 * @param {Date}     [opts.dueAt]
 */
export async function notifyUsers({ company, recipients, type = 'general', title, body = '', link = '', lead = null, dueAt = null }) {
  try {
    if (!company || !title) return [];
    const ids = (Array.isArray(recipients) ? recipients : [recipients])
      .filter(Boolean)
      .map((id) => String(id));
    const unique = [...new Set(ids)];
    if (!unique.length) return [];

    const docs = unique.map((user) => ({ company, user, type, title, body, link, lead, dueAt }));
    return await Notification.insertMany(docs);
  } catch (err) {
    console.error('[notify] failed to create notifications:', err.message);
    return [];
  }
}

/**
 * Resolve the set of recipients for a company event: the lead owner plus all
 * active admins of that company. De-duplicated by notifyUsers.
 */
export async function ownerAndAdmins(companyId, ownerId) {
  const admins = await User.find({ company: companyId, role: 'admin', active: true }).select('_id').lean();
  return [ownerId, ...admins.map((a) => a._id)];
}

/** All active admin user ids for a company (for billing/expiry notices). */
export async function adminsOf(companyId) {
  const admins = await User.find({ company: companyId, role: 'admin', active: true }).select('_id').lean();
  return admins.map((a) => a._id);
}