// ─────────────────────────────────────────────────────────────────────────────
// OrderForm.jsx
// Create or edit a sales order. Mobile number is used as the CRM primary key:
// an existing lead auto-fills the form; a new number triggers lead creation on
// save.
// ─────────────────────────────────────────────────────────────────────────────

import { Pencil, Plus, Save, UserCheck, UserPlus, Loader2, AlertCircle } from 'lucide-react';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { orderApi, userApi, leadApi } from '../api/endpoints.js';
import { apiError, api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fmtAED, todayStr, dialFor, ORDER_STATUSES } from '../utils/format.js';
import CountrySelect from '../components/ui/CountrySelect.jsx';

import PageTitle from '../components/layout/PageTitle.jsx';
import { Card, CardHead, CardBody } from '../components/ui/Card.jsx';
import { Field, Input, Select, Textarea } from '../components/ui/Field.jsx';
import Button from '../components/ui/Button.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import Modal from '../components/ui/Modal.jsx';
import OrderItemsEditor, { blankItem } from '../components/OrderItemsEditor.jsx';


// ─── Constants ────────────────────────────────────────────────────────────────

const PAY_TERMS = [
  'Cash on Delivery',
  'Cash or Bank Transfer',
  'Credit',
  'Cheque on Delivery',
  'Cash Paid',
  'Cash',
];

// Terms where payment is already received in full at the time of the order —
// Due Amount auto-resets to 0 when one of these is selected. Every other term
// implies payment is still outstanding, so Due auto-fills with the full
// Grand Total (i.e. fully pending) until the amount is edited manually.
const PAID_TERMS = ['Cash Paid', 'Cash'];

const INITIAL_FORM = {
  date: todayStr(),
  customer: '',
  city: '',
  country: '',
  mobile: '',
  delivery: '',
  deliveryContact: '',
  payTerms: 'Cash on Delivery',
  salesperson: '',
  items: [blankItem()],
  discount: 0,
  due: 0,
  status: 'Pending',
  notes: '',
  orderNo: null,
};

/** Minimum digit length before a mobile lookup fires. */
const MIN_MOBILE_DIGITS = 6;

/** Debounce delay (ms) for the lead-lookup call. */
const LOOKUP_DEBOUNCE_MS = 450;


// ─── Custom hook: lead lookup ─────────────────────────────────────────────────

/**
 * Debounced lead lookup keyed on mobile + country.
 * Returns { leadId, leadState } and handlers to call from the form.
 *
 * leadState: 'idle' | 'checking' | 'found' | 'new'
 */
function useLeadLookup({ editing, setForm }) {
  const [leadId, setLeadId]     = useState(null);
  const [leadState, setLeadState] = useState('idle');
  const timerRef                = useRef(null);

  // Cancel pending timer on unmount.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const runLookup = (mobile, country) => {
    const digits = (mobile || '').replace(/\D/g, '');
    clearTimeout(timerRef.current);

    if (digits.length < MIN_MOBILE_DIGITS) {
      setLeadState('idle');
      setLeadId(null);
      return;
    }

    setLeadState('checking');

    timerRef.current = setTimeout(async () => {
      try {
        const res = await leadApi.lookup(digits, country);

        if (res.exists && res.lead) {
          setLeadId(res.lead._id);
          setLeadState('found');
          // Auto-fill customer details from the matched lead.
          setForm((prev) => ({
            ...prev,
            customer: res.lead.name    || prev.customer,
            city:     res.lead.city    || prev.city,
            country:  res.lead.country || prev.country,
            delivery: res.lead.delivery || prev.delivery,
          }));
        } else {
          setLeadId(null);
          setLeadState('new');
        }
      } catch {
        setLeadState('idle');
      }
    }, LOOKUP_DEBOUNCE_MS);
  };

  const onMobileChange = (mobile, country) => {
    if (!editing) runLookup(mobile, country);
  };

  const onCountryChange = (country, mobile) => {
    if (!editing && mobile) runLookup(mobile, country);
  };

  return { leadId, leadState, onMobileChange, onCountryChange };
}


// ─── Custom hook: customer lookup (existing orders) ───────────────────────────

/**
 * Debounced lookup that fetches a customer's saved delivery details from their
 * most recent EXISTING order and pre-fills any blank fields on the form. This
 * complements the mobile-based lead lookup: it lets a user start from the
 * customer name and still recover the delivery address / city on record.
 *
 * Only fills fields that are still empty — never overwrites what the user typed.
 * custState: 'idle' | 'checking' | 'found' | 'none'
 */
const MIN_CUSTOMER_CHARS = 2;

function useCustomerLookup({ editing, setForm }) {
  const [custState, setCustState] = useState('idle');
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const onCustomerChange = (name, mobile, country) => {
    if (editing) return;
    const clean = (name || '').trim();
    clearTimeout(timerRef.current);

    if (clean.length < MIN_CUSTOMER_CHARS) {
      setCustState('idle');
      return;
    }

    setCustState('checking');
    timerRef.current = setTimeout(async () => {
      try {
        const res = await orderApi.customerLookup({ name: clean, mobile: mobile || '', country: country || '' });
        if (res && res.found && res.customer) {
          const c = res.customer;
          // Fill only blank fields, so user-entered values are preserved.
          setForm((prev) => ({
            ...prev,
            delivery: prev.delivery || c.delivery || '',
            city:     prev.city     || c.city     || '',
            country:  prev.country  || c.country  || prev.country,
            mobile:   prev.mobile   || c.mobile   || '',
            payTerms: prev.payTerms || c.payTerms || prev.payTerms,
          }));
          setCustState('found');
        } else {
          setCustState('none');
        }
      } catch {
        setCustState('idle');
      }
    }, LOOKUP_DEBOUNCE_MS);
  };

  return { custState, onCustomerChange };
}


// ─── Sub-components ───────────────────────────────────────────────────────────

/** Inline status badge shown beneath the mobile field while creating an order. */
function LeadStatus({ leadState }) {
  if (leadState === 'checking') {
    return (
      <span
        className="mt-1 flex items-center gap-1 text-[11px]"
        style={{ color: 'var(--text-muted)' }}
      >
        <Loader2 size={12} className="animate-spin" />
        Checking for existing lead…
      </span>
    );
  }

  if (leadState === 'found') {
    return (
      <span className="mt-1 flex items-center gap-1 text-[11px] font-bold text-ok">
        <UserCheck size={12} />
        Existing lead found — details auto-filled.
      </span>
    );
  }

  if (leadState === 'new') {
    return (
      <span
        className="mt-1 flex items-center gap-1 text-[11px] font-bold"
        style={{ color: 'var(--primary)' }}
      >
        <UserPlus size={12} />
        New lead — will be created on save.
      </span>
    );
  }

  return null;
}

/** Read-only prefix badge showing the country dial code. */
function DialCodePrefix({ country }) {
  return (
    <span
      className="flex items-center whitespace-nowrap rounded-l-md border border-r-0 px-2.5 text-[13px] font-bold"
      style={{
        backgroundColor: 'var(--bg-card-head)',
        borderColor:     'var(--input-border)',
        color:           'var(--text-primary)',
      }}
    >
      +{dialFor(country)}
    </span>
  );
}

/** Single totals row label + value block used in the order summary bar. */
function TotalCell({ label, value, big = false }) {
  return (
    <div className="text-right">
      <div className="text-[9px] uppercase text-white/55">{label}</div>
      <div
        className={`whitespace-nowrap ${
          big
            ? 'text-2xl font-black text-white'
            : 'text-[15px] font-bold text-white'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** Summary bar shown at the bottom of the items table. */
function OrderTotalsBar({ subTotal, discount, grandTotal }) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center justify-end gap-x-8 gap-y-2 rounded-md bg-navy px-5 py-3.5">
      <TotalCell label="Sub Total"   value={fmtAED(subTotal)} />
      <TotalCell label="Discount"    value={`${Number(discount) || 0}%`} />
      <TotalCell label="Grand Total" value={fmtAED(grandTotal)} big />
    </div>
  );
}


// ─── Section: Order Details card ──────────────────────────────────────────────

function OrderDetailsCard({ form, set, sales, editing, isAdmin, user, leadState, custState }) {
  return (
    <Card>
      <CardHead title="Order Details" />
      <CardBody>

        {/* Row 1 – meta fields */}
        <div className="mb-3 grid gap-3 md:grid-cols-4">
          <Field label="Sales Order #">
            <Input
              value={form.orderNo || 'Auto-generated'}
              readOnly
              style={{ backgroundColor: 'var(--bg-card-head)' }}
            />
          </Field>

          <Field label="Order Date *">
            <Input
              type="date"
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
            />
          </Field>

          <Field label="Salesperson *">
            {isAdmin ? (
              <Select
                value={form.salesperson}
                onChange={(e) => set('salesperson', e.target.value)}
              >
                <option value="">Select…</option>
                {sales.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            ) : (
              <Input
                value={user.name}
                readOnly
                style={{ backgroundColor: 'var(--bg-card-head)' }}
              />
            )}
          </Field>

          <Field label="Payment Status *">
            <Select
              value={form.payTerms}
              onChange={(e) => set('payTerms', e.target.value)}
            >
              {/* Keep a legacy/stored value selectable so editing an older order
                  doesn't silently overwrite its payment status. */}
              {form.payTerms && !PAY_TERMS.includes(form.payTerms) && (
                <option key={form.payTerms}>{form.payTerms}</option>
              )}
              {PAY_TERMS.map((p) => <option key={p}>{p}</option>)}
            </Select>
          </Field>
        </div>


        {/* Row 2 – customer fields */}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Billed To (Customer) *">
            <Input
              value={form.customer}
              placeholder="Customer name"
              onChange={(e) => set('customer', e.target.value)}
            />
            {!editing && custState === 'checking' && (
              <span className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <Loader2 size={12} className="animate-spin" />
                Looking up saved details…
              </span>
            )}
            {!editing && custState === 'found' && (
              <span className="mt-1 flex items-center gap-1 text-[11px] font-bold text-ok">
                <UserCheck size={12} />
                Delivery details auto-filled from a previous order.
              </span>
            )}
          </Field>

          <Field label="City / Area *">
            <Input
              value={form.city}
              placeholder="e.g. Al Quoz"
              onChange={(e) => set('city', e.target.value)}
            />
          </Field>

          <Field label="Country *">
            <CountrySelect value={form.country} onChange={(v) => set('country', v)} />
          </Field>
        </div>

        {/* Row 3 – contact + delivery */}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Contact / Mobile *">
            <div className="flex">
              <DialCodePrefix country={form.country} />
              <Input
                className="!rounded-l-none"
                value={form.mobile}
                placeholder="e.g. 506731305"
                onChange={(e) => set('mobile', e.target.value)}
              />
            </div>
            {!editing && <LeadStatus leadState={leadState} />}
          </Field>

          <Field label="Delivery Details *">
            <Input
              value={form.delivery}
              placeholder="e.g. HURIA TRANSPORT"
              onChange={(e) => set('delivery', e.target.value)}
            />
          </Field>

          {/* Entered manually — never auto-filled from the customer's mobile. */}
          <Field label="Delivery Contact No. (manual)">
            <Input
              type="tel"
              value={form.deliveryContact}
              placeholder="e.g. +971 501234567 (transporter / receiver)"
              onChange={(e) => set('deliveryContact', e.target.value.replace(/[^0-9+\-\s()]/g, ''))}
            />
            <span className="mt-1 block text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Shown as "Delivery Contact No." on the order form — include the country code.
            </span>
          </Field>
        </div>

      </CardBody>
    </Card>
  );
}


// ─── Section: Order Items card ────────────────────────────────────────────────

function OrderItemsCard({ form, set, subTotal, grandTotal }) {
  return (
    <Card>
      <CardHead title="Order Items">
        <span className="text-[10px] font-normal text-ink-3">
          Model code, category, quantity &amp; price for each item
        </span>
      </CardHead>
      <CardBody>
        <OrderItemsEditor
          items={form.items}
          onChange={(items) => set('items', items)}
        />
        <OrderTotalsBar
          subTotal={subTotal}
          discount={form.discount}
          grandTotal={grandTotal}
        />
      </CardBody>
    </Card>
  );
}


// ─── Section: Discount & Notes card ──────────────────────────────────────────

function DiscountNotesCard({ form, set, grandTotal = 0, onDueChange }) {
  // Auto-derived from Due Amount vs Grand Total — purely informational, shows
  // how the order's payment currently stands: fully paid, part-paid, or the
  // full amount still pending.
  const due = Number(form.due) || 0;
  const paymentState =
    due <= 0 ? { label: 'Paid — Complete', cls: 'bg-ok-light text-ok' } :
    due >= grandTotal && grandTotal > 0 ? { label: 'Due — Pending', cls: 'bg-danger-light text-danger' } :
    { label: 'Partial — Pending', cls: 'bg-warn-light text-warn' };

  return (
    <Card>
      <CardHead title="Discount & Notes" />
      <CardBody>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Discount (%)">
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.discount}
              onChange={(e) =>
                set('discount', Math.min(100, Math.max(0, Number(e.target.value))))
              }
            />
          </Field>

          <Field label="Due Amount">
            <Input
              type="number"
              min="0"
              value={form.due}
              onChange={(e) => onDueChange(Number(e.target.value))}
            />
            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${paymentState.cls}`}>
              {paymentState.label}
            </span>
          </Field>

          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
            >
              {ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
        </div>

        <div className="mt-2.5">
          <Field label="Notes">
            <Textarea
              rows={2}
              value={form.notes}
              placeholder="Any special instructions…"
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
        </div>
      </CardBody>
    </Card>
  );
}


// ─── Main component ───────────────────────────────────────────────────────────

export default function OrderForm() {
  const { id }             = useParams();
  const editing            = Boolean(id);
  const navigate           = useNavigate();
  const { isAdmin, user }  = useAuth();
  const { show }           = useToast();

  const [loading, setLoading] = useState(editing);
  const [busy, setBusy]       = useState(false);
  const [sales, setSales]     = useState([]);
  const [form, setForm]       = useState(INITIAL_FORM);

  // Whether Due Amount should keep auto-tracking the Grand Total (true) or has
  // been manually overridden by the user (false — stops auto-resync so a
  // custom partial-payment value is never silently clobbered).
  const dueAutoRef = useRef(true);

  // Existing-lead confirmation popup — shown when saving a new order and the
  // mobile number matches a customer already in the CRM (possibly owned by
  // someone else). Holds everything needed to resume the save once
  // acknowledged: { lead, items, isEdit } (isEdit unused here but keeps shape
  // consistent with how the save flow already branches).
  const [existingLeadPopup, setExistingLeadPopup] = useState(null);

  // ── Lead lookup ────────────────────────────────────────────────────────────
  const { leadId, leadState, onMobileChange, onCountryChange } = useLeadLookup({
    editing,
    setForm,
  });

  // ── Customer lookup (existing orders) ──────────────────────────────────────
  const { custState, onCustomerChange } = useCustomerLookup({ editing, setForm });

  // ── Derived totals ─────────────────────────────────────────────────────────
  const subTotal = useMemo(
    () => form.items.reduce((sum, it) => sum + (it.qty || 0) * (it.price || 0), 0),
    [form.items],
  );
  const grandTotal = Math.max(
    0,
    subTotal * (1 - (Number(form.discount) || 0) / 100),
  );

  // ── Bootstrap: load sales users & existing order ───────────────────────────
  useEffect(() => {
    (async () => {
      if (isAdmin) {
        try {
          const allUsers = await userApi.list();
          setSales(allUsers.filter((u) => (u.role === 'sales' || u.role === 'admin') && u.active));
        } catch { /* non-fatal */ }
      }

      if (editing) {
        try {
          const o = await orderApi.get(id);
          dueAutoRef.current = false; // an existing order's due amount is authoritative — don't auto-override it
          setForm({
            date:        o.date?.slice(0, 10) || todayStr(),
            customer:    o.customer,
            city:        o.city,
            country:     o.country,
            mobile:      o.mobile,
            delivery:    o.delivery,
            deliveryContact: o.deliveryContact || '',
            payTerms:    o.payTerms,
            salesperson: o.salesperson || '',
            items:       o.items.length ? o.items : [blankItem()],
            discount:    o.discount,
            due:         o.due,
            status:      o.status,
            notes:       o.notes,
            orderNo:     o.orderNo,
          });
        } catch (e) {
          show(apiError(e), 'error');
          navigate('/orders');
        } finally {
          setLoading(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Form field setter ──────────────────────────────────────────────────────
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  // ── Field change handlers that also trigger side-effects ───────────────────
  const handleMobileChange = (value) => {
    set('mobile', value);
    onMobileChange(value, form.country);
  };

  // Selecting a payment term auto-fills Due Amount: 0 for terms where payment
  // is already received in full, otherwise the full Grand Total (pending).
  // Re-enables auto-tracking so later item/discount changes keep it in sync
  // until the user manually edits Due Amount themselves.
  const handlePayTermsChange = (value) => {
    set('payTerms', value);
    dueAutoRef.current = true;
    set('due', PAID_TERMS.includes(value) ? 0 : Math.round(grandTotal * 100) / 100);
  };

  // A manual edit to Due Amount stops the auto-tracking above — the user's
  // custom (e.g. partial-payment) value is never silently overwritten again.
  const handleDueChange = (value) => {
    dueAutoRef.current = false;
    set('due', value);
  };

  // Keep Due Amount synced to the Grand Total whenever items/discount change
  // — but only while auto-tracking is active (see handlePayTermsChange /
  // handleDueChange above).
  useEffect(() => {
    if (!dueAutoRef.current) return;
    const target = PAID_TERMS.includes(form.payTerms) ? 0 : Math.round(grandTotal * 100) / 100;
    if (form.due !== target) set('due', target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grandTotal, form.payTerms]);

  const handleCountryChange = (value) => {
    set('country', value);
    onCountryChange(value, form.mobile);
  };

  const handleCustomerChange = (value) => {
    set('customer', value);
    onCustomerChange(value, form.mobile, form.country);
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const save = async () => {
    // All fields required except Notes, Discount, Due.
    const digits = (form.mobile || '').replace(/\D/g, '');
    const errors = [];
    if (!form.date) errors.push('Order date');
    if (!form.customer.trim()) errors.push('Customer name');
    if (!form.city.trim()) errors.push('City / Area');
    if (!form.country) errors.push('Country');
    if (digits.length < MIN_MOBILE_DIGITS) errors.push('a valid mobile number');
    if (!form.delivery.trim()) errors.push('Delivery details');
    if (!form.payTerms) errors.push('Payment status');
    // Salesperson: admins pick one; for sales users it's themselves (auto).
    if (isAdmin && !form.salesperson) errors.push('Salesperson');

    if (errors.length) {
      return show(`Please fill all required fields: ${errors.join(', ')}.`, 'error');
    }

    // Every filled item row must be complete: model code, qty > 0, price > 0.
    const items = form.items.filter(
      (it) => it.modelCode.trim() || (it.description || '').trim() || it.qty || it.price
    );
    if (items.length === 0) {
      return show('Add at least one item.', 'error');
    }
    const badItem = items.findIndex(
      (it) => !it.modelCode.trim() || !(Number(it.qty) > 0) || !(Number(it.price) > 0)
    );
    if (badItem !== -1) {
      return show(`Item #${badItem + 1} is incomplete — model code, quantity (>0) and price (>0) are all required.`, 'error');
    }

    setBusy(true);
    try {
      // If this is a new order with an unmatched mobile, we may need to
      // create a CRM lead first. leadId (from the debounced background
      // lookup) is NOT trusted here on its own — if the user fills in a
      // known customer's number and hits Save quickly, the background
      // lookup may not have resolved yet, so leadId would still be null
      // even though a lead genuinely exists. A fresh, synchronous lookup
      // right before deciding is what actually prevents creating a
      // duplicate lead — cross-employee: this matches on phone number
      // company-wide, not just leads owned by the current user.
      const mobileDigits = (form.mobile || '').replace(/\D/g, '');
      let confirmedLead = null;
      if (!editing && !leadId && mobileDigits.length >= MIN_MOBILE_DIGITS) {
        try {
          const freshLookup = await leadApi.lookup(mobileDigits, form.country);
          if (freshLookup && freshLookup.exists && freshLookup.lead) confirmedLead = freshLookup.lead;
        } catch { /* lookup failure — fall through and let the server's own duplicate check decide */ }
      }

      if (confirmedLead) {
        // Fetch the existing customer's data into any still-blank fields —
        // never overwrite what was already typed for THIS order.
        setForm((prev) => ({
          ...prev,
          customer: prev.customer || confirmedLead.name || prev.customer,
          city:     prev.city     || confirmedLead.city || prev.city,
          delivery: prev.delivery || confirmedLead.delivery || prev.delivery,
        }));
        // Pause here and let the salesperson see exactly who this is before
        // the order actually saves — a toast is too easy to miss for
        // something this important (it's the whole point of not creating a
        // duplicate lead).
        setBusy(false);
        setExistingLeadPopup({ lead: confirmedLead, items });
        return;
      }

      await finishSave(items, false);
    } catch (e) {
      show(apiError(e), 'error');
      setBusy(false);
    }
  };

  // Actually creates/updates the order (and a new CRM lead, if this really is
  // a brand-new customer with no existing match). Split out from save() so
  // the existing-lead popup can pause the flow and resume here once
  // acknowledged, without duplicating the validation/lookup logic above.
  // `hasExistingMatch` is passed explicitly rather than read from state,
  // since by the time this runs from the popup's "Continue" button the
  // popup state has already been cleared.
  const finishSave = async (items, hasExistingMatch) => {
    setBusy(true);
    try {
      const mobileDigits = (form.mobile || '').replace(/\D/g, '');
      const isNewMobile = !editing && !hasExistingMatch && !leadId && mobileDigits.length >= MIN_MOBILE_DIGITS;

      if (isNewMobile) {
        try {
          await leadApi.create({
            name:    form.customer.trim(),
            mobile:  mobileDigits,
            country: form.country,
            city:    form.city || '',
            delivery: form.delivery || '',
            source:  'Walk-in',
            status:  'New',
            remark:  'Auto-created from Order Form',
          });
        } catch (leadErr) {
          // A duplicate-phone conflict from the server is expected here and
          // is fine — it means the lead already exists, so the order simply
          // proceeds without creating a second one. Anything else (a real
          // validation error) is surfaced instead of silently disappearing,
          // so a genuine problem doesn't go unnoticed.
          const status = leadErr && leadErr.response && leadErr.response.status;
          if (status !== 409) {
            show(`Note: could not create a CRM lead for this customer (${apiError(leadErr)}). The order will still be saved.`, 'error');
          }
        }
      }

      const payload = {
        ...form,
        items,
        salesperson: form.salesperson || undefined,
      };

      if (editing) {
        await orderApi.update(id, payload);
        show('Order updated.', 'success');
      } else {
        const created = await orderApi.create(payload);
        show(`Order #${created.orderNo} saved.`, 'success');

        // Auto-convert the matching CRM lead to Buyer (Won) status
        try {
          const mobileDigits = (form.mobile || '').replace(/\D/g, '');
          if (mobileDigits.length >= 5) {
            const lookup = await leadApi.lookup(mobileDigits, form.country);
            if (lookup?.exists && lookup?.lead?._id) {
              // Mark lead as Buyer (Won) — always fires on new order
              // even if lead was previously converted (monthly reset sets
              // converted=true stays but status resets to Interested)
              await leadApi.markBuyer(lookup.lead._id, { orderNo: created.orderNo });
            }
          }
        } catch { /* non-fatal — order already saved */ }
      }

      navigate('/orders');
    } catch (e) {
      show(apiError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  // Called when the salesperson acknowledges the existing-lead popup —
  // resumes the save using the confirmed match.
  const confirmExistingLeadAndSave = async () => {
    if (!existingLeadPopup) return;
    const { items } = existingLeadPopup;
    setExistingLeadPopup(null);
    await finishSave(items, true);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <Spinner label="Loading order…" />;

  return (
    <>
      <PageTitle icon={editing ? <Pencil size={18} /> : <Plus size={18} />}>
        {editing ? `Edit Order #${form.orderNo}` : 'New Order Form'}
      </PageTitle>

      <OrderDetailsCard
        form={form}
        set={(k, v) => {
          if (k === 'mobile')   { handleMobileChange(v);   return; }
          if (k === 'country')  { handleCountryChange(v);  return; }
          if (k === 'customer') { handleCustomerChange(v); return; }
          if (k === 'payTerms') { handlePayTermsChange(v); return; }
          set(k, v);
        }}
        sales={sales}
        editing={editing}
        isAdmin={isAdmin}
        user={user}
        leadState={leadState}
        custState={custState}
      />

      <OrderItemsCard
        form={form}
        set={set}
        subTotal={subTotal}
        grandTotal={grandTotal}
      />

      <DiscountNotesCard form={form} set={set} grandTotal={grandTotal} onDueChange={handleDueChange} />

      <div className="flex justify-end gap-2.5">
        <Button variant="outline" onClick={() => navigate('/orders')}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={save}>
          <Save size={14} className="mr-1.5" />
          {busy ? 'Saving…' : 'Save Order'}
        </Button>
      </div>

      {existingLeadPopup && (
        <Modal open onClose={() => setExistingLeadPopup(null)} title="Existing Customer Found" width="sm:max-w-[440px]">
          <div className="mb-3 flex items-start gap-2.5 rounded-md border p-3" style={{ borderColor: 'var(--border-card)', backgroundColor: 'var(--bg-card-head)' }}>
            <UserCheck size={18} className="mt-0.5 flex-shrink-0 text-ok" />
            <div className="text-xs">
              <p className="font-bold" style={{ color: 'var(--text-primary)' }}>{existingLeadPopup.lead.name}</p>
              <p className="mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {existingLeadPopup.lead.city ? `${existingLeadPopup.lead.city}, ` : ''}{existingLeadPopup.lead.country || ''}
              </p>
              {existingLeadPopup.lead.ownerName && (
                <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Owned by <strong>{existingLeadPopup.lead.ownerName}</strong>
                </p>
              )}
              {existingLeadPopup.lead.status && (
                <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Status: <strong>{existingLeadPopup.lead.status}</strong>
                  {existingLeadPopup.lead.orderNo ? ` · previously ordered #${existingLeadPopup.lead.orderNo}` : ''}
                </p>
              )}
            </div>
          </div>
          <p className="mb-3 flex items-start gap-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
            This number already exists as a lead in your CRM. Continuing will use their saved details for this order — no new (duplicate) lead will be created.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setExistingLeadPopup(null)}>Cancel</Button>
            <Button disabled={busy} onClick={confirmExistingLeadAndSave}>
              {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Continue & Save Order'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}