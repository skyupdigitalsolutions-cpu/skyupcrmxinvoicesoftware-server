import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Notification } from '../models/Notification.js';
import { tenantScope } from '../middleware/auth.js';

// All notifications are scoped to the current tenant AND the current user —
// a user only ever sees their own. Developer has no company, so returns empty.
const mine = (req) => {
  if (req.user.role === 'developer') return null; // no company context
  return { ...tenantScope(req), user: req.user._id };
};

// GET /notifications?unread=1&limit=30
export const listNotifications = asyncHandler(async (req, res) => {
  const scope = mine(req);
  if (!scope) return res.json({ success: true, notifications: [], unread: 0 });

  const q = { ...scope };
  if (req.query.unread === '1' || req.query.unread === 'true') q.read = false;

  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const [notifications, unread] = await Promise.all([
    Notification.find(q).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ ...scope, read: false }),
  ]);

  res.json({ success: true, notifications, unread });
});

// GET /notifications/unread-count
export const unreadCount = asyncHandler(async (req, res) => {
  const scope = mine(req);
  if (!scope) return res.json({ success: true, unread: 0 });
  const unread = await Notification.countDocuments({ ...scope, read: false });
  res.json({ success: true, unread });
});

// PATCH /notifications/:id/read
export const markRead = asyncHandler(async (req, res) => {
  const scope = mine(req);
  if (!scope) throw new ApiError(403, 'No notifications for this account');
  const n = await Notification.findOne({ _id: req.params.id, ...scope });
  if (!n) throw new ApiError(404, 'Notification not found');
  if (!n.read) { n.read = true; n.readAt = new Date(); await n.save(); }
  res.json({ success: true, notification: n });
});

// PATCH /notifications/read-all
export const markAllRead = asyncHandler(async (req, res) => {
  const scope = mine(req);
  if (!scope) return res.json({ success: true, modified: 0 });
  const r = await Notification.updateMany(
    { ...scope, read: false },
    { $set: { read: true, readAt: new Date() } }
  );
  res.json({ success: true, modified: r.modifiedCount ?? r.nModified ?? 0 });
});

// DELETE /notifications/:id
export const deleteNotification = asyncHandler(async (req, res) => {
  const scope = mine(req);
  if (!scope) throw new ApiError(403, 'No notifications for this account');
  const n = await Notification.findOneAndDelete({ _id: req.params.id, ...scope });
  if (!n) throw new ApiError(404, 'Notification not found');
  res.json({ success: true, deleted: true });
});
