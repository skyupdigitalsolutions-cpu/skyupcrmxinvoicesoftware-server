import { Plus, Trash2 } from 'lucide-react';
import { fmtN } from '../utils/format.js';

// Product categories replace the old free-text description + brand fields.
const CATEGORIES = [
  'Men Shoes',
  'Ladies Shoes',
  'Kids Shoes',
  'Mens Slipper',
  'Ladies Slipper',
  'Kids Slipper',
];

// `description` keeps its field name so orders/invoices/PDF stay compatible —
// it now holds the selected category instead of free text. `brand` is dropped.
const blankItem = () => ({ modelCode: '', description: '', size: '', unit: 'PAIR', qty: 1, pieces: 0, price: 0 });

// Standard footwear size ranges — shown as a dropdown on each item row.
const SIZES = ['16to20', '20-25', '25-30', '31-36', '36-40', '40-45', '44-48'];

// Common pieces-per-box values for footwear cartons (used as datalist hints).
const PCS_PER_BOX = [12, 24, 36, 60, 72];

// Reusable line-item editor used by both the order form and invoice editing.
// Controlled: parent owns `items`; this calls onChange with the next array.
export default function OrderItemsEditor({ items, onChange, currency = 'DHS', compact = false }) {
  const update = (i, patch) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const add = () => onChange([...items, blankItem()]);
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));

  const cols = compact
    ? 'grid-cols-[26px_1.2fr_1.1fr_78px_70px_72px_84px_92px_34px]'
    : 'grid-cols-[34px_1.3fr_1.2fr_90px_70px_84px_96px_110px_40px]';
  const minW = compact ? 'min-w-[760px]' : 'min-w-[840px]';

  const Head = ({ children, align = 'text-left' }) => (
    <span className={`${align} text-[10px] font-black uppercase tracking-wide text-white`}>{children}</span>
  );

  return (
    <div>
      <div className="overflow-x-auto">
        <div className={minW}>
          {/* Header */}
          <div className={`grid ${cols} items-center gap-2 rounded-t-lg bg-gradient-to-r from-gold to-gold-light px-3 py-2.5`}>
            <Head align="text-center">#</Head>
            <Head>Article No.</Head>
            <Head>Description</Head>
            <Head>Size</Head>
            <Head align="text-center">Qty</Head>
            <Head align="text-center">Pieces</Head>
            <Head align="text-right">Rate</Head>
            <Head align="text-right">Amount</Head>
            <span />
          </div>

          {/* Rows */}
          <div className="rounded-b-lg border border-t-0" style={{ borderColor: 'var(--border-card)' }}>
            {items.map((it, i) => {
              const legacy = it.description && !CATEGORIES.includes(it.description);
              return (
                <div
                  key={i}
                  className={`grid ${cols} items-center gap-2 border-b px-3 py-2 transition-colors odd:bg-black/[0.015] hover:bg-gold-pale`}
                  style={{ borderColor: 'var(--border-card)' }}
                >
                  <span className="flex h-6 w-6 items-center justify-center justify-self-center rounded-full bg-navy text-[11px] font-bold text-white">
                    {i + 1}
                  </span>

                  <input
                    className="li"
                    value={it.modelCode}
                    placeholder="e.g. SS-4421"
                    onChange={(e) => update(i, { modelCode: e.target.value })}
                  />

                  <select
                    className="li"
                    value={it.description || ''}
                    onChange={(e) => update(i, { description: e.target.value })}
                    style={{ color: it.description ? 'var(--text-primary)' : 'var(--text-muted, #9aa1ab)' }}
                  >
                    <option value="">Select category…</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    {legacy && <option value={it.description}>{it.description}</option>}
                  </select>

                  <select
                    className="li"
                    value={it.size || ''}
                    onChange={(e) => update(i, { size: e.target.value })}
                    style={{ color: it.size ? 'var(--text-primary)' : 'var(--text-muted, #9aa1ab)' }}
                  >
                    <option value="">Select size…</option>
                    {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                    {it.size && !SIZES.includes(it.size) && <option value={it.size}>{it.size}</option>}
                  </select>

                  <input
                    className="li text-center"
                    type="number"
                    min="0"
                    value={it.qty}
                    onChange={(e) => update(i, { qty: Number(e.target.value) })}
                  />

                  <input
                    className="li text-center"
                    type="number"
                    min="0"
                    list="pcs-per-box"
                    placeholder="pcs/box"
                    value={it.pieces || 0}
                    onChange={(e) => update(i, { pieces: Number(e.target.value) })}
                  />

                  <input
                    className="li text-right"
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.price}
                    onChange={(e) => update(i, { price: Number(e.target.value) })}
                  />

                  <div
                    className="rounded-md border px-2 py-1.5 text-right text-[12px] font-bold"
                    style={{ borderColor: 'var(--border-card)', backgroundColor: 'var(--bg-card-head)', color: 'var(--text-primary)' }}
                  >
                    {fmtN((it.qty || 0) * (it.price || 0))}
                  </div>

                  <button
                    type="button"
                    onClick={() => remove(i)}
                    title="Remove item"
                    disabled={items.length === 1}
                    className="flex h-7 w-7 items-center justify-center justify-self-center rounded-md text-gray-300 transition hover:bg-danger/10 hover:text-danger disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-300"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-gold bg-gold-pale py-2 text-xs font-bold text-navy-700 transition hover:bg-gold-light"
      >
        <Plus size={15} /> Add Item
      </button>

      <style>{`.li{border:1px solid var(--input-border,#ddd);border-radius:6px;padding:6px 8px;font-size:12px;width:100%;outline:none;background:var(--bg-card,#fff);color:var(--text-primary,#111);transition:border-color .15s,box-shadow .15s}.li:focus{border-color:#C9A227;box-shadow:0 0 0 3px rgba(201,162,39,.15)}`}</style>

      <datalist id="pcs-per-box">
        {PCS_PER_BOX.map((n) => <option key={n} value={n} />)}
      </datalist>
    </div>
  );
}

export { blankItem, CATEGORIES, SIZES };