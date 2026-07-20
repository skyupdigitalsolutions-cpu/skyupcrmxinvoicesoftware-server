import mongoose from 'mongoose';

// A manually-entered cheque collection record from a client/lead. Independent
// of Order/Invoice — created directly on the Cheque Calendar page ("Add
// Cheque"), not derived from an order's payment term.
const CHEQUE_STATUSES = ['Pending', 'Collected', 'Bounced'];

const chequeSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },

    // Optional link to an existing lead — purely a reference for quick
    // lookup; the fields below are always filled in manually and are the
    // source of truth shown on the calendar even if the lead is later edited
    // or removed.
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },

    customer: { type: String, required: true, trim: true },
    mobile:   { type: String, default: '', trim: true },
    country:  { type: String, default: 'UAE' },

    amount:       { type: Number, required: true, min: 0 },
    chequeDate:   { type: Date, required: true, index: true }, // day the cheque is due to be collected
    chequeNumber: { type: String, default: '', trim: true },
    bank:         { type: String, default: '', trim: true },
    notes:        { type: String, default: '', trim: true },

    status: { type: String, enum: CHEQUE_STATUSES, default: 'Pending', index: true },

    // Owner is notified (with company admins) on the collection date —
    // defaults to whoever added the cheque.
    owner:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ownerName: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Stamped with chequeDate's day-start once a reminder has been sent for
    // it, so the scheduler fires exactly once per collection date — mirrors
    // Lead.followUpRemindedFor.
    reminderSentFor: { type: Date, default: null },
  },
  { timestamps: true }
);

chequeSchema.index({ company: 1, chequeDate: 1 });

chequeSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    lead: this.lead || null,
    customer: this.customer,
    mobile: this.mobile,
    country: this.country,
    amount: this.amount,
    chequeDate: this.chequeDate,
    chequeNumber: this.chequeNumber,
    bank: this.bank,
    notes: this.notes,
    status: this.status,
    owner: this.owner,
    ownerName: this.ownerName,
    createdAt: this.createdAt,
  };
};

export { CHEQUE_STATUSES };
export const Cheque = mongoose.model('Cheque', chequeSchema);