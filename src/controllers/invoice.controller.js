import { runTransactional } from '../utils/withTransaction.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Invoice } from '../models/Invoice.js';
import { Order } from '../models/Order.js';
import { Company } from '../models/Company.js';
import { Counter } from '../models/Counter.js';
import { generateInvoicePdf } from '../utils/invoicePdf.js';
import { uploadPdfToCloudinary, deletePdfFromCloudinary } from '../utils/cloudinary.js';
import { tenantScope, tenantCompanyId } from '../middleware/auth.js';

const scopeFor = (req) => {
  const t = tenantScope(req);
  return req.user.role === 'sales' ? { ...t, createdBy: req.user._id } : t;
};

// Load the tenant company (with branding + currency) for an invoice. The
// branding/currency fields drive the PDF's header, tax label and amounts so
// every company's invoice prints its own details.
async function companyForInvoice(inv) {
  if (!inv?.company) return null;
  return Company.findById(inv.company).lean();
}

// Internal helper: generate PDF, upload to Cloudinary, update invoice doc.
// `company` is the tenant company (loaded by the caller); when omitted it is
// fetched from the invoice so the PDF is always company-specific.
async function attachPdf(inv, company = undefined) {
  try {
    const comp = company !== undefined ? company : await companyForInvoice(inv);
    const buffer = await generateInvoicePdf(inv.toObject ? inv.toObject() : inv, comp);
    const publicId = `invoices/INV-${inv.invoiceNo}`;
    // Remove old file if it exists
    if (inv.pdfPublicId) await deletePdfFromCloudinary(inv.pdfPublicId);
    const { url, publicId: storedId } = await uploadPdfToCloudinary(buffer, publicId);
    inv.pdfUrl = url;
    inv.pdfPublicId = storedId;
    await inv.save();
  } catch (err) {
    console.error('[invoice] PDF generation/upload failed:', err.message);
    // Non-fatal — invoice is still created/updated; PDF can be regenerated
  }
}

export const listInvoices = asyncHandler(async (req, res) => {
  const { search, paymentStatus } = req.query;
  const q = { ...scopeFor(req) };
  if (paymentStatus) q.paymentStatus = paymentStatus;
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ customer: rx }];
    if (/^\d+$/.test(search)) q.$or.push({ invoiceNo: Number(search) }, { orderNo: Number(search) });
  }
  const invoices = await Invoice.find(q).sort({ createdAt: -1 }).limit(500);
  res.json({ success: true, invoices });
});

export const getInvoice = asyncHandler(async (req, res) => {
  const inv = await Invoice.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!inv) throw new ApiError(404, 'Invoice not found');
  res.json({ success: true, invoice: inv });
});

// GET /invoices/:id/pdf  → redirect to Cloudinary URL or stream freshly generated PDF
export const getInvoicePdf = asyncHandler(async (req, res) => {
  const inv = await Invoice.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!inv) throw new ApiError(404, 'Invoice not found');

  // If we have a stored URL, redirect there
  if (inv.pdfUrl) return res.redirect(302, inv.pdfUrl);

  // Otherwise generate on the fly and stream
  const company = await companyForInvoice(inv);
  const buffer = await generateInvoicePdf(inv.toObject(), company);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="INV-${inv.invoiceNo}.pdf"`,
    'Content-Length': buffer.length,
  });
  res.send(buffer);
});

// POST /invoices/:id/pdf/regenerate  → force regenerate & re-upload
export const regenerateInvoicePdf = asyncHandler(async (req, res) => {
  const inv = await Invoice.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!inv) throw new ApiError(404, 'Invoice not found');
  await attachPdf(inv);
  res.json({ success: true, pdfUrl: inv.pdfUrl });
});

// Convert an order to an invoice (transaction: create invoice + flip order status)
export const convertOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.invoiceId) throw new ApiError(409, 'Order already invoiced');
  if (req.user.role === 'sales' && String(order.salesperson) !== String(req.user._id)) {
    throw new ApiError(403, 'Not your order');
  }

  const invoice = await runTransactional(async (session) => {
    const opts = session ? { session } : {};
    const companyId = tenantCompanyId(req);
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
      createdBy: req.user._id,
    }], opts);
    created.recalc();
    await created.save(opts);

    order.status = 'Invoiced';
    order.invoiceId = created._id;
    order.statusHistory.push({ status: 'Invoiced', note: `Invoice #${invoiceNo} generated`, by: req.user._id, byName: req.user.name });
    await order.save(opts);
    return created;
  });

  // Generate PDF & upload to Cloudinary (non-blocking for the response)
  attachPdf(invoice).catch(() => {});

  res.status(201).json({ success: true, invoice });
});

export const updateInvoiceItems = asyncHandler(async (req, res) => {
  const inv = await Invoice.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!inv) throw new ApiError(404, 'Invoice not found');
  inv.items = req.body.items;
  inv.updatedBy = req.user._id;
  inv.recalc();
  await inv.save();

  // Regenerate PDF in the background
  attachPdf(inv).catch(() => {});

  res.json({ success: true, invoice: inv });
});

export const setPaymentStatus = asyncHandler(async (req, res) => {
  const inv = await Invoice.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!inv) throw new ApiError(404, 'Invoice not found');
  inv.paymentStatus = req.body.paymentStatus;
  inv.updatedBy = req.user._id;
  await inv.save();
  res.json({ success: true, invoice: inv });
});

export const deleteInvoice = asyncHandler(async (req, res) => {
  const inv = await Invoice.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!inv) throw new ApiError(404, 'Invoice not found');

  // Remove Cloudinary PDF
  if (inv.pdfPublicId) deletePdfFromCloudinary(inv.pdfPublicId).catch(() => {});

  await runTransactional(async (session) => {
    const opts = session ? { session } : {};
    const order = await Order.findOne({ _id: inv.order, company: inv.company }).session(session || null);
    if (order) {
      order.status = 'Confirmed';
      order.invoiceId = null;
      order.statusHistory.push({ status: 'Confirmed', note: `Invoice #${inv.invoiceNo} deleted`, by: req.user._id, byName: req.user.name });
      await order.save(opts);
    }
    await inv.deleteOne(opts);
  });
  res.json({ success: true, message: 'Invoice deleted, order reverted to Confirmed' });
});