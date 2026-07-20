import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Cheque, CHEQUE_STATUSES } from '../models/Cheque.js';
import { tenantScope, tenantCompanyId } from '../middleware/auth.js';

// Tenant-wide read: any authenticated user in the company can view the
// cheque calendar (consistent with orders/invoices being viewable by all).
export const listCheques = asyncHandler(async (req, res) => {
    const { from, to, status } = req.query;
    const q = { ...tenantScope(req) };
    if (status && CHEQUE_STATUSES.includes(status)) q.status = status;
    if (from || to) {
        q.chequeDate = {};
        if (from) q.chequeDate.$gte = new Date(from);
        if (to) {
            const d = new Date(to);
            d.setHours(23, 59, 59, 999);
            q.chequeDate.$lte = d;
        }
    }
    const cheques = await Cheque.find(q).sort({ chequeDate: 1 }).limit(1000);
    res.json({ success: true, cheques: cheques.map((c) => c.toSafeJSON()) });
});

export const getCheque = asyncHandler(async (req, res) => {
    const cheque = await Cheque.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!cheque) throw new ApiError(404, 'Cheque not found');
    res.json({ success: true, cheque: cheque.toSafeJSON() });
});

export const createCheque = asyncHandler(async (req, res) => {
    const { lead, customer, mobile, country, amount, chequeDate, chequeNumber, bank, notes } = req.body;

    if (!customer || !String(customer).trim()) throw new ApiError(400, 'Customer name is required');
    if (!chequeDate) throw new ApiError(400, 'Cheque collection date is required');
    if (amount === undefined || amount === null || Number.isNaN(Number(amount)) || Number(amount) < 0) {
        throw new ApiError(400, 'A valid amount is required');
    }

    const companyId = tenantCompanyId(req);
    const cheque = await Cheque.create({
        company: companyId,
        lead: lead || null,
        customer: customer.trim(),
        mobile: mobile || '',
        country: country || 'UAE',
        amount: Number(amount),
        chequeDate,
        chequeNumber: chequeNumber || '',
        bank: bank || '',
        notes: notes || '',
        owner: req.user._id,
        ownerName: req.user.name,
        createdBy: req.user._id,
    });

    res.status(201).json({ success: true, cheque: cheque.toSafeJSON() });
});

export const updateCheque = asyncHandler(async (req, res) => {
    const cheque = await Cheque.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!cheque) throw new ApiError(404, 'Cheque not found');

    const fields = ['lead', 'customer', 'mobile', 'country', 'amount', 'chequeDate', 'chequeNumber', 'bank', 'notes'];
    fields.forEach((f) => { if (req.body[f] !== undefined) cheque[f] = req.body[f]; });

    // Rescheduling the date makes the reminder eligible again for the new
    // date (the scheduler compares reminderSentFor's day against the new
    // chequeDate's day, so no explicit reset is required — but clearing it
    // here makes that intent explicit and avoids any edge-case stale match).
    if (req.body.chequeDate !== undefined) cheque.reminderSentFor = null;

    await cheque.save();
    res.json({ success: true, cheque: cheque.toSafeJSON() });
});

export const setChequeStatus = asyncHandler(async (req, res) => {
    const cheque = await Cheque.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!cheque) throw new ApiError(404, 'Cheque not found');
    if (!CHEQUE_STATUSES.includes(req.body.status)) throw new ApiError(400, 'Invalid status');
    cheque.status = req.body.status;
    await cheque.save();
    res.json({ success: true, cheque: cheque.toSafeJSON() });
});

export const deleteCheque = asyncHandler(async (req, res) => {
    const cheque = await Cheque.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!cheque) throw new ApiError(404, 'Cheque not found');
    await cheque.deleteOne();
    res.json({ success: true, message: 'Cheque deleted' });
});