import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Company } from '../models/Company.js';
import { User } from '../models/User.js';
import { Lead } from '../models/Lead.js';
import { uploadImageToCloudinary } from '../utils/cloudinary.js';

// Whitelist + coerce branding fields so callers can't inject arbitrary keys.
const BRANDING_STR_FIELDS = [
  'headerName', 'headerTagline', 'logoUrl', 'receiptHeading', 'cardsHeading',
  'legalName', 'addressLine1', 'addressLine2', 'city', 'phone', 'email',
  'website', 'trn', 'taxLabel', 'footerNote', 'declaration',
];
const sanitizeBranding = (b = {}) => {
  const out = {};
  for (const k of BRANDING_STR_FIELDS) {
    if (b[k] !== undefined) out[k] = String(b[k]).trim();
  }
  if (b.taxPercent !== undefined) {
    out.taxPercent = Math.min(100, Math.max(0, Number(b.taxPercent) || 0));
  }
  return out;
};

const usageFor = async (companyId) => {
  const rows = await User.aggregate([
    { $match: { company: companyId, active: true } },
    { $group: { _id: '$role', n: { $sum: 1 } } },
  ]);
  const map = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const leads = await Lead.countDocuments({ company: companyId });
  return { admins: map.admin || 0, employees: map.sales || 0, leads };
};

// GET /companies — list with usage
export const listCompanies = asyncHandler(async (_req, res) => {
  const companies = await Company.find().sort({ createdAt: 1 });
  const withUsage = await Promise.all(
    companies.map(async (c) => ({ ...c.toSafeJSON(), usage: await usageFor(c._id) }))
  );
  res.json({ success: true, companies: withUsage });
});

// GET /companies/:id
export const getCompany = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id).select('+cloudinary.apiSecret +emailReport.brevoApiKey');
  if (!company) throw new ApiError(404, 'Company not found');
  const safe = company.toSafeJSON();
  res.json({ success: true, company: { ...safe, usage: await usageFor(company._id) } });
});

// POST /companies
export const createCompany = asyncHandler(async (req, res) => {
  const { name, slug, limits, subscription, contactEmail, notes, active, currency, branding, admin } = req.body;
  if (!name?.trim()) throw new ApiError(400, 'Company name is required');

  const cleanSlug = String(slug || name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!cleanSlug) throw new ApiError(400, 'A valid slug could not be derived; please provide one');

  const exists = await Company.findOne({ slug: cleanSlug });
  if (exists) throw new ApiError(409, `A company with slug "${cleanSlug}" already exists`);

  // If an admin is being created alongside the company, validate it up front so
  // we don't create a company and then fail (e.g. username already taken).
  const wantsAdmin = admin && (admin.name || admin.username || admin.password);
  if (wantsAdmin) {
    if (!admin.name?.trim() || !admin.username?.trim() || !admin.password) {
      throw new ApiError(400, 'Admin name, username and password are all required to create the admin.');
    }
    if (String(admin.password).length < 6) {
      throw new ApiError(400, 'Admin password must be at least 6 characters.');
    }
    const uExists = await User.findOne({ username: admin.username.toLowerCase().trim() });
    if (uExists) throw new ApiError(409, `Username "${admin.username.trim()}" is already taken.`);
  }

  const company = await Company.create({
    name: name.trim(),
    slug: cleanSlug,
    active: active !== false,
    limits: {
      maxAdmins:    Number(limits?.maxAdmins    ?? 1),
      maxEmployees: Number(limits?.maxEmployees ?? 5),
      maxLeads:     Number(limits?.maxLeads     ?? 0),
    },
    currency: {
      code:   currency?.code   || 'INR',
      symbol: currency?.symbol || '₹',
      locale: currency?.locale || 'en-IN',
    },
    branding: branding ? sanitizeBranding(branding) : undefined,
    subscription: subscription || undefined,
    contactEmail: contactEmail || '',
    notes: notes || '',
  });

  // Create the admin user. If it fails for any reason, roll back the company so
  // we never leave an orphaned company with no way in.
  let adminUser = null;
  if (wantsAdmin) {
    try {
      adminUser = await User.create({
        name: admin.name.trim(),
        username: admin.username.toLowerCase().trim(),
        password: admin.password,
        role: 'admin',
        company: company._id,
      });
    } catch (err) {
      await Company.deleteOne({ _id: company._id });
      if (err?.code === 11000) throw new ApiError(409, `Username "${admin.username.trim()}" is already taken.`);
      throw new ApiError(400, `Company admin could not be created: ${err.message}`);
    }
  }

  res.status(201).json({
    success: true,
    company: company.toSafeJSON(),
    admin: adminUser ? adminUser.toSafeJSON() : null,
  });
});

// PATCH /companies/:id — general fields
export const updateCompany = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id);
  if (!company) throw new ApiError(404, 'Company not found');

  const { name, limits, contactEmail, notes, active, subscription, currency, branding } = req.body;
  if (name         !== undefined) company.name         = String(name).trim();
  if (contactEmail !== undefined) company.contactEmail = contactEmail;
  if (notes        !== undefined) company.notes        = notes;
  if (active       !== undefined) company.active       = !!active;
  if (limits !== undefined) {
    if (limits.maxAdmins    !== undefined) company.limits.maxAdmins    = Math.max(0, Number(limits.maxAdmins));
    if (limits.maxEmployees !== undefined) company.limits.maxEmployees = Math.max(0, Number(limits.maxEmployees));
    if (limits.maxLeads     !== undefined) company.limits.maxLeads     = Math.max(0, Number(limits.maxLeads));
  }
  if (currency !== undefined) {
    if (currency.code   !== undefined) company.currency.code   = String(currency.code).toUpperCase().trim();
    if (currency.symbol !== undefined) company.currency.symbol = String(currency.symbol).trim();
    if (currency.locale !== undefined) company.currency.locale = String(currency.locale).trim();
  }
  if (subscription !== undefined) Object.assign(company.subscription, subscription);

  if (branding !== undefined) {
    if (!company.branding) company.branding = {};
    Object.assign(company.branding, sanitizeBranding(branding));
  }

  await company.save();
  res.json({ success: true, company: { ...company.toSafeJSON(), usage: await usageFor(company._id) } });
});

// PATCH /companies/:id/subscription — dedicated billing update
export const setSubscription = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id);
  if (!company) throw new ApiError(404, 'Company not found');

  const s = req.body || {};
  const sub = company.subscription;
  if (s.plan              !== undefined) sub.plan              = s.plan;
  if (s.status            !== undefined) sub.status            = s.status;
  if (s.monthlyFee        !== undefined) sub.monthlyFee        = Math.max(0, Number(s.monthlyFee) || 0);
  if (s.startDate         !== undefined) sub.startDate         = s.startDate         ? new Date(s.startDate)         : null;
  if (s.renewalDate       !== undefined) {
    const newDate = s.renewalDate ? new Date(s.renewalDate) : null;
    const changed = String(sub.renewalDate || '') !== String(newDate || '');
    sub.renewalDate = newDate;
    // New renewal date → allow a fresh "5 days to expiry" reminder for it.
    if (changed) sub.expiryReminderSentFor = null;
  }
  if (s.lastPaymentDate   !== undefined) sub.lastPaymentDate   = s.lastPaymentDate   ? new Date(s.lastPaymentDate)   : null;
  if (s.lastPaymentAmount !== undefined) sub.lastPaymentAmount = Math.max(0, Number(s.lastPaymentAmount) || 0);
  if (s.paymentMethod     !== undefined) sub.paymentMethod     = s.paymentMethod;
  if (s.paymentRef        !== undefined) sub.paymentRef        = s.paymentRef;

  await company.save();
  res.json({ success: true, company: company.toSafeJSON() });
});

// PATCH /companies/:id/cloudinary — save per-company Cloudinary credentials
export const setCloudinary = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id);
  if (!company) throw new ApiError(404, 'Company not found');

  const { cloudName, apiKey, apiSecret } = req.body || {};
  if (!company.cloudinary) company.cloudinary = {};
  if (cloudName !== undefined) company.cloudinary.cloudName = String(cloudName).trim();
  if (apiKey    !== undefined) company.cloudinary.apiKey    = String(apiKey).trim();
  if (apiSecret !== undefined) company.cloudinary.apiSecret = String(apiSecret).trim();

  await company.save();
  res.json({ success: true, cloudinary: { cloudName: company.cloudinary.cloudName, apiKey: company.cloudinary.apiKey } });
});

// PATCH /companies/:id/branding — per-company white-label / receipt settings
export const setBranding = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id);
  if (!company) throw new ApiError(404, 'Company not found');

  if (!company.branding) company.branding = {};
  Object.assign(company.branding, sanitizeBranding(req.body || {}));

  await company.save();
  res.json({ success: true, branding: company.toSafeJSON().branding });
});

// POST /companies/:id/logo — upload a logo image (base64 data URL) and store
// its Cloudinary URL in branding.logoUrl. Uses the company's own Cloudinary
// creds when configured, else the platform env credentials.
export const uploadCompanyLogo = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id).select('+cloudinary.apiSecret');
  if (!company) throw new ApiError(404, 'Company not found');

  const { image } = req.body || {};
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    throw new ApiError(400, 'A valid base64 image (data:image/...) is required.');
  }
  // Guard size (~2MB of base64 ≈ 1.5MB image).
  if (image.length > 3_000_000) throw new ApiError(413, 'Image too large. Please use an image under ~1.5MB.');

  const creds = company.cloudinary?.cloudName
    ? { cloudName: company.cloudinary.cloudName, apiKey: company.cloudinary.apiKey, apiSecret: company.cloudinary.apiSecret }
    : null;

  let result;
  try {
    result = await uploadImageToCloudinary(image, `logos/company-${company._id}`, creds);
  } catch (err) {
    throw new ApiError(502, `Logo upload failed: ${err.message}`);
  }

  if (!company.branding) company.branding = {};
  company.branding.logoUrl = result.url;
  await company.save();

  res.json({ success: true, logoUrl: result.url, branding: company.toSafeJSON().branding });
});
export const setEmailReport = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id);
  if (!company) throw new ApiError(404, 'Company not found');

  const { enabled, adminEmail, senderEmail, senderName, brevoApiKey, sendAt } = req.body || {};
  if (!company.emailReport) company.emailReport = {};
  if (enabled      !== undefined) company.emailReport.enabled      = !!enabled;
  if (adminEmail   !== undefined) company.emailReport.adminEmail   = String(adminEmail).trim().toLowerCase();
  if (senderEmail  !== undefined) company.emailReport.senderEmail  = String(senderEmail).trim().toLowerCase();
  if (senderName   !== undefined) company.emailReport.senderName   = String(senderName).trim();
  if (sendAt       !== undefined) company.emailReport.sendAt       = String(sendAt).trim();
  // Only overwrite the key if a non-empty value was submitted (blank = keep existing)
  if (brevoApiKey  !== undefined && String(brevoApiKey).trim() !== '') {
    company.emailReport.brevoApiKey = String(brevoApiKey).trim();
  }

  await company.save();
  res.json({ success: true, emailReport: company.toSafeJSON().emailReport });
});

// POST /companies/:id/email-report/verify — validate the Brevo API key lightly
// (calls GET /account on Brevo; no email is sent, no report is built)
export const verifyEmailReport = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id).select('+emailReport.brevoApiKey');
  if (!company) throw new ApiError(404, 'Company not found');

  const { verifyBrevoApiKey } = await import('../utils/sendEmail.js');

  // Caller may pass a new key in the body (not yet saved) so they can verify
  // before committing. If no key in body, fall back to the stored one.
  const keyToTest = String(req.body?.brevoApiKey || '').trim() || company.emailReport?.brevoApiKey;
  if (!keyToTest) throw new ApiError(400, 'No Brevo API key to verify. Save a key first or provide one in the request body.');

  const result = await verifyBrevoApiKey(keyToTest);
  if (!result.valid) throw new ApiError(502, result.error || 'Brevo API key is invalid.');
  res.json({ success: true, email: result.email, plan: result.plan });
});

// POST /companies/:id/email-report/test — send a test report email right now
export const testEmailReport = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id).select('+emailReport.brevoApiKey');
  if (!company) throw new ApiError(404, 'Company not found');

  if (!company.emailReport?.brevoApiKey) {
    throw new ApiError(400, 'Brevo API key must be configured before sending a test.');
  }
  if (!company.emailReport?.adminEmail) {
    throw new ApiError(400, 'Admin recipient email must be configured before sending a test.');
  }
  if (!company.emailReport?.senderEmail) {
    throw new ApiError(400, 'Sender email must be configured before sending a test.');
  }

  const { sendDailyReport } = await import('../utils/dailyReportEmail.js');
  await sendDailyReport(company, new Date());
  res.json({ success: true, message: `Test report sent to ${company.emailReport.adminEmail}` });
});

// POST /companies/:id/admin — provision a company's first admin
export const createCompanyAdmin = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id);
  if (!company) throw new ApiError(404, 'Company not found');

  const { name, username, password } = req.body;
  if (!name?.trim() || !username?.trim() || !password) {
    throw new ApiError(400, 'name, username and password are required');
  }
  const exists = await User.findOne({ username: username.toLowerCase() });
  if (exists) throw new ApiError(409, 'Username already taken');

  const limit = company.limits?.maxAdmins ?? 0;
  if (limit > 0) {
    const current = await User.countDocuments({ company: company._id, role: 'admin', active: true });
    if (current >= limit) throw new ApiError(403, `Limit reached: max ${limit} admin(s) for this company.`);
  }

  const user = await User.create({
    name: name.trim(), username: username.toLowerCase().trim(), password,
    role: 'admin', company: company._id,
  });
  res.status(201).json({ success: true, user: user.toSafeJSON() });
});

// DELETE /companies/:id — refuse if it still has users
export const deleteCompany = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id);
  if (!company) throw new ApiError(404, 'Company not found');
  const userCount = await User.countDocuments({ company: company._id });
  if (userCount > 0) {
    throw new ApiError(409, `Cannot delete: ${userCount} user(s) still belong to this company. Deactivate it instead.`);
  }
  await company.deleteOne();
  res.json({ success: true, deleted: true });
});

// GET /companies/stats/overview — developer dashboard data
export const developerStats = asyncHandler(async (_req, res) => {
  const companies = await Company.find().sort({ createdAt: 1 });

  // Platform view only: company + subscription/billing + seat/lead usage.
  // No tenant business data (no invoices, revenue, orders) is read here.
  const rows = await Promise.all(
    companies.map(async (c) => {
      const usage = await usageFor(c._id);
      return { ...c.toSafeJSON(), usage };
    })
  );

  const totals = {
    companies:        companies.length,
    activeCompanies:  companies.filter((c) => c.active).length,
    monthlyRecurring: companies.reduce((s, c) => s + (c.subscription?.monthlyFee || 0), 0),
    // Aggregate seat / lead usage across all tenants (counts only, not content).
    totalLeads:       rows.reduce((s, r) => s + (r.usage?.leads || 0), 0),
    totalAdmins:      rows.reduce((s, r) => s + (r.usage?.admins || 0), 0),
    totalEmployees:   rows.reduce((s, r) => s + (r.usage?.employees || 0), 0),
  };

  res.json({ success: true, totals, companies: rows });
});