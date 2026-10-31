import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, Mail, ArrowLeft, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { authApi } from '../api/endpoints.js';
import { apiError } from '../api/client.js';

// ── Forgot-password inline panel ──────────────────────────────────────────────
function ForgotPasswordPanel({ onBack }) {
  const [email, setEmail]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [sent, setSent]     = useState(false);
  const [err,  setErr]      = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!email.trim()) return setErr('Please enter your email address.');
    setBusy(true);
    try {
      await authApi.forgotPassword({ email: email.trim() });
      setSent(true);
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="text-center">
        <div className="mb-4 flex justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-100">
            <Mail size={26} className="text-purple-700" />
          </span>
        </div>
        <h2 className="mb-2 text-base font-black text-navy">Check your inbox</h2>
        <p className="mb-5 text-xs leading-relaxed" style={{ color: '#6B7280' }}>
          If that email is registered, we've sent a password reset link.
          It expires in <strong>1 hour</strong>.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="flex w-full items-center justify-center gap-2 rounded-md border py-2.5 text-sm font-semibold text-navy transition hover:bg-gray-50"
        >
          <ArrowLeft size={14} /> Back to Sign In
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <button
        type="button"
        onClick={onBack}
        className="mb-5 flex items-center gap-1.5 text-xs font-semibold text-purple-700 hover:underline"
      >
        <ArrowLeft size={13} /> Back to Sign In
      </button>

      <h2 className="mb-1 text-lg font-black text-navy">Forgot your password?</h2>
      <p className="mb-5 text-xs leading-relaxed" style={{ color: '#6B7280' }}>
        Enter your account email and we'll send a reset link if it's registered.
      </p>

      <div className="mb-3">
        <label className="field-label">Email address</label>
        <input
          autoFocus
          type="email"
          className="input"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {err && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-center text-xs font-medium text-danger">
          {err}
        </div>
      )}

      <button
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: 'var(--primary)' }}
      >
        {busy ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : <><Mail size={15} /> Send Reset Link</>}
      </button>
    </form>
  );
}

// ── Main login page ───────────────────────────────────────────────────────────
export default function Login() {
  const { login }  = useAuth();
  const { branding } = useTheme();
  const navigate   = useNavigate();
  const [form, setForm]       = useState({ username: '', password: '' });
  const [err, setErr]         = useState('');
  const [busy, setBusy]       = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.username || !form.password) return setErr('Please enter username and password.');
    setBusy(true);
    try {
      await login(form.username.trim(), form.password);
      navigate('/dashboard');
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy to-navy-700 p-4">
      <div className="w-full max-w-[380px] rounded-2xl bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,.4)] sm:p-9">

        {/* Brand header — shown on both panels. Pulls the fixed platform brand
            from ThemeContext (no company context exists before login). */}
        <div className="mb-7 text-center">
          {branding.logo ? (
            <img
              src={branding.logo}
              alt={branding.companyName}
              className="mx-auto mb-3 h-12 w-auto object-contain"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          ) : null}
          <div className="text-2xl font-black leading-tight tracking-wide text-navy">
            {branding.companyName}
          </div>
          <div className="mt-1 text-xs font-medium tracking-wide text-ink-3">
            Sign in to continue
          </div>
        </div>

        {showForgot ? (
          <ForgotPasswordPanel onBack={() => setShowForgot(false)} />
        ) : (
          <form onSubmit={submit}>
            <div className="mb-4">
              <label className="field-label">Username</label>
              <input
                autoFocus
                className="input"
                placeholder="Enter username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>

            <div className="mb-1">
              <label className="field-label">Password</label>
              <input
                type="password"
                className="input"
                placeholder="Enter password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>

            {/* Forgot password link */}
            <div className="mb-3 text-right">
              <button
                type="button"
                onClick={() => { setErr(''); setShowForgot(true); }}
                className="text-[11px] font-semibold text-purple-700 hover:underline"
              >
                Forgot password?
              </button>
            </div>

            {err && (
              <div className="mb-3 mt-1 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-center text-xs font-medium text-danger">
                {err}
              </div>
            )}

            <button
              disabled={busy}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {busy ? 'Signing in…' : <><LogIn size={16} /> Sign In</>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}