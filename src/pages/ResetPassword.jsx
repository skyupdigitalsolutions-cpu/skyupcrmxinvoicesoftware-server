import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { KeyRound, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { authApi } from '../api/endpoints.js';
import { apiError } from '../api/client.js';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token    = params.get('token') || '';

  const [form, setForm]     = useState({ password: '', confirm: '' });
  const [showPwd, setShowPwd]     = useState(false);
  const [showConf, setShowConf]   = useState(false);
  const [busy, setBusy]     = useState(false);
  const [done, setDone]     = useState(false);
  const [err, setErr]       = useState('');

  // Token missing — show a helpful error immediately.
  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy to-navy-700 p-4">
        <div className="w-full max-w-[380px] rounded-2xl bg-white p-8 text-center shadow-[0_20px_60px_rgba(0,0,0,.4)]">
          <AlertCircle size={40} className="mx-auto mb-4 text-danger" />
          <h2 className="mb-2 text-base font-black text-navy">Invalid Link</h2>
          <p className="mb-5 text-xs text-gray-500">
            This password reset link is missing its token. Please request a new link from the login page.
          </p>
          <Link
            to="/login"
            className="inline-block rounded-md px-5 py-2.5 text-sm font-bold text-white"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.password || form.password.length < 6)
      return setErr('Password must be at least 6 characters.');
    if (form.password !== form.confirm)
      return setErr('Passwords do not match.');

    setBusy(true);
    try {
      await authApi.resetPassword({ token, password: form.password });
      setDone(true);
      // Auto-redirect to login after 3 seconds
      setTimeout(() => navigate('/login'), 3000);
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy to-navy-700 p-4">
      <div className="w-full max-w-[380px] rounded-2xl bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,.4)] sm:p-9">

        {/* Brand */}
        <div className="mb-6 text-center">
          <div className="text-2xl font-black leading-tight tracking-wide text-navy">
           Sign in to your account
          </div>
        </div>

        {done ? (
          <div className="text-center">
            <CheckCircle2 size={44} className="mx-auto mb-4 text-green-500" />
            <h2 className="mb-2 text-base font-black text-navy">Password updated!</h2>
            <p className="mb-4 text-xs text-gray-500">
              Your password has been reset successfully. Redirecting you to the login page…
            </p>
            <Link
              to="/login"
              className="inline-block rounded-md px-5 py-2.5 text-sm font-bold text-white"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              Sign In Now
            </Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="mb-5 flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100">
                <KeyRound size={18} className="text-purple-700" />
              </span>
              <div>
                <h2 className="text-sm font-black text-navy">Set a new password</h2>
                <p className="text-[11px] text-gray-500">Choose a strong password for your account.</p>
              </div>
            </div>

            {/* New password */}
            <div className="mb-3">
              <label className="field-label">New Password</label>
              <div className="relative">
                <input
                  autoFocus
                  type={showPwd ? 'text' : 'password'}
                  className="input"
                  placeholder="Min 6 characters"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  style={{ paddingRight: '2.5rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Confirm password */}
            <div className="mb-4">
              <label className="field-label">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConf ? 'text' : 'password'}
                  className="input"
                  placeholder="Repeat your password"
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                  style={{ paddingRight: '2.5rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowConf((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showConf ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
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
              {busy ? <><Loader2 size={15} className="animate-spin" /> Resetting…</> : 'Reset Password'}
            </button>

            <p className="mt-4 text-center text-[11px] text-gray-400">
              Remembered it?{' '}
              <Link to="/login" className="font-semibold text-purple-700 hover:underline">
                Sign In
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
