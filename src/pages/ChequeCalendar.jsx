// ChequeCalendar.jsx — SkyUp CRM
// Cheque calendar with Receivable/Payable types, colored date blocks, and filters.

import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Banknote, Landmark, Plus, Loader2, Trash2, Check, Filter, Download } from 'lucide-react';

import { chequeApi } from '../api/endpoints.js';
import { apiError } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { fmtAED, dialFor } from '../utils/format.js';
import CountrySelect from '../components/ui/CountrySelect.jsx';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card, CardBody } from '../components/ui/Card.jsx';
import { Field, Input, Textarea } from '../components/ui/Field.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const CHEQUE_TYPES = ['Receivable', 'Payable'];

const dkey = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
const todayKey = () => dkey(new Date());

const blankCheque = () => ({
  type: 'Receivable',
  customer: '', mobile: '', country: 'UAE', amount: '', chequeDate: todayKey(),
  chequeNumber: '', bank: '', notes: '',
});

// Returns the dominant color for a day's cheques based on type and status
const dayColor = (cheques) => {
  if (!cheques.length) return null;
  const allCollected = cheques.every(c => c.status === 'Collected');
  const anyBounced   = cheques.some(c => c.status === 'Bounced');
  const hasPayable   = cheques.some(c => c.type === 'Payable');
  const hasReceivable = cheques.some(c => c.type === 'Receivable');

  if (anyBounced) return { bg: '#fef2f2', border: '#fca5a5', text: '#dc2626', label: 'Bounced' };
  if (allCollected) return { bg: '#f0fdf4', border: '#86efac', text: '#16a34a', label: 'Collected' };
  // Mixed types: show split, prefer receivable color
  if (hasPayable && hasReceivable) return { bg: '#faf5ff', border: '#c084fc', text: '#7c3aed', label: 'Mixed' };
  if (hasPayable)    return { bg: '#fff7ed', border: '#fb923c', text: '#ea580c', label: 'Payable' };
  if (hasReceivable) return { bg: '#eff6ff', border: '#93c5fd', text: '#2563eb', label: 'Receivable' };
  return null;
};

// ── Add / Edit Cheque modal ──────────────────────────────────────────────────
function ChequeFormModal({ cheque, onClose, onSaved }) {
  const { show } = useToast();
  const isEdit = !!cheque?.id;
  const [form, setForm] = useState(
    isEdit
      ? {
          type: cheque.type || 'Receivable',
          customer: cheque.customer || '', mobile: cheque.mobile || '', country: cheque.country || 'UAE',
          amount: cheque.amount ?? '', chequeDate: cheque.chequeDate ? cheque.chequeDate.slice(0, 10) : todayKey(),
          chequeNumber: cheque.chequeNumber || '', bank: cheque.bank || '', notes: cheque.notes || '',
        }
      : blankCheque()
  );
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.customer.trim()) return show('Customer name is required.', 'error');
    if (!form.chequeDate) return show('Cheque collection date is required.', 'error');
    if (form.amount === '' || Number(form.amount) < 0) return show('Enter a valid amount.', 'error');

    setBusy(true);
    try {
      const payload = { ...form, amount: Number(form.amount) };
      if (isEdit) { await chequeApi.update(cheque.id, payload); show('Cheque updated.', 'success'); }
      else { await chequeApi.create(payload); show('Cheque added.', 'success'); }
      onSaved();
      onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit Cheque' : 'Add Cheque'} width="sm:max-w-[520px]">
      <div className="space-y-3">

        {/* Type selector — Receivable / Payable */}
        <Field label="Type *">
          <div className="flex gap-2">
            {CHEQUE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set('type', t)}
                className="flex-1 rounded-lg border py-2 text-[13px] font-bold transition"
                style={{
                  borderColor: form.type === t
                    ? (t === 'Receivable' ? '#2563eb' : '#ea580c')
                    : 'var(--border)',
                  background: form.type === t
                    ? (t === 'Receivable' ? '#eff6ff' : '#fff7ed')
                    : 'var(--bg-input)',
                  color: form.type === t
                    ? (t === 'Receivable' ? '#2563eb' : '#ea580c')
                    : 'var(--text-muted)',
                }}
              >
                {t === 'Receivable' ? '↓ Receivable' : '↑ Payable'}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {form.type === 'Receivable' ? 'Money coming IN from client' : 'Money going OUT to supplier'}
          </p>
        </Field>

        <Field label="Customer / Supplier Name *">
          <Input value={form.customer} placeholder={form.type === 'Receivable' ? 'e.g. Gents World' : 'e.g. Ahmed Textiles'} onChange={(e) => set('customer', e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Country">
            <CountrySelect value={form.country} onChange={(v) => set('country', v)} />
          </Field>
          <Field label="Mobile (optional)">
            <div className="flex">
              <span
                className="flex items-center whitespace-nowrap rounded-l-md border border-r-0 px-2.5 text-[13px] font-bold"
                style={{ backgroundColor: 'var(--bg-card-head)', borderColor: 'var(--input-border)', color: 'var(--text-primary)' }}
              >
                +{dialFor(form.country) || '—'}
              </span>
              <Input className="!rounded-l-none" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} />
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount *">
            <Input type="number" min="0" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
          </Field>
          <Field label="Cheque Date *">
            <Input type="date" value={form.chequeDate} onChange={(e) => set('chequeDate', e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Cheque Number (optional)">
            <Input value={form.chequeNumber} placeholder="e.g. 004521" onChange={(e) => set('chequeNumber', e.target.value)} />
          </Field>
          <Field label="Bank (optional)">
            <Input value={form.bank} placeholder="e.g. Emirates NBD" onChange={(e) => set('bank', e.target.value)} />
          </Field>
        </div>

        <Field label="Notes (optional)">
          <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          A reminder notification is sent to you and the company admins on the collection date.
        </p>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}
          style={{ background: form.type === 'Receivable' ? '#2563eb' : '#ea580c', border: 'none', color: '#fff' }}>
          {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Save Cheque'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function ChequeCalendar() {
  const { show } = useToast();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [cheques, setCheques] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [formTarget, setFormTarget] = useState(null);

  // Filters
  const [filterType, setFilterType] = useState('All');   // All | Receivable | Payable
  const [filterStatus, setFilterStatus] = useState('All'); // All | Pending | Collected | Bounced
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const from = new Date(year, month, 1 - 7);
      const to = new Date(year, month + 1, 7);
      const list = await chequeApi.list({
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      });
      setCheques(list || []);
    } catch (e) {
      show(apiError(e), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply filters for display
  const filteredCheques = useMemo(() => cheques.filter(c => {
    if (filterType !== 'All' && c.type !== filterType) return false;
    if (filterStatus !== 'All' && c.status !== filterStatus) return false;
    if (dateFrom && (c.chequeDate || '').slice(0, 10) < dateFrom) return false;
    if (dateTo   && (c.chequeDate || '').slice(0, 10) > dateTo)   return false;
    return true;
  }), [cheques, filterType, filterStatus, dateFrom, dateTo]);

  const exportCsv = () => {
    const header = ['Date', 'Type', 'Customer', 'Mobile', 'Bank', 'Cheque #', 'Amount', 'Status', 'Notes'];
    const rows = filteredCheques.map((c) => [
      (c.chequeDate || '').slice(0, 10), c.type || 'Receivable', c.customer || '',
      c.mobile || '', c.bank || '', c.chequeNumber || '', c.amount ?? '',
      c.status || '', (c.notes || '').replace(/"/g, '""'),
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const label = dateFrom && dateTo ? `${dateFrom}_${dateTo}` : `${year}-${String(month + 1).padStart(2, '0')}`;
    Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: `cheques_${label}.csv`,
    }).click();
  };

  const byDay = useMemo(() => {
    const m = new Map();
    for (const c of filteredCheques) {
      if (!c.chequeDate) continue;
      const k = dkey(c.chequeDate);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(c);
    }
    return m;
  }, [filteredCheques]);

  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const goMonth = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setMonth(m); setYear(y);
  };

  const markCollected = async (c) => {
    try { await chequeApi.setStatus(c.id, 'Collected'); show('Marked as collected.', 'success'); load(); }
    catch (e) { show(apiError(e), 'error'); }
  };
  const removeCheque = async (c) => {
    if (!confirm(`Delete the cheque entry for ${c.customer}?`)) return;
    try { await chequeApi.remove(c.id); show('Cheque deleted.', 'success'); load(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  const selectedCheques = byDay.get(selectedDay) || [];

  // Summary KPIs for current month view (filtered)
  const monthTotal = filteredCheques.reduce((s, c) => s + (c.amount || 0), 0);
  const receivableTotal = filteredCheques.filter(c => c.type === 'Receivable').reduce((s, c) => s + (c.amount || 0), 0);
  const payableTotal = filteredCheques.filter(c => c.type === 'Payable').reduce((s, c) => s + (c.amount || 0), 0);
  const pendingCount = filteredCheques.filter(c => c.status === 'Pending').length;

  return (
    <>
      <PageTitle
        icon={<Banknote size={18} />}
        badge={filteredCheques.length}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={!filteredCheques.length} onClick={exportCsv}>
              <Download size={13} className="mr-1" />CSV
            </Button>
            <Button onClick={() => setFormTarget('new')}><Plus size={14} className="mr-1.5" />Add Cheque</Button>
          </div>
        }
      >
        Cheque Calendar
      </PageTitle>

      {/* KPI Summary */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Receivable', value: fmtAED(receivableTotal), color: '#2563eb', bg: '#eff6ff' },
          { label: 'Payable',    value: fmtAED(payableTotal),    color: '#ea580c', bg: '#fff7ed' },
          { label: 'Net',        value: fmtAED(receivableTotal - payableTotal), color: receivableTotal >= payableTotal ? '#16a34a' : '#dc2626', bg: '#f9fafb' },
          { label: 'Pending',    value: `${pendingCount} cheque${pendingCount !== 1 ? 's' : ''}`, color: '#d97706', bg: '#fffbeb' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className="rounded-xl border p-3" style={{ background: bg, borderColor: color + '40' }}>
            <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>{label}</div>
            <div className="mt-1 text-[15px] font-black" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardBody>
          {/* Month nav + filters */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => goMonth(-1)} className="rounded-md border p-1.5" style={{ borderColor: 'var(--border-card)' }} title="Previous month">
              <ChevronLeft size={16} />
            </button>
            <div className="text-sm font-bold flex-1" style={{ color: 'var(--text-primary)' }}>
              {MONTH_NAMES[month]} {year}
            </div>
            <button type="button" onClick={() => goMonth(1)} className="rounded-md border p-1.5" style={{ borderColor: 'var(--border-card)' }} title="Next month">
              <ChevronRight size={16} />
            </button>

            {/* Filters */}
            <div className="flex items-center gap-1.5 ml-2">
              <Filter size={12} style={{ color: 'var(--text-muted)' }} />
              {['All', 'Receivable', 'Payable'].map(t => (
                <button key={t} onClick={() => setFilterType(t)}
                  className="rounded-full px-2.5 py-1 text-[11px] font-bold border transition"
                  style={{
                    background: filterType === t ? (t === 'Receivable' ? '#eff6ff' : t === 'Payable' ? '#fff7ed' : 'var(--bg-card-head)') : 'transparent',
                    borderColor: filterType === t ? (t === 'Receivable' ? '#2563eb' : t === 'Payable' ? '#ea580c' : 'var(--border)') : 'var(--border-card)',
                    color: filterType === t ? (t === 'Receivable' ? '#2563eb' : t === 'Payable' ? '#ea580c' : 'var(--text-primary)') : 'var(--text-muted)',
                  }}>
                  {t}
                </button>
              ))}
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>·</span>
              {['All', 'Pending', 'Collected', 'Bounced'].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className="rounded-full px-2.5 py-1 text-[11px] font-bold border transition"
                  style={{
                    background: filterStatus === s ? 'var(--bg-card-head)' : 'transparent',
                    borderColor: filterStatus === s ? 'var(--border)' : 'var(--border-card)',
                    color: filterStatus === s ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}>
                  {s}
                </button>
              ))}
              <span className="mx-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>·</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="rounded border px-2 py-0.5 text-[11px]"
                style={{ borderColor: 'var(--border-card)', color: 'var(--text-primary)', background: 'var(--bg-card)' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>–</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="rounded border px-2 py-0.5 text-[11px]"
                style={{ borderColor: 'var(--border-card)', color: 'var(--text-primary)', background: 'var(--bg-card)' }} />
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>✕</button>
              )}
            </div>
          </div>

          {/* Legend */}
          <div className="mb-2 flex flex-wrap gap-3 text-[10px] font-semibold">
            {[
              { color: '#2563eb', bg: '#eff6ff', label: 'Receivable (pending)' },
              { color: '#ea580c', bg: '#fff7ed', label: 'Payable (pending)' },
              { color: '#16a34a', bg: '#f0fdf4', label: 'Collected' },
              { color: '#dc2626', bg: '#fef2f2', label: 'Bounced' },
              { color: '#7c3aed', bg: '#faf5ff', label: 'Mixed' },
            ].map(({ color, bg, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="h-3 w-5 rounded" style={{ background: bg, border: `1px solid ${color}` }} />
                <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              </div>
            ))}
          </div>

          {loading ? (
            <Spinner label="Loading cheque calendar…" />
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>
                {DOW.map((d) => <div key={d} className="py-1">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((d, i) => {
                  if (d === null) return <div key={`b${i}`} className="aspect-square" />;
                  const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const dayCheques = byDay.get(key) || [];
                  const isToday = key === todayKey();
                  const isSelected = key === selectedDay;
                  const color = dayColor(dayCheques);

                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setSelectedDay(key)}
                      className="aspect-square rounded-lg border p-1 text-left transition-all"
                      style={{
                        borderColor: isSelected ? '#015FDE' : color ? color.border : 'var(--border-card)',
                        backgroundColor: color ? color.bg : isSelected ? 'var(--bg-card-head)' : 'transparent',
                        outline: isToday ? '2px solid #015FDE' : 'none',
                        outlineOffset: '1px',
                      }}
                    >
                      <div className="text-[11px] font-bold" style={{ color: color ? color.text : 'var(--text-primary)' }}>{d}</div>
                      {dayCheques.length > 0 && (
                        <div className="mt-0.5">
                          <div className="text-[9px] font-bold truncate" style={{ color: color?.text || 'var(--text-muted)' }}>
                            {dayCheques.length > 1 ? `${dayCheques.length}×` : ''}
                            {fmtAED(dayCheques.reduce((s, c) => s + (c.amount || 0), 0))}
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
              <Landmark size={14} />
              Cheques — {selectedDay}
            </div>
            {selectedCheques.length > 0 && (
              <div className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                Total: {fmtAED(selectedCheques.reduce((s, c) => s + (c.amount || 0), 0))}
              </div>
            )}
          </div>

          {!selectedCheques.length ? (
            <EmptyState title="No cheques on this day" hint="Pick another date or add one." />
          ) : (
            <div className="space-y-2">
              {selectedCheques.map((c) => {
                const isReceivable = c.type !== 'Payable';
                const typeColor = isReceivable ? '#2563eb' : '#ea580c';
                const typeBg = isReceivable ? '#eff6ff' : '#fff7ed';
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-xl border-l-4 border p-2.5"
                    style={{ borderLeftColor: typeColor, borderColor: 'var(--border-card)' }}
                  >
                    <button type="button" onClick={() => setFormTarget(c)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: typeBg, color: typeColor }}>
                          {c.type || 'Receivable'}
                        </span>
                        <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{c.customer}</span>
                        {c.status !== 'Pending' && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${c.status === 'Collected' ? 'bg-ok-light text-ok' : 'bg-danger-light text-danger'}`}>
                            {c.status}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        {c.chequeNumber ? `Cheque #${c.chequeNumber}` : 'No cheque number'}
                        {c.bank ? ` · ${c.bank}` : ''}
                        {c.mobile ? ` · ${c.mobile}` : ''}
                      </div>
                    </button>
                    <div className="text-right text-xs font-black" style={{ color: typeColor }}>{fmtAED(c.amount)}</div>
                    <div className="flex gap-1">
                      {c.status === 'Pending' && (
                        <Button size="sm" variant="outline" title="Mark collected" onClick={() => markCollected(c)}>
                          <Check size={13} />
                        </Button>
                      )}
                      <Button size="sm" variant="red" title="Delete" onClick={() => removeCheque(c)}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {formTarget && (
        <ChequeFormModal
          cheque={formTarget === 'new' ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={load}
        />
      )}
    </>
  );
}