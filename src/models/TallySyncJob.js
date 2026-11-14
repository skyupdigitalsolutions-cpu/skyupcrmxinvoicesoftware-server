// models/TallySyncJob.js
// Durable queue entry: one job per CRM Sales Order / Purchase Order.
// The same job is reused for every later change (ALTER / CANCEL / DELETE) and
// every retry, always with the same Tally reference, so the connector can find
// the voucher it made and never creates a second one.
import mongoose from 'mongoose';

export const TALLY_JOB_STATUSES = ['PENDING', 'PROCESSING', 'SYNCED', 'FAILED', 'NEEDS_REVIEW', 'DETACHED'];
// While a job is in one of these states the CRM document is locked (no edit /
// delete / cancel) so CRM and Tally cannot silently drift apart.
// CRM edits/cancels/deletes are now SENT to Tally instead of being blocked.
// A document is only held back while the connector is mid-way through a job
// (PROCESSING) or a human must look at it first (NEEDS_REVIEW).
export const TALLY_LOCKING_STATUSES = ['PROCESSING', 'NEEDS_REVIEW'];
export const TALLY_SOURCE_TYPES = ['SALES_ORDER', 'PURCHASE_ORDER'];
// What the connector must do in Tally for this job.
export const TALLY_OPERATIONS = ['CREATE', 'ALTER', 'CANCEL', 'DELETE'];
// What Tally currently holds for this document (after the last confirmed job).
export const TALLY_STATES = ['', 'ACTIVE', 'CANCELLED', 'DELETED'];

const eventSchema = new mongoose.Schema({
  at:      { type: Date, default: Date.now },
  type:    { type: String, required: true },   // ENQUEUED, CLAIMED, SUCCESS, FAILURE, RETRY, RESOLVED, ...
  code:    { type: String, default: '' },
  message: { type: String, default: '' },
  by:      { type: String, default: '' },      // 'user:<id>' | 'connector:<id>'
}, { _id: false });

const tallySyncJobSchema = new mongoose.Schema({
  company:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  sourceType: { type: String, enum: TALLY_SOURCE_TYPES, required: true },
  sourceId:   { type: mongoose.Schema.Types.ObjectId, required: true },
  sourceNo:   { type: Number, required: true },           // orderNo / poNo (display)

  idempotencyKey: { type: String, required: true, unique: true },
  reference:      { type: String, required: true },       // CRM-SO-1024 / CRM-PO-55
  status:         { type: String, enum: TALLY_JOB_STATUSES, default: 'PENDING', index: true },
  operation:      { type: String, enum: TALLY_OPERATIONS, default: 'CREATE' },
  tallyState:     { type: String, enum: TALLY_STATES, default: '' },

  attemptCount:   { type: Number, default: 0 },
  nextAttemptAt:  { type: Date, default: Date.now },
  lockedAt:       { type: Date, default: null },
  lockedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'TallyConnector', default: null },
  leaseId:        { type: String, default: null, select: false },
  leaseExpiresAt: { type: Date, default: null },

  payloadSnapshot: { type: mongoose.Schema.Types.Mixed, required: true }, // normalized, mapped, immutable per attempt
  lastSyncedPayload: { type: mongoose.Schema.Types.Mixed, default: null }, // what Tally holds now (last confirmed CREATE/ALTER)
  tallyCompany:    { type: String, required: true },

  tallyVoucherNumber: { type: String, default: '' },
  tallyMasterId:      { type: String, default: '' },
  tallyGuid:          { type: String, default: '' },

  lastErrorCode:    { type: String, default: '' },
  lastErrorMessage: { type: String, default: '' },
  lastErrorDetails: { type: mongoose.Schema.Types.Mixed, default: null },

  events:   { type: [eventSchema], default: [] },
  syncedAt: { type: Date, default: null },       // first time the voucher was confirmed in Tally (null = never reached Tally)
  lastSyncedAt: { type: Date, default: null },   // last confirmed job of any operation
  enqueuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

tallySyncJobSchema.index({ company: 1, sourceType: 1, sourceId: 1 }, { unique: true });
tallySyncJobSchema.index({ company: 1, status: 1, nextAttemptAt: 1 });
tallySyncJobSchema.index({ company: 1, updatedAt: -1 });

export const TallySyncJob = mongoose.model('TallySyncJob', tallySyncJobSchema);
