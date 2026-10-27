import mongoose from 'mongoose';

// A local reference list of WhatsApp templates already approved on the
// MSG91/Meta side. Template creation/approval itself always happens on
// MSG91's dashboard — this collection just lets the team pick a template by
// name in the Communication page instead of typing raw template names, and
// keeps a human-readable preview of what the template says.
const templateSchema = new mongoose.Schema(
  {
    company:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name:     { type: String, required: true, trim: true }, // must exactly match the approved template name on MSG91
    language: { type: String, default: 'en', trim: true },  // MSG91 language code, e.g. en, en_US, ar
    bodyPreview: { type: String, default: '', trim: true }, // human-readable copy with {{1}}, {{2}} placeholders
    variableCount: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

templateSchema.index({ company: 1, name: 1 }, { unique: true });

templateSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    name: this.name,
    language: this.language,
    bodyPreview: this.bodyPreview,
    variableCount: this.variableCount,
    active: this.active,
  };
};

export const WhatsAppTemplate = mongoose.model('WhatsAppTemplate', templateSchema);