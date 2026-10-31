// src/components/TermsViewerModal.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Read-only Terms & Conditions viewer. Opened from a link (e.g. the "Terms &
// Conditions" link under the Billing & Plans page). Unlike a blocking
// acceptance gate, this does NOT block the app and does NOT record
// acceptance — it simply displays the current published terms for reference.
//
// It fetches the same /terms/current endpoint an acceptance gate would use,
// so the content shown here always matches the version users actually accept.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { termsApi } from '../api/endpoints.js';

export default function TermsViewerModal({ open, onClose }) {
  const [loading, setLoading] = useState(true);
  const [terms, setTerms] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(false);
    termsApi.getCurrent()
      .then((data) => {
        if (!active) return;
        setTerms(data || null);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        setLoading(false);
      });
    return () => { active = false; };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-xl max-h-[80vh] flex-col rounded-2xl bg-white dark:bg-[#13161E] shadow-2xl border border-gray-200 dark:border-white/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 sm:px-5 pt-4 pb-3 border-b border-gray-100 dark:border-white/5">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-50">
              {terms?.title || 'Terms & Conditions'}
            </h2>
            {terms?.effectiveDate ? (
              <p className="mt-1 text-[8px] text-gray-500 dark:text-gray-400">
                Effective Date: {terms.effectiveDate}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-white/5 transition"
            aria-label="Close"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-3 text-[8px] leading-relaxed text-gray-700 dark:text-gray-300 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin w-6 h-6 text-[#2563EB]" />
            </div>
          ) : error ? (
            <p className="py-10 text-center text-gray-500 dark:text-gray-400">
              Could not load the Terms &amp; Conditions. Please try again later.
            </p>
          ) : !terms ? (
            <p className="py-10 text-center text-gray-500 dark:text-gray-400">
              No Terms &amp; Conditions have been published yet.
            </p>
          ) : (
            <>
              {terms.intro ? <p>{terms.intro}</p> : null}
              {(terms.sections || []).map((sec, i) => (
                <p key={i}>
                  {sec.heading ? <span className="font-semibold">{sec.heading} </span> : null}
                  {sec.body || ''}
                </p>
              ))}
              {terms.declaration ? (
                <p className="pt-2 border-t border-gray-100 dark:border-white/5 font-medium text-gray-800 dark:text-gray-200">
                  {terms.declaration}
                </p>
              ) : null}
              <div className="pt-2 text-center text-[11px] text-gray-400 dark:text-gray-500">
                — End of Terms &amp; Conditions —
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 border-t border-gray-100 dark:border-white/5 bg-gray-50/60 dark:bg-white/[0.02] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#2563EB] px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}