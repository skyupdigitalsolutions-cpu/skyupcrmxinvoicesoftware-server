import mongoose from 'mongoose';

// Append-only archive of contact numbers that were removed when a lead was
// deleted. This preserves the phone number (and a snapshot of who/what it was)
// so it stays available in a separate "Deleted Contacts" report for reference,
// even though the original Lead document is gone.
//
// This collection is NEVER updated in place — one row is inserted per deletion.
// Every query is company-scoped so tenants never see each other's data.
const deletedContactSchema = new mongoose.Schema({
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },

    // Snapshot of the lead at the moment of deletion.
    name: { type: String, default: '', trim: true },
    mobile: { type: String, default: '', trim: true },
    mobileKey: { type: String, default: '', index: true }, // normalised number
    email: { type: String, default: '', trim: true },
    country: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    source: { type: String, default: '', trim: true },
    status: { type: String, default: '', trim: true },
    interest: { type: String, default: '', trim: true },

    // Who owned the lead, and who deleted it.
    ownerName: { type: String, default: '' },
    originalLeadId: { type: mongoose.Schema.Types.ObjectId, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deletedByName: { type: String, default: '' },

    // When the lead was originally created (snapshot) vs. when it was deleted.
    leadCreatedAt: { type: Date, default: null },
}, { timestamps: true });

// Common access pattern: a company's deleted contacts, newest first.
deletedContactSchema.index({ company: 1, createdAt: -1 });

export const DeletedContact = mongoose.model('DeletedContact', deletedContactSchema);