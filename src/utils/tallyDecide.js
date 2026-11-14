// utils/tallyDecide.js — PURE decision table: what must happen in Tally when a
// CRM user edits, changes the status of, or deletes an order / purchase order.
// No database access, so every branch is unit-tested (tests/tallyDecide.test.mjs).
//
// Inputs
//   job       current TallySyncJob (plain object) or null
//   action    'edit' | 'status' | 'delete'
//   docAfter  the document as it will be after the change (null for delete)
//
// Result kinds
//   NONE             nothing to do in Tally (normal CRM behaviour)
//   BLOCK            refuse the change now (HTTP 409) — connector busy / needs review
//   DETACH_PENDING   job never reached Tally → just cancel the queued/failed job
//   REFRESH_CREATE   job queued but not sent yet → resend the NEW data as a create
//   ENQUEUE          queue an ALTER / CANCEL / DELETE for the existing Tally voucher
//   WITHDRAW         a queued CANCEL / reactivation is no longer wanted → back to SYNCED

export function decideTallyChange({ job, action, docAfter }) {
  if (!job || job.status === 'DETACHED') return { kind: 'NONE' };

  if (job.status === 'PROCESSING') {
    return { kind: 'BLOCK', message: `is being sent to Tally right now (${job.reference}). Try again in a minute.` };
  }
  if (job.status === 'NEEDS_REVIEW') {
    return { kind: 'BLOCK', message: `has a Tally sync problem waiting for review (${job.reference}). An admin must resolve it in Tally Integration first.` };
  }

  const isCancelled = docAfter?.status === 'Cancelled';
  const linked = !!job.syncedAt; // a voucher was confirmed in Tally at least once

  // ── Never reached Tally ───────────────────────────────────────────────────
  if (!linked) {
    if (job.status === 'PENDING') {
      if (action === 'delete' || isCancelled) return { kind: 'DETACH_PENDING' };
      if (action === 'edit') return { kind: 'REFRESH_CREATE' };
      return { kind: 'NONE' };
    }
    // FAILED create: nothing in Tally
    if (action === 'delete') return { kind: 'DETACH_PENDING' };
    return { kind: 'NONE' };
  }

  // ── A voucher exists (or existed) in Tally ───────────────────────────────
  const tallyState = job.tallyState || 'ACTIVE';
  if (tallyState === 'DELETED') return { kind: 'NONE' };
  const pendingOp = job.status === 'PENDING' ? job.operation : null;

  if (action === 'delete') return { kind: 'ENQUEUE', operation: 'DELETE' };

  if (isCancelled) {
    if (tallyState === 'CANCELLED') return pendingOp ? { kind: 'WITHDRAW' } : { kind: 'NONE' };
    if (pendingOp === 'CANCEL') return { kind: 'NONE' };
    return { kind: 'ENQUEUE', operation: 'CANCEL' };
  }

  // Document is active in the CRM.
  if (tallyState === 'CANCELLED') return { kind: 'ENQUEUE', operation: 'ALTER', reactivate: true };
  if (pendingOp === 'CANCEL') return { kind: 'WITHDRAW' };
  if (action === 'edit') return { kind: 'ENQUEUE', operation: 'ALTER' };
  return { kind: 'NONE' }; // delivery / PO stage changes don't change the Tally voucher
}
