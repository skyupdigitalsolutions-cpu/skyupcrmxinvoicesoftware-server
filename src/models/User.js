import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

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

    // Admin-visible copy of the most recently set password, kept in readable
    // form so company admins can view/share employee credentials (Option B,
    // chosen deliberately). Recorded whenever a password is set — create, admin
    // reset, or self reset. Never returned by toSafeJSON(); only surfaced by the
    // admin-only user-list endpoint. Empty for accounts whose password predates
    // this feature, until the password is next set. NOTE: this stores real
    // passwords in the DB; anyone with DB/admin access can read them.
    visiblePassword: { type: String, default: '', select: false },

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
}, { timestamps: true });

userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.visiblePassword = this.password; // readable copy for admin view (before hashing)
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
    };
};

export const User = mongoose.model('User', userSchema);
