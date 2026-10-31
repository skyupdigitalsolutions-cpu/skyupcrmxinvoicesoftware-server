// pages/PurchaseOrders.jsx
import { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Download, X, Save, Eye } from 'lucide-react';
import { useFetch } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api, apiError } from '../api/client.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { Field, Input, Select, Textarea } from '../components/ui/Field.jsx';
import { formatDate, fmtAED, fmtNum } from '../utils/format.js';
import { buildPurchaseOrderPdfBlob } from '../utils/purchaseOrderPdf.js';

// ── API helper (no separate endpoints file change needed) ────────────────────
const poApi = {
  list:          (params) => api.get('/purchase-orders', { params }).then((r) => r.data.purchaseOrders),
  get:           (id)     => api.get(`/purchase-orders/${id}`).then((r) => r.data.purchaseOrder),
  create:        (body)   => api.post('/purchase-orders', body).then((r) => r.data.purchaseOrder),
  update:        (id, b)  => api.put(`/purchase-orders/${id}`, b).then((r) => r.data.purchaseOrder),
  setStatus:     (id, s)  => api.patch(`/purchase-orders/${id}/status`, { status: s }).then((r) => r.data.purchaseOrder),
  setPayment:    (id, s)  => api.patch(`/purchase-orders/${id}/payment`, { paymentStatus: s }).then((r) => r.data.purchaseOrder),
  remove:        (id)     => api.delete(`/purchase-orders/${id}`).then((r) => r.data),
};

const PO_STATUSES    = ['Draft', 'Ordered', 'Received', 'Cancelled'];
const PO_PAY_STATUSES = ['Unpaid', 'Partial', 'Paid'];

const STATUS_CLASS = {
  Draft:     'bg-gray-100 text-gray-600',
  Ordered:   'bg-blue-100 text-blue-700',
  Received:  'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-600',
};
const PAY_CLASS = {
  Unpaid:  'bg-red-100 text-red-600',
  Partial: 'bg-yellow-100 text-yellow-700',
  Paid:    'bg-green-100 text-green-700',
};

const blankItem = () => ({ modelCode: '', description: '', size: '', qty: 1, price: 0 });

// ── Item row editor ──────────────────────────────────────────────────────────
function ItemRow({ item, idx, onChange, onRemove, showRemove }) {
  const amt = (Number(item.qty) || 0) * (Number(item.price) || 0);
  return (
    <tr className="border-b border-gray-100">
      <td className="py-1 pr-1 text-xs text-ink-3">{idx + 1}</td>
      <td className="py-1 pr-1">
        <input
          className="w-full rounded border px-1.5 py-1 text-xs"
          style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
          placeholder="Art No."
          value={item.modelCode}
          onChange={(e) => onChange(idx, 'modelCode', e.target.value)}
        />
      </td>
      <td className="py-1 pr-1">
        <input
          className="w-full rounded border px-1.5 py-1 text-xs"
          style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
          placeholder="Description"
          value={item.description}
          onChange={(e) => onChange(idx, 'description', e.target.value)}
        />
      </td>
      <td className="py-1 pr-1 w-16">
        <input
          className="w-full rounded border px-1.5 py-1 text-xs"
          style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
          placeholder="Size"
          value={item.size}
          onChange={(e) => onChange(idx, 'size', e.target.value)}
        />
      </td>
      <td className="py-1 pr-1 w-16">
        <input
          type="number" min="0"
          className="w-full rounded border px-1.5 py-1 text-xs text-right"
          style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
          value={item.qty}
          onChange={(e) => onChange(idx, 'qty', e.target.value)}
        />
      </td>
      <td className="py-1 pr-1 w-24">
        <input
          type="number" min="0" step="0.01"
          className="w-full rounded border px-1.5 py-1 text-xs text-right"
          style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
          value={item.price}
          onChange={(e) => onChange(idx, 'price', e.target.value)}
        />
      </td>
      <td className="py-1 pr-1 w-24 text-right text-xs font-bold">{fmtNum(amt)}</td>
      {showRemove && (
        <td className="py-1 w-6">
          <button
            type="button"
            onClick={() => onRemove(idx)}
            className="rounded p-0.5 text-red-400 hover:text-red-600"
          ><X size={12} /></button>
        </td>
      )}
    </tr>
  );
}

// ── PO Form Modal ────────────────────────────────────────────────────────────
function POFormModal({ po, onClose, onSaved, allPos }) {
  const { show } = useToast();
  const isEdit = !!po;

  const [form, setForm] = useState({
    supplierName:    po?.supplierName    || '',
    supplierContact: po?.supplierContact || '',
    city:            po?.city            || '',
    country:         po?.country         || 'UAE',
    paymentStatus:   po?.paymentStatus   || 'Unpaid',
    notes:           po?.notes           || '',
    date:            po?.date ? new Date(po.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  });
  const [items, setItems] = useState(
    po?.items?.length ? po.items.map((i) => ({ ...i })) : [blankItem()]
  );
  const [busy, setBusy] = useState(false);

  // Build unique supplier list from all existing POs
  const supplierMap = {};
  (allPos || []).forEach((p) => {
    if (p.supplierName && !supplierMap[p.supplierName]) {
      supplierMap[p.supplierName] = {
        contact: p.supplierContact || '',
        city:    p.city            || '',
        country: p.country         || 'UAE',
      };
    }
  });
  const supplierNames = Object.keys(supplierMap);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // When supplier name matches an existing one, auto-fill their details
  const handleSupplierChange = (name) => {
    set('supplierName', name);
    if (supplierMap[name]) {
      const s = supplierMap[name];
      setForm((f) => ({
        ...f,
        supplierName:    name,
        supplierContact: s.contact || f.supplierContact,
        city:            s.city    || f.city,
        country:         s.country || f.country,
      }));
    }
  };

  const changeItem = (idx, key, val) => {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [key]: val } : it));
  };
  const addItem    = () => setItems((p) => [...p, blankItem()]);
  const removeItem = (idx) => setItems((p) => p.filter((_, i) => i !== idx));

  const subTotal   = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const totalQty   = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);

  const save = async () => {
    if (!form.supplierName.trim()) { show('Supplier name is required', 'error'); return; }
    if (!items.some((it) => it.modelCode.trim())) { show('Add at least one item with an article number', 'error'); return; }
    setBusy(true);
    try {
      const payload = {
        ...form,
        items: items.map((it) => ({
          modelCode:   String(it.modelCode).trim(),
          description: String(it.description || '').trim(),
          size:        String(it.size || '').trim(),
          qty:         Number(it.qty)   || 0,
          price:       Number(it.price) || 0,
        })).filter((it) => it.modelCode),
      };
      const saved = isEdit
        ? await poApi.update(po._id, payload)
        : await poApi.create(payload);
      show(isEdit ? 'Purchase order updated.' : `PO #${saved.poNo} created.`, 'success');
      onSaved();
      onClose();
    } catch (e) {
      show(apiError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit PO #${po.poNo}` : 'New Purchase Order'}
      width="max-w-4xl"
    >
      {/* Header fields */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Order Date *">
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Supplier Name *">
          <div className="relative">
            <input
              list="supplier-list"
              placeholder="Select or type new supplier…"
              value={form.supplierName}
              onChange={(e) => handleSupplierChange(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
            />
            <datalist id="supplier-list">
              {supplierNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
        </Field>
        <Field label="Supplier Contact No.">
          <Input placeholder="e.g. +971501234567" value={form.supplierContact} onChange={(e) => set('supplierContact', e.target.value)} />
        </Field>
        <Field label="Payment Status">
          <Select value={form.paymentStatus} onChange={(e) => set('paymentStatus', e.target.value)}>
            {PO_PAY_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="City / Area">
          <Input placeholder="e.g. Al Quoz" value={form.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Country">
          <Input placeholder="e.g. UAE" value={form.country} onChange={(e) => set('country', e.target.value)} />
        </Field>
      </div>

      {/* Items table */}
      <div className="mt-4">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Purchase Items
        </div>
        <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--border-card)' }}>
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="bg-navy-800 text-white text-[11px]">
                {['#', 'Article No.', 'Description', 'Size', 'Qty', 'Price', 'Amount', ''].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left font-bold uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <ItemRow
                  key={idx}
                  item={it}
                  idx={idx}
                  onChange={changeItem}
                  onRemove={removeItem}
                  showRemove={items.length > 1}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 text-xs font-bold">
                <td colSpan={4} className="px-2 py-1.5 text-right text-ink-3">Total</td>
                <td className="px-2 py-1.5 text-right">{fmtNum(totalQty)}</td>
                <td />
                <td className="px-2 py-1.5 text-right">{fmtAED(subTotal)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <button
          type="button"
          onClick={addItem}
          className="mt-2 flex items-center gap-1 text-[12px] font-bold"
          style={{ color: 'var(--accent)' }}
        >
          <Plus size={13} /> Add Item
        </button>
      </div>

      {/* Notes */}
      <div className="mt-3">
        <Field label="Notes (optional)">
          <Textarea rows={2} value={form.notes} placeholder="Any internal notes…" onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="green" disabled={busy} onClick={save}>
          <Save size={13} className="mr-1.5" />{busy ? 'Saving…' : isEdit ? 'Update PO' : 'Create PO'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function PurchaseOrders() {
  const { isAdmin, branding } = useAuth();
  const { show } = useToast();

  const { data: pos, loading, refetch } = useFetch(() => poApi.list(), []);

  const [search, setSearch]           = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [payFilter, setPayFilter]     = useState('');
  const [form, setForm]               = useState(null); // null | 'new' | po object
  const [pdfBusy, setPdfBusy]         = useState(null);

  const filtered = useMemo(() => {
    if (!pos) return [];
    const q = search.toLowerCase();
    return pos.filter((p) =>
      (!q || p.supplierName.toLowerCase().includes(q) || `${p.poNo}`.includes(q) || (p.supplierContact || '').includes(q)) &&
      (!statusFilter || p.status === statusFilter) &&
      (!payFilter    || p.paymentStatus === payFilter)
    );
  }, [pos, search, statusFilter, payFilter]);

  const del = async (p) => {
    if (!confirm(`Delete PO #${p.poNo}? This cannot be undone.`)) return;
    try { await poApi.remove(p._id); show('Purchase order deleted.'); refetch(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  const changeStatus = async (p, status) => {
    try { await poApi.setStatus(p._id, status); refetch(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  const changePayment = async (p, paymentStatus) => {
    try { await poApi.setPayment(p._id, paymentStatus); refetch(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  const downloadPdf = async (p) => {
    setPdfBusy(p._id);
    try {
      const { blob, filename } = await buildPurchaseOrderPdfBlob(p, branding);
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: filename }).click();
      URL.revokeObjectURL(url);
    } catch (e) {
      show(e.message || 'Could not generate PDF.', 'error');
    } finally {
      setPdfBusy(null);
    }
  };

  const fmt2 = (n) => Number(n || 0).toFixed(2);
  const exportCsv = () => {
    const header = [
      'PO #', 'Date', 'Supplier', 'Contact', 'City', 'Country',
      'Payment Status', 'Status',
      'Article No.', 'Description', 'Size', 'Qty', 'Rate (AED)', 'Line Amt (AED)',
      'Grand Total (AED)',
    ];
    const rows = [];
    filtered.forEach((p) => {
      const items = p.items || [];
      if (!items.length) {
        rows.push([
          `PO-${p.poNo}`, new Date(p.date).toLocaleDateString(),
          p.supplierName, p.supplierContact || '—', p.city || '—', p.country,
          p.paymentStatus, p.status,
          '—', '—', '—', '', '', '', fmt2(p.grandTotal),
        ]);
      } else {
        items.forEach((it, iIdx) => {
          const lineAmt = fmt2((it.qty || 0) * (it.price || 0));
          rows.push([
            iIdx === 0 ? `PO-${p.poNo}` : '',
            iIdx === 0 ? new Date(p.date).toLocaleDateString() : '',
            iIdx === 0 ? p.supplierName : '',
            iIdx === 0 ? (p.supplierContact || '—') : '',
            iIdx === 0 ? (p.city || '—') : '',
            iIdx === 0 ? p.country : '',
            iIdx === 0 ? p.paymentStatus : '',
            iIdx === 0 ? p.status : '',
            it.modelCode || '—',
            it.description || '—',
            it.size || '—',
            it.qty ?? '',
            fmt2(it.price || 0),
            lineAmt,
            iIdx === 0 ? fmt2(p.grandTotal) : '',
          ]);
        });
      }
    });
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `purchase_orders_${new Date().toISOString().slice(0, 10)}.csv`,
    }).click();
  };

  // KPI totals
  const totalValue   = (pos || []).reduce((s, p) => s + (p.grandTotal || 0), 0);
  const unpaidCount  = (pos || []).filter((p) => p.paymentStatus === 'Unpaid').length;
  const receivedCount = (pos || []).filter((p) => p.status === 'Received').length;

  if (loading) return <Spinner label="Loading purchase orders…" />;

  return (
    <>
      <PageTitle
        icon={<Download size={18} />}
        badge={filtered.length}
        actions={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button variant="outline" size="sm" disabled={!filtered.length} onClick={exportCsv}>
                <Download size={13} className="mr-1" />CSV
              </Button>
            )}
            <Button onClick={() => setForm('new')}>
              <Plus size={14} className="mr-1.5" />New PO
            </Button>
          </div>
        }
      >
        Purchase Orders
      </PageTitle>

      {/* KPI strip */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { label: 'Total Value',  value: fmtAED(totalValue),            color: '#2563eb', bg: '#eff6ff' },
          { label: 'Unpaid',       value: `${unpaidCount} PO${unpaidCount !== 1 ? 's' : ''}`, color: '#dc2626', bg: '#fef2f2' },
          { label: 'Received',     value: `${receivedCount} PO${receivedCount !== 1 ? 's' : ''}`, color: '#16a34a', bg: '#f0fdf4' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className="rounded-xl border p-3" style={{ background: bg, borderColor: color + '40' }}>
            <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>{label}</div>
            <div className="mt-1 text-[15px] font-black" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <Input className="!w-52" placeholder="Search supplier / PO #…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="!w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {PO_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select className="!w-auto" value={payFilter} onChange={(e) => setPayFilter(e.target.value)}>
          <option value="">All Payments</option>
          {PO_PAY_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        {(search || statusFilter || payFilter) && (
          <Button variant="outline" size="sm" onClick={() => { setSearch(''); setStatusFilter(''); setPayFilter(''); }}>
            <X size={12} className="mr-1" />Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState title="No purchase orders" hint="Create your first PO with the New PO button." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-navy-800 text-white">
                  {['PO #', 'Date', 'Supplier', 'Contact', 'City / Country', 'Items', 'Total', 'Payment', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p._id} className="border-b border-gray-100 last:border-0 hover:bg-gold-pale [&>td]:align-middle">
                    <td className="px-2.5 py-2 text-xs font-bold text-blue-700">PO-{p.poNo}</td>
                    <td className="px-2.5 py-2 text-xs whitespace-nowrap">{formatDate(p.date)}</td>
                    <td className="px-2.5 py-2 text-xs font-bold">{p.supplierName}</td>
                    <td className="px-2.5 py-2 text-xs">{p.supplierContact || '—'}</td>
                    <td className="px-2.5 py-2 text-xs">{[p.city, p.country].filter(Boolean).join(', ')}</td>
                    <td className="px-2.5 py-2 text-xs text-center">{p.items.length}</td>
                    <td className="px-2.5 py-2 text-xs font-bold whitespace-nowrap">{fmtAED(p.grandTotal)}</td>

                    {/* Payment status — admin can change inline */}
                    <td className="px-2.5 py-2">
                      {isAdmin ? (
                        <select
                          value={p.paymentStatus || 'Unpaid'}
                          onChange={(e) => changePayment(p, e.target.value)}
                          className={`status cursor-pointer border-0 ${PAY_CLASS[p.paymentStatus || 'Unpaid']}`}
                        >
                          {PO_PAY_STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      ) : (
                        <span className={`status ${PAY_CLASS[p.paymentStatus || 'Unpaid']}`}>{p.paymentStatus || 'Unpaid'}</span>
                      )}
                    </td>

                    {/* PO status — admin can change inline */}
                    <td className="px-2.5 py-2">
                      {isAdmin ? (
                        <select
                          value={p.status}
                          onChange={(e) => changeStatus(p, e.target.value)}
                          className={`status cursor-pointer border-0 ${STATUS_CLASS[p.status]}`}
                        >
                          {PO_STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      ) : (
                        <span className={`status ${STATUS_CLASS[p.status]}`}>{p.status}</span>
                      )}
                    </td>

                    <td className="px-2.5 py-2">
                      <div className="flex items-center gap-1 flex-nowrap">
                        <Button size="sm" variant="outline" title="Download PDF"
                          disabled={pdfBusy === p._id}
                          onClick={() => downloadPdf(p)}
                        >
                          <Download size={13} className={pdfBusy === p._id ? 'animate-pulse' : ''} />
                        </Button>
                        <Button size="sm" variant="outline" title="Edit"
                          onClick={() => setForm(p)}
                        >
                          <Pencil size={13} />
                        </Button>
                        {isAdmin && (
                          <Button size="sm" variant="red" title="Delete" onClick={() => del(p)}>
                            <Trash2 size={13} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Form modal */}
      {form && (
        <POFormModal
          po={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSaved={refetch}
          allPos={pos || []}
        />
      )}
    </>
  );
}
