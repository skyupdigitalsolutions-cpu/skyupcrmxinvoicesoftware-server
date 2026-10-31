import { useState, useMemo } from 'react';
import {
  Clock, CheckCircle2, Package, Truck, Bike, PartyPopper, X, AlertTriangle,
} from 'lucide-react';
import { orderApi, userApi } from '../api/endpoints.js';
import { useFetch } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { apiError } from '../api/client.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { Field, Input, Select, Textarea } from '../components/ui/Field.jsx';
import { formatDate, ORDER_STATUSES, DELIVERY_STATUSES, fmtAED } from '../utils/format.js';

// The delivery flow stages, with the label + icon shown in the timeline.
// 'Pending' maps to the "Order Placed" milestone.
const STEPS = [
  { key: 'Pending', label: 'Order Placed', icon: Clock },
  { key: 'Confirmed', label: 'Confirmed', icon: CheckCircle2 },
  { key: 'Market Delay', label: 'Market Delay', icon: AlertTriangle },
   { key: 'Packed', label: 'Packed', icon: Package },
  { key: 'Out for Delivery', label: 'Out for Delivery', icon: Bike },
  { key: 'Delivered', label: 'Delivered', icon: PartyPopper },
];

const STEP_KEYS = STEPS.map((s) => s.key);

// The order's real current delivery stage — read from the status log itself
// (latest entry whose status is a delivery stage), so it's never guessed or
// auto-set to "Delivered" just because an invoice exists. Falls back to
// 'Pending' if nothing else was ever recorded.
// Condition: once an order has an invoice, its tracker stage is at least
// 'Confirmed' — an invoiced order can never still show "Order Placed".
const STAGE_RANK = (s) => STEP_KEYS.indexOf(s);
const currentStageOf = (o) => {
  const hits = (o.statusHistory || []).filter((h) => STEP_KEYS.includes(h.status));
  let stage = 'Pending';
  if (hits.length) {
    const sorted = [...hits].sort((a, b) => new Date(b.at) - new Date(a.at));
    stage = sorted[0].status;
  }
  const invoiced = o.status === 'Invoiced' || o.invoiceId;
  if (invoiced && STAGE_RANK(stage) < STAGE_RANK('Confirmed')) stage = 'Confirmed';
  return stage;
};

// Find the date a given status was first reached, from statusHistory.
const dateForStatus = (o, statusKey) => {
  const hit = (o.statusHistory || []).find((h) => h.status === statusKey);
  if (hit) return hit.at;
  // 'Pending' has no history entry — fall back to the order's creation date.
  if (statusKey === 'Pending') return o.createdAt || o.date;
  // Invoiced orders are auto-confirmed: if no explicit 'Confirmed' entry
  // exists, use the invoicing date as the confirmation date.
  if (statusKey === 'Confirmed' && (o.status === 'Invoiced' || o.invoiceId)) {
    const inv = (o.statusHistory || []).find((h) => h.status === 'Invoiced');
    if (inv) return inv.at;
  }
  return null;
};

export default function Tracker() {
  const { show } = useToast();
  const { isAdmin } = useAuth();
  const { data: orders, loading, refetch } = useFetch(() => orderApi.list(), []);
  const { data: users } = useFetch(() => (isAdmin ? userApi.list() : Promise.resolve([])), [isAdmin]);
  const [f, setF] = useState({ search: '', status: '', employee: '', from: '', to: '' });
  const [statusModal, setStatusModal] = useState(null);
  const [statusForm, setStatusForm] = useState({ status: 'Confirmed', note: '' });

  const active = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => {
      if (f.status && o.status !== f.status) return false;
      if (f.employee && String(o.salesperson) !== String(f.employee)) return false;
      if (f.search) {
        const q = f.search.toLowerCase();
        if (!(`${o.orderNo}`.includes(q) || o.customer.toLowerCase().includes(q))) return false;
      }
      if (f.from || f.to) {
        const d = new Date(o.date || o.createdAt);
        if (f.from && d < new Date(f.from + 'T00:00:00')) return false;
        if (f.to   && d > new Date(f.to   + 'T23:59:59')) return false;
      }
      return true;
    });
  }, [orders, f]);

  const openStatus = (o) => {
    const stage = currentStageOf(o);
    // Invoiced orders can only move through delivery stages (backend-enforced) —
    // if the real stage predates that (e.g. still 'Pending'), start the picker
    // at the first eligible delivery stage instead of an invalid option.
    const status = o.status === 'Invoiced' && !DELIVERY_STATUSES.includes(stage) ? DELIVERY_STATUSES[0] : stage;
    setStatusForm({ status, note: '' });
    setStatusModal(o);
  };
  const saveStatus = async () => {
    try {
      await orderApi.setStatus(statusModal._id, statusForm);
      show(`#${statusModal.orderNo} → ${statusForm.status}`, 'success');
      setStatusModal(null);
      refetch();
    } catch (e) { show(apiError(e), 'error'); }
  };

  if (loading) return <Spinner label="Loading tracker…" />;

  return (
    <>
      <PageTitle icon={<Truck size={18} />} badge={active.length}>Delivery Tracker</PageTitle>

      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <Input className="!w-56" placeholder="Search order / customer…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        <Select className="!w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">All Status</option>{ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        {isAdmin && (
          <Select className="!w-auto" value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })}>
            <option value="">All Employees</option>
            {(users || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
          </Select>
        )}
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}
          className="rounded border px-2 py-1.5 text-[12px]"
          style={{ borderColor: 'var(--border-card)', color: 'var(--text-primary)', background: 'var(--bg-card)' }}
          title="From date" />
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>–</span>
        <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}
          className="rounded border px-2 py-1.5 text-[12px]"
          style={{ borderColor: 'var(--border-card)', color: 'var(--text-primary)', background: 'var(--bg-card)' }}
          title="To date" />
        {(f.search || f.status || f.employee || f.from || f.to) && (
          <Button variant="outline" size="sm" onClick={() => setF({ search: '', status: '', employee: '', from: '', to: '' })}>
            <span className="flex items-center gap-1.5"><X size={13} />Clear Filter</span>
          </Button>
        )}
      </div>

      {active.length === 0 ? <Card><EmptyState title="No deliveries" hint="Try clearing the filters." /></Card> : (
        <div className="space-y-4">
          {active.map((o) => {
            const isInvoiced = o.status === 'Invoiced';
            const isCancelled = o.status === 'Cancelled';
            // Real current stage, read from the status log — never guessed.
            const currentStage = isCancelled ? null : currentStageOf(o);
            const effectiveIdx = currentStage ? STEPS.findIndex((s) => s.key === currentStage) : -1;
            const log = [...(o.statusHistory || [])].sort((a, b) => new Date(b.at) - new Date(a.at));

            return (
              <Card key={o._id}>
                <div className="p-5">
                  {/* Header */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-black text-navy">Order #{o.orderNo}</div>
                      <div className="mt-0.5 text-[12px] text-ink-2">
                        {o.customer}{o.city ? ` · ${o.city}` : ''} · {o.country}
                      </div>
                      <div className="text-[11px] text-ink-3">{formatDate(o.date)} | {o.payTerms}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-black text-navy">{fmtAED(o.grandTotal)}</div>
                      <div className="text-[11px] text-ink-3">Assigned: <span className="font-bold text-ink-2">{o.salespersonName || '—'}</span></div>
                      <div className="mt-1.5 flex items-center justify-end gap-2">
                        {isInvoiced && <span className="text-[10px] font-bold uppercase tracking-wide text-purple-700">Invoiced</span>}
                        {!isCancelled && currentStage !== 'Delivered' && (
                          <Button size="sm" variant="gold" onClick={() => openStatus(o)}>
                            <span className="flex items-center gap-1"><Truck size={13} /> Update Status</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Timeline */}
                  <div className="my-5 flex items-start">
                    {STEPS.map((step, i) => {
                      const done = !isCancelled && i <= effectiveIdx;
                      const current = !isCancelled && i === effectiveIdx;
                      const Icon = step.icon;
                      const at = done ? dateForStatus(o, step.key) : null;
                      return (
                        <div key={step.key} className="flex flex-1 flex-col items-center">
                          <div className="flex w-full items-center">
                            {/* left connector */}
                            <div className={`h-0.5 flex-1 ${i === 0 ? 'opacity-0' : i <= effectiveIdx && !isCancelled ? 'bg-ok' : 'bg-gray-200'}`} />
                            {/* node */}
                            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition
                              ${current ? 'border-gold bg-gold/15 text-gold'
                                : done ? 'border-ok bg-ok text-white'
                                : 'border-gray-200 bg-white text-gray-300'}`}>
                              <Icon size={18} />
                            </div>
                            {/* right connector */}
                            <div className={`h-0.5 flex-1 ${i === STEPS.length - 1 ? 'opacity-0' : i < effectiveIdx && !isCancelled ? 'bg-ok' : 'bg-gray-200'}`} />
                          </div>
                          <div className={`mt-1.5 text-center text-[11px] font-bold ${done ? 'text-ink-2' : 'text-ink-3'}`}>{step.label}</div>
                          {at && <div className="text-center text-[10px] text-ink-3">{formatDate(at)}</div>}
                        </div>
                      );
                    })}
                  </div>

                  {isCancelled && <div className="mb-2 text-[12px] font-bold text-danger">This order was cancelled.</div>}

                  {/* Update log */}
                  {log.length > 0 && (
                    <div className="border-t border-gray-100 pt-3">
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink-3">Update Log</div>
                      <div className="space-y-1.5">
                        {log.map((h, i) => (
                          <div key={i} className="flex items-start gap-2 text-[12px]">
                            <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                            <span>
                              <strong>{h.status}</strong> — by {h.byName || 'System'} on {formatDate(h.at)}
                              {h.note ? <span className="italic text-ink-3"> · {h.note}</span> : null}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Update status modal */}
      <Modal open={!!statusModal} onClose={() => setStatusModal(null)}
        title={<span className="flex items-center gap-1.5"><Truck size={16} /> Update Delivery Status</span>} width="max-w-[380px]">
        {statusModal && (
          <>
            <p className="mb-3 text-[13px] text-ink-2">Order <strong>#{statusModal.orderNo}</strong> · {statusModal.customer}</p>
            {statusModal.status === 'Invoiced' && (
              <p className="mb-3 text-[11px] text-ink-3">This order is already invoiced — you can still update its delivery stage.</p>
            )}
            <Field label="New Status">
              <Select value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })}>
                {(statusModal.status === 'Invoiced' ? DELIVERY_STATUSES : ORDER_STATUSES).map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <div className="mt-3"><Field label="Delivery Note (optional)">
              <Textarea rows={2} value={statusForm.note} placeholder="e.g. Delivered via HURIA TRANSPORT"
                onChange={(e) => setStatusForm({ ...statusForm, note: e.target.value })} />
            </Field></div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStatusModal(null)}>Cancel</Button>
              <Button variant="green" onClick={saveStatus}>Update Status</Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}