import mongoose from 'mongoose';

// ── phone normaliser ────────────────────────────────────────────────────────
// Maps country names to calling codes (matching the client-side list)
const DIAL = {
  UAE: '971', 'Saudi Arabia': '966', Kuwait: '965', Qatar: '974',
  Bahrain: '973', Oman: '968', India: '91', Other: '',
};

export function normalizePhone(raw, country = 'UAE') {
  if (!raw) return '';
  let p = String(raw).replace(/[^\d]/g, '');
  if (!p) return '';
  if (p.startsWith('0')) p = p.slice(1);           // strip leading zero
  const code = DIAL[country] || '971';
  if (code && !p.startsWith(code)) p = code + p;  // prepend country code
  return p;
}

// Display variant: "+<code> <local number>", e.g. "+971 506731305".
// Used in PDFs, emails and notifications so numbers always carry their
// country code. Falls back to the raw value when nothing can be derived.
export function displayPhone(raw, country = 'UAE') {
  if (!raw) return '';
  let p = String(raw).replace(/[^\d]/g, '');
  if (!p) return String(raw);
  if (p.startsWith('0')) p = p.slice(1);
  const code = DIAL[country] || '971';
  if (!code) return String(raw);
  if (p.startsWith(code)) return `+${code} ${p.slice(code.length)}`;
  return `+${code} ${p}`;
}

// ── sub-schemas ─────────────────────────────────────────────────────────────
const callLogSchema = new mongoose.Schema(
  {
    summary: { type: String, required: true, trim: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    byName: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const noteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    byName: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

// One entry per edit action (a single save may touch several fields — all
// changed fields from that save are grouped into one entry). Admin-only
// visibility is enforced in the controller, not here.
const editHistorySchema = new mongoose.Schema(
  {
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    byName: { type: String, default: '' },
    at: { type: Date, default: Date.now },
    changes: {
      type: [{
        field: { type: String, required: true },
        from: { type: mongoose.Schema.Types.Mixed, default: null },
        to: { type: mongoose.Schema.Types.Mixed, default: null },
      }],
      default: [],
    },
  },
  { _id: true }
);

// ── Lead schema ──────────────────────────────────────────────────────────────
export const LEAD_STATUSES = ['New', 'Contacted', 'Interested', 'Follow-up', 'Won', 'Lost'];
export const LEAD_SOURCES  = ['Walk-in', 'WhatsApp', 'Instagram', 'Facebook', 'Referral', 'market-in', 'Website', 'Call', 'Other'];

const leadSchema = new mongoose.Schema(
  {
    company:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name:     { type: String, required: true, trim: true },
    mobile:   { type: String, default: '', trim: true },
    mobileKey:{ type: String, default: '', index: true }, // normalised, used for dedup
    email:    { type: String, default: '', trim: true, lowercase: true },
    country:  { type: String, default: 'UAE' },
    city:     { type: String, default: '', trim: true },
    source:   { type: String, enum: LEAD_SOURCES, default: 'Walk-in' },
    campaign: { type: String, default: '', trim: true },
    interest: { type: String, default: '', trim: true },
    remark:   { type: String, default: '', trim: true },
    delivery: { type: String, default: '', trim: true },
    status:   { type: String, enum: LEAD_STATUSES, default: 'New', index: true },
    followUpAt: { type: Date, default: null, index: true }, // next scheduled follow-up
    // Timestamp of the followUpAt value we last sent a "due now" reminder for.
    // Lets the scheduler fire exactly once per scheduled follow-up: when the
    // owner reschedules, followUpAt changes and a new reminder becomes eligible.
    followUpRemindedFor: { type: Date, default: null },
    converted:{ type: Boolean, default: false },
    orderNo:  { type: Number, default: null },
    owner:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerName:{ type: String, default: '' },
    // discussion history — any authenticated employee can append
    callLogs: { type: [callLogSchema], default: [] },
    notes:    { type: [noteSchema],   default: [] },
    // Field-level edit trail — one entry per save that changed core details.
    // Admin-only visibility (enforced in the controller), used for oversight.
    editHistory: { type: [editHistorySchema], default: [] },
  },
  { timestamps: true }
);

// Keep mobileKey in sync whenever mobile or country changes
leadSchema.pre('save', function (next) {
  if (this.isModified('mobile') || this.isModified('country')) {
    this.mobileKey = normalizePhone(this.mobile, this.country);
  }
  next();
});

// Phone dedup is per-company: the same number may exist for different tenants.
leadSchema.index({ company: 1, mobileKey: 1 });

export const Lead = mongoose.model('Lead', leadSchema);