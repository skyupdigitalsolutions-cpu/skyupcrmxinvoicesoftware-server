import { runTransactional } from '../utils/withTransaction.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Invoice } from '../models/Invoice.js';
import { Order, DELIVERY_STATUSES } from '../models/Order.js';
import { Company } from '../models/Company.js';
import { Counter } from '../models/Counter.js';
import { generateInvoicePdf } from '../utils/invoicePdf.js';
import { uploadPdfToCloudinary, deletePdfFromCloudinary } from '../utils/cloudinary.js';
import { tenantScope, tenantCompanyId } from '../middleware/auth.js';

// Sales users only ever touch invoices they created; admin/developer see the
// whole tenant. Applied to reads AND mutations so a salesperson can neither
// view nor edit another employee's invoice by guessing its id.
const scopeFor = (req) => {
    const t = tenantScope(req);
    return req.user.role === 'sales' ? {...t, createdBy: req.user._id } : t;
};

// Load the tenant company (branding + currency + Cloudinary secret) for an
// invoice. apiSecret is select:false, so it must be requested explicitly or
// per-company Cloudinary uploads silently fall back to the platform account.
async function companyForInvoice(inv) {
    if (!inv || !inv.company) return null;
    return Company.findById(inv.company).select('+cloudinary.apiSecret').lean();
}

// The tax rate (percent) to apply to an invoice, from the company's branding.
const taxPercentFor = (company) => {
    const p = company && company.branding ? company.branding.taxPercent : undefined;
    return Number.isFinite(p) ? p : 5;
};

// Per-company Cloudinary credentials, or null to fall back to the platform
// (env-var) account. Mirrors the pattern used by uploadCompanyLogo.
const cloudCredsFor = (company) =>
    company && company.cloudinary && company.cloudinary.cloudName ? {
        cloudName: company.cloudinary.cloudName,
        apiKey: company.cloudinary.apiKey,
        apiSecret: company.cloudinary.apiSecret,
    } :
    null;

// Internal helper: generate PDF, upload to Cloudinary, update invoice doc.
// `company` is the tenant company (loaded by the caller); when omitted it is
// fetched from the invoice so the PDF is always company-specific.
//
// IMPORTANT: this throws on failure. Callers that want a non-blocking,
// best-effort attempt (e.g. right after creating/editing an invoice) must
// wrap the call in `.catch(...)` themselves — see convertOrder /
// updateInvoiceItems below. Callers that represent an explicit user action
// (e.g. the "Regenerate PDF" button) must let the error propagate so the
// client finds out the upload actually failed, instead of getting a false
// "success" response while the Cloudinary credentials are silently wrong.
async function attachPdf(inv, company = undefined) {
    const comp = company !== undefined ? company : await companyForInvoice(inv);
    const buffer = await generateInvoicePdf(inv.toObject ? inv.toObject() : inv, comp);

    // Invoice numbers are unique PER COMPANY, so a public id keyed only on the
    // number (e.g. "INV-1") collides across tenants — with overwrite:true one
    // company's PDF would clobber another's. Namespace by company id to keep
    // every tenant's files isolated.
    const publicId = `${inv.company}/INV-${inv.invoiceNo}.pdf`;
    const creds = cloudCredsFor(comp);

    // Remove old file if it exists
    if (inv.pdfPublicId) await deletePdfFromCloudinary(inv.pdfPublicId, creds);
    const { url, publicId: storedId } = await uploadPdfToCloudinary(buffer, publicId, creds);
    inv.pdfUrl = url;
    inv.pdfPublicId = storedId;
    await inv.save();
}

export const listInvoices = asyncHandler(async(req, res) => {
    const { search, paymentStatus } = req.query;
    const q = {...scopeFor(req) };
    if (paymentStatus) q.paymentStatus = paymentStatus;
    if (search) {
        const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        q.$or = [{ customer: rx }];
        if (/^\d+$/.test(search)) q.$or.push({ invoiceNo: Number(search) }, { orderNo: Number(search) });
    }
    const invoices = await Invoice.find(q).sort({ createdAt: -1 }).limit(500);
    res.json({ success: true, invoices });
});

export const getInvoice = asyncHandler(async(req, res) => {
    const inv = await Invoice.findOne({ _id: req.params.id, ...scopeFor(req) });
    if (!inv) throw new ApiError(404, 'Invoice not found');
    res.json({ success: true, invoice: inv });
});

// GET /invoices/:id/pdf  → stream a freshly generated PDF as a proper download.
// We stream from our own server (rather than redirecting to the Cloudinary raw
// URL) so the file always arrives as application/pdf with a real ".pdf"
// filename — the raw Cloudinary URL was serving an extension-less file that the
// browser saved as "INV-4" and refused to open as a PDF.
export const getInvoicePdf = asyncHandler(async(req, res) => {
    const inv = await Invoice.findOne({ _id: req.params.id, ...scopeFor(req) });
    if (!inv) throw new ApiError(404, 'Invoice not found');

    const company = await companyForInvoice(inv);
    const buffer = await generateInvoicePdf(inv.toObject(), company);
    res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="INV-${inv.invoiceNo}.pdf"`,
        'Content-Length': buffer.length,
    });
    res.send(buffer);
});

// POST /invoices/:id/pdf/regenerate  → force regenerate & re-upload
export const regenerateInvoicePdf = asyncHandler(async(req, res) => {
    const inv = await Invoice.findOne({ _id: req.params.id, ...scopeFor(req) });
    if (!inv) throw new ApiError(404, 'Invoice not found');
    try {
        await attachPdf(inv);
    } catch (err) {
        console.error(`[invoice] Regenerate PDF failed for invoice ${inv._id} (INV-${inv.invoiceNo}):`, err.message);
        throw new ApiError(502, `Could not save the PDF to Cloudinary: ${err.message}`);
    }
    res.json({ success: true, pdfUrl: inv.pdfUrl });
});

// Convert an order to an invoice (transaction: create invoice + flip order status)
export const convertOrder = asyncHandler(async(req, res) => {
    const order = await Order.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.status === 'Cancelled') throw new ApiError(400, 'Cannot invoice a cancelled order');
    if (req.user.role === 'sales' && String(order.salesperson) !== String(req.user._id)) {
        throw new ApiError(403, 'Not your order');
    }
    // An order may have more than one invoice (e.g. a re-issue with a different
    // payment status). We no longer block when order.invoiceId is already set;
    // each conversion mints a fresh invoice number linked to the same order.
    const isReInvoice = Boolean(order.invoiceId);

    const companyId = tenantCompanyId(req);
    // Load the tenant company once — used for the tax rate (so stored totals
    // match the PDF) and for the Cloudinary upload credentials.
    const company = await Company.findById(companyId).select('+cloudinary.apiSecret').lean();
    const taxPercent = taxPercentFor(company);

    const invoice = await runTransactional(async(session) => {
        const opts = session ? { session } : {};
        const invoiceNo = await Counter.next(`invoiceNo:${companyId}`);
        const [created] = await Invoice.create([{
            company: companyId,
            invoiceNo,
            date: new Date(),
            order: order._id,
            orderNo: order.orderNo,
            customer: order.customer,
            city: order.city,
            country: order.country,
            mobile: order.mobile,
            salespersonName: order.salespersonName,
            items: order.items,
            taxPercent,
            discount: order.discount || 0,
            createdBy: req.user._id,
        }], opts);
        created.recalc(taxPercent);
        await created.save(opts);

        // Carry the order's current delivery stage forward as `deliveryStatus`,
        // so the Delivery Tracker keeps showing real progress after invoicing
        // (and can keep being updated) instead of resetting.
        if (!order.deliveryStatus && DELIVERY_STATUSES.includes(order.status)) {
            order.deliveryStatus = order.status;
        }
        order.status = 'Invoiced';
        order.invoiceId = created._id; // latest invoice for quick reference
        order.statusHistory.push({
            status: 'Invoiced',
            note: isReInvoice ?
                `Additional invoice #${invoiceNo} generated` : `Invoice #${invoiceNo} generated`,
            by: req.user._id,
            byName: req.user.name,
        });
        await order.save(opts);
        return created;
    });

    // Generate PDF & upload to Cloudinary (non-blocking for the response)
    attachPdf(invoice, company).catch((err) =>
        console.error(`[invoice] Background PDF upload failed for invoice ${invoice._id} (INV-${invoice.invoiceNo}):`, err.message)
    );

    res.status(201).json({ success: true, invoice });
});

export const updateInvoiceItems = asyncHandler(async(req, res) => {
    const inv = await Invoice.findOne({ _id: req.params.id, ...scopeFor(req) });
    if (!inv) throw new ApiError(404, 'Invoice not found');
    inv.items = req.body.items;
    inv.updatedBy = req.user._id;

    const company = await companyForInvoice(inv);
    inv.recalc(taxPercentFor(company));
    await inv.save();

    // Regenerate PDF in the background (reuse the loaded company)
    attachPdf(inv, company).catch((err) =>
        console.error(`[invoice] Background PDF upload failed for invoice ${inv._id} (INV-${inv.invoiceNo}):`, err.message)
    );

    res.json({ success: true, invoice: inv });
});

export const setPaymentStatus = asyncHandler(async(req, res) => {
    const inv = await Invoice.findOne({ _id: req.params.id, ...scopeFor(req) });
    if (!inv) throw new ApiError(404, 'Invoice not found');
    inv.paymentStatus = req.body.paymentStatus;
    inv.updatedBy = req.user._id;
    await inv.save();
    res.json({ success: true, invoice: inv });
});

export const deleteInvoice = asyncHandler(async(req, res) => {
    const inv = await Invoice.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!inv) throw new ApiError(404, 'Invoice not found');

    // Remove Cloudinary PDF using the company's own credentials.
    if (inv.pdfPublicId) {
        const company = await companyForInvoice(inv);
        deletePdfFromCloudinary(inv.pdfPublicId, cloudCredsFor(company)).catch(() => {});
    }

    let orderReverted = false;
    await runTransactional(async(session) => {
        const opts = session ? { session } : {};
        await inv.deleteOne(opts);

        const order = await Order.findOne({ _id: inv.order, company: inv.company }).session(session || null);
        if (order) {
            // Any invoices still linked to this order after the delete?
            const remaining = await Invoice.find({ order: inv.order, company: inv.company })
                .sort({ createdAt: -1 })
                .session(session || null);

            if (remaining.length) {
                // Other invoices exist — stay Invoiced, just repoint to the newest.
                order.invoiceId = remaining[0]._id;
                order.statusHistory.push({
                    status: order.status,
                    note: `Invoice #${inv.invoiceNo} deleted (${remaining.length} invoice${remaining.length === 1 ? '' : 's'} remaining)`,
                    by: req.user._id,
                    byName: req.user.name,
                });
            } else {
                // Last invoice removed — revert the order so it can be worked again.
                order.status = order.deliveryStatus || 'Confirmed';
                order.deliveryStatus = '';
                order.invoiceId = null;
                order.statusHistory.push({
                    status: 'Confirmed',
                    note: `Invoice #${inv.invoiceNo} deleted`,
                    by: req.user._id,
                    byName: req.user.name,
                });
                orderReverted = true;
            }
            await order.save(opts);
        }
    });
    res.json({
        success: true,
        message: orderReverted ?
            'Invoice deleted, order reverted to Confirmed.' : 'Invoice deleted. The order still has other invoices.',
    });
});