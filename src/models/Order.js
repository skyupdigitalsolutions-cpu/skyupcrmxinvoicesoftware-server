import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema(
  {
    modelCode: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    unit: { type: String, default: 'PAIR' },
    brand: { type: String, trim: true, default: '' },
    qty: { type: Number, required: true, min: 0, default: 1 },
    price: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: String,
    note: { type: String, default: '' },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ORDER_STATUSES = ['Pending', 'Confirmed', 'Packed', 'Market Delay', 'Shipped', 'Out for Delivery', 'Delivered', 'Invoiced', 'Cancelled'];

const orderSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    orderNo: { type: Number, required: true, index: true },
    date: { type: Date, required: true, default: Date.now },
    customer: { type: String, required: true, trim: true },
    city: { type: String, trim: true, default: '' },
    country: { type: String, default: 'UAE', index: true },
    mobile: { type: String, default: '' },
    delivery: { type: String, default: '' },
    payTerms: { type: String, default: 'CASH TRANSFER' },
    salesperson: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    salespersonName: { type: String, default: '' },
    items: { type: [orderItemSchema], default: [] },
    discount: { type: Number, min: 0, default: 0 },
    due: { type: Number, min: 0, default: 0 },
    subTotal: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    status: { type: String, enum: ORDER_STATUSES, default: 'Pending', index: true },
    statusHistory: { type: [statusHistorySchema], default: [] },
    notes: { type: String, default: '' },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Order numbers are unique PER COMPANY (each tenant has its own sequence).
orderSchema.index({ company: 1, orderNo: 1 }, { unique: true });

orderSchema.methods.recalc = function () {
  this.subTotal = this.items.reduce((s, it) => s + it.qty * it.price, 0);
  this.grandTotal = Math.max(0, this.subTotal - (this.discount || 0));
  this.subTotal = Number(this.subTotal.toFixed(2));
  this.grandTotal = Number(this.grandTotal.toFixed(2));
};

export { ORDER_STATUSES };
export const Order = mongoose.model('Order', orderSchema);