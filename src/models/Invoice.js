import mongoose from 'mongoose';

// Fallback tax rate (fraction, not percent) used only when a company has not
// configured its own rate. The real rate comes from the tenant's
// company.branding.taxPercent and is passed into recalc() by the controller,
// so the stored subTotal/vatAmt/total always match what the PDF prints.
const VAT_RATE = 0.05;

const invoiceItemSchema = new mongoose.Schema(
  {
    modelCode: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    size: { type: String, default: '' },
    unit: { type: String, default: 'PAIR' },
    qty: { type: Number, required: true, min: 0, default: 1 },
    pieces: { type: Number, min: 0, default: 0 },
    price: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    invoiceNo: { type: Number, required: true, index: true },
    date: { type: Date, required: true, default: Date.now },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNo: { type: Number, required: true },
    customer: { type: String, required: true },
    city: { type: String, default: '' },
    country: { type: String, default: 'UAE' },
    mobile: { type: String, default: '' },
    salespersonName: { type: String, default: '' },
    paymentStatus: { type: String, enum: ['Unpaid', 'Partial', 'Paid'], default: 'Unpaid', index: true },
    items: { type: [invoiceItemSchema], default: [] },
    // Tax rate (as a percent, e.g. 5) actually applied to THIS invoice, captured
    // at creation time so a later change to the company's default rate never
    // silently rewrites historical invoices.
    taxPercent: { type: Number, default: 5, min: 0, max: 100 },
    // Order-level discount as a PERCENT (0–100), carried over from the source
    // order at conversion time. VAT is charged on the net (after discount).
    discount: { type: Number, default: 0, min: 0, max: 100 },
    discountAmt: { type: Number, default: 0 },
    subTotal: { type: Number, default: 0 },
    vatAmt: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    // Cloudinary PDF storage
    pdfUrl: { type: String, default: null },
    pdfPublicId: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Recompute the money fields.
//   taxPercent — the rate as a PERCENT (e.g. 5 for 5%). When omitted, the
//   invoice's own stored taxPercent is used; if that is missing too, the 5%
//   fallback applies. The controller passes company.branding.taxPercent here
//   so the stored total matches the figure printed on the PDF.
invoiceSchema.methods.recalc = function (taxPercent) {
  const pct = Number.isFinite(taxPercent)
    ? taxPercent
    : (Number.isFinite(this.taxPercent) ? this.taxPercent : VAT_RATE * 100);
  this.taxPercent = pct;
  const rate = pct / 100;
  const disc = Math.min(100, Math.max(0, Number(this.discount) || 0));
  const sub = this.items.reduce((s, it) => s + it.qty * it.price, 0);
  const discountAmt = sub * (disc / 100);
  const taxable = Math.max(0, sub - discountAmt);   // VAT is charged on the net
  this.subTotal = Number(sub.toFixed(2));           // gross (sum of line amounts)
  this.discountAmt = Number(discountAmt.toFixed(2));
  this.vatAmt = Number((taxable * rate).toFixed(2));
  this.total = Number((taxable + this.vatAmt).toFixed(2));
};

export { VAT_RATE };
invoiceSchema.index({ company: 1, invoiceNo: 1 }, { unique: true });

export const Invoice = mongoose.model('Invoice', invoiceSchema);