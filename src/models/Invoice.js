import mongoose from 'mongoose';

const VAT_RATE = 0.05;

const invoiceItemSchema = new mongoose.Schema(
  {
    modelCode: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    unit: { type: String, default: 'PAIR' },
    brand: { type: String, default: '' },
    qty: { type: Number, required: true, min: 0, default: 1 },
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

invoiceSchema.methods.recalc = function () {
  const sub = this.items.reduce((s, it) => s + it.qty * it.price, 0);
  this.subTotal = Number(sub.toFixed(2));
  this.vatAmt = Number((sub * VAT_RATE).toFixed(2));
  this.total = Number((sub + this.vatAmt).toFixed(2));
};

export { VAT_RATE };
invoiceSchema.index({ company: 1, invoiceNo: 1 }, { unique: true });

export const Invoice = mongoose.model('Invoice', invoiceSchema);