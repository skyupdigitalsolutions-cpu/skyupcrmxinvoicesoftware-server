// utils/tallySync.js — database side of the Tally integration that is shared by
// the Tally controller and the existing Order / Purchase Order controllers.
//
// planTallyChange() is called BEFORE an edit / status change / delete is saved:
//   • documents never sent to Tally → returns a no-op plan (one indexed lookup)
//   • otherwise it validates that Tally can take the change (throws 409/422 if not)
//     and returns { commit() } to call AFTER the CRM save succeeds.
import { ApiError } from './ApiError.js';
import { TallySyncJob } from '../models/TallySyncJob.js';
import { TallyConnector } from '../models/TallyConnector.js';
import { TallyMapping } from '../models/TallyMapping.js';
import { Company } from '../models/Company.js';
import { buildTallySnapshot, collectMappingKeys, tallyRelevantEqual } from './tallyPayload.js';
import { decideTallyChange } from './tallyDecide.js';

const EVENT_CAP = 50;
const NOOP = Object.freeze({ commit: null, summary: null });
const label = (t) => (t === 'SALES_ORDER' ? 'order' : 'purchase order');

/** Build the Tally snapshot from a document object (plain or mongoose). Throws 4xx with details. */
export async function buildSnapshotFromDoc({ company, sourceType, doc, skipStatusGate = false }) {
  const plain = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
  const [companyDoc, connector] = await Promise.all([
    Company.findById(company).lean(),
    TallyConnector.findOne({ company, active: true }).lean(),
  ]);
  if (!connector) throw new ApiError(409, 'No active Tally connector. An admin must register one in Tally Integration (or unlink this document from Tally).');

  const keys = collectMappingKeys(sourceType, plain);
  const or = [{ kind: keys.partyKind, crmKey: keys.partyKey }];
  if (keys.itemKeys.length) or.push({ kind: 'item', crmKey: { $in: keys.itemKeys } });
  if (keys.unitKeys.length) or.push({ kind: 'unit', crmKey: { $in: keys.unitKeys } });
  const mappings = await TallyMapping.find({ company, $or: or }).lean();

  const maps = { party: new Map(), item: new Map(), unit: new Map() };
  for (const m of mappings) {
    if (m.kind === keys.partyKind) maps.party.set(m.crmKey, m);
    else if (m.kind === 'item') maps.item.set(m.crmKey, m);
    else if (m.kind === 'unit') maps.unit.set(m.crmKey, m);
  }

  const result = buildTallySnapshot({
    sourceType, doc: plain, companyId: company, currencyCode: companyDoc?.currency?.code,
    settings: connector.settings, maps, skipStatusGate,
  });
  if (!result.ok) {
    // Details go into the message too: the order form only shows the message text.
    throw new ApiError(422, `This ${label(sourceType)} is linked to Tally and Tally can't accept it yet: ${result.errors.map((e) => e.message).join(' ')}`,
      result.errors.map((e) => ({ path: e.field || e.code, message: e.message, code: e.code })));
  }
  return result.payload;
}

const lastSyncedOf = (job) => job.lastSyncedPayload || job.payloadSnapshot;
const previousOf = (job) => {
  const last = lastSyncedOf(job);
  return last ? { date: last.date, voucherTypeName: last.voucherTypeName } : undefined;
};

/**
 * @param {object} a
 * @param {*} a.company, a.sourceId
 * @param {'SALES_ORDER'|'PURCHASE_ORDER'} a.sourceType
 * @param {'edit'|'status'|'delete'} a.action
 * @param {object|null} a.docAfter   document as it will be saved (null for delete)
 * @param {object} a.user
 */
export async function planTallyChange({ company, sourceType, sourceId, action, docAfter, user }) {
  if (!company || !sourceId) return NOOP;
  const job = await TallySyncJob.findOne({ company, sourceType, sourceId }).lean();
  const decision = decideTallyChange({ job, action, docAfter });
  if (decision.kind === 'NONE') return NOOP;
  if (decision.kind === 'BLOCK') {
    throw new ApiError(409, `This ${label(sourceType)} ${decision.message}`, [{ path: 'tally', message: job.status }]);
  }

  const by = `user:${user?._id || ''}`;
  let set;
  let eventType;
  let summary;

  if (decision.kind === 'DETACH_PENDING') {
    set = { status: 'DETACHED' };
    eventType = 'CANCELLED_BEFORE_SEND';
    summary = 'Removed from the Tally queue (it had not reached Tally).';
  } else if (decision.kind === 'WITHDRAW') {
    set = { status: 'SYNCED', operation: job.tallyState === 'CANCELLED' ? 'CANCEL' : 'ALTER', payloadSnapshot: lastSyncedOf(job), lastErrorCode: '', lastErrorMessage: '' };
    eventType = 'WITHDRAWN';
    summary = 'Queued Tally change withdrawn; Tally already matches.';
  } else if (decision.kind === 'REFRESH_CREATE') {
    const payload = await buildSnapshotFromDoc({ company, sourceType, doc: docAfter });
    set = { payloadSnapshot: payload, tallyCompany: payload.tallyCompany, nextAttemptAt: new Date() };
    eventType = 'REFRESHED';
    summary = 'Queued Tally data updated.';
  } else { // ENQUEUE
    let payload;
    if (decision.operation === 'ALTER') {
      const fresh = await buildSnapshotFromDoc({ company, sourceType, doc: docAfter, skipStatusGate: true });
      if (!decision.reactivate && job.status === 'SYNCED' && tallyRelevantEqual(fresh, lastSyncedOf(job))) return NOOP; // nothing Tally cares about changed
      payload = { ...fresh, operation: 'ALTER', previous: previousOf(job), reactivate: !!decision.reactivate };
    } else {
      const last = lastSyncedOf(job);
      if (!last) throw new ApiError(409, `No record of what was sent to Tally for ${job.reference}. Resolve it in Tally Integration.`);
      payload = { ...last, operation: decision.operation, previous: previousOf(job), reactivate: false };
    }
    set = {
      status: 'PENDING', operation: decision.operation, payloadSnapshot: payload, tallyCompany: payload.tallyCompany,
      attemptCount: 0, nextAttemptAt: new Date(), lockedAt: null, lockedBy: null, leaseId: null, leaseExpiresAt: null,
      lastErrorCode: '', lastErrorMessage: '', lastErrorDetails: null,
    };
    eventType = `ENQUEUED_${decision.operation}`;
    summary = { ALTER: 'Change queued for Tally.', CANCEL: 'Cancellation queued for Tally.', DELETE: 'Deletion queued for Tally.' }[decision.operation];
  }

  const commit = async () => {
    // Optimistic: only apply if the job is still in the state we decided on.
    const r = await TallySyncJob.updateOne(
      { _id: job._id, status: job.status, updatedAt: job.updatedAt },
      { $set: set, $push: { events: { $each: [{ at: new Date(), type: eventType, message: summary, by }], $slice: -EVENT_CAP } } }
    );
    return r.modifiedCount === 1;
  };
  return { commit, summary, decision, reference: job.reference };
}

/**
 * Save the CRM document, then queue the Tally change. If the job moved on in
 * between (connector claimed it), re-plan once against the fresh job.
 * `save` is the controller's original save/delete call.
 */
export async function saveWithTally({ plan, replan, save }) {
  if (!plan?.commit) return save();
  const result = await save();
  try {
    if (await plan.commit()) return result;
    const again = await replan();
    if (!again?.commit || (await again.commit())) return result;
  } catch (e) {
    console.error('[tally] could not queue Tally change after save:', e.message);
  }
  throw new ApiError(500, `Saved in the CRM, but the Tally update for ${plan.reference} could not be queued. An admin should press "Resend" in Tally Integration.`);
}
