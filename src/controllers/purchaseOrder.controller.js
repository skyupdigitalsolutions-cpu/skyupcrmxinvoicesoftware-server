// controllers/purchaseOrder.controller.js
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError }      from '../utils/ApiError.js';
import { PurchaseOrder, PO_STATUSES, PO_PAY_STATUSES } from '../models/PurchaseOrder.js';
import { Counter }       from '../models/Counter.js';
import { tenantScope, tenantCompanyId } from '../middleware/auth.js';

// ── List ─────────────────────────────────────────────────────────────────────
export const listPurchaseOrders = asyncHandler(async (req, res) => {
  const { search, status, paymentStatus, from, to } = req.query;
  const q = { ...tenantScope(req) };

  if (status)        q.status = status;
  if (paymentStatus) q.paymentStatus = paymentStatus;
  if (from || to) {
    q.date = {};
    if (from) q.date.$gte = new Date(from);
    if (to)   { const d = new Date(to); d.setHours(23,59,59,999); q.date.$lte = d; }
  }
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ supplierName: rx }, { supplierContact: rx }];
    if (/^\d+$/.test(search)) q.$or.push({ poNo: Number(search) });
  }

  const pos = await PurchaseOrder.find(q).sort({ createdAt: -1 }).lean();
  res.json({ success: true, purchaseOrders: pos });
});

// ── Get single ───────────────────────────────────────────────────────────────
export const getPurchaseOrder = asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!po) throw new ApiError(404, 'Purchase order not found');
  res.json({ success: true, purchaseOrder: po });
});

// ── Create ───────────────────────────────────────────────────────────────────
export const createPurchaseOrder = asyncHandler(async (req, res) => {
  const { supplierName, supplierContact, city, country, paymentStatus, items, notes } = req.body;
  if (!supplierName || !String(supplierName).trim()) throw new ApiError(400, 'Supplier name is required');
  if (!Array.isArray(items) || !items.length)        throw new ApiError(400, 'At least one item is required');

  const companyId = tenantCompanyId(req);
  const poNo      = await Counter.next(`poNo:${companyId}`);

  const po = new PurchaseOrder({
    company:         companyId,
    poNo,
    supplierName:    String(supplierName).trim(),
    supplierContact: supplierContact || '',
    city:            city || '',
    country:         country || 'UAE',
    paymentStatus:   PO_PAY_STATUSES.includes(paymentStatus) ? paymentStatus : 'Unpaid',
    status:          'Draft',
    items,
    notes:           notes || '',
    createdBy:       req.user._id,
  });
  po.recalc();
  await po.save();
  res.status(201).json({ success: true, purchaseOrder: po });
});

// ── Update ───────────────────────────────────────────────────────────────────
export const updatePurchaseOrder = asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!po) throw new ApiError(404, 'Purchase order not found');
  if (po.status === 'Cancelled') throw new ApiError(400, 'Cannot edit a cancelled purchase order');

  const fields = ['supplierName', 'supplierContact', 'city', 'country', 'paymentStatus', 'items', 'notes', 'date'];
  fields.forEach((f) => { if (req.body[f] !== undefined) po[f] = req.body[f]; });
  po.recalc();
  await po.save();
  res.json({ success: true, purchaseOrder: po });
});

// ── Set status ────────────────────────────────────────────────────────────────
export const setPurchaseOrderStatus = asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!po) throw new ApiError(404, 'Purchase order not found');

  const { status } = req.body;
  if (!PO_STATUSES.includes(status)) throw new ApiError(400, `Invalid status: ${status}`);
  po.status = status;
  await po.save();
  res.json({ success: true, purchaseOrder: po });
});

// ── Set payment status ────────────────────────────────────────────────────────
export const setPurchaseOrderPayment = asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!po) throw new ApiError(404, 'Purchase order not found');

  const { paymentStatus } = req.body;
  if (!PO_PAY_STATUSES.includes(paymentStatus)) throw new ApiError(400, `Invalid payment status: ${paymentStatus}`);
  po.paymentStatus = paymentStatus;
  await po.save();
  res.json({ success: true, purchaseOrder: po });
});

// ── Delete ────────────────────────────────────────────────────────────────────
export const deletePurchaseOrder = asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!po) throw new ApiError(404, 'Purchase order not found');
  await po.deleteOne();
  res.json({ success: true, message: 'Purchase order deleted' });
});
