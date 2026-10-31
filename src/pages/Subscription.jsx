import { useState } from 'react';
import { Receipt, Pencil, Loader2 } from 'lucide-react';
import { companyApi } from '../api/endpoints.js';
import { useFetch } from '../hooks/useApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { apiError } from '../api/client.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { Field, Input, Select } from '../components/ui/Field.jsx';
import { fmtINR, formatDate } from '../utils/format.js';

const PLANS = ['Free', 'Basic', 'Pro', 'Enterprise'];
const STATUSES = ['Trial', 'Active', 'Past Due', 'Expired', 'Cancelled'];
const STATUS_CLASS = {
  Active: 'bg-ok-light text-ok',
  Trial: 'bg-info-light text-info',
  'Past Due': 'bg-warn-light text-warn',
  Expired: 'bg-danger-light text-danger',
  Cancelled: 'bg-gray-100 text-ink-3',
};

// date -> yyyy-mm-dd for <input type=date>
const dInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function SubscriptionModal({ company, onClose, onSaved }) {
  const { show } = useToast();
  const s = company.subscription || {};
  const [form, setForm] = useState({
    plan: s.plan || 'Free',
    status: s.status || 'Trial',
    monthlyFee: s.monthlyFee ?? 0,
    startDate: dInput(s.startDate),
    renewalDate: dInput(s.renewalDate),
    lastPaymentDate: dInput(s.lastPaymentDate),
    lastPaymentAmount: s.lastPaymentAmount ?? 0,
    paymentMethod: s.paymentMethod || '',
    paymentRef: s.paymentRef || '',
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await companyApi.setSubscription(company.id, {
        plan: form.plan,
        status: form.status,
        monthlyFee: Number(form.monthlyFee) || 0,
        startDate: form.startDate || null,
        renewalDate: form.renewalDate || null,
        lastPaymentDate: form.lastPaymentDate || null,
        lastPaymentAmount: Number(form.lastPaymentAmount) || 0,
        paymentMethod: form.paymentMethod,
        paymentRef: form.paymentRef,
      });
      show('Subscription updated.', 'success');
      onSaved();
      onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Subscription — ${company.name}`} width="sm:max-w-[560px]">
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Plan">
            <Select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
              {PLANS.map((p) => <option key={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Billing Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {STATUSES.map((p) => <option key={p}>{p}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Monthly Fee (₹ INR)">
            <Input type="number" min={0} value={form.monthlyFee} onChange={(e) => setForm({ ...form, monthlyFee: e.target.value })} />
            <span className="mt-1 block text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Yearly: {fmtINR((Number(form.monthlyFee) || 0) * 12)}
            </span>
          </Field>
          <Field label="Payment Method">
            <Input value={form.paymentMethod} placeholder="Bank Transfer / Card" onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Subscription Start">
            <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
          <Field label="Renewal / Expiry">
            <Input type="date" value={form.renewalDate} onChange={(e) => setForm({ ...form, renewalDate: e.target.value })} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Last Payment Date">
            <Input type="date" value={form.lastPaymentDate} onChange={(e) => setForm({ ...form, lastPaymentDate: e.target.value })} />
          </Field>
          <Field label="Last Payment Amount (₹ INR)">
            <Input type="number" min={0} value={form.lastPaymentAmount} onChange={(e) => setForm({ ...form, lastPaymentAmount: e.target.value })} />
          </Field>
        </div>

        <Field label="Payment Reference (optional)">
          <Input value={form.paymentRef} placeholder="txn id / cheque no." onChange={(e) => setForm({ ...form, paymentRef: e.target.value })} />
        </Field>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>{busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Save'}</Button>
      </div>
    </Modal>
  );
}

export default function Subscription() {
  const { data: companies, loading, refetch } = useFetch(() => companyApi.list(), []);
  const [editing, setEditing] = useState(null);

  if (loading) return <Spinner label="Loading subscriptions…" />;

  return (
    <>
      <PageTitle icon={<Receipt size={18} />} badge={companies?.length}>Subscriptions</PageTitle>

      <Card className="overflow-x-auto">
        {!companies?.length ? (
          <EmptyState title="No companies yet" hint="Create a company first, then set its plan here." />
        ) : (
          <table className="w-full min-w-[820px] border-collapse">
            <thead><tr className="bg-navy-800 text-white">
              {['Sl. No', 'Company', 'Plan', 'Status', 'Monthly Fee', 'Renewal', 'Last Payment', 'Actions'].map((h) => (
                <th key={h} className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {companies.map((c, i) => {
                const s = c.subscription || {};
                return (
                  <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gold-pale">
                    <td className="px-2.5 py-2 text-xs text-ink-3">{i + 1}</td>
                    <td className="px-2.5 py-2 text-xs font-bold">{c.name}</td>
                    <td className="px-2.5 py-2 text-xs font-bold">{s.plan || 'Free'}</td>
                    <td className="px-2.5 py-2"><span className={`status ${STATUS_CLASS[s.status] || 'bg-gray-100 text-ink-3'}`}>{s.status || 'Trial'}</span></td>
                    <td className="px-2.5 py-2 text-xs">
                      {fmtINR(s.monthlyFee || 0)}
                      <span className="ml-1 text-[10px] text-ink-3">/mo · {fmtINR((s.monthlyFee || 0) * 12)}/yr</span>
                    </td>
                    <td className="px-2.5 py-2 text-xs whitespace-nowrap">{s.renewalDate ? formatDate(s.renewalDate) : '—'}</td>
                    <td className="px-2.5 py-2 text-xs whitespace-nowrap">
                      {s.lastPaymentDate ? <>{formatDate(s.lastPaymentDate)} <span className="text-[10px] text-ink-3">({fmtINR(s.lastPaymentAmount || 0)})</span></> : '—'}
                    </td>
                    <td className="px-2.5 py-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(c)}><Pencil size={13} className="mr-1" />Manage</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {editing && <SubscriptionModal company={editing} onClose={() => setEditing(null)} onSaved={refetch} />}
    </>
  );
}