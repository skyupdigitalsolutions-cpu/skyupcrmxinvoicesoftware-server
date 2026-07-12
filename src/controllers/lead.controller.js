import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Lead, normalizePhone } from '../models/Lead.js';
import { Counter } from '../models/Counter.js';
import { Order } from '../models/Order.js';
import { Company } from '../models/Company.js';
import { tenantScope, tenantCompanyId } from '../middleware/auth.js';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Scope for listing / mutating: company (tenant) + role. Sales see only their
 *  own leads; admins see their whole company; developer sees all/one company. */
const ownerScope = (req) => {
  const t = tenantScope(req);
  return req.user.role === 'sales' ? { ...t, owner: req.user._id } : t;
};

// ── Phone duplicate lookup (cross-employee, read-only) ────────────────────────
export const lookupByPhone = asyncHandler(async (req, res) => {
  const { mobile, country } = req.query;
  if (!mobile) return res.json({ success: true, exists: false });

  const key = normalizePhone(mobile, country || 'UAE');
  if (!key || key.replace(/\D/g, '').length < 5) {
    return res.json({ success: true, exists: false });
  }

  const lead = await Lead.findOne({ mobileKey: key, ...tenantScope(req) }).select(
    'name mobile country city status interest remark delivery callLogs notes owner ownerName converted orderNo createdAt'
  );

  if (!lead) return res.json({ success: true, exists: false });

  const ownedByMe = String(lead.owner) === String(req.user._id);
  return res.json({
    success: true,
    exists: true,
    ownedByMe,
    lead: {
      _id: lead._id,
      name: lead.name,
      mobile: lead.mobile,
      country: lead.country,
      city: lead.city,
      status: lead.status,
      interest: lead.interest,
      remark: lead.remark,
      delivery: lead.delivery,
      converted: lead.converted,
      orderNo: lead.orderNo,
      ownerName: lead.ownerName,
      callLogs: lead.callLogs,
      notes: lead.notes,
      createdAt: lead.createdAt,
    },
  });
});

// ── List all leads visible to the user ───────────────────────────────────────
export const listLeads = asyncHandler(async (req, res) => {
  const { search, status, source, converted } = req.query;
  const q = { ...ownerScope(req) };

  if (status)    q.status = status;
  if (source)    q.source = source;
  if (converted === 'yes') q.converted = true;
  if (converted === 'no')  q.converted = false;
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ name: rx }, { mobile: rx }, { email: rx }, { city: rx }];
  }

  const leads = await Lead.find(q).sort({ createdAt: -1 }).limit(500);
  res.json({ success: true, leads });
});

// ── Get single lead (owner OR any authenticated user — for cross-employee view) ──
export const getLead = asyncHandler(async (req, res) => {
  // Any authenticated employee may view a lead (to see the discussion)
  const lead = await Lead.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!lead) throw new ApiError(404, 'Lead not found');

  const isOwner   = String(lead.owner) === String(req.user._id);
  const canEdit   = isOwner || req.user.role === 'admin';
  const canContribute = true; // any employee can add calls/notes

  res.json({ success: true, lead, isOwner, canEdit, canContribute });
});

// ── Create lead (checks for duplicate phone) ──────────────────────────────────
export const createLead = asyncHandler(async (req, res) => {
  const { name, mobile, country = 'UAE', city, email, source, campaign, interest, remark, delivery, status, owner } = req.body;

  if (!name?.trim()) throw new ApiError(400, 'Lead name is required');

  // Duplicate phone guard
  if (mobile?.trim()) {
    const key = normalizePhone(mobile, country);
    if (key) {
      const existing = await Lead.findOne({ mobileKey: key, company: req.user.company });
      if (existing) {
        const ownedByMe = String(existing.owner) === String(req.user._id);
        return res.status(409).json({
          success: false,
          message: 'A lead with this phone number already exists.',
          details: {
            duplicate: true,
            leadId: existing._id,
            ownedByMe,
            ownerName: existing.ownerName,
          },
        });
      }
    }
  }

  // Resolve owner
  let ownerId   = req.user._id;
  let ownerName = req.user.name;
  if (req.user.role === 'admin' && owner) {
    const { User } = await import('../models/User.js');
    // Owner must belong to the SAME company — never assign across tenants.
    const u = await User.findOne({ _id: owner, company: tenantCompanyId(req) });
    if (u) { ownerId = u._id; ownerName = u.name; }
  }

  // Enforce the company's lead limit (0 = unlimited).
  const companyId = tenantCompanyId(req);
  const company = await Company.findById(companyId);
  if (!company) throw new ApiError(404, 'Company not found');
  const leadLimit = company.limits?.maxLeads ?? 0;
  if (leadLimit > 0) {
    const current = await Lead.countDocuments({ company: companyId });
    if (current >= leadLimit) {
      throw new ApiError(403, `Lead limit reached: this company allows a maximum of ${leadLimit} leads.`);
    }
  }

  const lead = await Lead.create({
    company: companyId,
    name, mobile, country, city, email, source, campaign, interest, remark, delivery,
    status: status || 'New',
    owner: ownerId,
    ownerName,
  });

  res.status(201).json({ success: true, lead });
});

// ── Update core fields (owner or admin only) ──────────────────────────────────
export const updateLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!lead) throw new ApiError(404, 'Lead not found');

  const isOwner = String(lead.owner) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin') {
    throw new ApiError(403, 'Only the lead owner or an admin can edit core details');
  }

  const fields = ['name', 'mobile', 'country', 'city', 'email', 'source', 'campaign', 'interest', 'remark', 'delivery', 'status', 'followUpAt'];
  fields.forEach((f) => { if (req.body[f] !== undefined) lead[f] = req.body[f]; });

  // Admin can re-assign owner
  if (req.user.role === 'admin' && req.body.owner) {
    const { User } = await import('../models/User.js');
    // Re-assignment is restricted to users within the same company.
    const u = await User.findOne({ _id: req.body.owner, company: lead.company });
    if (u) { lead.owner = u._id; lead.ownerName = u.name; }
  }

  await lead.save();
  res.json({ success: true, lead });
});

// ── Set status (owner or admin only) ─────────────────────────────────────────
export const setLeadStatus = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!lead) throw new ApiError(404, 'Lead not found');

  const isOwner = String(lead.owner) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin') {
    throw new ApiError(403, 'Only the owner or admin can change status');
  }

  lead.status = req.body.status;
  await lead.save();
  res.json({ success: true, lead });
});

// ── Log a call (any authenticated employee can contribute) ────────────────────
export const logCall = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!lead) throw new ApiError(404, 'Lead not found');
  if (!req.body.summary?.trim()) throw new ApiError(400, 'Call summary is required');

  lead.callLogs.push({
    summary: req.body.summary.trim(),
    by: req.user._id,
    byName: req.user.name,
  });
  await lead.save();
  res.json({ success: true, lead });
});

// ── Add a note (any authenticated employee can contribute) ────────────────────
export const addNote = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!lead) throw new ApiError(404, 'Lead not found');
  if (!req.body.text?.trim()) throw new ApiError(400, 'Note text is required');

  lead.notes.push({
    text: req.body.text.trim(),
    by: req.user._id,
    byName: req.user.name,
  });
  await lead.save();
  res.json({ success: true, lead });
});

// ── Convert lead → Order ──────────────────────────────────────────────────────
export const convertLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!lead) throw new ApiError(404, 'Lead not found');

  const isOwner = String(lead.owner) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin') {
    throw new ApiError(403, 'Only the owner or admin can convert a lead');
  }
  if (lead.converted) throw new ApiError(400, 'Lead is already converted');

  const { items = [], discount = 0 } = req.body;
  if (!items.length) throw new ApiError(400, 'At least one order item is required');

  const companyId = tenantCompanyId(req);
  const orderNo = await Counter.next(`orderNo:${companyId}`);

  const order = new Order({
    company: companyId,
    orderNo,
    customer: lead.name,
    mobile: lead.mobile,
    country: lead.country,
    city: lead.city,
    delivery: lead.delivery,
    items,
    discount,
    salesperson: lead.owner,
    salespersonName: lead.ownerName,
    createdBy: req.user._id,
    statusHistory: [{ status: 'Pending', note: `Converted from lead`, by: req.user._id, byName: req.user.name }],
  });
  order.recalc();
  await order.save();

  lead.converted = true;
  lead.orderNo   = orderNo;
  lead.status    = 'Won';
  await lead.save();

  res.json({ success: true, lead, order });
});

// ── Delete lead (admin only) ──────────────────────────────────────────────────
export const deleteLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, ...tenantScope(req) });
  if (!lead) throw new ApiError(404, 'Lead not found');
  await lead.deleteOne();
  res.json({ success: true, message: 'Lead deleted' });
});

