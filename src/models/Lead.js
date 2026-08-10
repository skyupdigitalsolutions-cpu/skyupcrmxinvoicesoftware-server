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
  // Gulf / Middle East
  UAE: '971', 'Saudi Arabia': '966', Kuwait: '965', Qatar: '974', Bahrain: '973',
  Oman: '968', Iran: '98', Iraq: '964', Syria: '963', Yemen: '967', Lebanon: '961',
  Jordan: '962', Palestine: '970', Israel: '972', Turkey: '90',
  // Central Asia
  Georgia: '995', Armenia: '374', Azerbaijan: '994', Kazakhstan: '7',
  Uzbekistan: '998', Turkmenistan: '993', Tajikistan: '992', Kyrgyzstan: '996',
  Afghanistan: '93', Pakistan: '92',
  // South Asia
  India: '91', 'Sri Lanka': '94', Bangladesh: '880', Nepal: '977',
  Bhutan: '975', Maldives: '960',
  // Southeast Asia
  Indonesia: '62', Malaysia: '60', Philippines: '63', Thailand: '66',
  Vietnam: '84', Singapore: '65', Myanmar: '95', Cambodia: '855',
  Laos: '856', Brunei: '673',
  // East Asia
  China: '86', Japan: '81', 'South Korea': '82', Mongolia: '976',
  Taiwan: '886', 'Hong Kong': '852', Macau: '853',
  // Europe
  'United Kingdom': '44', Germany: '49', France: '33', Italy: '39',
  Spain: '34', Portugal: '351', Netherlands: '31', Belgium: '32',
  Switzerland: '41', Austria: '43', Sweden: '46', Norway: '47',
  Denmark: '45', Finland: '358', Ireland: '353', Greece: '30',
  Poland: '48', 'Czech Republic': '420', Slovakia: '421', Hungary: '36',
  Romania: '40', Bulgaria: '359', Croatia: '385', Serbia: '381',
  Slovenia: '386', Albania: '355', Ukraine: '380', Belarus: '375',
  Moldova: '373', Russia: '7', Estonia: '372', Latvia: '371',
  Lithuania: '370', Luxembourg: '352', Iceland: '354', Malta: '356',
  Cyprus: '357',
  // Americas
  USA: '1', Canada: '1', Mexico: '52', Brazil: '55', Argentina: '54',
  Colombia: '57', Chile: '56', Peru: '51', Venezuela: '58', Ecuador: '593',
  Bolivia: '591', Paraguay: '595', Uruguay: '598', Guyana: '592',
  Suriname: '597', Panama: '507', 'Costa Rica': '506', Guatemala: '502',
  Honduras: '504', 'El Salvador': '503', Nicaragua: '505', Cuba: '53',
  Haiti: '509',
  // Africa
  Egypt: '20', Sudan: '249', 'South Sudan': '211', Libya: '218', Algeria: '213',
  Morocco: '212', Tunisia: '216', Angola: '244', Benin: '229', Botswana: '267',
  'Burkina Faso': '226', Burundi: '257', Cameroon: '237', 'Cape Verde': '238',
  'Central African Republic': '236', Chad: '235', Comoros: '269',
  'Congo (Republic)': '242', 'Congo (DRC)': '243', Djibouti: '253',
  'Equatorial Guinea': '240', Eritrea: '291', Eswatini: '268', Ethiopia: '251',
  Gabon: '241', Gambia: '220', Ghana: '233', Guinea: '224', 'Guinea-Bissau': '245',
  'Ivory Coast': '225', Kenya: '254', Lesotho: '266', Liberia: '231',
  Madagascar: '261', Malawi: '265', Mali: '223', Mauritania: '222', Mauritius: '230',
  Mayotte: '262', Mozambique: '258', Namibia: '264', Niger: '227', Nigeria: '234',
  Rwanda: '250', 'Sao Tome and Principe': '239', Senegal: '221', Seychelles: '248',
  'Sierra Leone': '232', Somalia: '252', 'South Africa': '27', Tanzania: '255',
  Togo: '228', Uganda: '256', Zambia: '260', Zimbabwe: '263',
  // Oceania
  Australia: '61', 'New Zealand': '64', Fiji: '679', 'Papua New Guinea': '675',
  // Fallback — user types country name + code manually via CountrySelect
  Other: '',
};

// Case-insensitive lookup: 'iran', 'IRAN', 'Iran' all resolve correctly.
// This prevents the silent '971' fallback that was the root cause of duplicate
// mobileKeys when country names were stored with inconsistent capitalisation.
const DIAL_LOWER = Object.fromEntries(
  Object.entries(DIAL).map(([k, v]) => [k.toLowerCase(), v])
);
function dialCode(country) {
  if (!country) return '971';
  const code = DIAL[country] ?? DIAL_LOWER[String(country).toLowerCase()];
  return code !== undefined ? code : '971';
}

export function normalizePhone(raw, country = 'UAE') {
  if (!raw) return '';
  let p = String(raw).replace(/[^\d]/g, '');
  if (!p) return '';
  if (p.startsWith('0')) p = p.slice(1);           // strip leading zero

  // Support custom country format "CountryName|dialCode" (e.g. "Mayotte|262")
  // saved by CountrySelect when user types a country not in the built-in list.
  let code;
  if (country && country.includes('|')) {
    const parts = country.split('|');
    code = parts[1] ? parts[1].replace(/\D/g, '') : '';
  } else {
    code = dialCode(country);
  }

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
  const code = dialCode(country);
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
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
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
  // NOTE: $gt '' (not $ne '') — MongoDB partial indexes explicitly disallow
  // $not-based expressions (which is what $ne compiles to internally), so it
  // rejects the index outright with "Expression not supported in partial
  // index: $not". $gt achieves the identical "mobileKey is a non-empty
  // string" effect for strings and IS an allowed partial-index operator.
  { unique: true, partialFilterExpression: { mobileKey: { $gt: '' } } }
);

export const Lead = mongoose.model('Lead', leadSchema);

// MongoDB silently REFUSES to build a unique index if duplicate data already
// violates it (e.g. leftover dupes from before this index existed, or a
// migration/manual edit that reintroduced one). Mongoose only reports that
// failure via this 'index' event — not a thrown error, not an unhandled
// rejection — so without this listener a broken duplicate-phone guarantee
// would fail completely silently. Run checkDuplicateIndex.js if this fires.
Lead.on('index', (err) => {
  if (err) {
    console.error(
      '[Lead] ✗ Index build failed — the unique (company, mobileKey) duplicate-phone guarantee may NOT be active:',
      err.message
    );
  }
});