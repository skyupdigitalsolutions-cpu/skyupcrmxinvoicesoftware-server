// Communication.jsx — SkyUp CRM
// WhatsApp-style UI wired to /api/whatsapp/* endpoints

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, Settings, Send, Loader2, RefreshCw,
  Paperclip, FileText, Download, AlertTriangle, X,
  Search, Plus, Users, ChevronLeft, Check, CheckCheck,
  Clock, Zap, Trash2, Eye, EyeOff, UserPlus,
} from 'lucide-react';

import { whatsappApi, leadApi, userApi } from '../api/endpoints.js';
import { apiError } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDate, LEAD_STAGES, leadStageOf, phoneSearchMatches, getCountryCodes } from '../utils/format.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import Modal from '../components/ui/Modal.jsx';
import Button from '../components/ui/Button.jsx';
import { Input, Field, Textarea } from '../components/ui/Field.jsx';

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getInitials(name = '') {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function MessageTick({ status }) {
  if (status === 'failed') return <X size={11} className="text-red-500" />;
  if (status === 'read' || status === 'replied')
    return <CheckCheck size={11} className="text-[#015FDE]" />;
  if (status === 'delivered')
    return <CheckCheck size={11} className="text-[#25D366]" />;
  return <Check size={11} style={{ color: 'var(--text-muted)' }} />;
}

// ── API Settings Modal ────────────────────────────────────────────────────────
function SettingsModal({ settings, onClose, onSaved }) {
  const { show } = useToast();
  const [form, setForm] = useState({
    enabled: settings.enabled || false,
    authKey: '',
    integratedNumber: settings.integratedNumber || '',
    senderName: settings.senderName || '',
  });
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await whatsappApi.setSettings(form);
      show('API settings saved.', 'success');
      onSaved(); onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="WhatsApp API Settings" width="sm:max-w-[480px]">
      <div className="space-y-3">
        <label className="flex items-center gap-2.5 cursor-pointer p-3 rounded-xl border border-[var(--border-card)] hover:bg-[var(--bg-card-head)] transition">
          <input type="checkbox" className="w-4 h-4 accent-[#25D366] rounded"
            checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />
          <div>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Enable WhatsApp for this company</p>
            <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Required to send and receive messages</p>
          </div>
        </label>

        <Field label={`Auth Key ${settings.hasAuthKey ? '(saved — leave blank to keep)' : ''}`}>
          <div className="relative">
            <Input type={showKey ? 'text' : 'password'} value={form.authKey}
              placeholder={settings.hasAuthKey ? '•••••••• (saved)' : 'Paste your API auth key'}
              onChange={e => setForm({ ...form, authKey: e.target.value })}
              style={{ paddingRight: '2.5rem', fontFamily: 'monospace' }} />
            <button type="button" onClick={() => setShowKey(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            msg91.com → Profile → API → Auth Key
          </p>
        </Field>

        <Field label="Integrated WhatsApp Number">
          <Input value={form.integratedNumber} placeholder="e.g. 919591327778 (country code, no +)"
            onChange={e => setForm({ ...form, integratedNumber: e.target.value })} />
        </Field>

        <Field label="Sender / Business Name (optional)">
          <Input value={form.senderName} onChange={e => setForm({ ...form, senderName: e.target.value })} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save} style={{ background: '#25D366', border: 'none', color: '#fff' }}>
          {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Save Settings'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Template Modal ────────────────────────────────────────────────────────────
function TemplateModal({ template, onClose, onSaved }) {
  const { show } = useToast();
  const isEdit = !!template?.id;
  const [form, setForm] = useState({
    name: template?.name || '',
    language: template?.language || 'en',
    bodyPreview: template?.bodyPreview || '',
    variableCount: template?.variableCount ?? 0,
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!form.name.trim()) return show('Template name is required.', 'error');
    setBusy(true);
    try {
      if (isEdit) await whatsappApi.updateTemplate(template.id, form);
      else await whatsappApi.createTemplate(form);
      show(`Template ${isEdit ? 'updated' : 'added'}.`, 'success');
      onSaved(); onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit Template' : 'Add Template'} width="sm:max-w-[440px]">
      <div className="space-y-3">
        <Field label="Template Name (must match API exactly)">
          <Input value={form.name} placeholder="e.g. crm_followup_leads"
            onChange={e => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Language">
            <Input value={form.language} placeholder="en"
              onChange={e => setForm({ ...form, language: e.target.value })} />
          </Field>
          <Field label="Variable Count">
            <Input type="number" min="0" value={form.variableCount}
              onChange={e => setForm({ ...form, variableCount: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Body Preview">
          <Textarea rows={3} value={form.bodyPreview}
            onChange={e => setForm({ ...form, bodyPreview: e.target.value })} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>
          {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</> : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Send Template Modal ───────────────────────────────────────────────────────
function SendTemplateModal({ leadId, templates, onClose, onSent }) {
  const { show } = useToast();
  const [templateName, setTemplateName] = useState(templates[0]?.name || '');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!templateName) return show('Select a template.', 'error');
    setBusy(true);
    try {
      await whatsappApi.sendTemplate({ leadIds: [leadId], templateName, variables: [], autoFillNameVar: true });
      show('Template sent.', 'success');
      onSent(); onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Send Template" width="sm:max-w-[380px]">
      <p className="text-[12px] mb-3" style={{ color: 'var(--text-secondary)' }}>
        Select a pre-approved template to send to this lead.
      </p>
      <Field label="Template">
        <select value={templateName} onChange={e => setTemplateName(e.target.value)}
          className="w-full rounded-lg border px-2.5 py-2 text-[13px]"
          style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
          {templates.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
        </select>
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={send} style={{ background: '#25D366', border: 'none', color: '#fff' }}>
          {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Sending…</>
            : <><Send size={12} className="mr-1.5" />Send</>}
        </Button>
      </div>
    </Modal>
  );
}

// ── Save as Lead Modal ────────────────────────────────────────────────────────
function SaveLeadModal({ conv, onClose, onSaved }) {
  const { show } = useToast();
  const { user: currentUser, isAdmin } = useAuth();
  const [form, setForm] = useState({
    name:    conv.leadName && conv.leadName !== conv.contactNumber ? conv.leadName : '',
    mobile:  conv.contactNumber || '',
    country: 'UAE',
    city:    '',
    source:  'WhatsApp',
    status:  'Contacted',
    email:   '',
    remark:  'Added from WhatsApp conversation',
    owner:   '',   // '' = assign to self (default)
  });
  const [busy, setBusy]       = useState(false);
  const [employees, setEmps]  = useState([]); // list for Assign To dropdown

  const SOURCES   = ['Walk-in','WhatsApp','Instagram','Facebook','Referral','market-in','Website','Call','Other'];
  const STATUSES  = ['New','Contacted','Interested','Follow-up','Won','Lost'];
  const COUNTRIES = ['UAE','India','Saudi Arabia','Kuwait','Bahrain','Oman','Qatar','Iran','Iraq','Yemen','Somalia','Nigeria','Other'];

  // Load employees for Assign To (admin only — sales can only assign to themselves)
  useEffect(() => {
    if (!isAdmin) return;
    userApi.list()
      .then(list => setEmps((list || []).filter(u => u.role === 'sales' || u.role === 'admin')))
      .catch(() => {});
  }, [isAdmin]);

  const save = async () => {
    if (!form.name.trim()) return show('Name is required.', 'error');
    setBusy(true);
    try {
      const payload = {
        name:    form.name.trim(),
        mobile:  form.mobile.trim(),
        country: form.country,
        city:    form.city.trim(),
        source:  form.source,
        status:  form.status,
        email:   form.email.trim(),
        remark:  form.remark.trim(),
      };
      // Only send owner if admin has explicitly chosen someone else
      if (isAdmin && form.owner) payload.owner = form.owner;

      const lead = await leadApi.create(payload);
      // Link existing WhatsApp messages to the new lead
      try {
        await whatsappApi.relinkContact({
          contactNumber: conv.contactNumber,
          leadId: lead._id || lead.id,
        });
      } catch {}
      show(`${form.name} saved as lead.`, 'success');
      onSaved();
      onClose();
    } catch (e) {
      const details = e?.response?.data?.details;
      if (details?.duplicate) {
        show('This number already exists as a lead.', 'error');
      } else {
        show(apiError(e), 'error');
      }
    } finally { setBusy(false); }
  };

  const sel = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));
  const inp = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  return (
    <Modal open onClose={onClose} title="Save as Lead" width="sm:max-w-[520px]">
      <div className="space-y-3">
        {/* Info banner */}
        <div className="flex gap-2.5 px-3 py-2.5 rounded-xl border"
          style={{ background: 'var(--bg-card-head)', borderColor: 'var(--border-card)' }}>
          <UserPlus size={14} className="shrink-0 mt-0.5 text-[#25D366]" />
          <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            This contact's WhatsApp history will be linked to the new lead automatically.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Full Name *">
            <Input value={form.name} placeholder="Contact's name" onChange={inp('name')} />
          </Field>
          <Field label="Mobile">
            <Input value={form.mobile} placeholder="With country code" onChange={inp('mobile')} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="City">
            <Input value={form.city} placeholder="e.g. Dubai" onChange={inp('city')} />
          </Field>
          <Field label="Country">
            <select value={form.country} onChange={sel('country')}
              className="w-full rounded-lg border px-2.5 py-2 text-[13px]"
              style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Source">
            <select value={form.source} onChange={sel('source')}
              className="w-full rounded-lg border px-2.5 py-2 text-[13px]"
              style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={sel('status')}
              className="w-full rounded-lg border px-2.5 py-2 text-[13px]"
              style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>

        {/* Assign To — admin only */}
        {isAdmin && (
          <Field label="Assign To">
            <select value={form.owner} onChange={sel('owner')}
              className="w-full rounded-lg border px-2.5 py-2 text-[13px]"
              style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
              <option value="">Me ({currentUser?.name || 'yourself'})</option>
              {employees
                .filter(u => (u.id || u._id) !== (currentUser?.id || currentUser?._id))
                .map(u => <option key={u.id || u._id} value={u.id || u._id}>{u.name} ({u.role})</option>)
              }
            </select>
          </Field>
        )}

        <Field label="Email (optional)">
          <Input type="email" value={form.email} placeholder="contact@example.com" onChange={inp('email')} />
        </Field>

        <Field label="Remark (optional)">
          <Textarea rows={2} value={form.remark} onChange={inp('remark')} />
        </Field>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save} style={{ background: '#015FDE', border: 'none', color: '#fff' }}>
          {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Saving…</>
                : <><UserPlus size={13} className="mr-1.5" />Save as Lead</>}
        </Button>
      </div>
    </Modal>
  );
}

// ── Message Bubble ────────────────────────────────────────────────────────────
function Bubble({ m }) {
  const isOut = m.direction === 'out';

  const content = () => {
    if (m.mediaUrl) {
      if (m.mediaType === 'image') return (
        <div>
          <img src={m.mediaUrl} alt="attachment" className="max-h-48 rounded-lg object-contain mb-1" />
          {m.text && <p className="text-[13px] leading-relaxed">{m.text}</p>}
        </div>
      );
      return (
        <div>
          <a href={m.mediaUrl} target="_blank" rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-semibold mb-1"
            style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
            <FileText size={14} />
            {m.mediaFilename || `${m.mediaType} file`}
            <Download size={12} className="ml-auto" />
          </a>
          {m.text && <p className="text-[13px]">{m.text}</p>}
        </div>
      );
    }
    if (m.kind === 'template') return (
      <div>
        <div className="text-[10px] font-bold uppercase mb-1 opacity-60">Template: {m.templateName}</div>
        <p className="text-[13px] leading-relaxed">{m.text || m.variables?.join(', ')}</p>
      </div>
    );
    return <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">{m.text}</p>;
  };

  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-1`}>
      <div className={`max-w-[72%] px-3.5 py-2.5 rounded-2xl ${
        isOut ? 'rounded-br-sm bg-[#DCF8C6] text-[#111]' : 'rounded-bl-sm bg-white text-[#111]'
      }`} style={{ boxShadow: '0 1px 2px rgba(0,0,0,.1)' }}>
        {content()}
        <div className={`flex items-center gap-1 mt-1 ${isOut ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[10px] opacity-55">{formatTime(m.createdAt)}</span>
          {isOut && <MessageTick status={m.status} />}
        </div>
        {isOut && m.status === 'failed' && m.error && (
          <p className="text-[10px] text-red-500 mt-0.5">{m.error}</p>
        )}
      </div>
    </div>
  );
}

// ── Chat Window ───────────────────────────────────────────────────────────────
function ChatWindow({ conv, templates, onClose, onRefreshList }) {
  const { show } = useToast();
  const { user, isAdmin } = useAuth();

  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [busy, setSending] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showSaveLeadModal, setShowSaveLeadModal] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const load = useCallback(async (silent = false) => {
    // silent=true keeps existing messages while refreshing (no spinner flash)
    // silent=false (initial load) shows spinner until first data arrives
    try {
      if (conv.isLead) {
        const d = await whatsappApi.getThread(conv.leadId);
        setData(d);
      } else {
        const d = await whatsappApi.getThreadByNumber(conv.contactNumber);
        setData(d);
      }
    } catch (e) {
      if (e?.response?.status === 404) {
        setData({ messages: [], lead: null, deleted: true });
      } else {
        if (!silent) show(apiError(e), 'error');
        setData(prev => prev || { messages: [], lead: null });
      }
    }
  }, [conv]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [data?.messages]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const onPickFile = e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return show('File too large (max 15 MB).', 'error');
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    setAttachment({ file, previewUrl });
  };

  const sendReply = async () => {
    if (attachment) {
      setSending(true);
      try {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            await whatsappApi.sendMedia({
              leadId: conv.leadId,
              dataUrl: reader.result,
              mediaType: attachment.file.type.startsWith('image/') ? 'image'
                : attachment.file.type.startsWith('video/') ? 'video'
                : attachment.file.type.startsWith('audio/') ? 'audio' : 'document',
              filename: attachment.file.name,
              caption: text,
            });
            setText(''); setAttachment(null); load(true); onRefreshList();
          } catch (e) {
            const msg = apiError(e);
            if (msg.toLowerCase().includes('cloudinary') || msg.includes('500') || msg.includes('File upload failed')) {
              show('Media sending requires Cloudinary. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET to your server environment variables.', 'error');
            } else {
              show(msg, 'error');
            }
          }
          finally { setSending(false); }
        };
        reader.readAsDataURL(attachment.file);
      } catch { setSending(false); }
      return;
    }
    if (!text.trim()) return;
    setSending(true);
    try {
      await whatsappApi.sendReply({ leadId: conv.leadId, text });
      setText(''); load(true); onRefreshList();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setSending(false); }
  };

  // ── 24-hour WhatsApp session window ────────────────────────────────────────
  // WhatsApp only allows free-form replies within 24 hours of the last
  // inbound message from the customer. After that only templates work.
  const [sessionWindow, setSessionWindow] = useState(null); // { open, expiresAt, lastInboundAt }
  const [timeLeft, setTimeLeft]           = useState('');   // live countdown string e.g. "2h 14m left"

  // Fetch session window whenever conversation changes
  useEffect(() => {
    if (!conv?.isLead || !conv?.leadId) { setSessionWindow(null); return; }
    whatsappApi.getSessionWindow(conv.leadId)
      .then(d => setSessionWindow(d))
      .catch(() => setSessionWindow({ open: false, expiresAt: null, lastInboundAt: null }));
  }, [conv?.leadId]);

  // Recalculate countdown every 30 seconds so the timer stays live
  useEffect(() => {
    if (!sessionWindow?.expiresAt) { setTimeLeft(''); return; }
    const calc = () => {
      const ms = new Date(sessionWindow.expiresAt).getTime() - Date.now();
      if (ms <= 0) {
        setTimeLeft('Expired');
        setSessionWindow(s => s ? { ...s, open: false } : s);
        return;
      }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      setTimeLeft(h > 0 ? `${h}h ${m}m left` : `${m}m left`);
    };
    calc();
    const t = setInterval(calc, 30000);
    return () => clearInterval(t);
  }, [sessionWindow?.expiresAt]);

  // Reply allowed only if session window is open (null = loading, optimistically allow)
  const sessionOpen = sessionWindow === null ? true : sessionWindow.open;
  const canReply    = conv.isLead && sessionOpen;

  // Session window banner shown at top of chat
  const SessionBanner = () => {
    if (!conv?.isLead || sessionWindow === null) return null;
    if (sessionWindow.open) {
      return (
        <div className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-medium shrink-0"
          style={{ background: '#f0fdf4', color: '#16a34a', borderBottom: '1px solid #bbf7d0' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
          </svg>
          Session window open — {timeLeft}. Free replies allowed.
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-medium shrink-0"
        style={{ background: '#fef2f2', color: '#dc2626', borderBottom: '1px solid #fecaca' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
        </svg>
        24-hour window expired
        {sessionWindow.lastInboundAt && (
          <> — last reply {new Date(sessionWindow.lastInboundAt).toLocaleDateString(undefined, { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</>
        )}. Send a template to re-open the conversation.
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-card)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0"
        style={{ borderColor: 'var(--border-card)', background: 'var(--bg-card-head)' }}>
        <button onClick={onClose} className="sm:hidden p-1.5 rounded-lg hover:bg-black/5"
          style={{ color: 'var(--text-muted)' }}>
          <ChevronLeft size={18} />
        </button>

        <div className="w-9 h-9 rounded-full bg-[#25D366]/15 flex items-center justify-center font-bold text-[13px] text-[#25D366] shrink-0">
          {getInitials(conv.leadName)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {conv.leadName}
            </p>
            {!conv.isLead && (
              <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700">
                Not a lead
              </span>
            )}
          </div>
          <p className="text-[11px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
            {conv.mobile || conv.contactNumber}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Save as Lead — only for non-lead contacts */}
          {!conv.isLead && (
            <button onClick={() => setShowSaveLeadModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold border transition"
              style={{ borderColor: '#015FDE', color: '#015FDE' }}
              title="Save this contact as a lead">
              <UserPlus size={13} />
              <span className="hidden sm:inline">Save as Lead</span>
            </button>
          )}
          {/* Template button — always shown for leads so it's accessible even when window is closed */}
          {conv.isLead && (
            <button onClick={() => setShowTemplateModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold border transition"
              style={{ borderColor: '#25D366', color: '#25D366' }}
              title={sessionOpen ? 'Send a template message' : 'Session window closed — send a template to re-open'}>
              <Zap size={12} />
              <span className="hidden sm:inline">Template</span>
            </button>
          )}
        </div>
      </div>

      {/* 24-hour session window banner */}
      <SessionBanner />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3"
        style={{ background: 'linear-gradient(180deg, rgba(37,211,102,0.03) 0%, transparent 100%)' }}>
        {!data ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>
        ) : data.deleted ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-50">
            <AlertTriangle size={32} strokeWidth={1.2} style={{ color: 'var(--text-muted)' }} />
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>This lead no longer exists</p>
          </div>
        ) : data.messages?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-60">
            <MessageSquare size={36} strokeWidth={1.2} style={{ color: 'var(--text-muted)' }} />
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No messages yet</p>
            <button onClick={() => setShowTemplateModal(true)}
              className="px-4 py-2 rounded-xl text-[12px] font-semibold text-white"
              style={{ background: '#25D366' }}>
              Send a template to start
            </button>
          </div>
        ) : (
          <>
            {data.messages.map(m => <Bubble key={m.id} m={m} />)}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Attachment preview */}
      {attachment && (
        <div className="px-4 py-2 flex items-center gap-2 border-t"
          style={{ borderColor: 'var(--border-card)', background: 'var(--bg-card-head)' }}>
          {attachment.previewUrl
            ? <img src={attachment.previewUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
            : <FileText size={20} style={{ color: 'var(--text-muted)' }} />}
          <span className="flex-1 text-[12px] truncate font-medium" style={{ color: 'var(--text-primary)' }}>
            {attachment.file.name}
          </span>
          <button onClick={() => setAttachment(null)} style={{ color: 'var(--text-muted)' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Input bar */}
      {canReply ? (
        <div className="px-3 py-3 flex items-end gap-2 border-t shrink-0"
          style={{ borderColor: 'var(--border-card)', background: 'var(--bg-card-head)' }}>
          <label className="p-2 rounded-xl cursor-pointer hover:bg-black/5 transition shrink-0"
            style={{ color: 'var(--text-muted)' }} title="Attach file">
            <Paperclip size={18} />
            <input type="file" className="hidden"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={onPickFile} />
          </label>
          <textarea
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
            placeholder={attachment ? 'Add a caption…' : 'Type a message…'}
            rows={1}
            className="flex-1 rounded-xl border px-3 py-2 text-[13px] focus:outline-none transition"
            style={{
              resize: 'none', maxHeight: '120px', overflowY: 'auto',
              background: 'var(--bg-input)', borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          <button onClick={sendReply}
            disabled={busy || (!text.trim() && !attachment)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 transition disabled:opacity-40"
            style={{ background: (text.trim() || attachment) ? '#25D366' : 'var(--text-muted)' }}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      ) : conv.isLead ? (
        /* Existing lead — session window closed — prompt to send template */
        <div className="px-4 py-3 border-t shrink-0"
          style={{ borderColor: 'var(--border-card)', background: '#fef2f2' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[12px] font-medium" style={{ color: '#dc2626' }}>
              <AlertTriangle size={13} />
              24-hour window closed — send a template to re-open
            </div>
          </div>
        </div>
      ) : (
        /* Not-a-lead bottom bar */
        <div className="px-4 py-3 border-t shrink-0"
          style={{ borderColor: 'var(--border-card)', background: 'var(--bg-card-head)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              <AlertTriangle size={13} className="text-amber-500" />
              Save as lead to reply
            </div>
            <button onClick={() => setShowSaveLeadModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold text-white transition"
              style={{ background: '#015FDE' }}>
              <UserPlus size={13} />
              Save as Lead
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showTemplateModal && (
        <SendTemplateModal
          leadId={conv.leadId}
          templates={templates}
          onClose={() => setShowTemplateModal(false)}
          onSent={() => { load(); onRefreshList(); }}
        />
      )}
      {showSaveLeadModal && (
        <SaveLeadModal
          conv={conv}
          onClose={() => setShowSaveLeadModal(false)}
          onSaved={() => {
            setShowSaveLeadModal(false);
            onRefreshList(); // refresh list — panel stays open showing updated conversation
          }}
        />
      )}
    </div>
  );
}

// ── CSV helpers ──────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow   = () => { rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') { pushField(); pushRow(); }
    else if (c === '\r') { /* ignore */ }
    else field += c;
  }
  if (field.length || row.length) { pushField(); pushRow(); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const PHONE_ALIASES = ['mobile', 'phone', 'phone number', 'mobile number', 'contact'];
const SCIENTIFIC_RE = /^-?\d+(\.\d+)?[eE][+-]?\d+$/;

function downloadCsvTemplate() {
  const csv = ['Name,Mobile', '"Ali Hassan","971501234567"'].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'whatsapp_blast_template.csv' });
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Bulk Send Modal ───────────────────────────────────────────────────────────
function BulkSendModal({ templates, onClose, onSent }) {
  const { show } = useToast();
  const [leads, setLeads] = useState([]);
  const [selected, setSelected] = useState([]);
  const [pendingContacts, setPendingContacts] = useState([]); // CSV numbers not yet leads
  const [templateName, setTemplateName] = useState('');
  const [variableValues, setVariableValues] = useState([]);
  const [autoFillName, setAutoFillName] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvResult, setCsvResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { leadApi.list({ fields: '_id,name,mobile,stage,status,country' }).then(setLeads).catch(() => setLeads([])); }, []);

  const selectedTemplate = templates.find(t => t.name === templateName) || null;

  // Track which leads already received the selected template
  const [templateStatuses, setTemplateStatuses] = useState({});  // { leadId: { sent, sentAt, status } }
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [excludeSent, setExcludeSent] = useState(true); // default ON — exclude already-sent leads

  // Manual count selector — how many leads to send to at once (0 = all selected)
  const [sendCount, setSendCount] = useState(0);
  const [countInput, setCountInput] = useState(''); // raw text in the manual input

  // anyTemplateSent: true if lead has received ANY template (not just current one)
  // Used for excludeSent when no specific template is chosen yet
  // Map of leadId → { templateName, sentAt, status } for any template ever sent
  const [anyTemplateSentMap, setAnyTemplateSentMap] = useState({});

  // Load "any template sent" map when modal opens — auto-deselect if excludeSent on
  // Chunks IDs into batches of 200 to avoid URL length limits (1000+ leads
  // would exceed the ~8KB URL limit when sent as a query param string).
  useEffect(() => {
    if (!leads.length) return;
    const allIds = leads.map(l => String(l._id || l.id));
    const CHUNK = 200;
    const chunks = [];
    for (let i = 0; i < allIds.length; i += CHUNK) chunks.push(allIds.slice(i, i + CHUNK));
    Promise.all(chunks.map(ids => whatsappApi.getTemplateSentStatus(ids, '__any__').catch(() => ({}))))
      .then(results => {
        const statuses = Object.assign({}, ...results);
        setAnyTemplateSentMap(statuses);
        if (excludeSent) {
          setSelected(prev => prev.filter(id => !statuses[String(id)]));
        }
      })
      .catch(() => setAnyTemplateSentMap({}));
  }, [leads]);

  const onTemplateChange = name => {
    setTemplateName(name);
    const t = templates.find(t => t.name === name);
    setVariableValues(Array.from({ length: t?.variableCount || 0 }, () => ''));
    // Fetch sent status for all leads when template changes
    if (name && leads.length) {
      setLoadingStatuses(true);
      const allIds = leads.map(l => String(l._id || l.id));
      const CHUNK = 200;
      const chunks = [];
      for (let i = 0; i < allIds.length; i += CHUNK) chunks.push(allIds.slice(i, i + CHUNK));
      Promise.all(chunks.map(ids => whatsappApi.getTemplateSentStatus(ids, name).catch(() => ({}))))
        .then(results => {
          const statuses = Object.assign({}, ...results);
          setTemplateStatuses(statuses);
          if (excludeSent) {
            setSelected(prev => prev.filter(id => !anyTemplateSentMap[String(id)]));
          }
        })
        .catch(() => setTemplateStatuses({}))
        .finally(() => setLoadingStatuses(false));
    } else {
      setTemplateStatuses({});
    }
  };

  // When excludeSent toggle changes — deselect or restore sent leads accordingly
  const onExcludeSentToggle = (checked) => {
    setExcludeSent(checked);
    if (checked) {
      // Always exclude leads that received ANY template — consistent behaviour
      // regardless of which specific template is currently selected.
      setSelected(prev => prev.filter(id => !anyTemplateSentMap[String(id)]));
    }
  };

  // Compute effective recipient list based on sendCount cap
  // effectiveRecipients: always excludes leads that received ANY template when
  // excludeSent is on — regardless of which specific template is currently selected.
  const effectiveRecipients = (() => {
    const base = selected.filter(id => {
      if (!excludeSent) return true;
      return !anyTemplateSentMap[String(id)];
    });
    return sendCount > 0 ? base.slice(0, sendCount) : base;
  })();

  const templateSentAgo = (sentAt) => {
    if (!sentAt) return '';
    const diff = Date.now() - new Date(sentAt).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  };

  const filtered = leads.filter(l => {
    // Skip leads with no mobile — they can't receive WhatsApp messages
    if (!l.mobile || !String(l.mobile).replace(/\D/g, '')) return false;
    const ms = !search.trim() || (l.name || '').toLowerCase().includes(search.toLowerCase()) || phoneSearchMatches(l.mobile, search);
    const mf = !stageFilter || leadStageOf(l) === stageFilter;
    return ms && mf;
  });

  const toggle = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const onImportCsv = e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCsvBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCSV(String(reader.result));
        if (!rows.length) { show('CSV appears to be empty.', 'error'); setCsvBusy(false); return; }

        const header  = rows[0].map(h => h.trim().toLowerCase());
        let phoneCol  = header.findIndex(h => PHONE_ALIASES.includes(h));
        const nameCol = header.findIndex(h => h === 'name');
        const dataRows = phoneCol === -1 ? rows : rows.slice(1);
        if (phoneCol === -1) phoneCol = 0;

        const dialCodeEntries = Object.entries(getCountryCodes())
          .filter(([, code]) => code)
          .sort((a, b) => b[1].length - a[1].length);

        const seenDigits = new Set();
        const duplicates = [], missingCode = [], unknownCode = [], scientificNotation = [], candidates = [];

        dataRows.forEach(r => {
          const raw  = (r[phoneCol] || '').trim();
          if (!raw) return;
          const name = nameCol !== -1 ? (r[nameCol] || '').trim() : '';
          if (SCIENTIFIC_RE.test(raw)) { scientificNotation.push(raw); return; }
          const digits = raw.replace(/\D/g, '');
          if (!digits) return;
          if (seenDigits.has(digits)) { duplicates.push(raw); return; }
          seenDigits.add(digits);
          if (digits.length < 8) { missingCode.push(raw); return; }
          const match = dialCodeEntries.find(([, code]) => digits.startsWith(code));
          if (!match) { unknownCode.push(raw); return; }
          const local = digits.slice(match[1].length);
          if (local.length < 7) { missingCode.push(raw); return; }
          candidates.push({ raw, name, digits, country: match[0] });
        });

        const matched = [], notYetLead = [], matchedIds = [];
        candidates.forEach(c => {
          const key  = c.digits.slice(-8);
          const lead = leads.find(l => (l.mobile || '').replace(/\D/g, '').slice(-8) === key);
          if (lead) { matched.push({ raw: c.raw, name: lead.name }); matchedIds.push(lead.id || lead._id); }
          else notYetLead.push({ raw: c.raw, name: c.name, mobile: c.digits, country: c.country });
        });

        setSelected(prev => [...new Set([...prev, ...matchedIds])]);
        setPendingContacts(prev => {
          const existing = new Set(prev.map(p => p.mobile));
          return [...prev, ...notYetLead.filter(c => !existing.has(c.mobile))];
        });
        setCsvResult({
          total: dataRows.length, matched,
          notFound: notYetLead.map(c => ({ raw: c.raw, name: c.name })),
          duplicates, missingCode, unknownCode, scientificNotation,
        });
      } catch { show('Could not read that CSV file.', 'error'); }
      finally { setCsvBusy(false); }
    };
    reader.onerror = () => { show('Could not read file.', 'error'); setCsvBusy(false); };
    reader.readAsText(file);
  };

  const send = async () => {
    if (!effectiveRecipients.length && !pendingContacts.length) return show('Select at least one lead or contact.', 'error');
    if (!templateName) return show('Select a template.', 'error');
    setBusy(true);
    try {
      const results = await whatsappApi.sendTemplate({
        leadIds: effectiveRecipients,
        contacts: pendingContacts.map(c => ({ name: c.name, mobile: c.mobile, country: c.country })),
        templateName,
        variables: variableValues.map(v => v.trim()),
        autoFillNameVar: autoFillName,
      });
      const ok   = results.filter(r => r.status === 'sent').length;
      const fail = results.length - ok;
      show(`Sent to ${ok} recipient(s)${fail ? `, ${fail} failed` : ''}.`, fail ? 'error' : 'success');
      setSelected([]); setPendingContacts([]); onSent();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  const totalRecipients = selected.length + pendingContacts.length;

  return (
    <Modal open onClose={onClose} title="Send WhatsApp Blast" width="sm:max-w-[560px]">
      <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">

        {/* Template */}
        <Field label="Template">
          <select value={templateName} onChange={e => onTemplateChange(e.target.value)}
            className="w-full rounded-lg border px-2.5 py-2 text-[13px]"
            style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
            <option value="">Select template…</option>
            {templates.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </Field>

        {selectedTemplate?.bodyPreview && (
          <div className="text-[12px] px-3 py-2 rounded-xl border"
            style={{ borderColor: 'var(--border-card)', color: 'var(--text-secondary)', background: 'var(--bg-card-head)' }}>
            {selectedTemplate.bodyPreview}
          </div>
        )}

        {variableValues.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {variableValues.map((val, i) => (
              <Field key={i} label={`Variable {{${i + 1}}}`}>
                <Input value={val} disabled={i === 0 && autoFillName}
                  placeholder={i === 0 && autoFillName ? 'auto-filled with lead name' : `value for {{${i + 1}}}`}
                  onChange={e => setVariableValues(vals => vals.map((v, idx) => idx === i ? e.target.value : v))} />
              </Field>
            ))}
          </div>
        )}

        <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" className="w-3.5 h-3.5 accent-[#25D366]"
            checked={autoFillName} onChange={e => setAutoFillName(e.target.checked)} />
          Auto-fill first variable with lead name
        </label>

        {/* CSV Import row */}
        <div className="flex items-center gap-2 p-3 rounded-xl border"
          style={{ borderColor: 'var(--border-card)', background: 'var(--bg-card-head)' }}>
          <div className="flex-1">
            <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>Import from CSV</p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Columns: <code className="font-mono bg-black/5 px-1 rounded">Name</code>, <code className="font-mono bg-black/5 px-1 rounded">Mobile</code> (with country code)
            </p>
          </div>
          <button onClick={downloadCsvTemplate}
            className="px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition"
            style={{ borderColor: 'var(--border-card)', color: 'var(--text-secondary)' }}>
            Sample
          </button>
          <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-semibold cursor-pointer transition ${csvBusy ? 'opacity-60' : ''}`}
            style={{ borderColor: '#25D366', color: '#25D366' }}>
            {csvBusy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            {csvBusy ? 'Reading…' : 'Import CSV'}
            <input type="file" accept=".csv,text/csv" className="hidden" disabled={csvBusy} onChange={onImportCsv} />
          </label>
        </div>

        {/* CSV result summary */}
        {csvResult && (
          <div className="px-3 py-2.5 rounded-xl border text-[12px] space-y-1"
            style={{ borderColor: 'var(--border-card)', background: 'var(--bg-card-head)' }}>
            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              CSV: {csvResult.total} row(s) read
            </p>
            {csvResult.matched.length > 0 && (
              <p className="text-[#25D366]">✓ {csvResult.matched.length} matched existing leads — auto-selected</p>
            )}
            {csvResult.notFound.length > 0 && (
              <p className="text-[#FF8B15]">→ {csvResult.notFound.length} new contact(s) — will send directly</p>
            )}
            {csvResult.duplicates.length > 0 && (
              <p style={{ color: 'var(--text-muted)' }}>⚠ {csvResult.duplicates.length} duplicate(s) skipped</p>
            )}
            {csvResult.missingCode.length > 0 && (
              <p className="text-red-500">✗ {csvResult.missingCode.length} missing/short country code</p>
            )}
            {csvResult.scientificNotation.length > 0 && (
              <p className="text-red-500">✗ {csvResult.scientificNotation.length} corrupted by Excel (scientific notation)</p>
            )}
          </div>
        )}

        {/* Pending CSV contacts (not yet leads) */}
        {pendingContacts.length > 0 && (
          <div>
            <p className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              New contacts from CSV — not yet leads ({pendingContacts.length})
            </p>
            <div className="max-h-24 overflow-y-auto rounded-xl border" style={{ borderColor: 'var(--border-card)' }}>
              {pendingContacts.map(c => (
                <div key={c.mobile} className="flex items-center gap-2 px-3 py-2 border-b last:border-0"
                  style={{ borderColor: 'var(--border-card)' }}>
                  <span className="flex-1 text-[12px]" style={{ color: 'var(--text-primary)' }}>
                    {c.name && <strong>{c.name}</strong>}{c.name ? ' — ' : ''}{c.mobile}
                  </span>
                  <button onClick={() => setPendingContacts(prev => prev.filter(p => p.mobile !== c.mobile))}
                    style={{ color: 'var(--text-muted)' }}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lead search + list */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search leads…" style={{ paddingLeft: '2rem' }} />
          </div>
          <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
            className="rounded-lg border px-2.5 py-1.5 text-[12px]"
            style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
            <option value="">All Stages</option>
            {LEAD_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="max-h-44 overflow-y-auto rounded-xl border" style={{ borderColor: 'var(--border-card)' }}>
          {filtered.map(l => {
            const id = l.id || l._id;
            const tStatus = templateName ? templateStatuses[String(id)] : null;
            const alreadySent = !!tStatus;
            const sentOk = alreadySent && ['sent','delivered','read','replied'].includes(tStatus.status);
            // Always use anyTemplateSentMap for exclude — same behaviour for all templates
            const excludedByAny = excludeSent && !!anyTemplateSentMap[String(id)];
            return (
              <label key={id}
                className={`flex items-center gap-2.5 px-3 py-2.5 border-b last:border-0 transition ${(excludeSent && sentOk) || excludedByAny ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-[rgba(0,0,0,0.02)]'}`}
                style={{ borderColor: 'var(--border-card)', background: alreadySent && !excludeSent ? 'rgba(37,211,102,0.04)' : undefined }}
                onClick={e => { if ((excludeSent && sentOk) || excludedByAny) e.preventDefault(); }}>
                <input type="checkbox" className="w-3.5 h-3.5 accent-[#25D366]"
                  checked={selected.includes(id)}
                  disabled={(excludeSent && sentOk) || excludedByAny}
                  onChange={() => { if (!((excludeSent && sentOk) || excludedByAny)) toggle(id); }}
                  title={(excludeSent && sentOk) || excludedByAny ? 'Excluded — already received a template' : undefined}
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-medium text-[13px]" style={{ color: 'var(--text-primary)' }}>{l.name}</span>
                  {(() => {
                    // Show specific template status if selected, otherwise show last-sent-any info
                    const display = tStatus || anyTemplateSentMap[String(id)];
                    if (!display) return null;
                    const ok = ['sent','delivered','read','replied'].includes(display.status);
                    return (
                      <span className="text-[10px] font-medium mt-0.5" style={{ color: ok ? '#16a34a' : '#dc2626' }}>
                        {ok
                          ? `✓ ${display.templateName || 'Template'} · ${templateSentAgo(display.sentAt)}`
                          : `✗ ${display.templateName || 'Template'} failed · ${templateSentAgo(display.sentAt)}`}
                      </span>
                    );
                  })()}
                </div>
                <span className="text-[11px] font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>{l.mobile}</span>
              </label>
            );
          })}
          {!filtered.length && (
            <p className="text-center text-[12px] py-4" style={{ color: 'var(--text-muted)' }}>No leads found</p>
          )}
        </div>

        {/* ── Bottom controls bar ── */}
        <div className="space-y-2.5 pt-1">

          {/* Selection summary */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text-primary)' }}>{selected.length}</span> lead(s) selected
              {pendingContacts.length > 0 && (
                <span className="ml-1" style={{ color: 'var(--text-muted)' }}>
                  + {pendingContacts.length} CSV contact(s)
                </span>
              )}
            </span>
            {templateName && (() => {
              const alreadyCount = selected.filter(id => templateStatuses[String(id)]?.status === 'sent').length;
              return alreadyCount > 0 ? (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: '#FEF3C7', color: '#D97706' }}>
                  ⚠ {alreadyCount} already received this template
                </span>
              ) : null;
            })()}
            {sendCount > 0 && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: '#EFF6FF', color: '#015FDE' }}>
                Capped at {sendCount} — sending to {Math.min(sendCount, effectiveRecipients.length)}
              </span>
            )}
          </div>

          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-2">

            {/* Exclude sent toggle */}
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer select-none transition hover:bg-black/[0.02]"
              style={{ borderColor: excludeSent ? '#25D366' : 'var(--border)', background: excludeSent ? 'rgba(37,211,102,0.06)' : 'var(--bg-input)' }}
              title="Exclude leads that have already received any WhatsApp template">
              <input
                type="checkbox"
                checked={excludeSent}
                onChange={e => onExcludeSentToggle(e.target.checked)}
                className="w-4 h-4 accent-[#25D366]"
              />
              <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: excludeSent ? '#25D366' : 'var(--text-secondary)' }}>
                Exclude already sent
                {Object.keys(anyTemplateSentMap).length > 0 && (
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                    style={{ background: excludeSent ? '#25D366' : '#e5e7eb', color: excludeSent ? '#fff' : '#6b7280' }}>
                    {Object.keys(anyTemplateSentMap).length}
                  </span>
                )}
              </span>
            </label>

            {/* Custom count selector */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border"
              style={{ borderColor: sendCount > 0 ? '#015FDE' : 'var(--border)', background: sendCount > 0 ? '#EFF6FF' : 'var(--bg-input)' }}>
              <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                Limit:
              </span>
              <select
                value={sendCount === 0 ? 'all' : 'custom'}
                onChange={e => {
                  if (e.target.value === 'all') { setSendCount(0); setCountInput(''); }
                  else { setSendCount(50); setCountInput('50'); }
                }}
                className="rounded border px-2 py-1 text-[12px] font-medium"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
                <option value="all">All selected</option>
                <option value="custom">Custom count</option>
              </select>
              {sendCount > 0 && (
                <input
                  type="number" min="1" max="9999"
                  value={countInput}
                  placeholder={String(sendCount)}
                  onChange={e => {
                    const raw = e.target.value;
                    setCountInput(raw);
                    const n = parseInt(raw, 10);
                    if (!isNaN(n) && n > 0) setSendCount(n);
                  }}
                  onFocus={e => e.target.select()}
                  className="w-20 rounded border px-2 py-1 text-[12px] font-bold text-center"
                  style={{ background: 'var(--bg-card)', color: '#015FDE', borderColor: '#015FDE' }}
                />
              )}
            </div>

            <div className="flex items-center gap-1.5 ml-auto">
              <Button variant="outline" size="sm" onClick={() => {
                const ids = filtered.map(l => l.id || l._id);
                // Always exclude any-template-sent leads when excludeSent is on
                const toSelect = excludeSent
                  ? ids.filter(id => !anyTemplateSentMap[String(id)])
                  : ids;
                setSelected(toSelect);
              }}>
                Select all
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setSelected([]); setPendingContacts([]); setCsvResult(null); }}>
                Clear
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={send} style={{ background: '#25D366', border: 'none', color: '#fff' }}>
          {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Sending…</>
            : <><Send size={13} className="mr-1.5" />Send to {(Math.min(effectiveRecipients.length, sendCount > 0 ? sendCount : Infinity) + pendingContacts.length) || '?'} recipient(s)</>}
        </Button>
      </div>
    </Modal>
  );
}

// ── Conversation Row ──────────────────────────────────────────────────────────
function ConvRow({ conv, active, onClick, showOwner = false }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 border-b text-left transition ${active ? 'bg-[#25D366]/8' : 'hover:bg-black/[0.02]'}`}
      style={{ borderColor: 'var(--border-card)' }}>
      <div className="relative shrink-0">
        <div className="w-10 h-10 rounded-full bg-[#25D366]/15 flex items-center justify-center font-bold text-[13px] text-[#25D366]">
          {getInitials(conv.leadName)}
        </div>
        {conv.unread && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#25D366] border-2 border-white" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`text-[13px] truncate ${conv.unread ? 'font-bold' : 'font-medium'}`}
              style={{ color: 'var(--text-primary)' }}>
              {conv.leadName}
            </span>
            {!conv.isLead && (
              <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700">
                new
              </span>
            )}
          </div>
          <span className="text-[10px] shrink-0 ml-2" style={{ color: 'var(--text-muted)' }}>
            {timeAgo(conv.lastSentAt || conv.lastResponseAt)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1">
          <p className="text-[12px] truncate flex-1"
            style={{ color: conv.unread ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {conv.lastResponse || conv.lastTemplate || 'No messages yet'}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            {showOwner && conv.isLead && conv.ownerName && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold truncate max-w-[70px]"
                style={{ background: 'var(--bg-tag, #EFF6FF)', color: 'var(--primary, #015FDE)' }}
                title={`Owner: ${conv.ownerName}`}>
                {conv.ownerName.split(' ')[0]}
              </span>
            )}
            {conv.unread && (
              <span className="w-5 h-5 rounded-full bg-[#25D366] text-white text-[10px] font-bold flex items-center justify-center">
                1
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Communication() {
  const { show } = useToast();
  const { user, isAdmin } = useAuth();

  const [settings, setSettings] = useState({ enabled: false, hasAuthKey: false, integratedNumber: '', senderName: '' });
  const [templates, setTemplates] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [empFilter, setEmpFilter] = useState('');  // '' = all employees

  const [selectedConv, setSelectedConv] = useState(null);
  const [settingsModal, setSettingsModal] = useState(false);
  const [templateModal, setTemplateModal] = useState(null);
  const [bulkModal, setBulkModal] = useState(false);

  const [empList, setEmpList] = useState([]); // for employee filter dropdown

  // Load employee list for filter — admin only
  useEffect(() => {
    if (!isAdmin) return;
    userApi.list()
      .then(list => setEmpList((list || []).filter(u => (u.role === 'sales' || u.role === 'admin') && (u.id || u._id))))
      .catch(() => {});
  }, [isAdmin]);

  const loadAll = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    const [sRes, tRes, cRes] = await Promise.allSettled([
      whatsappApi.getSettings(),
      whatsappApi.listTemplates(),
      whatsappApi.listConversations(),
    ]);
    if (sRes.status === 'fulfilled') setSettings(sRes.value);
    if (tRes.status === 'fulfilled') setTemplates(tRes.value);
    if (cRes.status === 'fulfilled') setConversations(cRes.value);
    else if (showSpinner) show('Could not load conversations.', 'error');
    if (showSpinner) setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  // Auto-refresh conversations only every 15s — does NOT reload settings/templates
  // so the page doesn't flicker. Uses a silent fetch without setLoading.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const convs = await whatsappApi.listConversations();
        setConversations(convs);
      } catch { /* silent */ }
    }, 30000);
    return () => clearInterval(t);
  }, []);

  const removeTemplate = async t => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    try { await whatsappApi.deleteTemplate(t.id); show('Deleted.', 'success'); loadAll(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  const filteredConvs = conversations.filter(c => {
    const ms = !search
      || (c.leadName || '').toLowerCase().includes(search.toLowerCase())
      || (c.mobile || '').includes(search)
      || (c.contactNumber || '').includes(search);
    if (!ms) return false;
    if (filter === 'unread') return c.unread;
    if (filter === 'replied') return !!c.lastResponse;
    if (filter === 'new') return !c.isLead;
    // Employee filter — only show conversations owned by selected employee
    if (empFilter && c.isLead && String(c.ownerId || '') !== String(empFilter)) return false;
    if (empFilter && !c.isLead) return false; // non-lead contacts have no owner
    return true;
  });

  const unreadCount = conversations.filter(c => c.unread).length;
  const newContactCount = conversations.filter(c => !c.isLead).length;

  if (loading) return <Spinner label="Loading Communication…" />;

  return (
    <div className="flex flex-col" style={{ background: 'var(--bg-page)', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Page title */}
      <div className="px-4 pt-4 pb-3 shrink-0">
        <PageTitle icon={<MessageSquare size={18} />}
          actions={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={loadAll}>
                <RefreshCw size={13} className="mr-1.5" />Refresh
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBulkModal(true)}
                style={{ borderColor: '#25D366', color: '#25D366' }}>
                <Users size={13} className="mr-1.5" />Blast
              </Button>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setSettingsModal(true)}>
                  <Settings size={13} className="mr-1.5" />Settings
                </Button>
              )}
            </div>
          }>
          Communication
        </PageTitle>

        {/* Connection status */}
        <div className="flex items-center gap-2 mt-2 px-1">
          <span className={`w-2 h-2 rounded-full ${settings.enabled && settings.hasAuthKey ? 'bg-[#25D366]' : 'bg-red-400'}`} />
          <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            {settings.enabled && settings.hasAuthKey
              ? `API connected${settings.integratedNumber ? ` · ${settings.integratedNumber}` : ''}`
              : 'WhatsApp API not configured — click Settings'}
          </span>
          {newContactCount > 0 && (
            <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700">
              {newContactCount} new contact{newContactCount > 1 ? 's' : ''} — not yet leads
            </span>
          )}
        </div>
      </div>

      {/* Main layout — flex-1 min-h-0 forces it to fill remaining space */}
      <div className="flex-1 min-h-0 flex overflow-hidden mx-4 mb-4 rounded-2xl border shadow-sm"
        style={{ borderColor: 'var(--border-card)' }}>

        {/* LEFT SIDEBAR */}
        <div className={`flex flex-col border-r shrink-0 overflow-hidden ${selectedConv ? 'hidden sm:flex' : 'flex'} w-full sm:w-[300px] lg:w-[340px]`}
          style={{ borderColor: 'var(--border-card)', background: 'var(--bg-card)' }}>

          {/* Sidebar header */}
          <div className="px-3 py-3 border-b shrink-0 space-y-2"
            style={{ borderColor: 'var(--border-card)', background: 'var(--bg-card-head)' }}>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search conversations…"
                className="w-full pl-8 pr-3 py-2 rounded-xl border text-[13px] focus:outline-none transition"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
            </div>
            {/* Filter tabs */}
            <div className="flex gap-1">
              {[
                ['all', 'All'],
                ['unread', unreadCount ? `Unread (${unreadCount})` : 'Unread'],
                ['replied', 'Replied'],
                ['new', newContactCount ? `New (${newContactCount})` : 'New'],
              ].map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition ${
                    filter === k
                      ? k === 'new' ? 'bg-amber-500 text-white' : 'bg-[#25D366] text-white'
                      : 'text-[var(--text-muted)] hover:bg-black/5'
                  }`}>
                  {l}
                </button>
              ))}
            </div>

            {/* Employee filter — admin only */}
            {isAdmin && empList.length > 0 && (
              <div className="flex items-center gap-2">
                <Users size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <select
                  value={empFilter}
                  onChange={e => setEmpFilter(e.target.value)}
                  className="flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium"
                  style={{ background: 'var(--bg-input)', color: empFilter ? 'var(--text-primary)' : 'var(--text-muted)', borderColor: empFilter ? '#25D366' : 'var(--border)' }}>
                  <option value="">All Employees</option>
                  {empList.map(u => (
                    <option key={u.id || u._id} value={u.id || u._id}>
                      {u.name} {u.role === 'admin' ? '(Admin)' : ''}
                    </option>
                  ))}
                </select>
                {empFilter && (
                  <button onClick={() => setEmpFilter('')}
                    className="text-[10px] px-1.5 py-1 rounded font-bold"
                    style={{ color: 'var(--text-muted)' }}
                    title="Clear filter">✕</button>
                )}
              </div>
            )}
          </div>

          {/* Conversation list */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {filteredConvs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 p-6 opacity-60">
                <MessageSquare size={32} strokeWidth={1.2} style={{ color: 'var(--text-muted)' }} />
                <p className="text-[13px] text-center" style={{ color: 'var(--text-muted)' }}>
                  {search ? 'No conversations match' : 'No conversations yet'}
                </p>
              </div>
            ) : (
              filteredConvs.map(conv => (
                <ConvRow key={conv.key || conv.leadId || conv.contactNumber}
                  conv={conv}
                  active={selectedConv?.key === conv.key}
                  onClick={() => setSelectedConv(conv)}
                  showOwner={isAdmin && !empFilter} />
              ))
            )}
          </div>

          {/* Templates panel */}
          {isAdmin && (
            <div className="border-t shrink-0" style={{ borderColor: 'var(--border-card)' }}>
              <div className="px-3 py-2.5 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Templates ({templates.length})
                </span>
                <button onClick={() => setTemplateModal('new')}
                  className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-black/5 transition"
                  style={{ color: 'var(--text-muted)' }}>
                  <Plus size={14} />
                </button>
              </div>
              <div className="max-h-36 overflow-y-auto px-3 pb-3 space-y-1.5">
                {templates.length === 0 ? (
                  <p className="text-[11px] italic" style={{ color: 'var(--text-muted)' }}>No templates — click + to add</p>
                ) : templates.map(t => (
                  <div key={t.id} className="flex items-center gap-2 p-2 rounded-xl border"
                    style={{ borderColor: 'var(--border-card)' }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{t.name}</p>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.language} · {t.variableCount} var(s)</p>
                    </div>
                    <button onClick={() => setTemplateModal(t)}
                      className="p-1 hover:bg-black/5 rounded transition" style={{ color: 'var(--text-muted)' }}>
                      <Settings size={12} />
                    </button>
                    <button onClick={() => removeTemplate(t)}
                      className="p-1 hover:bg-red-50 rounded transition text-red-400">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — CHAT or empty state */}
        <div className={`flex-1 overflow-hidden ${selectedConv ? 'flex' : 'hidden sm:flex'} flex-col`}>
          {selectedConv ? (
            <ChatWindow
              key={selectedConv.key}
              conv={selectedConv}
              templates={templates}
              onClose={() => setSelectedConv(null)}
              onRefreshList={() => { whatsappApi.listConversations().then(setConversations).catch(() => {}); }}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 opacity-60"
              style={{ background: 'var(--bg-card)' }}>
              <div className="w-16 h-16 rounded-full bg-[#25D366]/10 flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="#25D366">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.121 1.531 5.845L.057 23.286a.5.5 0 0 0 .64.64l5.431-1.47A11.952 11.952 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.849 0-3.576-.498-5.066-1.367l-.363-.214-3.765 1.018 1.022-3.734-.234-.376A9.967 9.967 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                </svg>
              </div>
              <div className="text-center">
                <p className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Select a conversation</p>
                <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Pick a chat from the left to view messages
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {settingsModal && (
        <SettingsModal settings={settings} onClose={() => setSettingsModal(false)} onSaved={loadAll} />
      )}
      {templateModal && (
        <TemplateModal
          template={templateModal === 'new' ? null : templateModal}
          onClose={() => setTemplateModal(null)}
          onSaved={loadAll}
        />
      )}
      {bulkModal && (
        <BulkSendModal templates={templates} onClose={() => setBulkModal(false)} onSent={loadAll} />
      )}
    </div>
  );
}
