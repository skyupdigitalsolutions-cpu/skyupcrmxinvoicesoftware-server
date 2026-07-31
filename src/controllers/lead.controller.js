import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Lead, normalizePhone } from '../models/Lead.js';
import { phoneSearchCandidates } from '../utils/phone.js';
import { DeletedContact } from '../models/DeletedContact.js';
import { Counter } from '../models/Counter.js';
import { Order } from '../models/Order.js';
import { Company } from '../models/Company.js';
import { tenantScope, tenantCompanyId } from '../middleware/auth.js';
import { notifyUsers, adminsOf } from '../utils/notify.js';
import { Cheque } from '../models/Cheque.js';
import { WhatsAppMessage } from '../models/WhatsAppMessage.js';
import { Notification } from '../models/Notification.js';

// Human-readable labels for the fields we track edits on — used both in the
// stored history and the admin notification text.
const FIELD_LABELS = {
    name: 'Name', mobile: 'Mobile', country: 'Country', city: 'City', email: 'Email',
    source: 'Source', campaign: 'Campaign', interest: 'Interest', remark: 'Remark',
    delivery: 'Delivery', status: 'Status', followUpAt: 'Follow-up date', owner: 'Owner',
};

// Diff `fields` between the lead's current values and the incoming `body`,
// returning only entries that actually changed (skips undefined-in-body and
// no-op writes). Dates are compared by ISO string so re-saving the same
// followUpAt doesn't count as a change.
function diffFields(lead, body, fields) {
    const changes = [];
    fields.forEach((f) => {
        if (body[f] === undefined) return;
        const before = lead[f] instanceof Date ? lead[f].toISOString() : (lead[f] ?? null);
        const afterRaw = body[f];
        const after = afterRaw instanceof Date ? afterRaw.toISOString() : afterRaw;
        const beforeCmp = before === '' ? null : before;
        const afterCmp = after === '' ? null : after;
        if (String(beforeCmp ?? '') === String(afterCmp ?? '')) return;
        changes.push({ field: f, from: lead[f] ?? null, to: afterRaw ?? null });
    });
    return changes;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Scope for listing / mutating: company (tenant) + role. Sales see only their
 *  own leads; admins see their whole company; developer sees all/one company. */
const ownerScope = (req) => {
    const t = tenantScope(req);
    return req.user.role === 'sales' ? {...t, owner: req.user._id } : t;
};

// ── Phone duplicate lookup (cross-employee, read-only) ────────────────────────
export const lookupByPhone = asyncHandler(async(req, res) => {
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
export const listLeads = asyncHandler(async(req, res) => {
    const { search, status, source, converted } = req.query;
    const q = {...ownerScope(req) };

    if (status) q.status = status;
    if (source) q.source = source;
    if (converted === 'yes') q.converted = true;
    if (converted === 'no') q.converted = false;
    if (search) {
        const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        q.$or = [{ name: rx }, { mobile: rx }, { email: rx }, { city: rx }];
        // Phone-aware search: matches regardless of whether the typed number
        // includes the country code, a leading trunk zero, or any punctuation
        // — see phoneSearchCandidates for why this needs its own handling.
        const phone = phoneSearchCandidates(search);
        if (phone) q.$or.push({ mobileKey: phone.mobileKeyRegex });
    }

    const leads = await Lead.find(q).sort({ createdAt: -1 });

    // Edit history is admin-only — strip it out for sales users' own view.
    const out = req.user.role === 'admin' ?
        leads :
        leads.map((l) => { const o = l.toObject(); delete o.editHistory; return o; });

    res.json({ success: true, leads: out });
});

// ── Get single lead (owner OR any authenticated user — for cross-employee view) ──
export const getLead = asyncHandler(async(req, res) => {
    // Any authenticated employee may view a lead (to see the discussion)
    const lead = await Lead.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!lead) throw new ApiError(404, 'Lead not found');

    const isOwner = String(lead.owner) === String(req.user._id);
    const canEdit = isOwner || req.user.role === 'admin';
    const canContribute = true; // any employee can add calls/notes

    // Edit history is admin-only.
    const out = req.user.role === 'admin' ?
        lead :
        (() => { const o = lead.toObject(); delete o.editHistory; return o; })();

    res.json({ success: true, lead: out, isOwner, canEdit, canContribute });
});

// ── Create lead (checks for duplicate phone) ──────────────────────────────────
export const createLead = asyncHandler(async(req, res) => {
    const { name, mobile, altMobile, altCountry, country = 'UAE', city, email, source, campaign, interest, remark, delivery, status, owner } = req.body;

    if (!name || !name.trim()) throw new ApiError(400, 'Lead name is required');

    // City is mandatory: city-wise reporting for outdoor sales depends on it.
    if (!city || !String(city).trim()) throw new ApiError(400, 'City is required');

    // Resolve the target company up front (not just req.user.company, which
    // is empty for the developer role) so the duplicate guard checks the
    // SAME company the lead will actually be created in.
    const companyId = tenantCompanyId(req);

    // Duplicate phone guard
    if (mobile && mobile.trim()) {
        const key = normalizePhone(mobile, country);
        if (key) {
            const existing = await Lead.findOne({ mobileKey: key, company: companyId });
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
    let ownerId = req.user._id;
    let ownerName = req.user.name;
    if (req.user.role === 'admin' && owner) {
        const { User } = await
        import ('../models/User.js');
        // Owner must belong to the SAME company — never assign across tenants.
        const u = await User.findOne({ _id: owner, company: tenantCompanyId(req) });
        if (u) { ownerId = u._id;
            ownerName = u.name; }
    }

    // Enforce the company's lead limit (0 = unlimited).
    const company = await Company.findById(companyId);
    if (!company) throw new ApiError(404, 'Company not found');
    const leadLimit = (company.limits && company.limits.maxLeads) ? company.limits.maxLeads : 0;
    if (leadLimit > 0) {
        const current = await Lead.countDocuments({ company: companyId });
        if (current >= leadLimit) {
            throw new ApiError(403, `Lead limit reached: this company allows a maximum of ${leadLimit} leads.`);
        }
    }

    let lead;
    try {
        lead = await Lead.create({
            company: companyId,
            name,
            mobile,
            altMobile,
            altCountry: altCountry || country,
            country,
            city,
            email,
            source,
            campaign,
            interest,
            remark,
            delivery,
            status: status || 'New',
            owner: ownerId,
            ownerName,
        });
    } catch (err) {
        // The unique (company, mobileKey) index is the real guarantee against
        // duplicates — it can reject an insert here even if the pre-check
        // above raced with another near-simultaneous request. Converted to
        // the same friendly duplicate response as the pre-check, rather than
        // a raw 500, so the caller (e.g. the Order Form) handles it identically.
        if (err && err.code === 11000) {
            const key = normalizePhone(mobile, country);
            const existing = key ? await Lead.findOne({ mobileKey: key, company: companyId }) : null;
            return res.status(409).json({
                success: false,
                message: 'A lead with this phone number already exists.',
                details: {
                    duplicate: true,
                    leadId: existing ? existing._id : null,
                    ownedByMe: existing ? String(existing.owner) === String(req.user._id) : false,
                    ownerName: existing ? existing.ownerName : '',
                },
            });
        }
        throw err;
    }

    res.status(201).json({ success: true, lead });
});

// ── Update core fields (owner or admin only) ──────────────────────────────────
// NOTE: `mobile` / `country` are deliberately NOT in the editable fields below.
// A lead's phone number is immutable once created — enforced in the UI (the
// Mobile input is read-only on edit) and mirrored here so the same rule holds
// for any direct API call too. This is what keeps the company-wide "one lead
// per phone number" guarantee airtight: the only way a mobileKey is ever set
// is at createLead time, where it's guarded by both a pre-check and the
// unique (company, mobileKey) index. If the number is genuinely wrong, use
// deleteLead + createLead (or mergeLeads) instead of changing it in place.
export const updateLead = asyncHandler(async(req, res) => {
    const lead = await Lead.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!lead) throw new ApiError(404, 'Lead not found');

    const isOwner = String(lead.owner) === String(req.user._id);
    if (!isOwner && req.user.role !== 'admin') {
        throw new ApiError(403, 'Only the lead owner or an admin can edit core details');
    }

    const fields = ['name', 'altMobile', 'altCountry', 'city', 'email', 'source', 'campaign', 'interest', 'remark', 'delivery', 'status', 'followUpAt'];

    // Capture the diff BEFORE applying changes, so the history/notification
    // reflect exactly what this save actually changed.
    const changes = diffFields(lead, req.body, fields);

    fields.forEach((f) => { if (req.body[f] !== undefined) lead[f] = req.body[f]; });

    // Admin can re-assign owner
    if (req.user.role === 'admin' && req.body.owner) {
        const { User } = await
        import ('../models/User.js');
        // Re-assignment is restricted to users within the same company.
        const u = await User.findOne({ _id: req.body.owner, company: lead.company });
        if (u && String(u._id) !== String(lead.owner)) {
            changes.push({ field: 'owner', from: lead.ownerName || null, to: u.name });
            lead.owner = u._id;
            lead.ownerName = u.name;
        }
    }

    if (changes.length) {
        lead.editHistory.push({ by: req.user._id, byName: req.user.name, changes });
    }

    await lead.save();

    // Notify every admin whenever a lead is edited — the owner themselves
    // doesn't need a notification for their own edit, so admins only.
    if (changes.length) {
        const admins = await adminsOf(lead.company);
        // Don't also notify the editor if they happen to be an admin — they
        // already know they just made the change.
        const recipients = admins.filter((id) => String(id) !== String(req.user._id));
        if (recipients.length) {
            const summary = changes.map((c) => FIELD_LABELS[c.field] || c.field).join(', ');
            notifyUsers({
                company: lead.company,
                recipients,
                type: 'lead-edited',
                title: `Lead edited: ${lead.name}`,
                body: `${req.user.name} updated ${summary}.`,
                link: `/leads/${lead._id}`,
                lead: lead._id,
            });
        }
    }

    res.json({ success: true, lead });
});

// ── Set status (owner or admin only) ─────────────────────────────────────────
export const setLeadStatus = asyncHandler(async(req, res) => {
    const lead = await Lead.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!lead) throw new ApiError(404, 'Lead not found');

    const isOwner = String(lead.owner) === String(req.user._id);
    if (!isOwner && req.user.role !== 'admin') {
        throw new ApiError(403, 'Only the owner or admin can change status');
    }

    const prevStatus = lead.status;
    lead.status = req.body.status;

    if (prevStatus !== lead.status) {
        lead.editHistory.push({
            by: req.user._id,
            byName: req.user.name,
            changes: [{ field: 'status', from: prevStatus, to: lead.status }],
        });
    }

    await lead.save();

    if (prevStatus !== lead.status) {
        const admins = await adminsOf(lead.company);
        const recipients = admins.filter((id) => String(id) !== String(req.user._id));
        if (recipients.length) {
            notifyUsers({
                company: lead.company,
                recipients,
                type: 'lead-edited',
                title: `Lead edited: ${lead.name}`,
                body: `${req.user.name} changed Status from "${prevStatus}" to "${lead.status}".`,
                link: `/leads/${lead._id}`,
                lead: lead._id,
            });
        }
    }

    res.json({ success: true, lead });
});

// ── Log a call (any authenticated employee can contribute) ────────────────────
export const logCall = asyncHandler(async(req, res) => {
    const lead = await Lead.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!lead) throw new ApiError(404, 'Lead not found');
    if (!req.body.summary || !req.body.summary.trim()) throw new ApiError(400, 'Call summary is required');

    lead.callLogs.push({
        summary: req.body.summary.trim(),
        by: req.user._id,
        byName: req.user.name,
    });
    await lead.save();
    res.json({ success: true, lead });
});

// ── Add a note (any authenticated employee can contribute) ────────────────────
export const addNote = asyncHandler(async(req, res) => {
    const lead = await Lead.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!lead) throw new ApiError(404, 'Lead not found');
    if (!req.body.text || !req.body.text.trim()) throw new ApiError(400, 'Note text is required');

    lead.notes.push({
        text: req.body.text.trim(),
        by: req.user._id,
        byName: req.user.name,
    });
    await lead.save();
    res.json({ success: true, lead });
});

// ── Convert lead → Order ──────────────────────────────────────────────────────
export const convertLead = asyncHandler(async(req, res) => {
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
    lead.orderNo = orderNo;
    lead.status = 'Won';
    await lead.save();

    res.json({ success: true, lead, order });
});

// ── Duplicate leads: find & merge (admin only) ───────────────────────────────
// Groups existing leads that share the same normalised phone number
// (mobileKey) within the company — this is for cleaning up leads that were
// already duplicated before the create-time guard existed/applied, or from
// any other historical gap. Empty/blank mobileKey is excluded so leads with
// no phone number never get grouped together.
export const listDuplicateLeads = asyncHandler(async(req, res) => {
    const companyId = tenantCompanyId(req);

    const groups = await Lead.aggregate([
        { $match: { company: companyId, mobileKey: { $ne: '' } } },
        { $group: { _id: '$mobileKey', ids: { $push: '$_id' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
    ]);

    if (!groups.length) return res.json({ success: true, groups: [] });

    const allIds = groups.flatMap((g) => g.ids);
    const leads = await Lead.find({ _id: { $in: allIds } })
        .select('name mobile country city status owner ownerName converted orderNo createdAt callLogs notes mobileKey')
        .lean();
    const byId = new Map(leads.map((l) => [String(l._id), l]));

    const out = groups.map((g) => ({
        mobileKey: g._id,
        leads: g.ids
            .map((id) => byId.get(String(id)))
            .filter(Boolean)
            .map((l) => ({
                id: l._id,
                name: l.name,
                mobile: l.mobile,
                country: l.country,
                city: l.city,
                status: l.status,
                owner: l.owner,
                ownerName: l.ownerName,
                converted: l.converted,
                orderNo: l.orderNo,
                callLogCount: (l.callLogs || []).length,
                noteCount: (l.notes || []).length,
                createdAt: l.createdAt,
            }))
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
    }));

    res.json({ success: true, groups: out });
});

// Merges one or more duplicate leads into a single "keep" lead: combines call
// logs, notes, and edit history; reassigns any Cheque / WhatsAppMessage /
// Notification records pointing at a merged-away lead; archives each merged
// lead to DeletedContact (same append-only archive used for outright
// deletion); then removes the merged-away lead documents. Never touches
// Orders/Invoices — they store a snapshot (name/mobile), not a lead reference.
export const mergeLeads = asyncHandler(async(req, res) => {
    const { keepId, mergeIds } = req.body || {};
    if (!keepId || !Array.isArray(mergeIds) || !mergeIds.length) {
        throw new ApiError(400, 'keepId and at least one mergeIds entry are required.');
    }
    if (mergeIds.includes(keepId)) {
        throw new ApiError(400, 'keepId cannot also appear in mergeIds.');
    }

    const scope = tenantScope(req);
    const keepLead = await Lead.findOne({ _id: keepId, ...scope });
    if (!keepLead) throw new ApiError(404, 'The lead to keep was not found.');

    const duplicates = await Lead.find({ _id: { $in: mergeIds }, ...scope });
    if (!duplicates.length) throw new ApiError(404, 'None of the selected duplicate leads were found.');

    let mergedCallLogs = 0;
    let mergedNotes = 0;

    for (const dup of duplicates) {
        // Combine discussion history into the kept lead.
        if (dup.callLogs && dup.callLogs.length) {
            keepLead.callLogs.push(...dup.callLogs);
            mergedCallLogs += dup.callLogs.length;
        }
        if (dup.notes && dup.notes.length) {
            keepLead.notes.push(...dup.notes);
            mergedNotes += dup.notes.length;
        }
        if (dup.editHistory && dup.editHistory.length) {
            keepLead.editHistory.push(...dup.editHistory);
        }
        // Record the merge itself as an edit-history entry for oversight.
        keepLead.editHistory.push({
            by: req.user._id,
            byName: req.user.name,
            changes: [{ field: 'merged', from: null, to: `Merged duplicate lead "${dup.name}" (${dup._id}) into this one` }],
        });

        // Reassign anything pointing at the duplicate lead over to the kept one.
        await Promise.all([
            Cheque.updateMany({ lead: dup._id }, { $set: { lead: keepLead._id } }),
            WhatsAppMessage.updateMany({ lead: dup._id }, { $set: { lead: keepLead._id } }),
            Notification.updateMany({ lead: dup._id }, { $set: { lead: keepLead._id } }),
        ]);

        // Archive the duplicate the same way an outright delete does, so its
        // phone number stays visible in the Deleted Contacts report.
        try {
            await DeletedContact.create({
                company: dup.company,
                name: dup.name || '',
                mobile: dup.mobile || '',
                mobileKey: dup.mobileKey || '',
                email: dup.email || '',
                country: dup.country || '',
                city: dup.city || '',
                source: dup.source || '',
                status: dup.status || '',
                interest: dup.interest || '',
                ownerName: dup.ownerName || '',
                originalLeadId: dup._id,
                deletedBy: req.user._id,
                deletedByName: req.user.name || '',
                leadCreatedAt: dup.createdAt || null,
            });
        } catch (err) {
            console.error('[lead] failed to archive merged-away lead:', err.message);
        }
    }

    await keepLead.save();
    await Lead.deleteMany({ _id: { $in: duplicates.map((d) => d._id) } });

    res.json({
        success: true,
        message: `Merged ${duplicates.length} duplicate lead(s) into "${keepLead.name}".`,
        lead: keepLead,
        mergedCallLogs,
        mergedNotes,
    });
});


// The lead's contact number is preserved in the append-only DeletedContact
// archive first, so it stays available in the "Deleted Contacts" report even
// after the lead itself is removed.
export const deleteLead = asyncHandler(async(req, res) => {
    const lead = await Lead.findOne({ _id: req.params.id, ...tenantScope(req) });
    if (!lead) throw new ApiError(404, 'Lead not found');

    // Best-effort archive — a failure here must never block the delete.
    try {
        await DeletedContact.create({
            company: lead.company,
            name: lead.name || '',
            mobile: lead.mobile || '',
            mobileKey: lead.mobileKey || '',
            email: lead.email || '',
            country: lead.country || '',
            city: lead.city || '',
            source: lead.source || '',
            status: lead.status || '',
            interest: lead.interest || '',
            ownerName: lead.ownerName || '',
            originalLeadId: lead._id,
            deletedBy: req.user._id,
            deletedByName: req.user.name || '',
            leadCreatedAt: lead.createdAt || null,
        });
    } catch (err) {
        console.error('[lead] failed to archive deleted contact:', err.message);
    }

    await lead.deleteOne();
    res.json({ success: true, message: 'Lead deleted' });
});

// ── Deleted contacts report (admin only) ─────────────────────────────────────
// Lists the archived contact numbers of deleted leads for the current company.
// Supports an optional ?search= over name / mobile / city.
export const listDeletedContacts = asyncHandler(async(req, res) => {
    const q = {...tenantScope(req) };

    const search = req.query.search;
    if (search) {
        const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        q.$or = [{ name: rx }, { mobile: rx }, { city: rx }, { email: rx }];
        const phone = phoneSearchCandidates(search);
        if (phone) q.$or.push({ mobileKey: phone.mobileKeyRegex });
    }

    const contacts = await DeletedContact.find(q).sort({ createdAt: -1 }).limit(1000).lean();
    res.json({ success: true, contacts });
});