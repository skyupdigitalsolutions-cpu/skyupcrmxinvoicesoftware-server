import mongoose from 'mongoose';

// ── phone normaliser ────────────────────────────────────────────────────────
// Maps country names to calling codes — kept in sync with the client's
// COUNTRY_CODES map (client/src/utils/format.js) so a lead's dedup key
// (mobileKey) is computed identically wherever the country was entered.
// Previously this only covered 8 countries; any country outside that list
// silently fell back to '971' (UAE), which is wrong for the number itself
// and, if a customer's country was recorded inconsistently between two
// submissions, could compute a different key each time and produce
// duplicate lead records instead of matching an existing one.
const DIAL = {
  UAE: '971', 'Saudi Arabia': '966', Kuwait: '965', Qatar: '974', Bahrain: '973',
  Oman: '968', Iran: '98', Iraq: '964', Syria: '963', Yemen: '967', Lebanon: '961',
  Georgia: '995', India: '91', 'Sri Lanka': '94', 'United Kingdom': '44',
  Egypt: '20', Sudan: '249', 'South Sudan': '211', Libya: '218', Algeria: '213',
  Morocco: '212', Tunisia: '216', Angola: '244', Benin: '229', Botswana: '267',
  'Burkina Faso': '226', Burundi: '257', Cameroon: '237', 'Cape Verde': '238',
  'Central African Republic': '236', Chad: '235', Comoros: '269',
  'Congo (Republic)': '242', 'Congo (DRC)': '243', Djibouti: '253',
  'Equatorial Guinea': '240', Eritrea: '291', Eswatini: '268', Ethiopia: '251',
  Gabon: '241', Gambia: '220', Ghana: '233', Guinea: '224', 'Guinea-Bissau': '245',
  'Ivory Coast': '225', Kenya: '254', Lesotho: '266', Liberia: '231',
  Madagascar: '261', Malawi: '265', Mali: '223', Mauritania: '222', Mauritius: '230',
  Mozambique: '258', Namibia: '264', Niger: '227', Nigeria: '234', Rwanda: '250',
  'Sao Tome and Principe': '239', Senegal: '221', Seychelles: '248',
  'Sierra Leone': '232', Somalia: '252', 'South Africa': '27', Tanzania: '255',
  Togo: '228', Uganda: '256', Zambia: '260', Zimbabwe: '263', Other: '',
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
    altMobile:{ type: String, default: '', trim: true }, // secondary/alternate contact number
    altCountry:{ type: String, default: '' },             // dial-code country for altMobile (independent of the lead's main country)
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
// UNIQUE (not just indexed) — this is a hard database-level guarantee that
// two leads in the same company can never share a phone number, regardless
// of any application-level race condition (e.g. two near-simultaneous
// requests both passing a "does this exist?" check before either commits).
// The application-level duplicate check in lead.controller.js still runs
// first for a fast, friendly error message — this index is the backstop that
// makes a duplicate structurally impossible even if that check is ever
// bypassed or raced. Partial so leads with no phone number (mobileKey: '')
// never collide with each other.
leadSchema.index(
  { company: 1, mobileKey: 1 },
  { unique: true, partialFilterExpression: { mobileKey: { $ne: '' } } }
);

export const Lead = mongoose.model('Lead', leadSchema);