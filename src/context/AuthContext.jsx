import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { PauseCircle } from 'lucide-react';
import { api, setAccessToken, onAuthFailure, onAccountPaused } from '../api/client.js';
import { authApi, termsApi } from '../api/endpoints.js';
import { setActiveCurrency } from '../utils/format.js';
import TermsGate from '../components/TermsGate.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pausedMsg, setPausedMsg] = useState(null);

  const clear = useCallback(() => { setAccessToken(null); setUser(null); }, []);

  // On load, attempt silent refresh to restore session
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.post('/auth/refresh');
        setAccessToken(data.accessToken);
        setUser(data.user);
      } catch {
        clear();
      } finally {
        setLoading(false);
      }
    })();
    onAuthFailure(clear);
    onAccountPaused((msg) => setPausedMsg(msg || 'Your account is paused.'));
  }, [clear]);

  const login = async (username, password) => {
    const data = await authApi.login({ username, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    setPausedMsg(null);
    clear();
  };

  const isAdmin = user?.role === 'admin';
  const isDeveloper = user?.role === 'developer';

  // ── Terms & Conditions gate ────────────────────────────────────────────
  // Fetched once a user is logged in; compared against their
  // termsAcceptedVersion to decide whether to block the app. Developers
  // (platform owner) are exempt, same as the subscription-pause check below.
  const [currentTerms, setCurrentTerms] = useState(null);
  useEffect(() => {
    if (!user || isDeveloper) { setCurrentTerms(null); return; }
    let active = true;
    termsApi.getCurrent().then((t) => { if (active) setCurrentTerms(t); }).catch(() => {});
    return () => { active = false; };
  }, [user?.id, isDeveloper]);

  const needsTermsAcceptance = !!(
    user && !isDeveloper && currentTerms && (user.termsAcceptedVersion || 0) < (currentTerms.version || 1)
  );

  const acceptTerms = async () => {
    await termsApi.accept();
    // Unblock immediately without requiring a refresh/re-login.
    setUser((u) => (u ? { ...u, termsAcceptedVersion: currentTerms.version } : u));
  };

  // Tenant info attached by the server (currency + branding). Null for developer.
  const company = user?.company && typeof user.company === 'object' ? user.company : null;
  const branding = company?.branding || null;
  const currency = company?.currency || null;
  const subscription = company?.subscription || null;

  // Push the tenant's currency into the shared formatter so fmt()/fmtAED()/etc.
  // render this company's symbol + locale everywhere. Resets to the default
  // when there's no company (developer / logged out).
  useEffect(() => {
    setActiveCurrency(currency);
  }, [currency?.code, currency?.symbol, currency?.locale]);

  // When the server reports the subscription is paused (402), show a blocking
  // notice over everything. Developers are never paused, so this only affects
  // admin/sales users of an expired company.
  if (pausedMsg && !isDeveloper) {
    return (
      <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isDeveloper, company, branding, currency, subscription, paused: true }}>
        <AccountPausedScreen
          message={pausedMsg}
          onLogout={logout}
          brandName={branding?.headerName}
          onResume={(newUser, newToken) => {
            // Called by AccountPausedScreen when it detects the subscription
            // has been renewed. Clear the paused state and restore the session.
            setAccessToken(newToken);
            setUser(newUser);
            setPausedMsg(null);
          }}
        />
      </AuthContext.Provider>
    );
  }

  // Mandatory Terms & Conditions acceptance — blocks everything else until
  // accepted. Checked after the paused screen (a paused company has bigger
  // problems to resolve first) but before the app itself ever renders.
  if (needsTermsAcceptance) {
    return (
      <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isDeveloper, company, branding, currency, subscription, paused: false }}>
        <TermsGate terms={currentTerms} onAccept={acceptTerms} onLogout={logout} />
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isDeveloper, company, branding, currency, subscription, paused: false }}>
      {children}
    </AuthContext.Provider>
  );
}

// Full-screen blocking notice shown when a company's subscription is paused.
// Polls /auth/refresh every 30s — when the developer renews the subscription
// the refresh succeeds (no longer 402) and onResume() is called to restore
// the session without requiring a manual page refresh or re-login.
function AccountPausedScreen({ message, onLogout, brandName, onResume }) {
  const [checking, setChecking] = React.useState(false);
  const [checkMsg, setCheckMsg] = React.useState('');

  // Try a silent refresh to see if the subscription has been renewed.
  const tryResume = React.useCallback(async (silent = false) => {
    if (!silent) setChecking(true);
    try {
      const { data } = await api.post('/auth/refresh');
      // If this succeeds without a 402, the account is no longer paused.
      if (data?.accessToken && data?.user) {
        onResume(data.user, data.accessToken);
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 402) {
        // Still paused — expected, no error to show
        if (!silent) setCheckMsg('Account is still paused. Please contact support.');
      } else {
        if (!silent) setCheckMsg('Could not connect. Please try again.');
      }
    } finally {
      if (!silent) setChecking(false);
    }
  }, [onResume]);

  // Auto-poll every 30s so access resumes as soon as the developer renews
  // the subscription — without the user having to do anything.
  React.useEffect(() => {
    const t = setInterval(() => tryResume(true), 30_000);
    return () => clearInterval(t);
  }, [tryResume]);

  return (
    <div
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px', background: 'var(--bg-base, #f6f7fb)',
      }}
    >
      <div
        style={{
          maxWidth: 460, width: '100%', textAlign: 'center', borderRadius: 16,
          background: 'var(--bg-card, #fff)', boxShadow: '0 10px 40px rgba(0,0,0,.12)',
          padding: '36px 28px', border: '1px solid var(--border-card, #eee)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, color: 'var(--primary, #6D28D9)' }}>
          <PauseCircle size={44} strokeWidth={1.5} />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px', color: 'var(--text-primary, #111)' }}>
          {brandName ? `${brandName} — ` : ''}Account Paused
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary, #555)', margin: '0 0 22px' }}>
          {message}
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', margin: '0 0 22px' }}>
          Access will resume automatically once the subscription is renewed and the
          payment status is updated. This page checks every 30 seconds.
        </p>
        {checkMsg && (
          <p style={{ fontSize: 12, color: '#dc2626', margin: '0 0 14px' }}>{checkMsg}</p>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => { setCheckMsg(''); tryResume(false); }}
            disabled={checking}
            style={{
              padding: '10px 22px', borderRadius: 8, border: '1.5px solid var(--primary, #6D28D9)',
              cursor: checking ? 'not-allowed' : 'pointer', opacity: checking ? 0.6 : 1,
              background: 'transparent', color: 'var(--primary, #6D28D9)', fontWeight: 700, fontSize: 14,
            }}
          >
            {checking ? 'Checking…' : 'Check now'}
          </button>
          <button
            onClick={onLogout}
            style={{
              padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'var(--primary, #6D28D9)', color: '#fff', fontWeight: 700, fontSize: 14,
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}