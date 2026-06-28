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

    // Contact email — used for password reset. Optional but required for
    // forgot-password to work. Not globally unique (multi-tenant: two companies
    // can have employees with the same email; each gets their own reset link).
    email: { type: String, default: '', trim: true, lowercase: true, index: true },

    // 'developer' = platform super-admin (manages companies + limits, no
    // company of their own). 'admin'/'sales' belong to one company.
    role: { type: String, enum: ['developer', 'admin', 'sales'], default: 'sales', index: true },

    // Tenant the user belongs to. Required for admin/sales; null for developer.
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null, index: true },

    active: { type: Boolean, default: true },
    refreshTokenHash: { type: String, select: false, default: null },

    // Password-reset fields — never exposed in API responses (select:false).
    // Token stored as sha-256 hash of the raw token sent in the email link.
    passwordResetToken:   { type: String, default: null, select: false },
    passwordResetExpires: { type: Date,   default: null, select: false },

    // Per-employee clock-in location override.
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
    email: this.email || '',
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