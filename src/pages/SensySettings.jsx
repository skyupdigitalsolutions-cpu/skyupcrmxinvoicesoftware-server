// pages/SensySettings.jsx
// Admin-only page to configure the Sensy webhook integration.
// Once configured, Sensy sends new contacts to your CRM automatically as leads.

import { useState, useEffect } from 'react';
import { Copy, RefreshCw, Check, Globe, Key, User, MapPin } from 'lucide-react';
import { api, apiError } from '../api/client.js';
import { useFetch } from '../hooks/useApi.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import { Field, Input, Select } from '../components/ui/Field.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const sensyApi = {
  getSettings:  ()    => api.get('/sensy/settings').then((r) => r.data.settings),
  saveSettings: (b)   => api.patch('/sensy/settings', b).then((r) => r.data.settings),
};

const userApi = {
  list: () => api.get('/users').then((r) => r.data.users || r.data),
};

function generateSecret(len = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const COUNTRIES = ['UAE', 'India', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Bahrain', 'Oman', 'UK', 'USA', 'Other'];

export default function SensySettings() {
  const { show } = useToast();
  const { isAdmin } = useAuth();

  const { data: settings, loading } = useFetch(() => sensyApi.getSettings(), []);
  const { data: usersRaw }          = useFetch(() => userApi.list(), []);
  const users = (usersRaw || []).filter((u) => u.role !== 'developer');

  const [form, setForm]     = useState(null);
  const [busy, setBusy]     = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (settings && !form) {
      setForm({
        webhookSecret:  settings.webhookSecret  || '',
        defaultCountry: settings.defaultCountry || 'UAE',
        defaultOwner:   settings.defaultOwner   || '',
      });
    }
  }, [settings]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Use the configured API base URL for the webhook (strip /api suffix if present)
  const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/api$/, '') || window.location.origin;
  const webhookUrl = form?.webhookSecret
    ? `${apiBase}/api/sensy/webhook?secret=${form.webhookSecret}`
    : '';

  const copyUrl = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const regenerate = () => set('webhookSecret', generateSecret());

  const save = async () => {
    if (!form.webhookSecret) { show('Generate a webhook secret first.', 'error'); return; }
    setBusy(true);
    try {
      await sensyApi.saveSettings({
        webhookSecret:  form.webhookSecret,
        defaultCountry: form.defaultCountry,
        defaultOwner:   form.defaultOwner || null,
      });
      show('Sensy integration saved.', 'success');
    } catch (e) {
      show(apiError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !form) return <Spinner label="Loading Sensy settings…" />;

  return (
    <>
      <PageTitle icon={<Globe size={18} />}>Sensy Integration</PageTitle>

      {/* Status banner */}
      <div
        className="mb-4 flex items-center gap-3 rounded-xl border px-4 py-3"
        style={{
          background:   form.webhookSecret ? 'var(--success-bg, #f0fdf4)' : 'var(--warn-bg, #fffbeb)',
          borderColor:  form.webhookSecret ? '#16a34a55' : '#d9770655',
        }}
      >
        <div
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: form.webhookSecret ? '#16a34a' : '#d97706' }}
        />
        <span className="text-[13px] font-bold" style={{ color: form.webhookSecret ? '#16a34a' : '#d97706' }}>
          {form.webhookSecret ? 'Sensy webhook configured — leads will be auto-imported.' : 'Not configured — generate a webhook secret to get started.'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* Webhook URL card */}
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Key size={15} style={{ color: 'var(--accent)' }} />
            <span className="text-[13px] font-bold">Webhook URL</span>
          </div>
          <p className="mb-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Paste this URL into Sensy → Flows → Webhook node → Webhook URL field.
            Sensy will POST every new contact to this URL automatically.
          </p>

          <div className="flex items-center gap-2">
            <input
              readOnly
              value={webhookUrl || 'Generate a secret first'}
              className="flex-1 rounded border px-3 py-2 text-[11px] font-mono"
              style={{
                borderColor: 'var(--border-card)',
                background:  'var(--bg-card)',
                color:       webhookUrl ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!webhookUrl}
              onClick={copyUrl}
              title="Copy webhook URL"
            >
              {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
            </Button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Field label="Webhook Secret" className="flex-1">
              <div className="flex gap-2">
                <Input
                  className="flex-1 font-mono text-[11px]"
                  value={form.webhookSecret}
                  onChange={(e) => set('webhookSecret', e.target.value)}
                  placeholder="Click Generate →"
                />
                <Button size="sm" variant="outline" onClick={regenerate} title="Generate new secret">
                  <RefreshCw size={13} />
                </Button>
              </div>
            </Field>
          </div>
          <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            ⚠️ Changing the secret breaks the existing Sensy webhook URL — update it in Sensy too.
          </p>
        </Card>

        {/* Lead defaults card */}
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <User size={15} style={{ color: 'var(--accent)' }} />
            <span className="text-[13px] font-bold">Lead Defaults</span>
          </div>
          <p className="mb-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Every lead imported from Sensy will be assigned to the default owner.
            Source is always set to <strong>WhatsApp</strong> and status to <strong>New</strong>.
          </p>

          <div className="space-y-3">
            <Field label="Default Country (for phone normalisation)">
              <Select value={form.defaultCountry} onChange={(e) => set('defaultCountry', e.target.value)}>
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>

            <Field label="Default Owner (assigned salesperson)">
              <Select value={form.defaultOwner} onChange={(e) => set('defaultOwner', e.target.value)}>
                <option value="">— First Admin (fallback) —</option>
                {users.map((u) => (
                  <option key={u._id} value={u._id}>{u.name} ({u.role})</option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
      </div>

      {/* How it works */}
      <Card className="mt-4 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Globe size={15} style={{ color: 'var(--accent)' }} />
          <span className="text-[13px] font-bold">How to connect Sensy</span>
        </div>
        <ol className="space-y-2 text-[12px]" style={{ color: 'var(--text-primary)' }}>
          {[
            'In this page — click Generate to create a webhook secret, set the default owner, and click Save.',
            'Copy the Webhook URL shown above.',
            'In Sensy → open your Flow → add a "Custom Webhook" node.',
            'Paste the Webhook URL into the "Webhook URL" field.',
            'Set Webhook Title to "CRM Lead Import" (or anything).',
            'Click "Capture Incoming Webhook" in Sensy, then run a test contact through your flow.',
            'The contact will appear as a new lead in your CRM Leads page automatically.',
            'Existing contacts (same phone number) are silently skipped — no duplicates.',
          ].map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white"
                style={{ background: 'var(--accent, #2563eb)' }}
              >{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Card>

      {/* Save button */}
      <div className="mt-4 flex justify-end">
        <Button variant="green" disabled={busy || !form.webhookSecret} onClick={save}>
          {busy ? 'Saving…' : 'Save Integration'}
        </Button>
      </div>
    </>
  );
}
