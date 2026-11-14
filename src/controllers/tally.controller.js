// controllers/tally.controller.js
// CRM → Tally integration (one-way). Two audiences:
//   • admins (user JWT): connector registration, settings, mappings, sync, review
//   • the Windows connector (connector token): heartbeat, claim, success, failure
import crypto from 'node:crypto';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { tenantScope, tenantCompanyId } from '../middleware/auth.js';
import { generateConnectorToken } from '../middleware/connectorAuth.js';
import { TallyConnector } from '../models/TallyConnector.js';
import { TallySyncJob, TALLY_LOCKING_STATUSES } from '../models/TallySyncJob.js';
import { TallyMapping } from '../models/TallyMapping.js';
import { Order } from '../models/Order.js';
import { PurchaseOrder } from '../models/PurchaseOrder.js';
import {
  SALES_ORDER, PURCHASE_ORDER, normalizeKey, itemKey, referenceFor, idempotencyKeyFor,
} from '../utils/tallyPayload.js';
import { buildSnapshotFromDoc } from '../utils/tallySync.js';

const LEASE_MS = 5 * 60 * 1000;          // connector must finish a job within 5 min
const MAX_AUTO_ATTEMPTS = 8;             // after this, retryable failures become FAILED
const ONLINE_WINDOW_MS = 2 * 60 * 1000;  // heartbeat newer than this = online
const EVENT_CAP = 50;

const event = (type, { code = '', message = '', by = '' } = {}) => ({ at: new Date(), type, code, message: String(message).slice(0, 500), by });
const pushEvent = (ev) => ({ $push: { events: { $each: [ev], $slice: -EVENT_CAP } } });
const userTag = (req) => `user:${req.user._id}`;
const connectorTag = (req) => `connector:${req.connector._id}`;
const capDetails = (d) => {
  if (d === undefined || d === null) return null;
  try { const s = JSON.stringify(d); return s.length > 5000 ? { truncated: s.slice(0, 5000) } : d; } catch { return null; }
};
const backoffMs = (attempt) => Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 30 * 60 * 1000);

const publicConnector = (c) => c && ({
  _id: c._id, name: c.name, tokenPrefix: c.tokenPrefix, active: c.active, revokedAt: c.revokedAt,
  settings: c.settings, lastSeenAt: c.lastSeenAt, lastHeartbeat: c.lastHeartbeat,
  online: !!(c.active && c.lastSeenAt && Date.now() - new Date(c.lastSeenAt).getTime() < ONLINE_WINDOW_MS),
  createdAt: c.createdAt, updatedAt: c.updatedAt,
});

const publicJob = (j, { withPayload = false } = {}) => j && ({
  _id: j._id, sourceType: j.sourceType, sourceId: j.sourceId, sourceNo: j.sourceNo, reference: j.reference,
  status: j.status, operation: j.operation || 'CREATE', tallyState: j.tallyState || (j.syncedAt ? 'ACTIVE' : ''), linked: !!j.syncedAt,
  lastSyncedAt: j.lastSyncedAt, attemptCount: j.attemptCount, nextAttemptAt: j.nextAttemptAt, tallyCompany: j.tallyCompany,
  tallyVoucherNumber: j.tallyVoucherNumber, tallyMasterId: j.tallyMasterId, tallyGuid: j.tallyGuid,
  lastErrorCode: j.lastErrorCode, lastErrorMessage: j.lastErrorMessage, syncedAt: j.syncedAt,
  createdAt: j.createdAt, updatedAt: j.updatedAt,
  ...(withPayload ? { payloadSnapshot: j.payloadSnapshot, lastErrorDetails: j.lastErrorDetails, events: j.events } : {}),
});

const pickSettings = (s = {}) => {
  const keys = ['tallyCompanyName', 'baseCurrency', 'salesOrderVoucherType', 'purchaseOrderVoucherType', 'salesLedger', 'purchaseLedger', 'godown', 'timezone'];
  const out = {};
  for (const k of keys) if (s[k] !== undefined) out[`settings.${k}`] = String(s[k]).trim();
  if (out['settings.timezone']) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: out['settings.timezone'] }); }
    catch { throw new ApiError(422, `Unknown timezone ${out['settings.timezone']}`); }
  }
  return out;
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — connector registration & settings
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/tally/connectors — register a connector for this company.
// Any previously active connector of the company is revoked. The plain token
// is returned ONCE; store it in the connector's .env.
export const createConnector = asyncHandler(async (req, res) => {
  const company = tenantCompanyId(req);
  await TallyConnector.updateMany({ company, active: true }, { $set: { active: false, revokedAt: new Date() } });

  const { token, tokenHash, tokenPrefix } = generateConnectorToken();
  const doc = new TallyConnector({ company, name: req.body.name || 'Tally Connector', tokenHash, tokenPrefix, createdBy: req.user._id });
  const settings = pickSettings(req.body.settings);
  for (const [k, v] of Object.entries(settings)) doc.set(k, v);
  await doc.save();

  res.status(201).json({
    success: true,
    connector: publicConnector(doc),
    token,
    message: 'Copy this token into the connector .env now. It will not be shown again.',
  });
});

export const listConnectors = asyncHandler(async (req, res) => {
  const list = await TallyConnector.find({ ...tenantScope(req) }).sort({ createdAt: -1 }).limit(20).lean();
  res.json({ success: true, connectors: list.map(publicConnector) });
});

export const updateConnector = asyncHandler(async (req, res) => {
  const set = pickSettings(req.body.settings);
  if (req.body.name) set.name = req.body.name;
  const c = await TallyConnector.findOneAndUpdate(
    { _id: req.params.id, ...tenantScope(req), active: true },
    { $set: set },
    { new: true, runValidators: true }
  );
  if (!c) throw new ApiError(404, 'Active connector not found');
  res.json({ success: true, connector: publicConnector(c) });
});

export const rotateConnectorToken = asyncHandler(async (req, res) => {
  const { token, tokenHash, tokenPrefix } = generateConnectorToken();
  const c = await TallyConnector.findOneAndUpdate(
    { _id: req.params.id, ...tenantScope(req), active: true },
    { $set: { tokenHash, tokenPrefix } },
    { new: true }
  );
  if (!c) throw new ApiError(404, 'Active connector not found');
  res.json({ success: true, connector: publicConnector(c), token, message: 'Old token stopped working. Update the connector .env and restart it.' });
});

export const revokeConnector = asyncHandler(async (req, res) => {
  const c = await TallyConnector.findOneAndUpdate(
    { _id: req.params.id, ...tenantScope(req), active: true },
    { $set: { active: false, revokedAt: new Date() } },
    { new: true }
  );
  if (!c) throw new ApiError(404, 'Active connector not found');
  res.json({ success: true, connector: publicConnector(c) });
});

// GET /api/tally/status — connector health + job counts + recent jobs
export const getStatus = asyncHandler(async (req, res) => {
  const scope = tenantScope(req);
  const [connector, counts, recent] = await Promise.all([
    TallyConnector.findOne({ ...scope, active: true }).lean(),
    TallySyncJob.aggregate([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    TallySyncJob.find(scope).sort({ updatedAt: -1 }).limit(25).lean(),
  ]);
  res.json({
    success: true,
    connector: publicConnector(connector),
    counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    recentJobs: recent.map((j) => publicJob(j)),
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — mappings
// ═════════════════════════════════════════════════════════════════════════════

const mappingKeyFrom = (m) => {
  if (m.kind === 'item') {
    if (!m.modelCode) throw new ApiError(422, 'Article (model code) is required for an item mapping');
    const size = m.size === '*' ? '' : m.size;
    return { crmKey: itemKey(m.modelCode, size), crmLabel: `${m.modelCode}${size ? ` / ${size}` : ' / any size'}` };
  }
  if (!m.crmValue) throw new ApiError(422, `CRM value is required for a ${m.kind} mapping`);
  return { crmKey: normalizeKey(m.crmValue), crmLabel: m.crmValue };
};

const upsertOne = async (company, m, userId) => {
  const { crmKey, crmLabel } = mappingKeyFrom(m);
  return TallyMapping.findOneAndUpdate(
    { company, kind: m.kind, crmKey },
    { $set: { crmLabel, tallyName: m.tallyName.trim(), tallyUnit: m.kind === 'item' ? (m.tallyUnit || '').trim() : '', updatedBy: userId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

export const listMappings = asyncHandler(async (req, res) => {
  const q = { ...tenantScope(req) };
  if (req.query.kind) q.kind = req.query.kind;
  const mappings = await TallyMapping.find(q).sort({ kind: 1, crmKey: 1 }).limit(5000).lean();
  res.json({ success: true, mappings });
});

export const upsertMapping = asyncHandler(async (req, res) => {
  const mapping = await upsertOne(tenantCompanyId(req), req.body, req.user._id);
  res.json({ success: true, mapping });
});

export const bulkUpsertMappings = asyncHandler(async (req, res) => {
  const company = tenantCompanyId(req);
  const results = { saved: 0, errors: [] };
  for (const [i, m] of req.body.mappings.entries()) {
    try { await upsertOne(company, m, req.user._id); results.saved++; }
    catch (e) { results.errors.push({ index: i, message: e.message }); }
  }
  res.json({ success: true, ...results });
});

export const deleteMapping = asyncHandler(async (req, res) => {
  const r = await TallyMapping.deleteOne({ _id: req.params.id, ...tenantScope(req) });
  if (!r.deletedCount) throw new ApiError(404, 'Mapping not found');
  res.json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — enqueue / resend / resolve
// ═════════════════════════════════════════════════════════════════════════════

const modelFor = (sourceType) => (sourceType === SALES_ORDER ? Order : PurchaseOrder);
const loadDoc = (sourceType, sourceId, company) => modelFor(sourceType).findOne({ _id: sourceId, company }).lean();
const lastSyncedOf = (job) => job.lastSyncedPayload || job.payloadSnapshot;
const previousOf = (job) => { const l = lastSyncedOf(job); return l ? { date: l.date, voucherTypeName: l.voucherTypeName } : undefined; };

// Fresh queue fields for a (re)queued job.
const requeueSet = (payload, operation, req) => ({
  status: 'PENDING', operation, payloadSnapshot: payload, tallyCompany: payload.tallyCompany, attemptCount: 0,
  nextAttemptAt: new Date(), lockedAt: null, lockedBy: null, leaseId: null, leaseExpiresAt: null,
  lastErrorCode: '', lastErrorMessage: '', lastErrorDetails: null, enqueuedBy: req.user._id,
});

/**
 * Work out what to (re)send for an existing job:
 *   never reached Tally      → CREATE from the current document
 *   linked, doc deleted      → DELETE (with what Tally holds)
 *   linked, last op CANCEL   → CANCEL again (or ALTER+reactivate if the doc is active again)
 *   linked, otherwise        → ALTER from the current document (connector replaces if different)
 */
async function resendPayload(job) {
  const doc = await loadDoc(job.sourceType, job.sourceId, job.company);
  if (!job.syncedAt) {
    if (!doc) throw new ApiError(404, 'The CRM document no longer exists.');
    const payload = await buildSnapshotFromDoc({ company: job.company, sourceType: job.sourceType, doc });
    return { operation: 'CREATE', payload };
  }
  const last = lastSyncedOf(job);
  if (!doc || job.operation === 'DELETE') {
    if (!last) throw new ApiError(409, 'No record of what was sent to Tally.');
    return { operation: 'DELETE', payload: { ...last, operation: 'DELETE', previous: previousOf(job), reactivate: false } };
  }
  const docCancelled = doc.status === 'Cancelled';
  if (docCancelled) {
    if (!last) throw new ApiError(409, 'No record of what was sent to Tally.');
    return { operation: 'CANCEL', payload: { ...last, operation: 'CANCEL', previous: previousOf(job), reactivate: false } };
  }
  const fresh = await buildSnapshotFromDoc({ company: job.company, sourceType: job.sourceType, doc, skipStatusGate: true });
  return {
    operation: 'ALTER',
    payload: { ...fresh, operation: 'ALTER', previous: previousOf(job), reactivate: job.tallyState === 'CANCELLED' },
  };
}

async function requeueExisting(req, existing, allowFrom, eventType) {
  if (!allowFrom.includes(existing.status)) {
    throw new ApiError(409, `Can't resend while the job is ${existing.status.toLowerCase().replace('_', ' ')} (${existing.reference}).`);
  }
  const { operation, payload } = await resendPayload(existing);
  const job = await TallySyncJob.findOneAndUpdate(
    { _id: existing._id, status: existing.status },
    { $set: requeueSet(payload, operation, req), ...pushEvent(event(eventType, { code: operation, message: `From ${existing.status}`, by: userTag(req) })) },
    { new: true }
  );
  if (!job) throw new ApiError(409, 'Sync state changed meanwhile. Refresh and try again.');
  return job;
}

// POST /api/tally/sync/:type/:id   (type = sales-order | purchase-order)
export const syncToTally = asyncHandler(async (req, res) => {
  const sourceType = req.params.type === 'sales-order' ? SALES_ORDER : PURCHASE_ORDER;
  const company = tenantCompanyId(req);
  const existing = await TallySyncJob.findOne({ company, sourceType, sourceId: req.params.id }).lean();
  if (existing) {
    const job = await requeueExisting(req, existing, ['FAILED', 'DETACHED'], 'RE_ENQUEUED');
    return res.status(202).json({ success: true, job: publicJob(job) });
  }

  const doc = await loadDoc(sourceType, req.params.id, company);
  if (!doc) throw new ApiError(404, sourceType === SALES_ORDER ? 'Order not found' : 'Purchase order not found');
  const payload = await buildSnapshotFromDoc({ company, sourceType, doc });
  const no = sourceType === SALES_ORDER ? doc.orderNo : doc.poNo;
  try {
    const job = await TallySyncJob.create({
      company, sourceType, sourceId: doc._id, sourceNo: no,
      idempotencyKey: idempotencyKeyFor(sourceType, company, no),
      reference: referenceFor(sourceType, no),
      status: 'PENDING', operation: 'CREATE', payloadSnapshot: payload, tallyCompany: payload.tallyCompany,
      enqueuedBy: req.user._id, events: [event('ENQUEUED', { code: 'CREATE', by: userTag(req) })],
    });
    res.status(202).json({ success: true, job: publicJob(job) });
  } catch (e) {
    if (e?.code === 11000) throw new ApiError(409, 'This document is already queued for Tally.');
    throw e;
  }
});

// POST /api/tally/jobs/:id/retry — "Retry" / "Resend": rebuilds from the CURRENT
// document and mappings, so fixing a mapping and pressing Retry works. Also
// allowed on SYNCED jobs to force Tally back in line with the CRM.
export const retryJob = asyncHandler(async (req, res) => {
  const existing = await TallySyncJob.findOne({ _id: req.params.id, ...tenantScope(req) }).lean();
  if (!existing) throw new ApiError(404, 'Sync job not found');
  const job = await requeueExisting(req, existing, ['FAILED', 'NEEDS_REVIEW', 'DETACHED', 'SYNCED'], 'RESENT');
  res.json({ success: true, job: publicJob(job) });
});

// What Tally holds after an operation is confirmed.
const confirmedSet = (job, now = new Date()) => {
  const op = job.operation || 'CREATE';
  const set = { lastSyncedAt: now };
  if (!job.syncedAt && op !== 'DELETE') set.syncedAt = now;
  if (op === 'CREATE' || op === 'ALTER') { set.tallyState = 'ACTIVE'; set.lastSyncedPayload = job.payloadSnapshot; }
  if (op === 'CANCEL') set.tallyState = 'CANCELLED';
  if (op === 'DELETE') set.tallyState = 'DELETED';
  return set;
};

// POST /api/tally/jobs/:id/resolve — manual decision after checking Tally.
//   SYNCED   : the change IS done in Tally and correct
//   DETACHED : unlink from Tally (CRM changes stop flowing to Tally; also cancels a queued job)
export const resolveJob = asyncHandler(async (req, res) => {
  const { outcome, note, tallyVoucherNumber } = req.body;
  const from = outcome === 'SYNCED' ? ['NEEDS_REVIEW', 'FAILED'] : ['PENDING', 'SYNCED', 'NEEDS_REVIEW', 'FAILED'];
  const current = await TallySyncJob.findOne({ _id: req.params.id, ...tenantScope(req), status: { $in: from } }).lean();
  if (!current) throw new ApiError(409, `Job not found or cannot be marked ${outcome} from its current state.`);
  const set = outcome === 'SYNCED'
    ? { status: 'SYNCED', ...confirmedSet(current), ...(tallyVoucherNumber ? { tallyVoucherNumber } : {}) }
    : { status: 'DETACHED' };
  const job = await TallySyncJob.findOneAndUpdate(
    { _id: current._id, status: current.status },
    { $set: { ...set, leaseId: null, leaseExpiresAt: null }, ...pushEvent(event('RESOLVED', { code: outcome, message: note, by: userTag(req) })) },
    { new: true }
  );
  if (!job) throw new ApiError(409, 'Sync state changed meanwhile. Refresh and try again.');
  res.json({ success: true, job: publicJob(job) });
});

export const listJobs = asyncHandler(async (req, res) => {
  const q = { ...tenantScope(req) };
  if (req.query.status) q.status = req.query.status;
  const jobs = await TallySyncJob.find(q).sort({ updatedAt: -1 }).limit(req.query.limit || 50).lean();
  res.json({ success: true, jobs: jobs.map((j) => publicJob(j)) });
});

export const getJob = asyncHandler(async (req, res) => {
  const job = await TallySyncJob.findOne({ _id: req.params.id, ...tenantScope(req) }).lean();
  if (!job) throw new ApiError(404, 'Sync job not found');
  res.json({ success: true, job: publicJob(job, { withPayload: true }) });
});

// POST /api/tally/sync-status { type, ids[] } — badges on list pages (any user in tenant)
export const syncStatus = asyncHandler(async (req, res) => {
  const { type, ids } = req.body;
  if (!ids.length) return res.json({ success: true, statuses: {} });
  const jobs = await TallySyncJob.find(
    { ...tenantScope(req), sourceType: type, sourceId: { $in: ids } },
    { sourceId: 1, status: 1, operation: 1, tallyState: 1, reference: 1, lastErrorMessage: 1, tallyVoucherNumber: 1, syncedAt: 1 }
  ).lean();
  const statuses = {};
  for (const j of jobs) {
    statuses[String(j.sourceId)] = {
      jobId: j._id, status: j.status, operation: j.operation || 'CREATE', tallyState: j.tallyState || (j.syncedAt ? 'ACTIVE' : ''),
      linked: !!j.syncedAt, reference: j.reference, locked: TALLY_LOCKING_STATUSES.includes(j.status),
      lastErrorMessage: j.lastErrorMessage, tallyVoucherNumber: j.tallyVoucherNumber, syncedAt: j.syncedAt,
    };
  }
  res.json({ success: true, statuses });
});

// ═════════════════════════════════════════════════════════════════════════════
// CONNECTOR (agent) — token-authenticated
// ═════════════════════════════════════════════════════════════════════════════

export const agentHeartbeat = asyncHandler(async (req, res) => {
  const hb = req.body;
  await TallyConnector.updateOne(
    { _id: req.connector._id },
    { $set: { lastSeenAt: new Date(), lastHeartbeat: hb } }
  );
  res.json({
    success: true,
    serverTime: new Date().toISOString(),
    settings: {
      tallyCompanyName: req.connector.settings?.tallyCompanyName || '',
      baseCurrency: req.connector.settings?.baseCurrency || 'AED',
    },
  });
});

// POST /api/tally/agent/jobs/claim — atomically lease ONE eligible job.
// Expired PROCESSING leases are reclaimable; the connector always checks Tally
// for the reference before posting, so a reclaim cannot create a duplicate.
export const agentClaimJob = asyncHandler(async (req, res) => {
  const now = new Date();
  const leaseId = crypto.randomUUID();
  const job = await TallySyncJob.findOneAndUpdate(
    {
      company: req.connector.company,
      $or: [
        { status: 'PENDING', nextAttemptAt: { $lte: now } },
        { status: 'PROCESSING', leaseExpiresAt: { $lt: now } },
      ],
    },
    {
      $set: { status: 'PROCESSING', lockedAt: now, lockedBy: req.connector._id, leaseId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
      $inc: { attemptCount: 1 },
      ...pushEvent(event('CLAIMED', { by: connectorTag(req) })),
    },
    { new: true, sort: { nextAttemptAt: 1, createdAt: 1 } }
  ).lean();

  await TallyConnector.updateOne({ _id: req.connector._id }, { $set: { lastSeenAt: now } });
  if (!job) return res.json({ success: true, job: null });

  res.json({
    success: true,
    job: {
      id: job._id, leaseId, attempt: job.attemptCount, leaseExpiresAt: job.leaseExpiresAt,
      reference: job.reference, operation: job.operation || 'CREATE', tallyCompany: job.tallyCompany, payload: job.payloadSnapshot,
    },
  });
});

export const agentJobSuccess = asyncHandler(async (req, res) => {
  const b = req.body;
  const filter = { _id: req.params.id, company: req.connector.company, status: 'PROCESSING', leaseId: b.leaseId };
  const current = await TallySyncJob.findOne(filter, { operation: 1, syncedAt: 1, payloadSnapshot: 1 }).lean();
  if (!current) throw new ApiError(409, 'Lease lost: job is no longer held by this connector');
  const ids = current.operation === 'DELETE' || current.operation === 'CANCEL'
    ? {} // keep the identifiers of the voucher we created
    : { tallyVoucherNumber: b.tallyVoucherNumber, tallyMasterId: b.tallyMasterId, tallyGuid: b.tallyGuid };
  const job = await TallySyncJob.findOneAndUpdate(
    filter,
    {
      $set: {
        status: 'SYNCED', ...confirmedSet(current), ...ids,
        lastErrorCode: '', lastErrorMessage: '', lastErrorDetails: null, leaseId: null, leaseExpiresAt: null,
      },
      ...pushEvent(event('SUCCESS', { code: `${current.operation || 'CREATE'}${b.reconciled ? '_RECONCILED' : ''}`, message: b.message, by: connectorTag(req) })),
    },
    { new: true }
  ).lean();
  if (!job) throw new ApiError(409, 'Lease lost: job is no longer held by this connector');
  res.json({ success: true, status: job.status });
});

export const agentJobFailure = asyncHandler(async (req, res) => {
  const b = req.body;
  const filter = { _id: req.params.id, company: req.connector.company, status: 'PROCESSING', leaseId: b.leaseId };
  const current = await TallySyncJob.findOne(filter, { attemptCount: 1 }).lean();
  if (!current) throw new ApiError(409, 'Lease lost: job is no longer held by this connector');

  let status = 'FAILED';
  let nextAttemptAt = null;
  if (b.needsReview) status = 'NEEDS_REVIEW';
  else if (b.retryable && current.attemptCount < MAX_AUTO_ATTEMPTS) {
    status = 'PENDING';
    nextAttemptAt = new Date(Date.now() + backoffMs(current.attemptCount));
  }

  const job = await TallySyncJob.findOneAndUpdate(
    filter,
    {
      $set: {
        status, ...(nextAttemptAt ? { nextAttemptAt } : {}),
        lastErrorCode: b.code, lastErrorMessage: b.message, lastErrorDetails: capDetails(b.details),
        leaseId: null, leaseExpiresAt: null,
      },
      ...pushEvent(event('FAILURE', { code: b.code, message: b.message, by: connectorTag(req) })),
    },
    { new: true }
  ).lean();
  if (!job) throw new ApiError(409, 'Lease lost: job is no longer held by this connector');
  res.json({ success: true, status: job.status, nextAttemptAt: job.nextAttemptAt });
});
