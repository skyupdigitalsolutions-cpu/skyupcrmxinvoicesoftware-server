import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { encryptPassword } from '../utils/crypto.js';

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 80 },
    username: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        minlength: 3,
        maxlength: 40,
        index: true,
    },
    password: { type: String, required: true, minlength: 6, select: false },

    // AES-256-GCM encrypted copy of the most recently set password.
    // Decrypted server-side and returned only on the admin-only user-list
    // endpoint so admins can view/share employee credentials.
    // Format: iv:authTag:ciphertext (all hex) — useless without the
    // PASSWORD_ENCRYPTION_KEY env var. Never returned by toSafeJSON().
    encryptedPassword: { type: String, default: '', select: false },

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
    passwordResetToken: { type: String, default: null, select: false },
    passwordResetExpires: { type: Date, default: null, select: false },

    // Per-employee clock-in location override.
    clockInLocation: {
        enabled: { type: Boolean, default: false },
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
        label: { type: String, default: '', trim: true, maxlength: 80 },
    },

    // Which Terms & Conditions version (Terms.version) this user has last
    // accepted. TermsGate compares this to the currently-published version
    // and blocks the app (re-)prompting for acceptance when they differ.
    termsAcceptedVersion: { type: Number, default: 0 },
    termsAcceptedAt: { type: Date, default: null },

    // Admin-set live-location tracking rule. When enabled, the employee's app
    // sends a location ping every `intervalMinutes` while clocked in (web app:
    // only while the tab is open; true background needs the native app).
    locationTracking: {
        enabled: { type: Boolean, default: false },
        intervalMinutes: { type: Number, enum: [15, 30, 60], default: 30 },
    },
}, { timestamps: true });

userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    // Encrypt the plaintext password BEFORE hashing so we still have it.
    // encryptPassword() uses AES-256-GCM with a random IV — the result is
    // safe to store in the DB (useless without the server's encryption key).
    try {
        this.encryptedPassword = encryptPassword(this.password);
    } catch (err) {
        // If the encryption key is missing, fail loudly rather than silently
        // falling back to storing plaintext.
        return next(err);
    }
    this.password = await bcrypt.hash(this.password, 12);
    next();
});

userSchema.methods.comparePassword = function(candidate) {
    return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toSafeJSON = function() {
    const loc = this.clockInLocation || {};
    return {
        id: this._id,
        name: this.name,
        username: this.username,
        email: this.email || '',
        role: this.role,
        company: this.company,
        active: this.active,
        clockInLocation: {
            enabled: loc.enabled === true,
            lat: loc.lat != null ? loc.lat : null,
            lng: loc.lng != null ? loc.lng : null,
            label: loc.label || '',
        },
        locationTracking: {
            enabled: !!(this.locationTracking && this.locationTracking.enabled),
            intervalMinutes: (this.locationTracking && this.locationTracking.intervalMinutes) || 30,
        },
        termsAcceptedVersion: this.termsAcceptedVersion || 0,
    };
};

export const User = mongoose.model('User', userSchema);