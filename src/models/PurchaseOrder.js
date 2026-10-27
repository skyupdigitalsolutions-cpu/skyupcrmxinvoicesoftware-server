// models/PurchaseOrder.js
import mongoose from 'mongoose';

const poItemSchema = new mongoose.Schema({
  modelCode:   { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  size:        { type: String, trim: true, default: '' },
  qty:         { type: Number, required: true, min: 0, default: 1 },
  price:       { type: Number, required: true, min: 0, default: 0 },
}, { _id: false });

export const PO_STATUSES = ['Draft', 'Ordered', 'Received', 'Cancelled'];
export const PO_PAY_STATUSES = ['Unpaid', 'Partial', 'Paid'];

const purchaseOrderSchema = new mongoose.Schema({
  company:       { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  poNo:          { type: Number, required: true, index: true },
  date:          { type: Date, required: true, default: Date.now },

  // Supplier details
  supplierName:    { type: String, required: true, trim: true },
  supplierContact: { type: String, trim: true, default: '' },
  city:            { type: String, trim: true, default: '' },
  country:         { type: String, trim: true, default: 'UAE' },

  // Payment
  paymentStatus: { type: String, enum: PO_PAY_STATUSES, default: 'Unpaid', index: true },
  status:        { type: String, enum: PO_STATUSES,     default: 'Draft',   index: true },

  // Items
  items:      { type: [poItemSchema], default: [] },
  subTotal:   { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },

  notes:     { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

purchaseOrderSchema.index({ company: 1, poNo: 1 }, { unique: true });

purchaseOrderSchema.methods.recalc = function () {
  const sub = this.items.reduce((s, it) => s + (it.qty || 0) * (it.price || 0), 0);
  this.subTotal  = Number(sub.toFixed(2));
  this.grandTotal = Number(sub.toFixed(2));
};

export const PurchaseOrder = mongoose.model('PurchaseOrder', purchaseOrderSchema);
