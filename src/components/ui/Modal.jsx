import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, children, width = 'min-w-[340px]' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  // Render through a portal to <body> so no ancestor (sticky headers,
  // transformed elements, overflow containers) can clip the modal or let
  // page content bleed through.
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onMouseDown={onClose}
    >
      <div
        className={`relative my-auto w-full ${width} max-w-[92vw] max-h-[90vh] overflow-y-auto rounded-xl border p-6`}
        style={{
          backgroundColor: 'var(--bg-surface, #ffffff)',
          color: 'var(--text-primary)',
          borderColor: 'var(--border-card)',
          boxShadow: 'var(--shadow-lift)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
            <button
              onClick={onClose}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition hover:bg-black/10 dark:hover:bg-white/10"
              style={{ color: 'var(--text-hint)' }}
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}