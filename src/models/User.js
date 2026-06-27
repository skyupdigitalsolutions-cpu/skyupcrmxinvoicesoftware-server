import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    username: {
      type: String, required: true, unique: true, lowercase: true,
      trim: true, minlength: 3, maxlength: 40, index: true,
    },
    password: { type: String, required: true, minlength: 6, select: false },

    // 'developer' = platform super-admin (manages companies + limits, no
    // company of their own). 'admin'/'sales' belong to one company.
    role: { type: String, enum: ['developer', 'admin', 'sales'], default: 'sales', index: true },

    // Tenant the user belongs to. Required for admin/sales; null for developer.
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null, index: true },

    active: { type: Boolean, default: true },
    refreshTokenHash: { type: String, select: false, default: null },

    // Per-employee clock-in location override. When `enabled`, this user must
    // clock in within the COMPANY radius of (lat,lng) instead of the company's
    // office geofence. When disabled (default), the company geofence applies.
    clockInLocation: {
      enabled: { type: Boolean, default: false },
      lat:     { type: Number, default: null },
      lng:     { type: Number, default: null },
      label:   { type: String, default: '', trim: true, maxlength: 80 },
    },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    name: this.name,
    username: this.username,
    role: this.role,
    company: this.company,
    active: this.active,
    clockInLocation: {
      enabled: this.clockInLocation?.enabled ?? false,
      lat:     this.clockInLocation?.lat ?? null,
      lng:     this.clockInLocation?.lng ?? null,
      label:   this.clockInLocation?.label || '',
    },
  };
};

export const User = mongoose.model('User', userSchema);