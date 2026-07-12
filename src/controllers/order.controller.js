import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Order, DELIVERY_STATUSES } from '../models/Order.js';
import { User } from '../models/User.js';
import { Counter } from '../models/Counter.js';
import { tenantScope, tenantCompanyId } from '../middleware/auth.js';

// Scope = company (tenant) + role. Sales see only their own orders; admins see
// their whole company; developer sees all (or one company via ?company=).
const scopeFor = (req) => {
    const t = tenantScope(req);
    if (req.user.role === 'sales') return {...t, salesperson: req.user._id };
    return t;
};

export const listOrders = asyncHandler(async(req, res) => {
    const { search, status, country, salesperson, from, to } = req.query;
    const q = {...scopeFor(req) };

    if (status) q.status = status;
    if (country) q.country = country;
    if (salesperson && req.user.role === 'admin') q.salesperson = salesperson;
    if (from || to) {
        q.date = {};
        if (from) q.date.$gte = new Date(from);
        if (to) { const d = new Date(to);
            d.setHours(23, 59, 59, 999);
            q.date.$lte = d; }
    }
    if (search) {
        const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        q.$or = [{ customer: rx }, { city: rx }];
        if (/^\d+$/.test(search)) q.$or.push({ orderNo: Number(search) });
    }

    const orders = await Order.find(q).sort({ createdAt: -1 }).limit(500);
    res.json({ success: true, orders });
});

export const getOrder = asyncHandler(async(req, res) => {
    const order = await Order.findOne({ _id: req.params.id, ...scopeFor(req) });
    if (!order) throw new ApiError(404, 'Order not found');
    res.json({ success: true, order });
});

export const createOrder = asyncHandler(async(req, res) => {
    const body = req.body;
    const companyId = tenantCompanyId(req);
    const orderNo = await Counter.next(`orderNo:${companyId}`);

    let spId = body.salesperson;
    let spName = '';
    if (req.user.role === 'sales') { spId = req.user._id;
        spName = req.user.name; } else if (spId) {
        // Salesperson must belong to this company — never assign across tenants.
        const sp = await User.findOne({ _id: spId, company: companyId });
        if (!sp) { spId = req.user._id;
            spName = req.user.name; } else spName = sp.name;
    }

    const order = new Order({
        ...body,
        company: companyId,
        orderNo,
        salesperson: spId || req.user._id,
        salespersonName: spName || req.user.name,
        createdBy: req.user._id,
        statusHistory: [{ status: body.status || 'Pending', note: 'Order created', by: req.user._id, byName: req.user.name }],
    });
    order.recalc();
    await order.save();
    res.status(201).json({ success: true, order });
});

export const updateOrder = asyncHandler(async(req, res) => {
    const order = await Order.findOne({ _id: req.params.id, ...scopeFor(req) });
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.status === 'Invoiced') throw new ApiError(400, 'Invoiced orders cannot be edited');

    const fields = ['date', 'customer', 'city', 'country', 'mobile', 'delivery', 'payTerms', 'items', 'discount', 'due', 'notes'];
    fields.forEach((f) => { if (req.body[f] !== undefined) order[f] = req.body[f]; });

    if (req.user.role === 'admin' && req.body.salesperson) {
        // Only allow reassigning to a salesperson in the same company.
        const sp = await User.findOne({ _id: req.body.salesperson, company: order.company });
        if (sp) {
            order.salesperson = sp._id;
            order.salespersonName = sp.name;
        }
    }
    order.recalc();
    await order.save();
    res.json({ success: true, order });
});

export const updateStatus = asyncHandler(async(req, res) => {
    const order = await Order.findOne({ _id: req.params.id, ...scopeFor(req) });
    if (!order) throw new ApiError(404, 'Order not found');

    if (order.status === 'Invoiced') {
        // Invoiced orders keep status: 'Invoiced' (edit/delete/re-invoice guards
        // depend on it), but delivery progress can still move forward — tracked
        // in `deliveryStatus` — so the Delivery Tracker stays usable post-invoice.
        if (!DELIVERY_STATUSES.includes(req.body.status)) {
            throw new ApiError(400, 'Invoiced orders can only have their delivery stage updated, not be reverted to Cancelled');
        }
        order.deliveryStatus = req.body.status;
        order.statusHistory.push({
            status: req.body.status,
            note: req.body.note || '',
            by: req.user._id,
            byName: req.user.name,
        });
        await order.save();
        return res.json({ success: true, order });
    }

    order.status = req.body.status;
    order.statusHistory.push({
        status: req.body.status,
        note: req.body.note || '',
        by: req.user._id,
        byName: req.user.name,
    });
    await order.save();
    res.json({ success: true, order });
});

export const deleteOrder = asyncHandler(async(req, res) => {
    const order = await Order.findOne({ _id: req.params.id, ...scopeFor(req) });
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.status === 'Invoiced') throw new ApiError(400, 'Delete the invoice first');
    await order.deleteOne();
    res.json({ success: true, message: 'Order deleted' });
});
