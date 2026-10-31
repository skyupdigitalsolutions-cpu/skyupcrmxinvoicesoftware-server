import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';
import { Input } from './Field.jsx';
import { getCountryNames, dialFor, addCustomCountry } from '../../utils/format.js';

// Searchable country picker. Type to filter by country NAME or DIAL CODE
// (e.g. "971", "ind", "saudi"), click or press Enter to choose. Picking
// "Other — type manually" reveals a free text box for a country not listed.
// The menu renders in a portal (fixed-positioned to the field) so it floats
// above cards that clip their overflow. Controlled: `value` + `onChange(value)`.
export default function CountrySelect({ value, onChange, showCode = true, className = '' }) {
  // Bump to re-read the (live) country list after a custom country is added.
  const [countryVersion, setCountryVersion] = useState(0);
  const NAMES = useMemo(() => getCountryNames().filter((c) => c !== 'Other'), [countryVersion]);
  const isCustom = !!value && !getCountryNames().includes(value);

  const [manual, setManual] = useState(isCustom);
  const [manualCode, setManualCode] = useState(isCustom ? dialFor(value) : '');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState(null); // { left, width, top?, bottom? }

  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => { if (isCustom) setManual(true); }, [isCustom]);

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const menuH = 340;
    const spaceBelow = window.innerHeight - r.bottom;
    const flipUp = spaceBelow < menuH && r.top > spaceBelow;
    setPos({
      left: r.left,
      width: r.width,
      top: flipUp ? undefined : Math.round(r.bottom + 4),
      bottom: flipUp ? Math.round(window.innerHeight - r.top + 4) : undefined,
    });
  }, []);

  const openMenu = () => { reposition(); setOpen(true); };

  // Reposition on scroll/resize; close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onScrollResize = () => reposition();
    const onDoc = (e) => {
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open, reposition]);

  useEffect(() => { if (open && searchRef.current) searchRef.current.focus(); }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    if (!q) return NAMES;
    return NAMES.filter((c) => c.toLowerCase().includes(q) || (qDigits && dialFor(c).includes(qDigits)));
  }, [query, NAMES]);

  const itemCount = filtered.length + 1;
  useEffect(() => { setHi(0); }, [query]);

  const choose = (c) => { setManual(false); onChange(c); setOpen(false); setQuery(''); };
  const enterManual = () => { setManual(true); onChange(''); setManualCode(''); setOpen(false); setQuery(''); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, itemCount - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (hi >= filtered.length) enterManual();
      else if (filtered[hi]) choose(filtered[hi]);
    } else if (e.key === 'Escape') { setOpen(false); }
  };

  const fieldStyle = { borderColor: 'var(--border-card)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' };

  const saveCustom = () => {
    const added = addCustomCountry(value, manualCode);
    if (!added) return;
    setCountryVersion((v) => v + 1); // refresh the dropdown list with the new country
    setManual(false);
    onChange(added);
  };

  // ── Manual entry mode ────────────────────────────────────────────────────
  if (manual) {
    const codeDigits = manualCode.replace(/\D/g, '');
    return (
      <div className={className}>
        <Input placeholder="Country name (e.g. Georgia)" value={value} onChange={(e) => onChange(e.target.value)} />
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex items-center rounded-md border px-2" style={{ borderColor: 'var(--border-card)', backgroundColor: 'var(--bg-card)' }}>
            <span className="text-sm text-ink-3">+</span>
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.replace(/\D/g, ''))}
              placeholder="995"
              inputMode="numeric"
              className="w-16 bg-transparent py-2 text-sm outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
          <button
            type="button"
            onClick={saveCustom}
            disabled={!(value || '').trim() || !codeDigits}
            className="rounded-md bg-gold-700 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50"
          >
            Save to list
          </button>
        </div>
        <p className="mt-1 text-[11px] text-ink-3">
          Enter the country name and its dial code, then “Save to list” — it’s remembered for next time.
        </p>
        <button
          type="button"
          onClick={() => { setManual(false); onChange(''); setManualCode(''); }}
          className="mt-1 text-[11px] font-semibold text-gold-700 hover:underline"
        >
          ← Choose from list instead
        </button>
      </div>
    );
  }

  // ── Searchable dropdown mode ─────────────────────────────────────────────
  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm outline-none focus:ring-2 focus:ring-gold/30"
        style={fieldStyle}
      >
        <span className={value ? '' : 'text-ink-3'}>
          {value ? (showCode ? `${value} (+${dialFor(value)})` : value) : 'Select country'}
        </span>
        <ChevronDown size={15} className="flex-shrink-0 text-ink-3" />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="overflow-hidden rounded-lg border shadow-xl"
          style={{
            position: 'fixed',
            left: pos.left,
            width: pos.width,
            top: pos.top,
            bottom: pos.bottom,
            zIndex: 9999,
            borderColor: 'var(--border-card)',
            backgroundColor: 'var(--bg-card)',
          }}
        >
          <div className="relative border-b p-2" style={{ borderColor: 'var(--border-card)' }}>
            <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search country or code…"
              className="w-full rounded-md border py-1.5 pl-8 pr-7 text-sm outline-none"
              style={fieldStyle}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-1">
                <X size={13} />
              </button>
            )}
          </div>

          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.map((c, idx) => (
              <li key={c}>
                <button
                  type="button"
                  onMouseEnter={() => setHi(idx)}
                  onClick={() => choose(c)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] ${hi === idx ? 'bg-gold-pale' : ''} ${c === value ? 'font-bold' : ''}`}
                  style={{ color: 'var(--text-primary)' }}
                >
                  <span>{c}</span>
                  <span className="text-[11px] text-ink-3">+{dialFor(c)}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-[12px] italic text-ink-3">No match — use “Other” below to type it.</li>
            )}
            <li className="border-t" style={{ borderColor: 'var(--border-card)' }}>
              <button
                type="button"
                onMouseEnter={() => setHi(filtered.length)}
                onClick={enterManual}
                className={`w-full px-3 py-1.5 text-left text-[13px] font-semibold text-gold-700 ${hi === filtered.length ? 'bg-gold-pale' : ''}`}
              >
                Other — type manually…
              </button>
            </li>
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}