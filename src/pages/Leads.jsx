import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Formik, Form } from 'formik';
import * as Yup from 'yup';
import {
  Plus, Upload, Download, Eye, ShoppingCart, Pencil, Trash2,
  Target, Users, Percent, AlertTriangle, Phone, MessageCircle,
  FileText, ArrowRight, Loader2, CheckCircle, GitMerge, StickyNote, RefreshCw,
} from 'lucide-react';
import { leadApi, userApi } from '../api/endpoints.js';
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
import CountrySelect from '../components/ui/CountrySelect.jsx';
import OrderItemsEditor, { blankItem } from '../components/OrderItemsEditor.jsx';
import { exportTablePdf, exportTableCsv } from '../utils/exportPdf.js';
import { exportLeadsForUpdate, buildUpdatePlan, UPDATE_CHUNK } from '../utils/leadBulkUpdate.js';
import {
  formatDate, fmtAED, fmtDateTime, leadStatusClass,
  LEAD_STATUSES, LEAD_SOURCES, ALL_COUNTRY_NAMES, dialFor, cleanPhone, fmtMobile,
  LEAD_STAGES, leadStageOf, leadStageClass, getCountryCodes, phoneSearchMatches,
} from '../utils/format.js';

const emptyLead = () => ({
  name: '', mobile: '', email: '', country: 'UAE', city: '',
  source: 'Walk-in', campaign: '', interest: '', status: 'New', remark: '', delivery: '', owner: '',
});

// Funnel order: Lead (initial) → Opportunity → Enquiry → Buyer
const CREATE_STAGES = ['Lead', 'Opportunity', 'Enquiry', 'Buyer'];
const STAGE_TO_STATUS = { Lead: 'New', Opportunity: 'Interested', Enquiry: 'Follow-up', Buyer: 'Won' };

const STATUS_TO_STAGE = (status) => {
  if (status === 'Won') return 'Buyer';
  if (status === 'Follow-up') return 'Enquiry';
  if (status === 'Interested' || status === 'Contacted') return 'Opportunity';
  return 'Lead';
};
const leadSchema = Yup.object({
  name: Yup.string().trim().required('Name is required').max(80, 'Too long'),
  mobile: Yup.string().trim()
    .required('Mobile is required')
    .matches(/^[0-9+\-\s]*$/, 'Digits only')
    .test('len', 'Enter a valid number', (v) => !v || v.replace(/\D/g, '').length >= 5),
  email: Yup.string().trim().email('Invalid email'),
  altMobile: Yup.string().trim()
    .matches(/^[0-9+\-\s]*$/, 'Digits only')
    .test('len', 'Enter a valid number', (v) => !v || v.replace(/\D/g, '').length >= 5),
  city: Yup.string().trim().max(60, 'Too long'), // optional
  country: Yup.string().required('Country is required'),
  source: Yup.string().required('Source is required'),
  stage: Yup.string().oneOf(CREATE_STAGES).required('Stage is required'),
  campaign: Yup.string().trim().max(80, 'Too long'),
  interest: Yup.string().trim().required('Interest is required').max(200, 'Too long'),
  remark: Yup.string().trim().max(300, 'Too long'),
});

// Max leads per CSV import — must match BULK_MAX in server lead.controller.js
const IMPORT_MAX = 2000;

// ── Minimal CSV parser ────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') { pushField(); pushRow(); }
    else if (c === '\r') { /* ignore */ }
    else field += c;
  }
  if (field.length || row.length) { pushField(); pushRow(); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function downloadTemplate() {
  const headers = ['Name', 'Mobile', 'Country Code', 'Email', 'Country', 'City', 'Source', 'Campaign', 'Stage', 'Interest', 'Remark', 'Delivery'];
  const sample = ['Rahul Sharma', '506731305', '971', 'rahul@email.com', 'UAE', 'Al Quoz', 'WhatsApp', 'Eid Sale', 'Lead', 'Formal shoes size 42', 'Called once, interested', 'HURIA TRANSPORT'];
  const csv = [headers.join(','), sample.map((v) => `"${v}"`).join(',')].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'leads_import_template.csv' });
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

const HEADER_MAP = {
  name: 'name', 'lead name': 'name', 'customer': 'name', 'customer name': 'name',
  mobile: 'mobile', phone: 'mobile', 'phone number': 'mobile', 'mobile number': 'mobile', contact: 'mobile',
  'country code': 'code', countrycode: 'code', code: 'code', 'dial code': 'code', dial: 'code', isd: 'code', 'isd code': 'code',
  email: 'email', 'email address': 'email',
  country: 'country',
  city: 'city',
  source: 'source',
  campaign: 'campaign',
  stage: 'stage',
  interest: 'interest',
  status: 'status',
  delivery: 'delivery', 'delivery details': 'delivery', transport: 'delivery', 'delivery note': 'delivery',
  remark: 'remark', remarks: 'remark', note: 'remark', notes: 'remark',
};
const LEAD_STATUS_SET = new Set(LEAD_STATUSES);
const LEAD_SOURCE_SET = new Set(LEAD_SOURCES);
const COUNTRY_SET = new Set(ALL_COUNTRY_NAMES);
const STAGE_SET = new Set(CREATE_STAGES);

// Reverse map: dial code (digits only) → country name, for the "Country Code" column.
const CODE_TO_COUNTRY = Object.entries(getCountryCodes()).reduce((acc, [country, code]) => {
  if (code) acc[String(code)] = country;
  return acc;
}, {});

function rowsToLeads(parsed, existingLeads = []) {
  if (!parsed.length) return { leads: [], dupExisting: [], dupInFile: [], errors: ['File is empty.'] };
  const header = parsed[0].map((h) => HEADER_MAP[h.trim().toLowerCase()] || null);
  if (!header.includes('name')) {
    return { leads: [], dupExisting: [], dupInFile: [], errors: ['CSV must have a "Name" column. Detected headers: ' + parsed[0].join(', ')] };
  }

  const existingKeys = new Set(
    (existingLeads || []).map((l) => cleanPhone(l.mobile, l.country)).filter(Boolean)
  );
  const seenInFile = new Set();

  const leads = [];
  const dupExisting = [];
  const dupInFile = [];
  const errors = [];

  for (let r = 1; r < parsed.length; r++) {
    const cells = parsed[r];
    const obj = emptyLead();
    header.forEach((key, c) => { if (key) obj[key] = (cells[c] || '').trim(); });
    if (!obj.name) { errors.push(`Row ${r + 1}: missing name — skipped.`); continue; }

    // Country Code column: resolve a country name from the dial code when given.
    // If the code is unknown, prepend it onto the mobile so it isn't lost.
    if (obj.code) {
      const codeDigits = String(obj.code).replace(/[^\d]/g, '');
      if (codeDigits) {
        const mapped = CODE_TO_COUNTRY[codeDigits];
        if (mapped) {
          obj.country = mapped;
        } else if (!obj.mobile.replace(/\D/g, '').startsWith(codeDigits)) {
          obj.mobile = codeDigits + obj.mobile.replace(/\D/g, '');
        }
      }
    }
    delete obj.code;

    if (!LEAD_SOURCE_SET.has(obj.source)) obj.source = 'Other';
    if (!COUNTRY_SET.has(obj.country)) obj.country = 'UAE';

    // Stage takes priority over Status. Map the funnel stage to a lead status.
    if (obj.stage && STAGE_SET.has(obj.stage)) {
      obj.status = STAGE_TO_STATUS[obj.stage];
    } else if (!LEAD_STATUS_SET.has(obj.status) || obj.status === 'Won') {
      obj.status = 'New';
    }
    delete obj.stage;

    delete obj.owner;

    const key = cleanPhone(obj.mobile, obj.country);
    if (key && existingKeys.has(key)) { dupExisting.push(`${obj.name} (${obj.mobile})`); continue; }
    if (key && seenInFile.has(key)) { dupInFile.push(`${obj.name} (${obj.mobile})`); continue; }
    if (key) seenInFile.add(key);
    leads.push(obj);
  }
  return { leads, dupExisting, dupInFile, errors };
}

// WhatsApp quick-chat button. Builds a wa.me link from the lead's number +
// country dial code (cleanPhone prepends the code and strips symbols). Renders
// nothing when there's no mobile. lucide-react has no WhatsApp brand glyph, so
// this uses its MessageCircle icon on a WhatsApp-green button.
function WhatsAppButton({ mobile, country }) {
  const num = cleanPhone(mobile, country);
  if (!num) return null;
  return (
    <a
      href={`https://wa.me/${num}`}
      target="_blank"
      rel="noreferrer"
      title="Chat on WhatsApp"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm transition hover:opacity-90"
      style={{ backgroundColor: '#25D366' }}
    >
      <MessageCircle size={13} />
    </a>
  );
}

// ── Inline duplicate-lead group (used by the "Duplicates" panel below) ───────
// One group = leads that share the exact same phone number. Pick which one to
// keep; merging combines call logs/notes/edit history into it, reassigns any
// cheques or WhatsApp messages that pointed at the removed lead(s), archives
// the removed lead(s) to Deleted Contacts, and deletes them.
function DuplicateGroup({ group, onMerged }) {
  const { show } = useToast();
  const [keepId, setKeepId] = useState(group.leads[0].id);
  const [busy, setBusy] = useState(false);

  const merge = async () => {
    const mergeIds = group.leads.map((l) => l.id).filter((id) => id !== keepId);
    if (!mergeIds.length) return;
    if (!confirm(`Merge ${mergeIds.length} duplicate lead(s) into the selected one? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await leadApi.merge({ keepId, mergeIds });
      show(res.message || 'Leads merged.', 'success');
      onMerged();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Card className="mb-3">
      <div className="card-head flex items-center justify-between">
        <h2>{fmtMobile(group.leads[0].mobile, group.leads[0].country) || group.mobileKey}</h2>
        <span className="text-[10px] font-normal text-ink-3">{group.leads.length} leads share this number</span>
      </div>
      <div className="card-body space-y-2">
        {group.leads.map((l) => (
          <label
            key={l.id}
            className="flex cursor-pointer items-center gap-3 rounded-md border p-2.5"
            style={{ borderColor: keepId === l.id ? 'var(--gold-700, #a16207)' : 'var(--border-card)', backgroundColor: keepId === l.id ? 'var(--bg-card-head)' : 'transparent' }}
          >
            <input type="radio" name={`keep-${group.mobileKey}`} className="h-4 w-4 accent-purple-500" checked={keepId === l.id} onChange={() => setKeepId(l.id)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                {l.name}
                {keepId === l.id && <span className="rounded-full bg-ok-light px-2 py-0.5 text-[10px] font-bold text-ok">Keep this one</span>}
                {l.converted && <span className="rounded-full bg-gold-light px-2 py-0.5 text-[10px] font-bold text-navy-700">Converted — Order #{l.orderNo}</span>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                <span>Owner: <strong>{l.ownerName || '—'}</strong></span>
                <span>Status: {l.status}</span>
                <span>City: {l.city || '—'}</span>
                <span className="flex items-center gap-1"><MessageCircle size={11} />{l.callLogCount} calls</span>
                <span className="flex items-center gap-1"><StickyNote size={11} />{l.noteCount} notes</span>
                <span>Added {fmtDateTime(l.createdAt)}</span>
              </div>
            </div>
          </label>
        ))}
        <div className="flex justify-end pt-1">
          <Button disabled={busy} onClick={merge}>
            {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Merging…</> : <><GitMerge size={13} className="mr-1.5" />Merge into selected</>}
          </Button>
        </div>
      </div>
    </Card>
  );
}


// ── Reconstruct lead status/stage at a given date using editHistory ───────────
// Replays the editHistory backwards to find what 'status' was on targetDate.
// Falls back to current status if no history or lead didn't exist yet.
function statusAtDate(lead, targetDate) {
  if (!targetDate) return lead.status;
  const target = new Date(targetDate + 'T23:59:59');
  const history = lead.editHistory || [];
  // Sort history oldest-first
  const sorted = [...history].sort((a, b) => new Date(a.at) - new Date(b.at));
  // Start from the lead's initial status (before any edits) — which we derive
  // by rewinding: find the first status change and take its 'from' value,
  // or use current status if no status change exists.
  let statusChanges = sorted
    .flatMap(h => (h.changes || []).filter(ch => ch.field === 'status').map(ch => ({ at: h.at, from: ch.from, to: ch.to })));

  if (!statusChanges.length) return lead.status; // no history, use current

  // The initial status is the 'from' of the first change
  let statusOnDate = statusChanges[0].from || 'New';
  // Apply each change that happened ON or BEFORE the target date
  for (const ch of statusChanges) {
    if (new Date(ch.at) <= target) statusOnDate = ch.to;
    else break;
  }
  return statusOnDate || lead.status;
}


// ── Reusable multi-select dropdown ───────────────────────────────────────────
function MultiSelect({ label, options, selected, onChange, valueKey, labelKey }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const getVal = (o) => valueKey ? o[valueKey] : o;
  const getLabel = (o) => labelKey ? o[labelKey] : o;
  const isSelected = (o) => selected.includes(getVal(o));

  const toggle = (o) => {
    const v = getVal(o);
    onChange(isSelected(o) ? selected.filter((s) => s !== v) : [...selected, v]);
  };

  const displayText = selected.length === 0
    ? `All ${label}`
    : selected.length === 1
      ? (options.find((o) => getVal(o) === selected[0]) ? getLabel(options.find((o) => getVal(o) === selected[0])) : selected[0])
      : `${label}: ${selected.length} selected`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap"
        style={{
          borderColor: selected.length ? 'var(--gold-600, #ca8a04)' : 'var(--input-border)',
          background: selected.length ? 'var(--gold-50, #fefce8)' : 'var(--input-bg)',
          color: selected.length ? 'var(--gold-700, #a16207)' : 'var(--text-primary)',
          minWidth: '110px',
        }}
      >
        <span className="flex-1 text-left truncate max-w-[130px]">{displayText}</span>
        {selected.length > 0 && (
          <span
            onClick={(e) => { e.stopPropagation(); onChange([]); }}
            className="ml-1 text-[10px] font-bold opacity-60 hover:opacity-100"
            title="Clear"
          >✕</span>
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.5, flexShrink: 0 }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 rounded-lg border shadow-lg overflow-y-auto"
          style={{
            minWidth: '180px', maxHeight: '260px',
            background: 'var(--bg-card)',
            borderColor: 'var(--border-card)',
            top: '100%', left: 0,
          }}
        >
          {/* Select all / clear all */}
          <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--border-card)' }}>
            <button type="button" className="text-[11px] font-bold" style={{ color: 'var(--gold-600, #ca8a04)' }}
              onClick={() => onChange(options.map(getVal))}>All</button>
            <span style={{ color: 'var(--text-muted)' }}>·</span>
            <button type="button" className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}
              onClick={() => onChange([])}>None</button>
          </div>
          {options.map((o) => (
            <label key={getVal(o)} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-opacity-50 text-[12px]"
              style={{ background: isSelected(o) ? 'var(--bg-card-head)' : 'transparent', color: 'var(--text-primary)' }}>
              <input type="checkbox" checked={isSelected(o)} onChange={() => toggle(o)}
                className="accent-yellow-500" style={{ width: 13, height: 13 }} />
              {getLabel(o)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Leads() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, user } = useAuth();
  const { show } = useToast();
  const { data: leads, loading, refetch } = useFetch(() => leadApi.list(), []);

  const [f, setF] = useState({
    search:   searchParams.get('search')   || '',
    status:   searchParams.get('status')   ? searchParams.get('status').split(',')   : [],
    source:   searchParams.get('source')   ? searchParams.get('source').split(',')   : [],
    stage:    searchParams.get('stage')    ? searchParams.get('stage').split(',')    : [],
    country:  searchParams.get('country')  ? searchParams.get('country').split(',')  : [],
    campaign: searchParams.get('campaign') ? searchParams.get('campaign').split(',') : [],
    employee: searchParams.get('employee') ? searchParams.get('employee').split(',') : [],
    dateFrom: searchParams.get('dateFrom') || '',
    dateTo:   searchParams.get('dateTo')   || '',
  });

  // Sync every filter change into the URL so browser Back restores it exactly.
  const updateFilter = (patch) => {
    const next = { ...f, ...patch };
    setF(next);
    const params = {};
    Object.entries(next).forEach(([k, v]) => {
      if (Array.isArray(v)) { if (v.length) params[k] = v.join(','); }
      else if (v) params[k] = v;
    });
    setSearchParams(params, { replace: true });
  };
  const [sales, setSales] = useState([]);
  const [form, setForm] = useState(null);
  const [convert, setConvert] = useState(null);
  const [items, setItems] = useState([blankItem()]);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [exporting, setExporting] = useState(false);
  // Bulk update (export → edit → re-upload) — admin only
  const [updOpen, setUpdOpen] = useState(false);
  const [updPlan, setUpdPlan] = useState(null);
  const [updBusy, setUpdBusy] = useState(false);
  const [updProgress, setUpdProgress] = useState('');
  const [updResult, setUpdResult] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  // Whole page scrolls (no inner table scrollbar); jump back to the top when the page changes.
  const topRef = useRef(null);
  useEffect(() => { topRef.current?.scrollIntoView({ block: 'start' }); }, [page]);

  // ── Inline "Duplicates" panel (admin only) ──────────────────────────────────
  const [dupOpen, setDupOpen] = useState(false);
  const [dupGroups, setDupGroups] = useState(null);
  const [dupLoading, setDupLoading] = useState(false);

  const loadDuplicates = async () => {
    setDupLoading(true);
    try { setDupGroups(await leadApi.listDuplicates()); }
    catch (e) { show(apiError(e), 'error'); }
    finally { setDupLoading(false); }
  };

  const toggleDuplicates = () => {
    const next = !dupOpen;
    setDupOpen(next);
    if (next && dupGroups === null) loadDuplicates();
  };

  useEffect(() => {
    if (isAdmin) userApi.list()
      .then((u) => setSales(u.filter((x) => x.role === 'sales' && x.active)))
      .catch(() => {});
  }, [isAdmin]);

  // Reset to page 1 whenever filter values change
  const fKey = JSON.stringify(f);
  useEffect(() => { setPage(1); }, [fKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!leads) return [];
    return leads.filter((l) => {
      // When date filter is active, compare against the status the lead HAD on that date
      const effectiveStatus = (f.dateFrom || f.dateTo)
        ? statusAtDate(l, f.dateTo || f.dateFrom)
        : l.status;
      if (f.status.length   && !f.status.includes(effectiveStatus)) return false;
      if (f.source.length   && !f.source.includes(l.source || '')) return false;
      if (f.stage.length    && !f.stage.includes(leadStageOf({ ...l, status: effectiveStatus }))) return false;
      if (f.country.length  && !f.country.map(x=>x.toLowerCase()).includes((l.country||'').trim().toLowerCase())) return false;
      if (f.campaign.length && !f.campaign.includes(l.campaign || '')) return false;
      if (f.employee.length && !f.employee.includes(String(l.owner))) return false;
      if (f.dateFrom || f.dateTo) {
        const d = new Date(l.createdAt);
        if (f.dateFrom && d < new Date(f.dateFrom + 'T00:00:00')) return false;
        if (f.dateTo   && d > new Date(f.dateTo   + 'T23:59:59')) return false;
      }
      if (f.search) {
        const q = f.search.toLowerCase();
        const qDigits = f.search.replace(/\D/g, '');

        // 1. Text match on name, email, city
        const textMatch = [l.name, l.email, l.city].some((v) => (v || '').toLowerCase().includes(q));

        // 2. Raw mobile digit match — strip non-digits from both sides.
        const mobileDigits = (l.mobile || '').replace(/\D/g, '');
        const altMobileDigits = (l.altMobile || '').replace(/\D/g, '');
        // Also build the full E164 number (country code + stored digits) for matching.
        // This handles "+971" matching UAE leads whose stored mobile is "506731305" (no code).
        const dialCode = dialFor(l.country) || '';
        const fullMobileDigits = dialCode ? dialCode + mobileDigits : mobileDigits;
        const fullAltMobileDigits = dialCode ? dialCode + altMobileDigits : altMobileDigits;

        const rawMobileMatch = qDigits.length >= 2 && (
          mobileDigits.includes(qDigits) ||
          altMobileDigits.includes(qDigits) ||
          fullMobileDigits.includes(qDigits) ||
          fullAltMobileDigits.includes(qDigits)
        );

        // 3. Phone-aware match: handles country code stripping for full numbers (>= 7 digits)
        const phoneMatch = phoneSearchMatches(l.mobile, f.search) || phoneSearchMatches(l.altMobile, f.search);

        if (!textMatch && !rawMobileMatch && !phoneMatch) return false;
      }
      return true;
    });
  }, [leads, f]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page, PAGE_SIZE]);

  // Derive sorted unique country list from actual leads data
  const countryOptions = useMemo(() => {
    if (!leads) return [];
    // Normalize casing so 'iran' and 'Iran' don't appear as two separate options
    const seen = new Map();
    leads.forEach((l) => {
      if (!l.country) return;
      const norm = l.country.trim();
      const key = norm.toLowerCase();
      if (!seen.has(key)) seen.set(key, norm);
    });
    return [...seen.values()].sort();
  }, [leads]);

  // Campaign filter is optional — only leads that were actually tagged with
  // a campaign show up here, so the dropdown only lists campaigns that exist.
  const campaignOptions = useMemo(() => {
    if (!leads) return [];
    return [...new Set(leads.map((l) => (l.campaign || '').trim()).filter(Boolean))].sort();
  }, [leads]);

  // Employee filter options. Start from active sales users, then fold in EVERY
  // owner that actually appears on a lead — including the admin/owner and any
  // deactivated staff — so contacts entered by the owner are filterable too.
  const employeeOptions = useMemo(() => {
    const byId = new Map();
    (sales || []).forEach((u) => {
      const id = String(u.id || u._id);
      if (id) byId.set(id, u.name);
    });
    (leads || []).forEach((l) => {
      if (!l.owner) return;
      const id = String(l.owner);
      if (!byId.has(id)) byId.set(id, l.ownerName || 'Owner');
    });
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sales, leads]);

  const buildExport = () => {
    const empName = f.employee.length === 1 ? (employeeOptions.find((u) => String(u.id) === f.employee[0])?.name || 'All') : f.employee.length > 1 ? `${f.employee.length} Employees` : 'All';
    return {
      title: 'Leads Report',
      columns: [
        'Sl. No', 'Name', 'Mobile', 'Email', 'Source', 'Campaign',
        'Interest', 'City', 'Country', 'Owner', 'Stage', 'Status',
        'Remark', 'Notes', 'Order #', 'Date',
      ],
      rows: filtered.map((l, idx) => {
        // Combine all notes into one cell
        const notesText = (l.notes || [])
          .map((n) => `[${new Date(n.at).toLocaleDateString()} ${n.byName || ''}] ${n.text || ''}`)
          .join(' | ') || '—';
        return [
          idx + 1,
          l.name,
          fmtMobile(l.mobile, l.country) || '—',
          l.email || '—',
          l.source || '—',
          l.campaign || '—',
          l.interest || '—',
          l.city || '—',
          l.country || '—',
          l.ownerName || '—',
          leadStageOf(l),
          (f.dateFrom || f.dateTo) ? statusAtDate(l, f.dateTo || f.dateFrom) : l.status,
          l.remark || '—',
          notesText,
          l.orderNo ? `#${l.orderNo}` : '—',
          new Date(l.createdAt).toLocaleDateString(),
        ];
      }),
      meta: { Employee: empName || 'All', Records: filtered.length },
    };
  };
  const exportPdf = async () => {
    setExporting(true);
    try {
      await exportTablePdf(buildExport());
    } catch (e) { show(e.message || 'Export failed. Check your connection.', 'error'); }
    finally { setExporting(false); }
  };
  const exportCsv = () => {
    try { exportTableCsv(buildExport()); }
    catch (e) { show(e.message || 'CSV export failed.', 'error'); }
  };

  const stats = useMemo(() => {
    // KPIs reflect the currently filtered leads, not all leads
    const list = filtered;
    const total = list.length;
    const enquiry = list.filter((l) => {
      const st = (f.dateFrom || f.dateTo) ? statusAtDate(l, f.dateTo || f.dateFrom) : l.status;
      return leadStageOf({ ...l, status: st }) === 'Enquiry';
    }).length;
    const opportunity = list.filter((l) => {
      const st = (f.dateFrom || f.dateTo) ? statusAtDate(l, f.dateTo || f.dateFrom) : l.status;
      return leadStageOf({ ...l, status: st }) === 'Opportunity';
    }).length;
    const converted = list.filter((l) => {
      const st = (f.dateFrom || f.dateTo) ? statusAtDate(l, f.dateTo || f.dateFrom) : l.status;
      return st === 'Won' || l.converted;
    }).length;
    return {
      total,
      enquiry,
      opportunity,
      converted,
      rate: total ? Math.round((converted / total) * 100) : 0,
    };
  }, [filtered, f.dateFrom, f.dateTo]);

  const doConvert = async () => {
    const valid = items.filter((it) => it.modelCode.trim());
    if (!valid.length) return show('Add at least one item to create the order.', 'error');
    setBusy(true);
    try {
      const { order } = await leadApi.convert(convert._id, { items: valid, discount: 0 });
      show(`Converted — Order #${order.orderNo} created.`, 'success');
      setConvert(null); setItems([blankItem()]); refetch();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  const del = async (lead) => {
    if (!confirm(`Delete lead "${lead.name}"?`)) return;
    try { await leadApi.remove(lead._id); show('Lead deleted.'); refetch(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  const openImport = () => { setImportRows(null); setImportResult(null); setImportOpen(true); };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = rowsToLeads(parseCSV(String(reader.result)), leads || []);
        if (result.leads.length > IMPORT_MAX) {
          result.tooMany = true;
          result.errors = [
            `Import limit exceeded: you can import at most ${IMPORT_MAX} leads at a time, but this file has ${result.leads.length} new leads. Split it into smaller files.`,
            ...result.errors,
          ];
        }
        setImportRows(result);
      }
      catch { setImportRows({ leads: [], dupExisting: [], dupInFile: [], errors: ['Could not read this file as CSV.'] }); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // The whole file goes to POST /leads/bulk in ONE request (max IMPORT_MAX
  // rows), so the server can check the company lead limit for the full file
  // at once and the 300-requests/15-min rate limit is never an issue.
  const runImport = async () => {
    if (!importRows?.leads.length || importRows.leads.length > IMPORT_MAX) return;
    setImportBusy(true);
    try {
      const r = await leadApi.bulkCreate(importRows.leads);
      const reasons = (r.errors || []).map((e) => e.replace(/^Row (\d+)/, 'Lead #$1'));
      setImportResult({ created: r.created || 0, merged: r.merged || 0, skipped: r.skipped || 0, failed: r.failed || 0, reasons });
      show(`Import done — ${r.created || 0} added, ${r.merged || 0} updated, ${r.skipped || 0} skipped, ${r.failed || 0} failed.`, r.failed ? 'error' : 'success');
      refetch();
    } catch (err) {
      // Nothing was imported — show the server's exact reason (e.g. lead limit exceeded)
      const msg = apiError(err);
      setImportResult({ created: 0, skipped: 0, failed: importRows.leads.length, reasons: [msg], blocked: true });
      show(msg, 'error');
    } finally {
      setImportBusy(false);
    }
  };

  // ── Bulk update: export → edit in Excel → re-upload ────────────────────────
  const openUpdate = () => { setUpdPlan(null); setUpdResult(null); setUpdProgress(''); setUpdOpen(true); };

  const onUpdateFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUpdResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      try { setUpdPlan(buildUpdatePlan(String(reader.result), leads || [])); }
      catch { setUpdPlan({ updates: [], preview: [], total: 0, unchanged: 0, errors: ['Could not read this file as CSV.'] }); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Sends only the changed rows, in chunks, so a 7,000-lead file never hits the
  // request-size or rate limits. A chunk that fails is reported; the rest continue.
  const runUpdate = async () => {
    if (!updPlan?.updates.length) return;
    setUpdBusy(true);
    const total = { updated: 0, unchanged: 0, failed: 0, errors: [] };
    const rows = updPlan.updates;
    try {
      for (let i = 0; i < rows.length; i += UPDATE_CHUNK) {
        setUpdProgress(`Updating ${Math.min(i + UPDATE_CHUNK, rows.length)} of ${rows.length}…`);
        try {
          const r = await leadApi.bulkUpdate(rows.slice(i, i + UPDATE_CHUNK));
          total.updated += r.updated || 0;
          total.unchanged += r.unchanged || 0;
          total.failed += r.failed || 0;
          total.errors.push(...(r.errors || []));
        } catch (err) {
          const n = Math.min(UPDATE_CHUNK, rows.length - i);
          total.failed += n;
          total.errors.push(`Leads ${i + 1}–${i + n} were not updated: ${apiError(err)}`);
        }
      }
      setUpdResult(total);
      setUpdPlan(null);
      show(`Update done — ${total.updated} updated, ${total.failed} failed.`, total.failed ? 'error' : 'success');
      refetch();
    } finally {
      setUpdBusy(false);
      setUpdProgress('');
    }
  };

  const subTotal = useMemo(() => items.reduce((s, it) => s + (it.qty || 0) * (it.price || 0), 0), [items]);

  // Full-page spinner only on first load — a refetch (e.g. after an import)
  // must not replace the page, or the import modal and its results vanish.
  if (loading && !leads) return <Spinner label="Loading leads…" />;

  return (
    // Normal-flow page: title, filters, then all 50 rows of the current page; the page itself scrolls
    <div ref={topRef} className="flex flex-col">

      <PageTitle
        icon={<Target size={18} />}
        badge={filtered.length}
        actions={
          <div className="flex gap-2">
          
            <Button variant="outline" onClick={openImport}>
              <Upload size={14} className="mr-1.5" />Import CSV
            </Button>
            <Button onClick={() => setForm(emptyLead())}>
              <Plus size={14} className="mr-1.5" />Add Lead
            </Button>
          </div>
        }
      >
        Leads
      </PageTitle>

      {dupOpen && (
        <>
          <p className="mb-3 text-[12px] text-ink-2">
            Leads that share the exact same phone number are grouped below — e.g. the same customer
            auto-created twice from the Order Form under two different salespeople. Pick which one to keep,
            then merge: call logs, notes, and edit history are combined, and any cheques or WhatsApp messages
            linked to the removed lead(s) move to the kept one. Removed leads are archived to Deleted Contacts.
          </p>
          {dupLoading ? (
            <Spinner label="Scanning for duplicate leads…" />
          ) : !dupGroups || !dupGroups.length ? (
            <Card><div className="card-body"><EmptyState title="No duplicates found" hint="Every lead in this company has a unique phone number." /></div></Card>
          ) : (
            <>
              <div className="mb-2 flex justify-end">
                <Button variant="outline" size="sm" onClick={loadDuplicates}><RefreshCw size={13} className="mr-1.5" />Rescan</Button>
              </div>
              {dupGroups.map((g) => (
                <DuplicateGroup key={g.mobileKey} group={g} onMerged={loadDuplicates} />
              ))}
            </>
          )}
        </>
      )}

      {!dupOpen && (
      <>
      {/* ── Stats strip ─────────────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 flex-shrink-0">
        {[
          ['Total Contacts',  stats.total,        'border-gold',  <Target size={16} />],
          ['Enquiry',         stats.enquiry,      'border-info',  <Target size={16} />],
          ['Opportunity',     stats.opportunity,  'border-warn',  <Target size={16} />],
          ['Buyers',          stats.converted,    'border-ok',    <Users size={16} />],
          ['Conversion %',    `${stats.rate}%`,   'border-gold',  <Percent size={16} />],
        ].map(([l, v, c, icon]) => (
          <div key={l} className={`rounded-lg bg-white p-4 shadow-card border-l-4 ${c} flex items-center gap-3`}>
            <div className="text-ink-3">{icon}</div>
            <div>
              <div className="text-2xl font-black text-navy">{v}</div>
              <div className="mt-0.5 text-[11px] text-ink-2">{l}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2 flex-shrink-0">
        <Input
          className="!w-52"
          placeholder="Search name / mobile / email…"
          value={f.search}
          onChange={(e) => updateFilter({ search: e.target.value })}
        />
        <MultiSelect label="Statuses" options={LEAD_STATUSES} selected={f.status} onChange={(v) => updateFilter({ status: v })} />
        <MultiSelect label="Sources"  options={LEAD_SOURCES}  selected={f.source}  onChange={(v) => updateFilter({ source: v })} />
        <MultiSelect label="Stages"   options={LEAD_STAGES}   selected={f.stage}   onChange={(v) => updateFilter({ stage: v })} />
        <MultiSelect label="Countries" options={countryOptions} selected={f.country} onChange={(v) => updateFilter({ country: v })} />
        {campaignOptions.length > 0 && (
          <MultiSelect label="Campaigns" options={campaignOptions} selected={f.campaign} onChange={(v) => updateFilter({ campaign: v })} />
        )}
        {isAdmin && (
          <MultiSelect label="Employees" options={employeeOptions} selected={f.employee} onChange={(v) => updateFilter({ employee: v })} valueKey="id" labelKey="name" />
        )}
        <input
          type="date"
          value={f.dateFrom}
          onChange={(e) => updateFilter({ dateFrom: e.target.value })}
          className="rounded-lg border px-2.5 py-1.5 text-[12px]"
          style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
          title="From date"
        />
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>–</span>
        <input
          type="date"
          value={f.dateTo}
          onChange={(e) => updateFilter({ dateTo: e.target.value })}
          className="rounded-lg border px-2.5 py-1.5 text-[12px]"
          style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
          title="To date"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => updateFilter({ search: '', status: [], source: [], stage: [], country: [], campaign: [], employee: [], dateFrom: '', dateTo: '' })}
        >
          Clear
        </Button>
        {isAdmin && (
          <Button variant="outline" size="sm" className="ml-auto" disabled={!filtered.length}
            title="Download the leads below as an editable file (includes Lead ID)"
            onClick={() => exportLeadsForUpdate(filtered)}>
            <span className="flex items-center gap-1.5"><Download size={13} />Export for Update</span>
          </Button>
        )}
        {isAdmin && (
          <Button variant="outline" size="sm" title="Upload an edited export to update existing leads" onClick={openUpdate}>
            <span className="flex items-center gap-1.5"><Upload size={13} />Upload Updates</span>
          </Button>
        )}
        {isAdmin && (
          <Button variant="outline" size="sm" disabled={!filtered.length} onClick={exportCsv}>
            <span className="flex items-center gap-1.5"><Download size={13} />Export CSV</span>
          </Button>
        )}
        {isAdmin && (
          <Button variant="dark" size="sm" disabled={exporting || !filtered.length} onClick={exportPdf}>
            <span className="flex items-center gap-1.5"><Download size={13} />{exporting ? 'Exporting…' : 'Export PDF'}</span>
          </Button>
        )}
      </div>

      {/* ── Table — full height (all rows of the current page), horizontal scroll only ────────────── */}
      <Card className="flex flex-col overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            title="No leads yet"
            hint="Add a lead manually or adjust your filters."
            action={
              <Button onClick={() => setForm(emptyLead())}>
                <Plus size={14} className="mr-1.5" />Add Lead
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse">
              <thead>
                <tr className="bg-navy-800 text-white">
                  {['Sl. No', 'Name', 'Contact', 'Source', 'Interest', 'City', 'Remark', 'Owner', 'Country', 'Stage', 'Status', 'Order', 'Actions'].map((h) => (
                    <th key={h} className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((l, idx) => (
                  <tr key={l._id} className="border-b border-gray-100 last:border-0 hover:bg-gold-pale [&>td]:align-middle">
                    <td className="px-2.5 py-2 text-xs text-ink-3">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="px-2.5 py-2 text-xs font-bold">
                      <div className="flex items-center gap-2">
                        <WhatsAppButton mobile={l.mobile} country={l.country} />
                        <div className="min-w-0">
                          <button
                            className="text-left text-navy-700 hover:text-gold hover:underline"
                            onClick={() => navigate(`/leads/${l._id}`, { state: { from: location.pathname + location.search } })}
                          >
                            {l.name}
                          </button>
                          <div className="text-[10px] text-ink-3 font-normal">
                            {l.city}{l.city && l.country ? ', ' : ''}{l.country}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2.5 py-2 text-xs">
                      {fmtMobile(l.mobile, l.country) || '—'}
                      <div className="text-[10px] text-ink-3">{l.email}</div>
                    </td>
                    <td className="px-2.5 py-2 text-xs">
                      {l.source}
                      {l.campaign ? <div className="text-[10px] text-ink-3">{l.campaign}</div> : null}
                    </td>
                    <td className="px-2.5 py-2 text-xs">{l.interest || '—'}</td>
                    <td className="px-2.5 py-2 text-xs whitespace-nowrap">{l.city || '—'}</td>
                    <td className="px-2.5 py-2 text-xs max-w-[140px]"><span className="block truncate" title={l.remark || ''}>{l.remark || '—'}</span></td>
                    <td className="px-2.5 py-2 text-xs">{l.ownerName || '—'}</td>
                    <td className="px-2.5 py-2 text-xs whitespace-nowrap">{l.country || '—'}</td>
                    <td className="px-2.5 py-2">
                      {(() => {
                        const effStatus = (f.dateFrom || f.dateTo) ? statusAtDate(l, f.dateTo || f.dateFrom) : l.status;
                        const effL = { ...l, status: effStatus };
                        return <span className={`status ${leadStageClass(leadStageOf(effL), effL)}`}>{leadStageOf(effL)}</span>;
                      })()}
                    </td>
                    <td className="px-2.5 py-2">
                      {(f.dateFrom || f.dateTo) && (() => {
                        const hist = statusAtDate(l, f.dateTo || f.dateFrom);
                        return hist !== l.status ? (
                          <div className="flex flex-col gap-0.5">
                            <span className={`status ${leadStatusClass(hist)}`} title={`Status on ${f.dateTo || f.dateFrom}`}>{hist}</span>
                            <span className="text-[10px] text-ink-3">now: {l.status}</span>
                          </div>
                        ) : (
                          <span className={`status ${leadStatusClass(hist)}`}>{hist}</span>
                        );
                      })()}
                      {!(f.dateFrom || f.dateTo) && (
                        <span className={`status ${leadStatusClass(l.status)}`}>{l.status}</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 text-xs">
                      {l.orderNo ? <span className="font-bold text-ok">#{l.orderNo}</span> : '—'}
                    </td>
                    <td className="px-2.5 py-2 align-middle">
                      <div className="flex flex-nowrap items-center justify-start gap-1 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          title="View"
                          onClick={() => navigate(`/leads/${l._id}`, { state: { from: location.pathname + location.search } })}
                        >
                          <Eye size={13} />
                        </Button>

                        {!l.converted && (
                          <Button
                            size="sm"
                            variant="outline"
                            title="Edit"
                            onClick={() => setForm({ ...l, owner: l.owner || '' })}
                          >
                            <Pencil size={13} />
                          </Button>
                        )}
                        {isAdmin && !l.converted && (
                          <Button
                            size="sm"
                            variant="red"
                            title="Delete"
                            onClick={() => del(l)}
                          >
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
        {/* ── Pagination bar ───────────────────────────────────────────── */}
        {filtered.length > PAGE_SIZE && (
          <div className="flex flex-shrink-0 items-center justify-between border-t px-4 py-2.5" style={{ borderColor: 'var(--border-card)' }}>
            <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page === 1}
                onClick={() => setPage(1)}
                className="rounded px-2 py-1 text-[11px] font-bold disabled:opacity-30"
                style={{ color: 'var(--text-secondary)' }}
                title="First page"
              >«</button>
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded px-2 py-1 text-[11px] font-bold disabled:opacity-30"
                style={{ color: 'var(--text-secondary)' }}
                title="Previous page"
              >‹</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce((acc, p, i, arr) => {
                  if (i > 0 && p - arr[i - 1] > 1) acc.push('…');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === '…' ? (
                    <span key={`ellipsis-${i}`} className="px-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className="min-w-[28px] rounded px-2 py-1 text-[11px] font-bold"
                      style={p === page
                        ? { backgroundColor: 'var(--navy, #1e3a5f)', color: '#fff' }
                        : { color: 'var(--text-secondary)' }}
                    >{p}</button>
                  )
                )}
              <button
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded px-2 py-1 text-[11px] font-bold disabled:opacity-30"
                style={{ color: 'var(--text-secondary)' }}
                title="Next page"
              >›</button>
              <button
                disabled={page === totalPages}
                onClick={() => setPage(totalPages)}
                className="rounded px-2 py-1 text-[11px] font-bold disabled:opacity-30"
                style={{ color: 'var(--text-secondary)' }}
                title="Last page"
              >»</button>
            </div>
          </div>
        )}
      </Card>
      </>
      )}

      {/* ── Add / Edit modal ─────────────────────────────────────────────────── */}
      <LeadFormModal
        open={!!form}
        lead={form}
        isAdmin={isAdmin}
        currentUser={user}
        sales={sales}
        onClose={() => setForm(null)}
        onSaved={refetch}
        onOpenExisting={(lid) => { setForm(null); navigate(`/leads/${lid}`, { state: { from: location.pathname + location.search } }); }}
      />

      {/* ── Import CSV modal ─────────────────────────────────────────────────── */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import Leads from CSV" width="min-w-[560px]">
        <p className="text-[11px] text-ink-3">
          Upload a <strong>.csv</strong> file. The first row must be column headers. A <strong>Name</strong> column is
          required; optional columns: Mobile, Country Code, Email, Country, City, Source, Campaign, Stage, Interest,
          Remark, Delivery. <strong>Country Code</strong> accepts a dial code (e.g. 971, +91) and sets the country
          automatically. <strong>Stage</strong> accepts Lead, Opportunity, Enquiry or Buyer. Duplicate phone numbers
          are skipped automatically.
        </p>

        <div className="mt-3 flex items-center justify-between gap-2">
          <label className="flex flex-1 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-xs font-bold text-ink-2 hover:border-gold hover:bg-gold-pale gap-2">
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
            <FileText size={16} />Choose CSV file…
          </label>
        </div>
        <button onClick={downloadTemplate} className="mt-2 flex items-center gap-1 text-[11px] font-bold text-info hover:underline">
          <Download size={12} />Download template CSV
        </button>

        {importRows && (
          <div className="mt-3 space-y-2">
            <div className="rounded-md bg-info-light px-3 py-2 text-xs text-info">
              <strong>{importRows.leads.length}</strong> new lead{importRows.leads.length !== 1 ? 's' : ''} ready to import.
            </div>
            {importRows.dupExisting?.length > 0 && (
              <div className="max-h-24 overflow-y-auto rounded-md bg-warn-light px-3 py-2 text-[11px] text-warn">
                <strong>{importRows.dupExisting.length} already in system</strong> (will be skipped): {importRows.dupExisting.slice(0, 8).join(', ')}{importRows.dupExisting.length > 8 ? '…' : ''}
              </div>
            )}
            {importRows.dupInFile?.length > 0 && (
              <div className="max-h-24 overflow-y-auto rounded-md bg-warn-light px-3 py-2 text-[11px] text-warn">
                <strong>{importRows.dupInFile.length} duplicate{importRows.dupInFile.length !== 1 ? 's' : ''} within the file</strong> (only first kept): {importRows.dupInFile.slice(0, 8).join(', ')}{importRows.dupInFile.length > 8 ? '…' : ''}
              </div>
            )}
            {importRows.errors.length > 0 && (
              <div className="max-h-28 overflow-y-auto rounded-md bg-warn-light px-3 py-2 text-[11px] text-warn">
                {importRows.errors.slice(0, 12).map((er, i) => <div key={i}>{er}</div>)}
                {importRows.errors.length > 12 && <div>…and {importRows.errors.length - 12} more.</div>}
              </div>
            )}
            {importRows.leads.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border border-gray-100">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-gray-50 text-ink-2">
                      {['Name', 'Mobile', 'Source', 'Stage', 'Delivery'].map((h) => (
                        <th key={h} className="px-2 py-1 text-left font-bold uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.leads.slice(0, 8).map((l, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-2 py-1 font-bold">{l.name}</td>
                        <td className="px-2 py-1">{fmtMobile(l.mobile, l.country) || '—'}</td>
                        <td className="px-2 py-1">{l.source}</td>
                        <td className="px-2 py-1">{leadStageOf(l)}</td>
                        <td className="px-2 py-1">{l.delivery || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importRows.leads.length > 8 && (
                  <div className="px-2 py-1 text-[10px] text-ink-3">…and {importRows.leads.length - 8} more rows.</div>
                )}
              </div>
            )}
          </div>
        )}

        {importResult && !importResult.blocked && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-ok-light px-3 py-2 text-xs text-ok">
            <CheckCircle size={14} />
            {importResult.created} added · {importResult.merged || 0} updated · {importResult.skipped} skipped · {importResult.failed} failed.
          </div>
        )}
        {importResult?.reasons?.length > 0 && (
          <div className={`mt-2 max-h-40 overflow-y-auto rounded-md bg-danger-light px-3 py-2 text-danger ${importResult.blocked ? 'text-xs font-bold' : 'text-[11px]'}`}>
            {importResult.reasons.slice(0, 50).map((r, i) => <div key={i}>{r}</div>)}
            {importResult.reasons.length > 50 && <div>…and {importResult.reasons.length - 50} more.</div>}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setImportOpen(false)}>Close</Button>
          <Button disabled={importBusy || !importRows?.leads.length || importRows?.tooMany} onClick={runImport}>
            {importBusy
              ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Importing…</>
              : <><Upload size={13} className="mr-1.5" />Import {importRows?.leads.length || 0} Lead{importRows?.leads.length === 1 ? '' : 's'}</>
            }
          </Button>
        </div>
      </Modal>

      {/* ── Bulk update modal (admin) ───────────────────────────────────────── */}
      <Modal open={updOpen} onClose={() => !updBusy && setUpdOpen(false)} title="Update Leads from File" width="min-w-[600px]">
        <ol className="list-decimal space-y-1 pl-4 text-[11px] text-ink-3">
          <li>Click <strong>Export for Update</strong> (it exports the leads currently shown, so filter first if you only want some).</li>
          <li>Edit the cells in Excel. <strong>Do not change or delete the Lead ID column</strong> — it is how each row finds its lead.</li>
          <li>Save as <strong>CSV</strong> and upload it here. You'll see every change before anything is saved.</li>
        </ol>
        <p className="mt-2 text-[11px] text-ink-3">
          Editable: Name, Mobile, Country, Email, City, Source, Campaign, Interest, Remark, Delivery, Status, Owner (user name), Follow-up Date (YYYY-MM-DD).
          Blank Email / City / Campaign / Remark / Delivery / Follow-up clears that field; blank in any other column leaves it unchanged.
          Rows you delete from the file are left untouched. Stage and Created are read-only.
        </p>

        <div className="mt-3">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-xs font-bold text-ink-2 hover:border-gold hover:bg-gold-pale">
            <input type="file" accept=".csv,text/csv" className="hidden" disabled={updBusy} onChange={onUpdateFile} />
            <FileText size={16} />Choose edited CSV file…
          </label>
        </div>

        {updPlan && (
          <div className="mt-3 space-y-2 text-xs">
            <div className="rounded-md bg-gray-50 px-3 py-2">
              <strong>{updPlan.updates.length}</strong> lead{updPlan.updates.length !== 1 ? 's' : ''} will be updated ·{' '}
              {updPlan.unchanged} unchanged · {updPlan.errors.length} skipped (of {updPlan.total} rows).
            </div>
            {updPlan.errors.length > 0 && (
              <div className="max-h-28 overflow-y-auto rounded-md bg-warn-light px-3 py-2 text-[11px] text-warn">
                {updPlan.errors.slice(0, 30).map((er, i) => <div key={i}>{er}</div>)}
                {updPlan.errors.length > 30 && <div>…and {updPlan.errors.length - 30} more.</div>}
              </div>
            )}
            {updPlan.preview.length > 0 && (
              <div className="max-h-52 overflow-y-auto rounded-md border border-gray-100">
                {updPlan.preview.slice(0, 25).map((p, i) => (
                  <div key={i} className="border-b border-gray-100 px-3 py-1.5 last:border-0">
                    <div className="font-bold">{p.name}</div>
                    {p.diffs.map((d, j) => (
                      <div key={j} className="text-[11px] text-ink-3">
                        {d.label}: <span className="line-through">{d.from || '(empty)'}</span> → <strong className="text-ink-1">{d.to || '(empty)'}</strong>
                      </div>
                    ))}
                  </div>
                ))}
                {updPlan.preview.length > 25 && (
                  <div className="px-3 py-1.5 text-[10px] text-ink-3">…and {updPlan.preview.length - 25} more leads (all will be updated).</div>
                )}
              </div>
            )}
          </div>
        )}

        {updResult && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-1.5 rounded-md bg-ok-light px-3 py-2 text-xs font-bold text-ok">
              <CheckCircle size={14} />{updResult.updated} updated · {updResult.unchanged} unchanged · {updResult.failed} failed.
            </div>
            {updResult.errors.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md bg-danger-light px-3 py-2 text-[11px] text-danger">
                {updResult.errors.slice(0, 50).map((er, i) => <div key={i}>{er}</div>)}
                {updResult.errors.length > 50 && <div>…and {updResult.errors.length - 50} more.</div>}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          {updProgress && <span className="mr-auto text-[11px] text-ink-3">{updProgress}</span>}
          <Button variant="outline" disabled={updBusy} onClick={() => setUpdOpen(false)}>Close</Button>
          <Button disabled={updBusy || !updPlan?.updates.length} onClick={runUpdate}>
            {updBusy
              ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Updating…</>
              : <><Upload size={13} className="mr-1.5" />Update {updPlan?.updates.length || 0} Lead{updPlan?.updates.length === 1 ? '' : 's'}</>}
          </Button>
        </div>
      </Modal>

      {/* ── Convert modal ───────────────────────────────────────────────────── */}
      <Modal
        open={!!convert}
        onClose={() => setConvert(null)}
        title={convert ? `Convert "${convert.name}" to Order` : ''}
        width="min-w-[640px]"
      >
        {convert && (
          <>
            <p className="mb-2.5 text-[11px] text-ink-3">
              Add the items the customer is ordering. This creates a confirmed order and links it to the lead.
            </p>
            <OrderItemsEditor items={items} onChange={setItems} compact />
            <div className="mt-1.5 flex justify-end rounded-md bg-navy px-4 py-3">
              <div className="text-right">
                <div className="text-[9px] uppercase text-white/55">Order Total</div>
                <div className="text-xl font-bold text-gold">{fmtAED(subTotal)}</div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConvert(null)}>Cancel</Button>
              <Button variant="green" disabled={busy} onClick={doConvert}>
                {busy
                  ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Converting…</>
                  : <><ShoppingCart size={13} className="mr-1.5" />Create Order</>
                }
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

// ── Duplicate detection panel ─────────────────────────────────────────────────
function DupePanel({ dupe, onOpen }) {
  const { lead } = dupe;
  const calls = lead.callLogs || [];
  const notes = lead.notes   || [];
  const allEntries = [
    ...calls.map((c) => ({ type: 'call', text: c.summary, byName: c.byName, at: c.at })),
    ...notes.map((n) => ({ type: 'note', text: n.text,    byName: n.byName, at: n.at })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <div className="mt-3 rounded-lg border border-warn/40 bg-warn-light">
      {/* Header */}
      <div className="flex items-start gap-2 px-3 pt-3 pb-2">
        <AlertTriangle size={16} className="mt-0.5 text-warn flex-shrink-0" />
        <div className="flex-1">
          <p className="text-xs font-bold text-warn">This number is already registered</p>
          <p className="mt-0.5 text-[11px] text-ink-2">
            Added by{' '}
            <strong>{dupe.ownedByMe ? 'you' : (lead.ownerName || 'another employee')}</strong>
            {lead.name   ? <> · <strong>{lead.name}</strong></>   : null}
            {lead.status ? <> · <span className="font-medium">{lead.status}</span></> : null}
          </p>
          {lead.interest && (
            <p className="mt-0.5 text-[11px] text-ink-3">Interest: {lead.interest}</p>
          )}
        </div>
      </div>

      {/* Discussion history */}
      {allEntries.length > 0 && (
        <div className="mx-3 mb-2 rounded-md border border-warn/20 bg-white/70">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-3 border-b border-warn/10">
            What's been discussed ({calls.length} call{calls.length !== 1 ? 's' : ''} · {notes.length} note{notes.length !== 1 ? 's' : ''})
          </div>
          <div className="divide-y divide-warn/10 max-h-44 overflow-y-auto">
            {allEntries.map((entry, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2">
                {entry.type === 'call'
                  ? <Phone size={12} className="mt-0.5 flex-shrink-0 text-ink-3" />
                  : <FileText size={12} className="mt-0.5 flex-shrink-0 text-ink-3" />
                }
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-ink break-words">{entry.text}</p>
                  <p className="mt-0.5 text-[10px] text-ink-3">
                    <strong>{entry.byName || 'Unknown'}</strong> · {new Date(entry.at).toLocaleString('en-GB', {
                      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {allEntries.length === 0 && (
        <p className="mx-3 mb-2 text-[11px] text-ink-3">No calls or notes logged yet.</p>
      )}

      <div className="px-3 pb-3 flex items-center justify-between">
        <p className="text-[11px] text-ink-2">
          Open the existing lead to add your own calls or notes.
        </p>
        <Button size="sm" onClick={onOpen}>
          Open existing lead <ArrowRight size={12} className="ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ── Lead form modal (Formik + Yup) ───────────────────────────────────────────
// Convert an ISO date (or null) to a value usable by <input type="datetime-local">
// in the user's local timezone: "YYYY-MM-DDTHH:mm". Returns '' when empty.
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LeadFormModal({ open, lead, isAdmin, currentUser, sales, onClose, onSaved, onOpenExisting }) {
  const { show } = useToast();
  const [dupe, setDupe] = useState(null);
  const [checking, setChecking] = useState(false);
  const isEdit = !!lead?._id;

  const initial = {
    name: lead?.name || '', mobile: lead?.mobile || '', altMobile: lead?.altMobile || '', email: lead?.email || '',
    country: lead?.country || 'UAE', altCountry: lead?.altCountry || lead?.country || 'UAE', city: lead?.city || '',
    source: lead?.source || 'Walk-in', campaign: lead?.campaign || '',
    interest: lead?.interest || '', remark: lead?.remark || '',
    delivery: lead?.delivery || '',
    stage: isEdit ? STATUS_TO_STAGE(lead.status) : 'Lead',
    owner: lead?.owner || '',
    followUpAt: toLocalInput(lead?.followUpAt),
  };

  const handleSubmit = async (values, { setSubmitting }) => {
    if (!isEdit && dupe) { show('This number already exists — open the existing lead instead.', 'error'); setSubmitting(false); return; }
    let status = STAGE_TO_STATUS[values.stage];
    if (isEdit && STATUS_TO_STAGE(lead.status) === values.stage) status = lead.status;

    const payload = {
      name: values.name, mobile: values.mobile, altMobile: values.altMobile, altCountry: values.altMobile ? values.altCountry : '', email: values.email,
      country: values.country, city: values.city, source: values.source,
      campaign: values.campaign, interest: values.interest, remark: values.remark,
      delivery: values.delivery,
      status,
      owner: values.owner || undefined,
      followUpAt: values.followUpAt ? new Date(values.followUpAt).toISOString() : null,
    };
    try {
      if (isEdit) { await leadApi.update(lead._id, payload); show('Lead updated.', 'success'); }
      else { await leadApi.create(payload); show('Lead added.', 'success'); }
      onSaved();
      onClose();
    } catch (e) {
      const details = e?.response?.data?.details;
      if (e?.response?.status === 409 && details?.duplicate) {
        show('This number already exists.', 'error');
        setDupe({ exists: true, ownedByMe: details.ownedByMe, lead: { _id: details.leadId, ownerName: details.ownerName } });
      } else show(apiError(e), 'error');
    } finally { setSubmitting(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Lead' : 'Add Lead'} width="sm:max-w-[600px]">
      <Formik initialValues={initial} validationSchema={leadSchema} onSubmit={handleSubmit} enableReinitialize>
        {({ values, errors, touched, handleChange, handleBlur, isSubmitting, setFieldValue }) => (
          <Form>
            <DupeWatcher
              active={!isEdit}
              mobile={values.mobile}
              country={values.country}
              onResult={setDupe}
              onChecking={setChecking}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <FieldRow label="Name" name="name" error={touched.name && errors.name}>
                <Input name="name" value={values.name} placeholder="Customer name" onChange={handleChange} onBlur={handleBlur} />
              </FieldRow>
              <FieldRow label="Country" name="country" error={touched.country && errors.country}>
                <CountrySelect value={values.country} onChange={(v) => setFieldValue('country', v)} />
              </FieldRow>

              <FieldRow
                label="Mobile"
                name="mobile"
                error={(touched.mobile && errors.mobile) || (!isEdit && dupe ? 'Number already exists' : '')}
              >
                <div className="flex">
                  <span
                    className="flex items-center whitespace-nowrap rounded-l-md border border-r-0 px-2.5 text-[13px] font-bold"
                    style={{
                      backgroundColor: 'var(--bg-card-head)',
                      borderColor: !isEdit && dupe ? '#DC2626' : 'var(--input-border)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    +{dialFor(values.country) || '—'}
                  </span>
                  <Input
                    className={`!rounded-l-none ${!isEdit && dupe ? '!border-danger' : ''}`}
                    name="mobile"
                    value={values.mobile}
                    placeholder="e.g. 506731305"
                    onChange={handleChange}
                    onBlur={handleBlur}
                    readOnly={isEdit && !isAdmin}
                    title={isEdit && !isAdmin ? "Only admins can edit the mobile number" : undefined}
                    style={
                      isEdit && !isAdmin
                        ? { backgroundColor: 'var(--bg-card-head)', cursor: 'not-allowed' }
                        : dupe ? { borderColor: '#DC2626' } : undefined
                    }
                  />
                </div>
                {isEdit && !isAdmin && <span className="mt-1 block text-[10px]" style={{ color: 'var(--text-muted)' }}>Only admins can edit the mobile number.</span>}
              </FieldRow>
              <FieldRow label="Alternate Country (optional)" name="altCountry" error={touched.altCountry && errors.altCountry}>
                <CountrySelect value={values.altCountry} onChange={(v) => setFieldValue('altCountry', v)} />
              </FieldRow>
              <FieldRow label="Alternate Number (optional)" name="altMobile" error={touched.altMobile && errors.altMobile}>
                <div className="flex">
                  <span
                    className="flex items-center whitespace-nowrap rounded-l-md border border-r-0 px-2.5 text-[13px] font-bold"
                    style={{ backgroundColor: 'var(--bg-card-head)', borderColor: 'var(--input-border)', color: 'var(--text-primary)' }}
                  >
                    +{dialFor(values.altCountry) || '—'}
                  </span>
                  <Input
                    className="!rounded-l-none"
                    name="altMobile"
                    value={values.altMobile}
                    placeholder="e.g. second contact number"
                    onChange={handleChange}
                    onBlur={handleBlur}
                  />
                </div>
              </FieldRow>
              <FieldRow label="Email" name="email" error={touched.email && errors.email}>
                <Input name="email" value={values.email} placeholder="name@email.com" onChange={handleChange} onBlur={handleBlur} />
              </FieldRow>
              <FieldRow label="City" name="city" error={touched.city && errors.city}>
                <Input name="city" value={values.city} placeholder="e.g. Al Quoz" onChange={handleChange} onBlur={handleBlur} />
              </FieldRow>
             
              <FieldRow label="Source" name="source" error={touched.source && errors.source}>
                <Select name="source" value={values.source} onChange={handleChange}>
                  {LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}
                </Select>
              </FieldRow>
              <FieldRow label="Campaign (optional)" name="campaign" error={touched.campaign && errors.campaign}>
                <Input name="campaign" value={values.campaign} placeholder="e.g. Eid Sale" onChange={handleChange} onBlur={handleBlur} />
              </FieldRow>
              <FieldRow label="Stage" name="stage" error={touched.stage && errors.stage}>
                <Select name="stage" value={values.stage} onChange={handleChange}>
                  {CREATE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </FieldRow>
              {isAdmin && (
                <FieldRow label="Assign to" name="owner">
                  <Select name="owner" value={values.owner} onChange={handleChange}>
                    <option value="">Me ({currentUser.name})</option>
                    {sales.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </FieldRow>
              )}
            </div>
            <div className="mt-3">
              <FieldRow label="Interest" name="interest" error={touched.interest && errors.interest}>
                <Input name="interest" value={values.interest} placeholder="e.g. Formal leather shoes, size 42" onChange={handleChange} onBlur={handleBlur} />
              </FieldRow>
            </div>
            <div className="mt-3">
              <FieldRow label="Remark (optional)" name="remark" error={touched.remark && errors.remark}>
                <Textarea rows={2} name="remark" value={values.remark} onChange={handleChange} onBlur={handleBlur} />
              </FieldRow>
            </div>
            <div className="mt-3">
              <FieldRow label="Delivery Details (optional)" name="delivery" error={touched.delivery && errors.delivery}>
                <Input name="delivery" value={values.delivery} placeholder="e.g. HURIA TRANSPORT" onChange={handleChange} onBlur={handleBlur} />
              </FieldRow>
            </div>

            <div className="mt-3">
              <FieldRow label="Follow-up Date & Time (optional)" name="followUpAt" error={touched.followUpAt && errors.followUpAt}>
                <Input
                  type="datetime-local"
                  name="followUpAt"
                  value={values.followUpAt}
                  onChange={handleChange}
                  onBlur={handleBlur}
                />
                <span className="mt-1 block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Setting this notifies the assigned employee and the admins.
                  {values.followUpAt ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => handleChange({ target: { name: 'followUpAt', value: '' } })}
                      >
                        Clear
                      </button>
                    </>
                  ) : null}
                </span>
              </FieldRow>
            </div>

            {!isEdit && checking && (
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-3">
                <Loader2 size={12} className="animate-spin" />Checking if this number already exists…
              </p>
            )}
            {!isEdit && dupe && <DupePanel dupe={dupe} onOpen={() => onOpenExisting(dupe.lead._id)} />}

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || (!isEdit && !!dupe)}>
                {isSubmitting
                  ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</>
                  : 'Save Lead'
                }
              </Button>
            </div>
          </Form>
        )}
      </Formik>
    </Modal>
  );
}

function FieldRow({ label, error, children }) {
  return (
    <Field label={label}>
      {children}
      {error && <p className="mt-1 text-[11px] font-bold text-danger">{error}</p>}
    </Field>
  );
}

function DupeWatcher({ active, mobile, country, onResult, onChecking }) {
  useEffect(() => {
    if (!active) { onResult(null); return; }
    const m = (mobile || '').trim();
    if (m.replace(/\D/g, '').length < 5) { onResult(null); onChecking(false); return; }
    onChecking(true);
    const t = setTimeout(async () => {
      try {
        const res = await leadApi.lookup(m, country);
        onResult(res.exists ? res : null);
      } catch { onResult(null); }
      finally { onChecking(false); }
    }, 450);
    return () => clearTimeout(t);
  }, [active, mobile, country]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
