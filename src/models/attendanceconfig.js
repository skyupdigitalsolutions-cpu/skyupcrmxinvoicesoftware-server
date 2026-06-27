import mongoose from 'mongoose';

const holidaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    name: { type: String, default: 'Holiday', maxlength: 80 },
  },
  { _id: false }
);

// Per-company attendance configuration. Each tenant has exactly one config row
// (one per company), holding its rules + office geofence. Clock-in/out status
// detection reads from the caller's company config.
const attendanceConfigSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, unique: true, index: true },

    // Minutes-into-day after which a clock-in is marked "late" (e.g. 9*60+30).
    lateAfterMinutes: { type: Number, default: 9 * 60 + 30, min: 0, max: 1439 },

    // Expected shift window (HH:MM, 24h, in the company's timezone). Display +
    // reference only by default; clock-in is still allowed any time, but these
    // drive the "expected" columns and can tighten late/early-leaving logic.
    shiftStart: { type: String, default: '09:00', trim: true }, // expected clock-in
    shiftEnd:   { type: String, default: '18:00', trim: true }, // expected clock-out

    // IANA timezone for this company (country-wise). All day-boundary and
    // late-calculations are done in this zone, so a UAE tenant's "today" and
    // "late after 09:30" follow Dubai time regardless of where the server runs.
    timezone: { type: String, default: 'Asia/Dubai', trim: true },

    // Worked-minute thresholds. Below half = absent-ish/short, between =
    // half_day, at/above full = present.
    halfDayMinMinutes: { type: Number, default: 240, min: 0 }, // 4h
    fullDayMinMinutes: { type: Number, default: 480, min: 0 }, // 8h

    // Day-of-week numbers (0 = Sunday .. 6 = Saturday) that are weekly offs.
    weeklyOffDays: { type: [Number], default: [0] },

    holidays: { type: [holidaySchema], default: [] },

    // Office geofence — when enabled, clock-in is only allowed within
    // `radiusMeters` of the (lat,lng) point. lat/lng null = not configured.
    office: {
      enabled: { type: Boolean, default: false },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      radiusMeters: { type: Number, default: 100, min: 10, max: 5000 },
    },
  },
  { timestamps: true }
);

// Returns the company's config doc, creating it with defaults if missing.
attendanceConfigSchema.statics.getForCompany = async function (companyId) {
  if (!companyId) throw new Error('getForCompany requires a companyId');
  let cfg = await this.findOne({ company: companyId });
  if (!cfg) cfg = await this.create({ company: companyId });
  return cfg;
};

export const AttendanceConfig = mongoose.model('AttendanceConfig', attendanceConfigSchema);