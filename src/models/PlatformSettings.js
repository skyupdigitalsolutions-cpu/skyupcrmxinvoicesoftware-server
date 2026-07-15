import mongoose from 'mongoose';

// Platform-wide settings, managed only by the developer (platform owner).
// A singleton: there is exactly one document, fetched via getSingleton().
//
// Behavior settings for subscription-expiry emails. The Brevo CONNECTION
// itself (API key, sender email/name) is no longer stored here — it's read
// from environment variables on the server (BREVO_API_KEY / BREVO_SENDER_EMAIL
// / BREVO_SENDER_NAME, see config/env.js), the same connection used for
// password resets and every company's daily report.
const platformSettingsSchema = new mongoose.Schema(
  {
    // Fixed key so we always read/write the same single document.
    singleton: { type: String, default: 'platform', unique: true, index: true },

    expiryEmail: {
      enabled:     { type: Boolean, default: false },
      // How many days before expiry to send the warning.
      remindDays:  { type: Number, default: 5, min: 1, max: 60 },
      // Optional BCC to the platform owner on every expiry mail.
      ccOwnerEmail: { type: String, default: '', trim: true, lowercase: true },
    },
  },
  { timestamps: true }
);

// Returns the single settings doc, creating it with defaults if missing.
platformSettingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({ singleton: 'platform' });
  if (!doc) doc = await this.create({ singleton: 'platform' });
  return doc;
};

// Safe shape for sending to the client (nothing secret is stored here anymore).
platformSettingsSchema.methods.toSafeJSON = function () {
  return {
    expiryEmail: {
      enabled:      this.expiryEmail?.enabled      ?? false,
      remindDays:   this.expiryEmail?.remindDays   ?? 5,
      ccOwnerEmail: this.expiryEmail?.ccOwnerEmail || '',
    },
  };
};

export const PlatformSettings = mongoose.model('PlatformSettings', platformSettingsSchema);