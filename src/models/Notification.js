import mongoose from 'mongoose';

// A lightweight, per-user notification. Company-scoped so tenants never see
// each other's notifications. Created server-side (e.g. when a lead follow-up
// is scheduled) and read by the recipient via the notification bell.
const notificationSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    // Recipient. One notification row per recipient (a follow-up may create
    // several: one for the owner, one per admin).
    user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    type:    { type: String, default: 'general', trim: true }, // e.g. 'lead-followup'
    title:   { type: String, required: true, trim: true, maxlength: 160 },
    body:    { type: String, default: '', trim: true, maxlength: 500 },

    // Optional deep-link target inside the app (e.g. /leads/<id>)
    link:    { type: String, default: '', trim: true },
    lead:    { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },

    // When the notification is "about" (e.g. the follow-up time). Used for sorting/labels.
    dueAt:   { type: Date, default: null },

    read:    { type: Boolean, default: false, index: true },
    readAt:  { type: Date, default: null },
  },
  { timestamps: true }
);

// Common access pattern: a user's notifications, newest first, scoped to company.
notificationSchema.index({ company: 1, user: 1, read: 1, createdAt: -1 });

export const Notification = mongoose.model('Notification', notificationSchema);