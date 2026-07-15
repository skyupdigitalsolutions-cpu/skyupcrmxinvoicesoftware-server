import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
    modelCode: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    size: { type: String, trim: true, default: '' },
    unit: { type: String, default: 'PAIR' },
    qty: { type: Number, required: true, min: 0, default: 1 },
    pieces: { type: Number, min: 0, default: 0 },
    price: { type: Number, required: true, min: 0, default: 0 },
}, { _id: false });

const statusHistorySchema = new mongoose.Schema({
    status: String,
    note: { type: String, default: '' },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    at: { type: Date, default: Date.now },
}, { _id: false });

const ORDER_STATUSES = ['Pending', 'Confirmed', 'Packed', 'Market Delay', 'Shipped', 'Out for Delivery', 'Delivered', 'Invoiced', 'Cancelled'];

// Every stage that remains updatable even after an order has been invoiced
// (order.status stays 'Invoiced'; these are tracked separately in
// `deliveryStatus` so the Delivery Tracker keeps working post-invoice).
// Excludes 'Invoiced' (that's the order's own status) and 'Cancelled' (an
// invoiced order shouldn't be marked cancelled from the tracker).
const DELIVERY_STATUSES = ['Pending', 'Confirmed', 'Market Delay', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered'];

const orderSchema = new mongoose.Schema({
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    orderNo: { type: Number, required: true, index: true },
    date: { type: Date, required: true, default: Date.now },
    customer: { type: String, required: true, trim: true },
    city: { type: String, trim: true, default: '' },
    country: { type: String, default: 'UAE', index: true },
    mobile: { type: String, default: '' },
    delivery: { type: String, default: '' },
    // Delivery contact number — entered MANUALLY on the order form (never
    // auto-filled from the customer's mobile). Free text so it can carry its
    // own country code, a transporter's number, etc.
    deliveryContact: { type: String, default: '', trim: true },
    payTerms: { type: String, default: 'Cash on Delivery' },
    salesperson: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    salespersonName: { type: String, default: '' },
    items: { type: [orderItemSchema], default: [] },
    discount: { type: Number, min: 0, default: 0 },
    due: { type: Number, min: 0, default: 0 },
    subTotal: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    status: { type: String, enum: ORDER_STATUSES, default: 'Pending', index: true },
    // Once an order is Invoiced, `status` stays 'Invoiced' (so edit/delete/
    // re-invoice guards keep working). Delivery progress after that point is
    // tracked separately here, so the Delivery Tracker stays updatable.
    deliveryStatus: { type: String, enum: ['', ...DELIVERY_STATUSES], default: '' },
    statusHistory: { type: [statusHistorySchema], default: [] },
    notes: { type: String, default: '' },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Order numbers are unique PER COMPANY (each tenant has its own sequence).
orderSchema.index({ company: 1, orderNo: 1 }, { unique: true });

orderSchema.methods.recalc = function() {
    const sub = this.items.reduce((s, it) => s + it.qty * it.price, 0);
    // `discount` is a PERCENT (0–100), matching the order form and print/preview.
    const pct = Math.min(100, Math.max(0, Number(this.discount) || 0));
    this.subTotal = Number(sub.toFixed(2));
    this.grandTotal = Number(Math.max(0, sub * (1 - pct / 100)).toFixed(2));
};

export { ORDER_STATUSES, DELIVERY_STATUSES };
export const Order = mongoose.model('Order', orderSchema);