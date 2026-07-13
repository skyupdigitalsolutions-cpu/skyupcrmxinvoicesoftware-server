import mongoose from 'mongoose';

// A tenant. Every business-data document (User, Order, Lead, Invoice,
// Attendance, AttendanceConfig, Counter) belongs to exactly one Company.
// The `developer` super-role manages these, sets limits, and tracks billing.
const companySchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 120 },

    slug: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        minlength: 2,
        maxlength: 60,
        index: true,
    },

    active: { type: Boolean, default: true },

    // Per-company limits. 0 = unlimited (interpret in the enforcement layer).
    limits: {
        maxAdmins: { type: Number, default: 1, min: 0 },
        maxEmployees: { type: Number, default: 5, min: 0 },
        maxLeads: { type: Number, default: 0, min: 0 },
    },

    // ── Currency ──────────────────────────────────────────────────────────────
    currency: {
        code: { type: String, default: 'INR', trim: true, uppercase: true }, // e.g. INR, AED, USD
        symbol: { type: String, default: '₹', trim: true }, // e.g. ₹, AED, $
        locale: { type: String, default: 'en-IN', trim: true }, // for Intl.NumberFormat
    },

    // ── Branding (per-company, set by developer) ──────────────────────────────
    // Everything a tenant needs to white-label receipts, the sidebar header and
    // the document/PDF chrome. All optional — sensible fallbacks applied where
    // these are consumed (sidebar, invoice PDF, receipts).
    branding: {
        // Name shown in the top header / sidebar in place of "Sole & Stride".
        headerName: { type: String, default: '', trim: true, maxlength: 120 },
        // Optional second line / tagline shown under the header name.
        headerTagline: { type: String, default: '', trim: true, maxlength: 120 },
        // Logo image URL (hosted anywhere — e.g. Cloudinary). Shown fixed in sidebar.
        logoUrl: { type: String, default: '', trim: true },

        // ── Receipt / Tax-Invoice document fields ──────────────────────────────
        receiptHeading: { type: String, default: 'Tax Invoice', trim: true, maxlength: 80 }, // title at top of invoice PDF
        cardsHeading: { type: String, default: '', trim: true, maxlength: 120 }, // heading above dashboard/report summary cards
        legalName: { type: String, default: '', trim: true, maxlength: 160 }, // company legal name printed on receipt
        legalNameAr: { type: String, default: '', trim: true, maxlength: 200 }, // company legal name in Arabic (order form / receipt)
        addressLine1: { type: String, default: '', trim: true, maxlength: 160 },
        addressLine2: { type: String, default: '', trim: true, maxlength: 160 },
        addressAr: { type: String, default: '', trim: true, maxlength: 240 }, // address in Arabic (optional)
        city: { type: String, default: '', trim: true, maxlength: 80 },
        phone: { type: String, default: '', trim: true, maxlength: 60 },
        email: { type: String, default: '', trim: true, maxlength: 120 },
        website: { type: String, default: '', trim: true, maxlength: 120 },
        trn: { type: String, default: '', trim: true, maxlength: 60 }, // Tax Registration No.
        taxLabel: { type: String, default: 'VAT', trim: true, maxlength: 20 }, // e.g. VAT / GST
        taxPercent: { type: Number, default: 5, min: 0, max: 100 }, // default tax rate on receipts
        footerNote: { type: String, default: 'This is a Computer Generated Invoice', trim: true, maxlength: 200 },
        declaration: { type: String, default: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', trim: true, maxlength: 400 },
    },

    // ── Cloudinary (per-company) ──────────────────────────────────────────────
    cloudinary: {
        cloudName: { type: String, default: '', trim: true },
        apiKey: { type: String, default: '', trim: true },
        apiSecret: { type: String, default: '', trim: true, select: false }, // never expose in list
    },

    // ── Email / daily report (Brevo) ──────────────────────────────────────────
    // brevoApiKey and senderEmail are the only fields required to send mail.
    // brevoApiKey is select:false so it is never leaked in list responses.
    emailReport: {
        enabled: { type: Boolean, default: false },
        adminEmail: { type: String, default: '', trim: true, lowercase: true }, // recipient
        senderEmail: { type: String, default: '', trim: true, lowercase: true }, // must be verified in Brevo
        senderName: { type: String, default: '', trim: true }, // From display name
        brevoApiKey: { type: String, default: '', trim: true, select: false }, // xkeysib-… key
        sendAt: { type: String, default: '08:00', trim: true }, // HH:MM (server local)
    },

    // ── Subscription / billing ────────────────────────────────────────────────
    subscription: {
        plan: { type: String, enum: ['Free', 'Basic', 'Pro', 'Enterprise'], default: 'Free' },
        status: { type: String, enum: ['Trial', 'Active', 'Past Due', 'Expired', 'Cancelled'], default: 'Trial' },
        monthlyFee: { type: Number, default: 0, min: 0 },
        startDate: { type: Date, default: null },
        renewalDate: { type: Date, default: null },
        lastPaymentDate: { type: Date, default: null },
        lastPaymentAmount: { type: Number, default: 0, min: 0 },
        paymentMethod: { type: String, default: '' },
        paymentRef: { type: String, default: '' },
        // Renewal date we last sent a "5 days to expiry" reminder for. Prevents
        // the daily scheduler from re-notifying every day; resets when the
        // developer sets a new renewal date.
        expiryReminderSentFor: { type: Date, default: null },
    },

    contactEmail: { type: String, default: '', trim: true, lowercase: true },
    notes: { type: String, default: '', maxlength: 500 },
}, { timestamps: true });

companySchema.methods.toSafeJSON = function() {
    const b = this.branding || {};
    const cl = this.cloudinary || {};
    const er = this.emailReport || {};
    return {
        id: this._id,
        name: this.name,
        slug: this.slug,
        active: this.active,
        limits: this.limits,
        currency: this.currency,
        branding: {
            headerName: b.headerName || '',
            headerTagline: b.headerTagline || '',
            logoUrl: b.logoUrl || '',
            receiptHeading: b.receiptHeading || 'Tax Invoice',
            cardsHeading: b.cardsHeading || '',
            legalName: b.legalName || '',
            legalNameAr: b.legalNameAr || '',
            addressLine1: b.addressLine1 || '',
            addressLine2: b.addressLine2 || '',
            addressAr: b.addressAr || '',
            city: b.city || '',
            phone: b.phone || '',
            email: b.email || '',
            website: b.website || '',
            trn: b.trn || '',
            taxLabel: b.taxLabel || 'VAT',
            taxPercent: Number.isFinite(b.taxPercent) ? b.taxPercent : 5,
            footerNote: b.footerNote || 'This is a Computer Generated Invoice',
            declaration: b.declaration || '',
        },
        cloudinary: {
            cloudName: cl.cloudName || '',
            apiKey: cl.apiKey || '',
            // never expose apiSecret
        },
        emailReport: {
            enabled: er.enabled === true,
            adminEmail: er.adminEmail || '',
            senderEmail: er.senderEmail || '',
            senderName: er.senderName || '',
            // brevoApiKey is intentionally omitted — select:false keeps it out of all
            // queries unless explicitly requested, and toSafeJSON never includes it.
            sendAt: er.sendAt || '08:00',
        },
        subscription: this.subscription,
        contactEmail: this.contactEmail,
        notes: this.notes,
        createdAt: this.createdAt,
    };
};

export const Company = mongoose.model('Company', companySchema);