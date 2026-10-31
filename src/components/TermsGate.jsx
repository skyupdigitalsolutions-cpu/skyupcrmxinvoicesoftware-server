// src/components/TermsGate.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Mandatory, blocking Terms & Conditions acceptance screen. Rendered by
// AuthContext in place of the whole app whenever the logged-in user's
// `termsAcceptedVersion` is behind the currently published Terms.version —
// which is true the very first time they ever log in (starts at 0), and
// again any time the developer publishes an updated version afterward.
//
// Unlike TermsViewerModal, this cannot be dismissed without accepting: no
// backdrop-click-to-close, no Escape handling, no X button. The only way
// through is checking the box and clicking "I Agree & Continue" (or signing
// out instead).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useRef, useCallback, useEffect } from 'react';
import { Loader2, ShieldCheck, ArrowDown } from 'lucide-react';

export default function TermsGate({ terms, onAccept, onLogout }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const bodyRef = useRef(null);

  const checkScrolled = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    // 8px tolerance for rounding — "close enough" to the bottom counts.
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
    if (atEnd) setScrolledToEnd(true);
  }, []);

  // Content short enough to need no scrolling at all shouldn't block
  // acceptance forever — check once content is loaded/rendered.
  useEffect(() => {
    checkScrolled();
  }, [terms, checkScrolled]);

  const canCheck = scrolledToEnd;
  // If there's no declaration text, there's no checkbox to check — in that
  // case, scrolling to the end alone is enough to enable the Agree button
  // (otherwise it would be permanently disabled with nothing visible to fix it).
  const canAgree = terms?.declaration ? checked : scrolledToEnd;

  const agree = async () => {
    if (!canAgree || busy) return;
    setBusy(true);
    setError('');
    try {
      await onAccept();
    } catch {
      setError('Could not record your acceptance. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-3 sm:p-6">
      <div className="flex w-full max-w-xl max-h-[82vh] flex-col rounded-2xl bg-white dark:bg-[#13161E] shadow-2xl border border-gray-200 dark:border-white/10 overflow-hidden">
        {/* Header — no close button, intentionally */}
        <div className="flex items-center gap-2.5 px-4 sm:px-5 pt-4 pb-3 border-b border-gray-100 dark:border-white/5">
          <ShieldCheck className="w-5 h-5 text-[#2563EB] shrink-0" />
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-50">
              {terms?.title || 'Terms & Conditions'}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Please review and accept to continue using the app.
            </p>
          </div>
        </div>

        {/* Body */}
        <div
          ref={bodyRef}
          onScroll={checkScrolled}
          className="flex-1 overflow-y-auto px-4 sm:px-5 py-3 text-[13px] leading-relaxed text-gray-700 dark:text-gray-300 space-y-4"
        >
          {terms?.intro ? <p>{terms.intro}</p> : null}
          {(terms?.sections || []).map((sec, i) => (
            <p key={i}>
              {sec.heading ? <span className="font-semibold">{sec.heading} </span> : null}
              {sec.body || ''}
            </p>
          ))}
        </div>

        {/* Footer — declaration checkbox + actions */}
        <div className="px-4 sm:px-5 py-3 border-t border-gray-100 dark:border-white/5 bg-gray-50/60 dark:bg-white/[0.02] space-y-3">
          {!scrolledToEnd && (
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-amber-600 dark:text-amber-400">
              <ArrowDown className="w-3.5 h-3.5 animate-bounce shrink-0" />
              Scroll to the end of the document above to enable the checkbox.
            </p>
          )}
          {terms?.declaration ? (
            <label className={`flex items-start gap-2.5 select-none ${canCheck ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
              <input
                type="checkbox"
                disabled={!canCheck}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#2563EB] disabled:cursor-not-allowed"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <span className="text-[12.5px] leading-snug text-gray-700 dark:text-gray-300">
                {terms.declaration}
              </span>
            </label>
          ) : null}

          {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={onLogout}
              className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition"
            >
              Sign out instead
            </button>
            <button
              type="button"
              disabled={!canAgree || busy}
              onClick={agree}
              className="rounded-lg bg-[#2563EB] px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              I Agree &amp; Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}