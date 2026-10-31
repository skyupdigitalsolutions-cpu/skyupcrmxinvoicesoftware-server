import { useState, useEffect } from 'react';
import {
  Building2, Plus, Pencil, Trash2, Users, Shield, Loader2, Target,
  Cloud, Mail, DollarSign, ChevronDown, ChevronRight, ChevronUp, Send, Eye, EyeOff,
  Palette, Image as ImageIcon, Server, FileCheck,
  Languages,
} from 'lucide-react';
import { companyApi, platformApi, termsApi } from '../api/endpoints.js';
import { useFetch } from '../hooks/useApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { apiError } from '../api/client.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { Field, Input, Textarea } from '../components/ui/Field.jsx';

// Max dimension (px) a logo is downscaled to before upload. Keeps every
// format (PNG/JPG/GIF/WEBP/BMP/SVG — anything the browser's <img> can
// decode) consistent, keeps the upload small regardless of the original
// photo size, and preserves aspect ratio (never stretches/crops).
const LOGO_MAX_DIM = 512;

// Backend schema caps branding.addressLine1 / addressLine2 at 160 chars each.
// Enforce the same limit client-side (hard cap via maxLength + a live counter)
// so users get immediate feedback instead of a failed save after filling out
// the whole form.
const ADDRESS_LINE_MAX_LEN = 160;

function resizeImageFile(file, maxDim = LOGO_MAX_DIM) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        // Transparent background so non-square logos sit cleanly on any
        // page background instead of getting a white/black box.
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Free, keyless translation helper (MyMemory API) used to auto-fill the
// Arabic legal name from the English legal/trading name. This is machine
// translation — always review the result before saving, especially for
// brand names, which are often transliterated rather than translated.
async function translateToArabic(text) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const res = await fetch(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=en|ar`
  );
  if (!res.ok) throw new Error('Translation request failed.');
  const data = await res.json();
  return data?.responseData?.translatedText || '';
}

// ── Currency presets ──────────────────────────────────────────────────────────
const CURRENCY_PRESETS = [
  { code: 'INR', symbol: '₹',  locale: 'en-IN',  label: 'INR — Indian Rupee (₹)' },
  { code: 'AED', symbol: 'AED', locale: 'en-AE',  label: 'AED — UAE Dirham' },
  { code: 'USD', symbol: '$',   locale: 'en-US',  label: 'USD — US Dollar ($)' },
  { code: 'EUR', symbol: '€',   locale: 'en-EU',  label: 'EUR — Euro (€)' },
  { code: 'GBP', symbol: '£',   locale: 'en-GB',  label: 'GBP — British Pound (£)' },
  { code: 'SAR', symbol: 'SAR', locale: 'ar-SA',  label: 'SAR — Saudi Riyal' },
  { code: 'QAR', symbol: 'QAR', locale: 'ar-QA',  label: 'QAR — Qatari Riyal' },
  { code: 'OTHER', symbol: '',  locale: '',        label: 'Other (custom)' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const blank = () => ({
  name: '', slug: '', contactEmail: '', notes: '', active: true,
  limits: { maxAdmins: 1, maxEmployees: 5, maxLeads: 0 },
  currency: { code: 'INR', symbol: '₹', locale: 'en-IN' },
});

const Usage = ({ used, limit }) => {
  const unlimited = !limit || limit === 0;
  const over = !unlimited && used >= limit;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-bold"
      style={{
        backgroundColor: over ? 'rgba(220,38,38,.12)' : 'var(--bg-card-head)',
        color: over ? '#DC2626' : 'var(--text-secondary)',
      }}
    >
      {used} / {unlimited ? '∞' : limit}
    </span>
  );
};

// ── Section expander ──────────────────────────────────────────────────────────
const Section = ({ icon, title, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border" style={{ borderColor: 'var(--border)' }}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold"
        style={{ background: 'var(--bg-card-head)', color: 'var(--text-primary)', borderRadius: 'inherit' }}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        <span className="flex-1">{title}</span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && <div className="space-y-3 px-3 pb-3 pt-2">{children}</div>}
    </div>
  );
};

// ── Password field with show/hide ─────────────────────────────────────────────
const SecretInput = ({ value, onChange, placeholder }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        style={{ paddingRight: '2.2rem' }}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3"
        onClick={() => setShow((v) => !v)}
        tabIndex={-1}
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
};

// ── Main Company Modal ────────────────────────────────────────────────────────
function CompanyModal({ company, onClose, onSaved }) {
  const { show } = useToast();
  const isEdit = !!company?.id;

  const initCurrency = () => {
    if (!company?.currency) return { code: 'INR', symbol: '₹', locale: 'en-IN' };
    return { code: company.currency.code || 'INR', symbol: company.currency.symbol || '₹', locale: company.currency.locale || 'en-IN' };
  };

  const [form, setForm] = useState(
    company
      ? {
          name: company.name, slug: company.slug,
          contactEmail: company.contactEmail || '',
          notes: company.notes || '', active: company.active,
          limits: { maxAdmins: company.limits?.maxAdmins ?? 1, maxEmployees: company.limits?.maxEmployees ?? 5, maxLeads: company.limits?.maxLeads ?? 0 },
          currency: initCurrency(),
        }
      : blank()
  );
  const [busy, setBusy] = useState(false);
  // Admin credentials, only used when creating a new company.
  const [admin, setAdmin] = useState({ name: '', username: '', password: '', email: '' });
  const [showPwd, setShowPwd] = useState(false);

  const setLimit = (k, v) => setForm((f) => ({ ...f, limits: { ...f.limits, [k]: v } }));
  const setCur = (k, v) => setForm((f) => ({ ...f, currency: { ...f.currency, [k]: v } }));

  const handlePreset = (e) => {
    const preset = CURRENCY_PRESETS.find((p) => p.code === e.target.value);
    if (preset && preset.code !== 'OTHER') {
      setForm((f) => ({ ...f, currency: { code: preset.code, symbol: preset.symbol, locale: preset.locale } }));
    } else {
      setForm((f) => ({ ...f, currency: { ...f.currency, code: '' } }));
    }
  };

  const save = async () => {
    if (!form.name.trim()) return show('Company name is required.', 'error');

    // On create, an admin can optionally be set up. If any admin field is filled,
    // require all three.
    const adminFilled = !isEdit && (admin.name.trim() || admin.username.trim() || admin.password);
    if (adminFilled) {
      if (!admin.name.trim() || !admin.username.trim() || !admin.password) {
        return show('Fill all admin fields (name, username, password) or leave them all blank.', 'error');
      }
      if (admin.password.length < 6) return show('Admin password must be at least 6 characters.', 'error');
    }

    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        contactEmail: form.contactEmail,
        notes: form.notes,
        active: form.active,
        limits: {
          maxAdmins: Math.max(0, Number(form.limits.maxAdmins) || 0),
          maxEmployees: Math.max(0, Number(form.limits.maxEmployees) || 0),
          maxLeads: Math.max(0, Number(form.limits.maxLeads) || 0),
        },
        currency: form.currency,
      };
      if (!isEdit) payload.slug = form.slug;
      if (isEdit) {
        await companyApi.update(company.id, payload);
        show('Company updated.', 'success');
      } else {
        if (adminFilled) {
          payload.admin = {
            name: admin.name.trim(),
            username: admin.username.trim(),
            password: admin.password,
            email: admin.email.trim(),
          };
        }
        const res = await companyApi.create(payload);
        show(
          res?.admin
            ? `Company created with admin "${res.admin.username}".`
            : 'Company created.',
          'success'
        );
      }
      onSaved();
      onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  const selectedPresetCode = CURRENCY_PRESETS.find(
    (p) => p.code === form.currency.code
  )?.code || 'OTHER';

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${company.name}` : 'New Company'} width="sm:max-w-[560px]">
      <div className="space-y-3.5">
        <Field label="Company Name">
          <Input value={form.name} placeholder="e.g. Skyup" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        {!isEdit && (
          <Field label="Slug (optional — auto-generated from name)">
            <Input value={form.slug} placeholder="skyup" onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Max Admins (0 = unlimited)">
            <Input type="number" min={0} value={form.limits.maxAdmins} onChange={(e) => setLimit('maxAdmins', e.target.value)} />
          </Field>
          <Field label="Max Employees (0 = unlimited)">
            <Input type="number" min={0} value={form.limits.maxEmployees} onChange={(e) => setLimit('maxEmployees', e.target.value)} />
          </Field>
        </div>
        <Field label="Max Leads (0 = unlimited)">
          <Input type="number" min={0} value={form.limits.maxLeads} onChange={(e) => setLimit('maxLeads', e.target.value)} />
        </Field>

        {/* ── Currency ─────────────────────────────────────────────────────── */}
        <Section icon={<DollarSign size={13} />} title="Currency" defaultOpen>
          <Field label="Currency Preset">
            <select
              value={selectedPresetCode}
              onChange={handlePreset}
              className="w-full rounded border px-2 py-1.5 text-xs"
              style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
            >
              {CURRENCY_PRESETS.map((p) => (
                <option key={p.code} value={p.code}>{p.label}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Code (e.g. INR)">
              <Input value={form.currency.code} placeholder="INR" onChange={(e) => setCur('code', e.target.value.toUpperCase())} />
            </Field>
            <Field label="Symbol (e.g. ₹)">
              <Input value={form.currency.symbol} placeholder="₹" onChange={(e) => setCur('symbol', e.target.value)} />
            </Field>
            <Field label="Locale (e.g. en-IN)">
              <Input value={form.currency.locale} placeholder="en-IN" onChange={(e) => setCur('locale', e.target.value)} />
            </Field>
          </div>
        </Section>

        <Field label="Contact Email (optional)">
          <Input value={form.contactEmail} placeholder="owner@company.com" onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
        </Field>
        <Field label="Notes (optional)">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>

        <label className="flex cursor-pointer items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
          <input type="checkbox" className="h-4 w-4 accent-purple-500" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Active (employees can log in &amp; data is usable)
        </label>

        {!isEdit && (
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border-card)' }}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
              <Shield size={13} /> Admin Login (created with the company)
            </div>
            <p className="mb-2.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              Set up the company's first admin now. Leave blank to add an admin later.
            </p>
            <div className="space-y-2.5">
              <Field label="Admin Name">
                <Input value={admin.name} placeholder="e.g. Priya Nair"
                  onChange={(e) => setAdmin({ ...admin, name: e.target.value })} />
              </Field>
              <Field label="Email Address (for password reset)">
                <Input type="email" value={admin.email} placeholder="admin@company.com"
                  onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Username">
                  <Input value={admin.username} placeholder="login username"
                    onChange={(e) => setAdmin({ ...admin, username: e.target.value })} />
                </Field>
                <Field label="Password (min 6 chars)">
                  <div className="relative">
                    <Input type={showPwd ? 'text' : 'password'} value={admin.password} placeholder="••••••"
                      onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
                      style={{ paddingRight: '2.2rem' }} />
                    <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3"
                      onClick={() => setShowPwd((v) => !v)} tabIndex={-1}>
                      {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </Field>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>
          {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Save Company'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Cloudinary Settings Modal ──────────────────────────────────────────────────
function CloudinaryModal({ company, onClose }) {
  const { show } = useToast();
  const [form, setForm] = useState({
    cloudName: company.cloudinary?.cloudName || '',
    apiKey:    company.cloudinary?.apiKey    || '',
    apiSecret: '',
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await companyApi.setCloudinary(company.id, form);
      show('Cloudinary credentials saved.', 'success');
      onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Cloudinary — ${company.name}`} width="sm:max-w-[480px]">
      <div className="space-y-3">
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          These credentials override the global Cloudinary env vars for this company's invoice PDFs.
        </p>
        <Field label="Cloud Name">
          <Input value={form.cloudName} placeholder="my-cloud-name" onChange={(e) => setForm({ ...form, cloudName: e.target.value })} />
        </Field>
        <Field label="API Key">
          <Input value={form.apiKey} placeholder="123456789012345" onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        </Field>
        <Field label="API Secret">
          <SecretInput value={form.apiSecret} placeholder="Leave blank to keep existing" onChange={(e) => setForm({ ...form, apiSecret: e.target.value })} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>
          {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Save Credentials'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Email Report Settings Modal ────────────────────────────────────────────────
// Daily report is sent through the developer's own Brevo account (the same
// connection configured in "Platform Email (Expiry Notifications)" below) —
// there's no per-company SMTP/Brevo setup anymore, just who receives it and
// when.
function EmailReportModal({ company, onClose }) {
  const { show } = useToast();
  const er = company.emailReport || {};
  const [form, setForm] = useState({
    enabled:      er.enabled      ?? false,
    adminEmail:   er.adminEmail   || '',
    senderName:   er.senderName   || '',
    sendAt:       er.sendAt       || '08:00',
  });
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await companyApi.setEmailReport(company.id, form);
      show('Email report settings saved.', 'success');
      onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      // Save first so the latest values are persisted, then test.
      await companyApi.setEmailReport(company.id, form);
      const r = await companyApi.testEmailReport(company.id);
      show(r.message || 'Test email sent!', 'success');
    } catch (e) { show(apiError(e), 'error'); }
    finally { setTesting(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Daily Email Report — ${company.name}`} width="sm:max-w-[520px]">
      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
          <input
            type="checkbox"
            className="h-4 w-4 accent-purple-500"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          Enable daily report emails for this company
        </label>

        <Field label="Admin Email (recipient)">
          <Input
            type="email"
            value={form.adminEmail}
            placeholder="admin@company.com"
            onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
          />
        </Field>

        <Field label="Send At (HH:MM — server local time)">
          <Input
            type="time"
            value={form.sendAt}
            onChange={(e) => setForm({ ...form, sendAt: e.target.value })}
          />
        </Field>

        <Field label="Sender Name (optional)">
          <Input
            value={form.senderName}
            placeholder={company.name}
            onChange={(e) => setForm({ ...form, senderName: e.target.value })}
          />
        </Field>

        <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          Reports are sent through the developer's own Brevo account (configured once, platform-wide,
          in "Platform Email" below) — no per-company email setup needed. Sender Name only changes how
          the "From" name looks to this company's recipient; the actual sending account stays the platform's.
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <Button variant="outline" disabled={testing} onClick={sendTest}>
          {testing ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Sending…</> : <><Send size={13} className="mr-1.5" />Send Test Now</>}
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={save}>
            {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Save Settings'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Branding / Receipt Settings Modal ─────────────────────────────────────────
// Per-company white-label: header name shown in the app sidebar, logo, plus all
// the fields printed on the receipt / tax-invoice PDF (heading, legal name,
// address, tax label/%, footer, declaration) and the dashboard cards heading.
function BrandingModal({ company, onClose }) {
  const { show } = useToast();
  const b = company.branding || {};
  const [form, setForm] = useState({
    headerName:     b.headerName     || '',
    headerTagline:  b.headerTagline  || '',
    logoUrl:        b.logoUrl        || '',
    receiptLogoUrl: b.receiptLogoUrl || '',
    cardsHeading:   b.cardsHeading   || '',
    receiptHeading: b.receiptHeading || 'Tax Invoice',
    legalName:      b.legalName      || '',
    legalNameAr:    b.legalNameAr    || '',
    addressLine1:   b.addressLine1   || '',
    addressLine2:   b.addressLine2   || '',
    addressAr:      b.addressAr      || '',
    city:           b.city           || '',
    phone:          b.phone          || '',
    email:          b.email          || '',
    website:        b.website        || '',
    trn:            b.trn            || '',
    taxLabel:       b.taxLabel       || 'VAT',
    taxPercent:     b.taxPercent     ?? 5,
    footerNote:     b.footerNote     || 'This is a Computer Generated Invoice',
    declaration:    b.declaration    || '',
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [translatingName, setTranslatingName] = useState(false);
  const [translatingAddr, setTranslatingAddr] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onLogoFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) return show('Please choose an image file.', 'error');
    // Raw upload cap is generous — the file gets downscaled below regardless
    // of format or original size, so this is just a sanity limit on huge files.
    if (file.size > 15 * 1024 * 1024) return show('Image too large — please use a file under 15 MB.', 'error');

    setUploading(true);
    try {
      // Normalizes ANY browser-decodable format (PNG/JPG/GIF/WEBP/BMP/SVG…)
      // to a correctly-proportioned PNG, so it always displays cleanly no
      // matter what the original file looked like.
      const dataUrl = await resizeImageFile(file);
      const res = await companyApi.uploadLogo(company.id, dataUrl);
      set('logoUrl', res.logoUrl);
      show('Logo uploaded.', 'success');
    } catch (err) { show(err && err.message ? err.message : apiError(err), 'error'); }
    finally { setUploading(false); }
  };

  // Separate logo just for the invoice/receipt PDF. Uploaded with target
  // 'receipt' so it's stored in branding.receiptLogoUrl and never overwrites
  // the sidebar logo.
  const onReceiptLogoFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return show('Please choose an image file.', 'error');
    if (file.size > 15 * 1024 * 1024) return show('Image too large — please use a file under 15 MB.', 'error');
    setUploadingReceipt(true);
    try {
      const dataUrl = await resizeImageFile(file);
      const res = await companyApi.uploadLogo(company.id, dataUrl, 'receipt');
      set('receiptLogoUrl', res.url || res.receiptLogoUrl || '');
      show('Receipt logo uploaded.', 'success');
    } catch (err) { show(err && err.message ? err.message : apiError(err), 'error'); }
    finally { setUploadingReceipt(false); }
  };

  // Auto-translate the English legal/trading name into Arabic using a free
  // machine-translation API. Always review the result — brand/proper names
  // are frequently transliterated rather than semantically translated.
  // `silent` = true suppresses toasts and only fills if the Arabic field is
  // still empty (used for the automatic on-blur trigger below).
  const autoTranslateLegalName = async (silent = false) => {
    if (!form.legalName.trim()) {
      if (!silent) show('Enter the Legal / Trading Name first.', 'error');
      return;
    }
    if (silent && form.legalNameAr.trim()) return; // don't clobber an existing value
    setTranslatingName(true);
    try {
      const ar = await translateToArabic(form.legalName);
      if (ar) {
        set('legalNameAr', ar);
        if (!silent) show('Arabic name filled — please review before saving.', 'success');
      } else if (!silent) {
        show('Could not get a translation — please enter manually.', 'error');
      }
    } catch (err) {
      if (!silent) show('Translation service unavailable — please enter manually.', 'error');
    } finally {
      setTranslatingName(false);
    }
  };

  // Same idea for the address block — combines Address Line 1 + 2 (+ City)
  // as the source text since the Arabic address field is a single line.
  const autoTranslateAddress = async (silent = false) => {
    const source = [form.addressLine1, form.addressLine2, form.city].filter(Boolean).join(', ');
    if (!source.trim()) {
      if (!silent) show('Enter Address Line 1 / 2 first.', 'error');
      return;
    }
    if (silent && form.addressAr.trim()) return;
    setTranslatingAddr(true);
    try {
      const ar = await translateToArabic(source);
      if (ar) {
        set('addressAr', ar);
        if (!silent) show('Arabic address filled — please review before saving.', 'success');
      } else if (!silent) {
        show('Could not get a translation — please enter manually.', 'error');
      }
    } catch (err) {
      if (!silent) show('Translation service unavailable — please enter manually.', 'error');
    } finally {
      setTranslatingAddr(false);
    }
  };

  const save = async () => {
    if (form.addressLine1.length > ADDRESS_LINE_MAX_LEN) {
      return show(`Address Line 1 is too long (${form.addressLine1.length}/${ADDRESS_LINE_MAX_LEN} chars). Please shorten it.`, 'error');
    }
    if (form.addressLine2.length > ADDRESS_LINE_MAX_LEN) {
      return show(`Address Line 2 is too long (${form.addressLine2.length}/${ADDRESS_LINE_MAX_LEN} chars). Please shorten it.`, 'error');
    }
    setBusy(true);
    try {
      await companyApi.setBranding(company.id, {
        ...form,
        taxPercent: Math.min(100, Math.max(0, Number(form.taxPercent) || 0)),
      });
      show('Branding & receipt settings saved.', 'success');
      onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Branding & Receipt — ${company.name}`} width="sm:max-w-[600px]">
      <div className="space-y-3.5">
        {/* ── App / sidebar branding ─────────────────────────────────────── */}
        <Section icon={<ImageIcon size={13} />} title="App Header & Logo" defaultOpen>
          <Field label="Header Name (shown in sidebar / top bar)">
            <Input value={form.headerName} placeholder={company.name} onChange={(e) => set('headerName', e.target.value)} />
          </Field>
          <Field label="Header Tagline (optional)">
            <Input value={form.headerTagline} placeholder="e.g. FOOTWEAR" onChange={(e) => set('headerTagline', e.target.value)} />
          </Field>
          <Field label="Logo Image (shown fixed in sidebar)">
            <Input value={form.logoUrl} placeholder="https://res.cloudinary.com/.../logo.png" onChange={(e) => set('logoUrl', e.target.value)} />
            <div className="mt-1.5 flex items-center gap-2">
              <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-bold ${uploading ? 'opacity-60' : ''}`} style={{ borderColor: 'var(--border-card)', color: 'var(--text-primary)' }}>
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
                {uploading ? 'Uploading…' : 'Upload image'}
                <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={onLogoFile} />
              </label>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>or paste a URL above · any image format, auto-resized</span>
            </div>
          </Field>
          {form.logoUrl ? (
            <div className="flex items-center gap-2 rounded border p-2" style={{ borderColor: 'var(--border)' }}>
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded" style={{ backgroundColor: 'var(--bg-muted, #f1f1f1)' }}>
                <img src={form.logoUrl} alt="Logo preview" className="h-11 w-11 rounded object-contain"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              </div>
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Logo preview — this is exactly how it'll appear in the sidebar</span>
            </div>
          ) : null}
          <Field label="Receipt Logo — printed on the invoice / tax-invoice PDF (separate from the sidebar logo)">
            <Input value={form.receiptLogoUrl} placeholder="https://res.cloudinary.com/.../receipt-logo.png" onChange={(e) => set('receiptLogoUrl', e.target.value)} />
            <div className="mt-1.5 flex items-center gap-2">
              <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-bold ${uploadingReceipt ? 'opacity-60' : ''}`} style={{ borderColor: 'var(--border-card)', color: 'var(--text-primary)' }}>
                {uploadingReceipt ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
                {uploadingReceipt ? 'Uploading…' : 'Upload receipt logo'}
                <input type="file" accept="image/*" className="hidden" disabled={uploadingReceipt} onChange={onReceiptLogoFile} />
              </label>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>use a version sized / cropped for the invoice header</span>
            </div>
          </Field>
          {form.receiptLogoUrl ? (
            <div className="flex items-center gap-2 rounded border p-2" style={{ borderColor: 'var(--border)' }}>
              <div className="flex h-12 w-20 flex-shrink-0 items-center justify-center rounded" style={{ backgroundColor: 'var(--bg-muted, #f1f1f1)' }}>
                <img src={form.receiptLogoUrl} alt="Receipt logo preview" className="max-h-11 max-w-[76px] object-contain"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              </div>
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Receipt logo preview — appears on the invoice PDF header</span>
            </div>
          ) : null}
          <Field label="Dashboard / Report Cards Heading (optional)">
            <Input value={form.cardsHeading} placeholder="e.g. Today's Overview" onChange={(e) => set('cardsHeading', e.target.value)} />
          </Field>
        </Section>

        {/* ── Receipt / Tax Invoice ──────────────────────────────────────── */}
        <Section icon={<Palette size={13} />} title="Receipt / Tax Invoice">
          <Field label="Receipt Heading (title at top of PDF)">
            <Input value={form.receiptHeading} placeholder="Tax Invoice" onChange={(e) => set('receiptHeading', e.target.value)} />
          </Field>
          <Field label="Legal / Trading Name (printed on receipt)">
            <Input
              value={form.legalName}
              placeholder={company.name}
              onChange={(e) => set('legalName', e.target.value)}
              onBlur={() => autoTranslateLegalName(true)}
            />
          </Field>
          <Field label="Legal Name — Arabic (اسم الشركة بالعربية)">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  value={form.legalNameAr}
                  dir="rtl"
                  placeholder="شركة نيو سبوتك للتجارة ذ.م.م"
                  onChange={(e) => set('legalNameAr', e.target.value)}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={translatingName || !form.legalName.trim()}
                onClick={() => autoTranslateLegalName(false)}
                title="Re-translate from Legal / Trading Name (overwrites current text)"
              >
                {translatingName ? <Loader2 size={13} className="animate-spin" /> : <Languages size={13} />}
              </Button>
            </div>
            <p className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Auto-fills when you leave the English field above (only if empty). Auto-translation
              is machine-generated — please review/edit before saving.
            </p>
          </Field>
          <Field label="Address — Arabic (optional)">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input value={form.addressAr} dir="rtl" onChange={(e) => set('addressAr', e.target.value)} />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={translatingAddr || (!form.addressLine1.trim() && !form.addressLine2.trim())}
                onClick={() => autoTranslateAddress(false)}
                title="Re-translate from Address Line 1 / 2 / City (overwrites current text)"
              >
                {translatingAddr ? <Loader2 size={13} className="animate-spin" /> : <Languages size={13} />}
              </Button>
            </div>
            <p className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Auto-fills from Address Line 1 / 2 / City once you leave those fields (only if empty).
            </p>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Address Line 1">
              <Input
                value={form.addressLine1}
                maxLength={ADDRESS_LINE_MAX_LEN}
                onChange={(e) => set('addressLine1', e.target.value)}
                onBlur={() => autoTranslateAddress(true)}
              />
              <p className="mt-0.5 text-[10px]" style={{ color: form.addressLine1.length >= ADDRESS_LINE_MAX_LEN ? '#DC2626' : 'var(--text-muted)' }}>
                {form.addressLine1.length}/{ADDRESS_LINE_MAX_LEN}
              </p>
            </Field>
            <Field label="Address Line 2">
              <Input
                value={form.addressLine2}
                maxLength={ADDRESS_LINE_MAX_LEN}
                onChange={(e) => set('addressLine2', e.target.value)}
                onBlur={() => autoTranslateAddress(true)}
              />
              <p className="mt-0.5 text-[10px]" style={{ color: form.addressLine2.length >= ADDRESS_LINE_MAX_LEN ? '#DC2626' : 'var(--text-muted)' }}>
                {form.addressLine2.length}/{ADDRESS_LINE_MAX_LEN}
              </p>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="City / Emirate">
              <Input
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                onBlur={() => autoTranslateAddress(true)}
              />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Email">
              <Input value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Website">
              <Input value={form.website} onChange={(e) => set('website', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="TRN / Tax No.">
              <Input value={form.trn} onChange={(e) => set('trn', e.target.value)} />
            </Field>
            <Field label="Tax Label">
              <Input value={form.taxLabel} placeholder="VAT" onChange={(e) => set('taxLabel', e.target.value)} />
            </Field>
            <Field label="Tax %">
              <Input type="number" min={0} max={100} value={form.taxPercent} onChange={(e) => set('taxPercent', e.target.value)} />
            </Field>
          </div>
          <Field label="Declaration (printed near signature)">
            <Textarea rows={2} value={form.declaration} onChange={(e) => set('declaration', e.target.value)} />
          </Field>
          <Field label="Footer Note">
            <Input value={form.footerNote} onChange={(e) => set('footerNote', e.target.value)} />
          </Field>
        </Section>

        <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          These settings are applied per company. Header name &amp; logo appear in the app
          sidebar after the company&apos;s users log in; the receipt fields are used on all
          newly generated / regenerated invoice PDFs.
        </p>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>
          {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Save Branding'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Platform Email (Expiry Notifications) ─────────────────────────────────────
// Platform-wide Brevo connection used to email subscription-expiry warnings to
// each company's admin. Separate from each company's own daily-report Brevo.
function PlatformEmailCard() {
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [form, setForm] = useState({
    enabled: false, remindDays: 5, ccOwnerEmail: '',
  });

  useEffect(() => {
    if (!open || loaded) return;
    platformApi.getSettings()
      .then((s) => {
        const e = s.expiryEmail || {};
        setForm({
          enabled: !!e.enabled,
          remindDays: e.remindDays ?? 5,
          ccOwnerEmail: e.ccOwnerEmail || '',
        });
        setLoaded(true);
      })
      .catch((err) => show(apiError(err), 'error'));
  }, [open, loaded, show]);

  const save = async () => {
    setBusy(true);
    try {
      await platformApi.setExpiryEmail({
        enabled: form.enabled,
        remindDays: Number(form.remindDays) || 5,
        ccOwnerEmail: form.ccOwnerEmail,
      });
      show('Platform expiry-email settings saved.', 'success');
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  const sendTest = async () => {
    if (!testTo.trim()) return show('Enter an email to send the test to.', 'error');
    setTesting(true);
    try {
      // Save first so the latest settings are persisted, then test.
      await platformApi.setExpiryEmail({
        enabled: form.enabled, remindDays: Number(form.remindDays) || 5, ccOwnerEmail: form.ccOwnerEmail,
      });
      const r = await platformApi.testExpiryEmail(testTo.trim());
      show(r.message || 'Test sent.', 'success');
    } catch (e) { show(apiError(e), 'error'); }
    finally { setTesting(false); }
  };

  return (
    <Card className="mb-4">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-bold"
        style={{ color: 'var(--text-primary)' }}
        onClick={() => setOpen((v) => !v)}
      >
        <Server size={15} />
        <span className="flex-1">Platform Email — Subscription Expiry Notifications</span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>

      {open && (
        <div className="space-y-3 border-t px-4 py-3.5" style={{ borderColor: 'var(--border-card)' }}>
          {!loaded ? <Spinner label="Loading…" /> : (
            <>
              <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                Emails expiry warnings to <strong>every company's admin</strong>, and powers every
                company's daily report — both sent through the platform's one Brevo account,
                configured as environment variables on the server (<code>BREVO_API_KEY</code>,{' '}
                <code>BREVO_SENDER_EMAIL</code>, <code>BREVO_SENDER_NAME</code>). Nothing to enter here
                for the connection itself — just the behavior settings below.
              </p>

              <label className="flex cursor-pointer items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                <input type="checkbox" className="h-4 w-4 accent-purple-500"
                  checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                Enable expiry email notifications
              </label>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Remind how many days before expiry">
                  <Input type="number" min={1} max={60} value={form.remindDays}
                    onChange={(e) => setForm({ ...form, remindDays: e.target.value })} />
                </Field>
                <Field label="BCC owner (optional)">
                  <Input type="email" value={form.ccOwnerEmail} placeholder="owner@yourplatform.com"
                    onChange={(e) => setForm({ ...form, ccOwnerEmail: e.target.value })} />
                </Field>
              </div>

              <div className="flex flex-wrap items-end gap-2 border-t pt-3" style={{ borderColor: 'var(--border-card)' }}>
                <div className="flex-1 min-w-[180px]">
                  <Field label="Send a test to">
                    <Input type="email" value={testTo} placeholder="you@example.com"
                      onChange={(e) => setTestTo(e.target.value)} />
                  </Field>
                </div>
                <Button variant="outline" disabled={testing} onClick={sendTest}>
                  {testing ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Sending…</> : <><Send size={13} className="mr-1.5" />Send Test</>}
                </Button>
                <Button disabled={busy} onClick={save}>
                  {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Save'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Terms & Conditions Editor ──────────────────────────────────────────────────
// Platform-wide Terms & Conditions singleton — edited here, read by
// TermsGate (mandatory acceptance popup) and TermsViewerModal (footer link).
// Saving bumps the published version server-side, which is what makes
// TermsGate re-prompt every user for acceptance again.
function TermsEditorCard() {
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: '', effectiveDate: '', intro: '', declaration: '', sections: [],
  });

  useEffect(() => {
    if (!open || loaded) return;
    termsApi.getCurrent()
      .then((t) => {
        setForm({
          title: t.title || '',
          effectiveDate: t.effectiveDate || '',
          intro: t.intro || '',
          declaration: t.declaration || '',
          sections: (t.sections || []).map((s) => ({ heading: s.heading || '', body: s.body || '' })),
        });
        setLoaded(true);
      })
      .catch((err) => show(apiError(err), 'error'));
  }, [open, loaded, show]);

  const setSection = (i, field, value) => {
    setForm((f) => {
      const sections = [...f.sections];
      sections[i] = { ...sections[i], [field]: value };
      return { ...f, sections };
    });
  };
  const addSection = () => setForm((f) => ({ ...f, sections: [...f.sections, { heading: `${f.sections.length + 1}. `, body: '' }] }));
  const removeSection = (i) => setForm((f) => ({ ...f, sections: f.sections.filter((_, idx) => idx !== i) }));
  const moveSection = (i, dir) => {
    setForm((f) => {
      const j = i + dir;
      if (j < 0 || j >= f.sections.length) return f;
      const sections = [...f.sections];
      [sections[i], sections[j]] = [sections[j], sections[i]];
      return { ...f, sections };
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      await termsApi.setCurrent(form);
      show('Terms & Conditions saved — every user will be asked to accept the updated version.', 'success');
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Card className="mb-4">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-bold"
        style={{ color: 'var(--text-primary)' }}
        onClick={() => setOpen((v) => !v)}
      >
        <FileCheck size={15} />
        <span className="flex-1">Terms &amp; Conditions</span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>

      {open && (
        <div className="space-y-3 border-t px-4 py-3.5" style={{ borderColor: 'var(--border-card)' }}>
          {!loaded ? <Spinner label="Loading…" /> : (
            <>
              <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                Shown by the mandatory acceptance popup (every user, on first login and again
                whenever you save a change here) and by the "Terms &amp; Conditions" link in the
                app footer (view-only, no acceptance required).
              </p>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Title">
                  <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </Field>
                <Field label="Effective Date (optional, free text)">
                  <Input value={form.effectiveDate} placeholder="e.g. 16 Jul 2026"
                    onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
                </Field>
              </div>

              <Field label="Intro paragraph">
                <Textarea rows={2} value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} />
              </Field>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                    Sections ({form.sections.length})
                  </span>
                  <Button variant="outline" size="sm" onClick={addSection}>+ Add Section</Button>
                </div>
                <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                  {form.sections.map((sec, i) => (
                    <div key={i} className="rounded-md border p-2.5" style={{ borderColor: 'var(--border-card)' }}>
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <Input
                          className="flex-1 !text-xs !font-bold"
                          value={sec.heading}
                          placeholder="Heading (e.g. 1. Invoice Accuracy)"
                          onChange={(e) => setSection(i, 'heading', e.target.value)}
                        />
                        <button type="button" onClick={() => moveSection(i, -1)} disabled={i === 0}
                          className="flex h-7 w-7 items-center justify-center rounded hover:bg-black/[0.06] disabled:opacity-30"
                          style={{ color: 'var(--text-muted)' }} title="Move up">
                          <ChevronUp size={14} />
                        </button>
                        <button type="button" onClick={() => moveSection(i, 1)} disabled={i === form.sections.length - 1}
                          className="flex h-7 w-7 items-center justify-center rounded hover:bg-black/[0.06] disabled:opacity-30"
                          style={{ color: 'var(--text-muted)' }} title="Move down">
                          <ChevronDown size={14} />
                        </button>
                        <button type="button" onClick={() => removeSection(i)}
                          className="flex h-7 w-7 items-center justify-center rounded text-red-500 hover:bg-red-50" title="Remove">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <Textarea rows={2} value={sec.body} placeholder="Section text"
                        onChange={(e) => setSection(i, 'body', e.target.value)} />
                    </div>
                  ))}
                  {form.sections.length === 0 && (
                    <p className="py-4 text-center text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      No sections yet — click "+ Add Section" above.
                    </p>
                  )}
                </div>
              </div>

              <Field label="Declaration (shown next to the acceptance checkbox)">
                <Textarea rows={3} value={form.declaration} onChange={(e) => setForm({ ...form, declaration: e.target.value })} />
              </Field>

              <div className="flex justify-end border-t pt-3" style={{ borderColor: 'var(--border-card)' }}>
                <Button disabled={busy} onClick={save}>
                  {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Save & Publish New Version'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Main Developer Page ───────────────────────────────────────────────────────
export default function Developer() {
  const { show } = useToast();
  const { data: companies, loading, refetch } = useFetch(() => companyApi.list(), []);
  const [editing, setEditing] = useState(null);       // company obj or 'new'
  const [cloudModal, setCloudModal] = useState(null); // company obj
  const [emailModal, setEmailModal] = useState(null); // company obj
  const [brandModal, setBrandModal] = useState(null); // company obj

  const remove = async (c) => {
    if (!confirm(`Delete company "${c.name}"? This is only allowed if it has no users.`)) return;
    try { await companyApi.remove(c.id); show('Company deleted.'); refetch(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  if (loading) return <Spinner label="Loading companies…" />;

  return (
    <>
      <PageTitle
        icon={<Building2 size={18} />}
        badge={companies?.length}
        actions={<Button onClick={() => setEditing('new')}><Plus size={14} className="mr-1.5" />New Company</Button>}
      >
        Companies
      </PageTitle>

      <PlatformEmailCard />
      <TermsEditorCard />

      <Card className="overflow-x-auto">
        {!companies?.length ? (
          <EmptyState title="No companies yet" hint="Create the first company to onboard a tenant." />
        ) : (
          <table className="w-full min-w-[880px] border-collapse">
            <thead>
              <tr className="bg-navy-800 text-white">
                {['Sl. No', 'Company', 'Currency', 'Admins', 'Employees', 'Leads', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {companies.map((c, i) => (
                <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gold-pale">
                  <td className="px-2.5 py-2 text-xs text-ink-3">{i + 1}</td>
                  <td className="px-2.5 py-2 text-xs font-bold">
                    {c.name}
                    {c.contactEmail ? <div className="text-[10px] font-normal text-ink-3">{c.contactEmail}</div> : null}
                  </td>
                  <td className="px-2.5 py-2 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-bold text-purple-700">
                      {c.currency?.symbol || '₹'} {c.currency?.code || 'INR'}
                    </span>
                  </td>
                  <td className="px-2.5 py-2 text-xs"><span className="flex items-center gap-1.5"><Shield size={12} className="text-ink-3" /><Usage used={c.usage?.admins ?? 0} limit={c.limits?.maxAdmins} /></span></td>
                  <td className="px-2.5 py-2 text-xs"><span className="flex items-center gap-1.5"><Users size={12} className="text-ink-3" /><Usage used={c.usage?.employees ?? 0} limit={c.limits?.maxEmployees} /></span></td>
                  <td className="px-2.5 py-2 text-xs"><span className="flex items-center gap-1.5"><Target size={12} className="text-ink-3" /><Usage used={c.usage?.leads ?? 0} limit={c.limits?.maxLeads} /></span></td>
                  <td className="px-2.5 py-2">
                    <div className="flex flex-col gap-0.5">
                      <span className={`status ${c.active ? 'bg-ok-light text-ok' : 'bg-gray-100 text-ink-3'}`}>{c.active ? 'Active' : 'Inactive'}</span>
                      {c.emailReport?.enabled && (
                        <span className="status bg-purple-50 text-purple-700 text-[10px] inline-flex items-center gap-1"><Mail size={10} /> Report {c.emailReport.sendAt}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="flex gap-1 flex-wrap">
                      <Button size="sm" variant="outline" title="Edit company" onClick={() => setEditing(c)}><Pencil size={13} /></Button>
                      <Button size="sm" variant="outline" title="Branding & receipt settings" onClick={() => setBrandModal(c)}>
                        <Palette size={13} />
                      </Button>
                      <Button size="sm" variant="outline" title="Cloudinary settings" onClick={() => setCloudModal(c)}>
                        <Cloud size={13} />
                      </Button>
                      <Button size="sm" variant="outline" title="Email report settings" onClick={() => setEmailModal(c)}>
                        <Mail size={13} />
                      </Button>
                      <Button size="sm" variant="red" title="Delete" onClick={() => remove(c)}><Trash2 size={13} /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editing && (
        <CompanyModal
          company={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refetch}
        />
      )}

      {cloudModal && (
        <CloudinaryModal
          company={cloudModal}
          onClose={() => { setCloudModal(null); refetch(); }}
        />
      )}

      {emailModal && (
        <EmailReportModal
          company={emailModal}
          onClose={() => { setEmailModal(null); refetch(); }}
        />
      )}

      {brandModal && (
        <BrandingModal
          company={brandModal}
          onClose={() => { setBrandModal(null); refetch(); }}
        />
      )}
    </>
  );
}