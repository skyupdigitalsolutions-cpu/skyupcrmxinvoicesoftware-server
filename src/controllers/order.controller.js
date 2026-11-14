import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Order, DELIVERY_STATUSES } from '../models/Order.js';
import { normalizePhone } from '../models/Lead.js';
import { phoneSearchCandidates } from '../utils/phone.js';
import { User } from '../models/User.js';
import { Counter } from '../models/Counter.js';
import { tenantScope, tenantCompanyId } from '../middleware/auth.js';
import { ensureBuyerForOrder, revokeBuyerForCancelledOrder } from '../utils/orderBuyer.js';
import { planTallyChange, saveWithTally } from '../utils/tallySync.js';

// Scope = company (tenant) + role. Sales see only their own orders; admins see
// their whole company; developer sees all (or one company via ?company=).
const scopeFor = (req) => {
    const t = tenantScope(req);
    if (req.user.role === 'sales') return {...t, salesperson: req.user._id };
    return t;
};

// Read scope: EVERY authenticated user in the tenant can view all orders and
// update delivery progress on them — regardless of who the salesperson is.
// Only full edits (updateOrder) and deletes stay restricted to the sales
// user's own orders via scopeFor() above.
const readScopeFor = (req) => tenantScope(req);

export const listOrders = asyncHandler(async(req, res) => {
    const { search, status, country, salesperson, from, to } = req.query;
    const q = {...readScopeFor(req) };

    if (status) q.status = status;
    if (country) q.country = country;
    if (salesperson && req.user.role === 'admin') q.salesperson = salesperson;
    if (from || to) {
        q.date = {};
        if (from) q.date.$gte = new Date(from);
        if (to) {
            const d = new Date(to);
            d.setHours(23, 59, 59, 999);
            q.date.$lte = d;
        }
    }
    if (search) {
        const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        q.$or = [{ customer: rx }, { city: rx }];
        if (/^\d+$/.test(search)) q.$or.push({ orderNo: Number(search) });
        // Phone-aware search: Order has no normalised mobileKey, so match
        // the free-text mobile field tolerant of country code, leading
        // zero, and punctuation differences.
        const phone = phoneSearchCandidates(search);
        if (phone) phone.rawFieldRegexes.forEach((r) => q.$or.push({ mobile: r }));
    }

    const orders = await Order.find(q)
        .select('orderNo date customer mobile country city salesperson salespersonName status delivery deliveryStatus deliveryContact payTerms subTotal discount grandTotal due notes statusHistory items invoiceId createdAt updatedAt')
        .sort({ createdAt: -1 })
        .lean();
    res.json({ success: true, orders });
});

export const getOrder = asyncHandler(async(req, res) => {
    const order = await Order.findOne({ _id: req.params.id, ...readScopeFor(req) });
    if (!order) throw new ApiError(404, 'Order not found');
    res.json({ success: true, order });
});

// ── Customer lookup (read-only) ──────────────────────────────────────────────
// While creating an order, fetch a customer's saved delivery details from their
// most recent existing order in this company. Matches by normalised mobile
// first (most reliable), then falls back to an exact-ish name match. Company-
// scoped so one tenant never reads another's customer records.
export const customerLookup = asyncHandler(async(req, res) => {
    const name = (req.query.name || '').trim();
    const mobile = (req.query.mobile || '').trim();
    const country = req.query.country || 'UAE';

    if (!name && !mobile) return res.json({ success: true, found: false });

    const scope = tenantScope(req);
    let order = null;

    // 1) Match by phone number (normalised, matching the Lead dedup logic).
    if (mobile) {
        const key = normalizePhone(mobile, country);
        if (key && key.replace(/\D/g, '').length >= 5) {
            order = await Order.findOne({...scope, mobile: { $regex: mobile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })
                .sort({ createdAt: -1 })
                .lean();
        }
    }

    // 2) Fall back to a case-insensitive customer-name match.
    if (!order && name) {
        const rx = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        order = await Order.findOne({...scope, customer: rx })
            .sort({ createdAt: -1 })
            .lean();
    }

    if (!order) return res.json({ success: true, found: false });

    res.json({
        success: true,
        found: true,
        customer: {
            customer: order.customer || '',
            mobile: order.mobile || '',
            city: order.city || '',
            country: order.country || 'UAE',
            delivery: order.delivery || '',
            payTerms: order.payTerms || '',
        },
    });
});

export const createOrder = asyncHandler(async(req, res) => {
    const body = req.body;
    const companyId = tenantCompanyId(req);
    const orderNo = await Counter.next(`orderNo:${companyId}`);

    let spId = body.salesperson;
    let spName = '';
    if (req.user.role === 'sales') {
        spId = req.user._id;
        spName = req.user.name;
    } else if (spId) {
        // Salesperson must belong to this company — never assign across tenants.
        const sp = await User.findOne({ _id: spId, company: companyId });
        if (!sp) {
            spId = req.user._id;
            spName = req.user.name;
        } else spName = sp.name;
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

    // The customer becomes a Buyer as soon as the order exists — done here on the
    // server so it no longer depends on the browser's follow-up calls (lead lookup /
    // lead creation / mark-buyer) succeeding. If the customer has no lead yet, one is created.
    // Non-fatal: the order is already saved.
    try {
        await ensureBuyerForOrder(order, { byUser: req.user });
    } catch (err) {
        console.error(`[order] #${order.orderNo}: could not mark lead as Buyer:`, err.message);
    }

    res.status(201).json({ success: true, order });
});

export const updateOrder = asyncHandler(async(req, res) => {
    const order = await Order.findOne({ _id: req.params.id, ...scopeFor(req) });
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.status === 'Invoiced') throw new ApiError(400, 'Invoiced orders cannot be edited');

    const fields = ['date', 'customer', 'city', 'country', 'mobile', 'delivery', 'deliveryContact', 'payTerms', 'items', 'discount', 'due', 'notes'];
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
    // Linked to Tally? Validate the change for Tally first, then queue it after saving.
    const tallyArgs = { company: order.company, sourceType: 'SALES_ORDER', sourceId: order._id, action: 'edit', docAfter: order, user: req.user };
    const tally = await planTallyChange(tallyArgs);
    await saveWithTally({ plan: tally, replan: () => planTallyChange(tallyArgs), save: () => order.save() });
    res.json({ success: true, order, ...(tally.summary ? { tally: tally.summary } : {}) });
});

// Tenant-wide: any authenticated user can update an order's status/delivery
// stage (this is the Delivery Tracker action), not just the owning salesperson.
export const updateStatus = asyncHandler(async(req, res) => {
    const order = await Order.findOne({ _id: req.params.id, ...readScopeFor(req) });
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

    const wasCancelled = order.status === 'Cancelled';
    order.status = req.body.status;
    order.statusHistory.push({
        status: req.body.status,
        note: req.body.note || '',
        by: req.user._id,
        byName: req.user.name,
    });
    // Cancel / un-cancel of an order linked to Tally is sent to Tally; other
    // stage changes don't touch Tally (the planner returns a no-op).
    const tallyArgs = { company: order.company, sourceType: 'SALES_ORDER', sourceId: order._id, action: 'status', docAfter: order, user: req.user };
    const tally = await planTallyChange(tallyArgs);
    await saveWithTally({ plan: tally, replan: () => planTallyChange(tallyArgs), save: () => order.save() });

    // Keep the customer's Buyer status in step with the order. Revenue needs no
    // update here: every report skips Cancelled orders when summing grandTotal.
    // Non-fatal: the status change is already saved.
    const isCancelled = order.status === 'Cancelled';
    try {
        if (isCancelled && !wasCancelled) await revokeBuyerForCancelledOrder(order, { byUser: req.user });
        else if (!isCancelled && wasCancelled) await ensureBuyerForOrder(order, { byUser: req.user });
    } catch (err) {
        console.error(`[order] #${order.orderNo}: could not update Buyer after status change:`, err.message);
    }

    res.json({ success: true, order });
});

export const deleteOrder = asyncHandler(async(req, res) => {
    const order = await Order.findOne({ _id: req.params.id, ...scopeFor(req) });
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.status === 'Invoiced') throw new ApiError(400, 'Delete the invoice first');
    const wasLive = order.status !== 'Cancelled';
    const tallyArgs = { company: order.company, sourceType: 'SALES_ORDER', sourceId: order._id, action: 'delete', docAfter: null, user: req.user };
    const tally = await planTallyChange(tallyArgs);
    await saveWithTally({ plan: tally, replan: () => planTallyChange(tallyArgs), save: () => order.deleteOne() });
    // A deleted order is no longer a purchase either — same Buyer clean-up as cancelling.
    if (wasLive) {
        try { await revokeBuyerForCancelledOrder(order, { byUser: req.user }); }
        catch (err) { console.error(`[order] #${order.orderNo}: could not update Buyer after delete:`, err.message); }
    }
    res.json({ success: true, message: 'Order deleted' });
});