import mongoose from 'mongoose';

// Platform-wide settings, managed only by the developer (platform owner).
// A singleton: there is exactly one document, fetched via getSingleton().
//
// Holds the PLATFORM Brevo connection used for subscription-expiry emails —
// separate from each company's own emailReport (daily report) config. One key
// here sends expiry warnings to every company's admin email.
const platformSettingsSchema = new mongoose.Schema(
  {
    // Fixed key so we always read/write the same single document.
    singleton: { type: String, default: 'platform', unique: true, index: true },

    expiryEmail: {
      enabled:     { type: Boolean, default: false },
      brevoApiKey: { type: String, default: '', trim: true, select: false }, // xkeysib-… (never exposed in list)
      senderEmail: { type: String, default: '', trim: true, lowercase: true }, // verified sender in Brevo
      senderName:  { type: String, default: '', trim: true },                  // From display name
      // How many days before expiry to send the warning.
      remindDays:  { type: Number, default: 5, min: 1, max: 60 },
      // Optional BCC to the platform owner on every expiry mail.
      ccOwnerEmail: { type: String, default: '', trim: true, lowercase: true },
    },
  },
  { timestamps: true }
);

// Returns the single settings doc, creating it with defaults if missing.
platformSettingsSchema.statics.getSingleton = async function (withSecret = false) {
  const q = this.findOne({ singleton: 'platform' });
  if (withSecret) q.select('+expiryEmail.brevoApiKey');
  let doc = await q;
  if (!doc) doc = await this.create({ singleton: 'platform' });
  return doc;
};

// Safe shape (no API key) for sending to the client.
platformSettingsSchema.methods.toSafeJSON = function () {
  return {
    expiryEmail: {
      enabled:      this.expiryEmail?.enabled      ?? false,
      senderEmail:  this.expiryEmail?.senderEmail  || '',
      senderName:   this.expiryEmail?.senderName   || '',
      remindDays:   this.expiryEmail?.remindDays   ?? 5,
      ccOwnerEmail: this.expiryEmail?.ccOwnerEmail || '',
      // brevoApiKey intentionally omitted
      hasApiKey:    !!this.expiryEmail?.brevoApiKey,
    },
  };
};

export const PlatformSettings = mongoose.model('PlatformSettings', platformSettingsSchema);
