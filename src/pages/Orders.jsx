import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, Eye, Pencil, Truck, FileText, Trash2, ClipboardList,
  MessageCircle, Printer, X, Check, Download, Phone, FolderOpen, RefreshCw,
} from 'lucide-react';
import { orderApi, invoiceApi, userApi } from '../api/endpoints.js';
import { useFetch } from '../hooks/useApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { apiError } from '../api/client.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import Modal from '../components/ui/Modal.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { Field, Select, Input, Textarea } from '../components/ui/Field.jsx';
import { fmtAED, fmtN, formatDate, ALL_STATUSES, ORDER_STATUSES, DELIVERY_STATUSES, cleanPhone, fmtMobile } from '../utils/format.js';
import { exportTablePdf, exportTableCsv } from '../utils/exportPdf.js';
import { buildOrderPdfBlob } from '../utils/orderPdf.js';
import {
  chooseDownloadFolder, getDownloadFolderName, clearDownloadFolder,
  savePdfBlob, folderPickerSupported,
} from '../utils/pdfSaver.js';
import { orderWhatsAppUrl } from '../utils/whatsapp.js';

// ── Amount → words (up to 9,999,999) ─────────────────────────────────────────
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function hundredsToWords(n) {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + hundredsToWords(n % 100) : '');
}
function amountToWords(amount) {
  const n = Math.round(Number(amount) || 0);
  if (n === 0) return 'Zero Only';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1_000);
  const remainder = n % 1_000;
  let result = '';
  if (millions) result += hundredsToWords(millions) + ' Million ';
  if (thousands) result += hundredsToWords(thousands) + ' Thousand ';
  if (remainder) result += hundredsToWords(remainder);
  return result.trim() + ' Only';
}

// ── Icon button helper ────────────────────────────────────────────────────────
const IconBtn = ({ icon: Icon, label, ...props }) => (
  <Button {...props}>
    <span className="flex items-center gap-1">
      <Icon size={14} className="shrink-0" />
      {label && <span>{label}</span>}
    </span>
  </Button>
);

// ── Print-only Order Form (A4, black & white, matches physical document) ──────
// Company header (logo + EN/Arabic name + contact block) is driven by the
// tenant's branding so it stays correct per company. Strictly black & white.
function PrintOrderForm({ order, branding }) {
  const b = branding || {};
  // The order form uses the receipt logo when set, otherwise the sidebar logo —
  // so the "official document" logo stays consistent with the invoice PDF.
  const logoSrc = b.receiptLogoUrl || b.logoUrl || '';
  const companyEn = b.legalName || b.headerName || 'Company Name';
  const addr = [b.addressLine1, b.addressLine2, b.city].filter(Boolean).join(', ');
  const subTotal = (order.items || []).reduce((s, it) => s + (it.qty || 0) * (it.price || 0), 0);
  const grandTotal = order.grandTotal === undefined || order.grandTotal === null ? subTotal : order.grandTotal;
  const totalQty = (order.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const totalPcs = (order.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.pieces) || 0), 0);

  return createPortal(
    <div id="print-order-form" style={{ display: 'none' }}>
      <style>{`
        /* margin:0 tells the browser to drop its own header/footer
           (date, page title "SkyUp CRM", URL, page number). Our own padding
           on #print-order-form provides the page margins instead. */
        @page { size: A4; margin: 0; }
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body > *:not(#print-order-form) { display: none !important; }
          #print-order-form {
            display: block !important;
            /* IMPORTANT: must stay in normal document flow (position:relative,
               NOT fixed/absolute) so the browser's print engine can paginate
               content taller than one page across page 2, 3, etc. A
               viewport-fixed element gets clipped to a single page instead —
               this was why orders with many items stopped after however many
               rows fit on page 1, with the rest simply never appearing. */
            position: relative;
            width: 210mm; min-height: 297mm;
            margin: 0; padding: 12mm 13mm;
            font-family: Arial, sans-serif;
            font-size: 12px; color: #000; background: #fff; box-sizing: border-box;
          }
          /* Faint, single logo watermark behind all content — centered once,
             not repeated. Grayscale + low opacity keeps it from competing
             with the (black & white) text. */
          .pof-watermark {
            position: absolute;
            top: 50%; left: 50%;
            width: 65%; aspect-ratio: 1 / 1;
            transform: translate(-50%, -50%) rotate(-28deg);
            background-image: var(--pof-wm-url);
            background-repeat: no-repeat;
            background-position: center;
            background-size: contain;
            opacity: 0.07;
            filter: grayscale(1);
            pointer-events: none;
          }
          .pof-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10mm; border-bottom: 1.5px solid #000; padding: 0 0 4mm; margin-bottom: 4mm; }
          /* flex-shrink:0 is the important part here — without it, this
             column could be squeezed narrower than its own content (the
             company name has white-space:nowrap so it can't wrap to
             compensate), and the text would overflow straight into the
             Arabic column next to it, causing the two to visually collide. */
          .pof-brand { display: flex; flex-direction: row; align-items: center; gap: 6mm; flex: 0 0 auto; max-width: 64%; }
          .pof-logo { height: 24mm; width: auto; max-width: 50mm; object-fit: contain; flex-shrink: 0; }
          .pof-logo-slot { height: 24mm; width: 42mm; border: 1px dashed #999; display: flex; align-items: center; justify-content: center; font-size: 9px; color: #999; text-transform: uppercase; letter-spacing: 1px; flex-shrink: 0; }
          .pof-brand-text { display: flex; flex-direction: column; gap: 1.5mm; min-width: 0; }
          .pof-company-en { font-size: 21px; font-weight: 900; letter-spacing: 0.4px; color: #000; text-transform: uppercase; line-height: 1.15; white-space: nowrap; }
          .pof-tagline-en { font-size: 8.5px; font-weight: 700; letter-spacing: 0.3px; color: #333; text-transform: uppercase; }
          .pof-contact-en { font-size: 10px; color: #000; line-height: 1.6; }
          /* The Arabic side takes whatever's left (min-width:0 lets it
             shrink below its content's natural width when needed) — Arabic
             text wraps safely onto extra lines, so it's the side that
             should flex, not the English name. */
          .pof-side-ar { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; align-items: flex-end; text-align: right; }
          .pof-company-ar { font-size: 16px; font-weight: 700; color: #000; margin-bottom: 1.5mm; text-align: right; line-height: 1.25; }
          .pof-address-ar { font-size: 10px; color: #000; line-height: 1.5; text-align: right; }
          .pof-title { text-align: center; font-size: 30px; font-weight: 900; letter-spacing: 4px; color: #000; text-transform: uppercase; margin: 2mm 0 4mm; }

          .pof-info { display: grid; grid-template-columns: 1.3fr 1fr 0.9fr; gap: 0; margin-bottom: 4mm; border: 1px solid #000; align-items: stretch; }
          .pof-info-col { padding: 3.5mm 4mm; border-right: 1px solid #000; display: flex; flex-direction: column; }
          .pof-info-col:last-child { border-right: none; }
          .pof-info-col-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #000; border-bottom: 1px solid #000; margin-bottom: 2.5mm; padding-bottom: 1mm; letter-spacing: 0.5px; }
          .pof-billed-name { font-size: 14px; font-weight: 900; color: #000; line-height: 1.3; text-align: left; }
          .pof-billed-city { font-size: 11.5px; color: #000; margin-top: 1mm; line-height: 1.4; text-align: left; }
          .pof-info-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1.5mm; font-size: 11px; }
          .pof-info-key { color: #333; text-align: left; }
          .pof-info-val { font-weight: 700; color: #000; text-align: right; }
          .pof-info-val.accent, .pof-info-val.blue { color: #000; }

          .pof-table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; table-layout: fixed; }
          .pof-table thead tr { background: #000; color: #fff; }
          .pof-table thead th { padding: 1.6mm 1.8mm; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.2px; border: 1px solid #000; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .pof-table thead th:last-child, .pof-table thead th:nth-last-child(2) { text-align: right; }
          .pof-table tbody td { padding: 1.6mm 1.8mm; font-size: 10px; border: 1px solid #000; overflow: hidden; text-overflow: ellipsis; word-break: break-word; }
          .pof-table tbody td:last-child, .pof-table tbody td:nth-last-child(2) { text-align: right; }
          .pof-table tbody td.bold { font-weight: 700; }
          .pof-table tfoot td { padding: 1.6mm 1.8mm; font-size: 10px; font-weight: 700; border: 1px solid #000; background: #ececec; }
          .pof-table tfoot td.bold { font-weight: 700; }
          .pof-col-total-label { text-align: right; text-transform: uppercase; letter-spacing: 0.3px; }
          /* Narrow columns get a fixed share so Description/Art No keep most of the
             width — and there's still headroom to add more columns later. */
          .pof-col-sno   { width: 6%; }
          .pof-col-art   { width: 13%; }
          .pof-col-desc  { width: 27%; }
          .pof-col-size  { width: 10%; }
          .pof-col-pcs   { width: 8%; }
          .pof-col-qty   { width: 8%; }
          .pof-col-price { width: 13%; }
          .pof-col-amt   { width: 15%; }

          /* Words (left) + totals (right) sit in ONE row so there's no big empty
             gap to the left of the totals box. */
          .pof-summary { display: flex; align-items: stretch; gap: 6mm; margin-bottom: 4mm; }
          .pof-words-box { flex: 1; border: 1px solid #000; padding: 3mm 4mm; background: #fff; }
          .pof-words-label { font-size: 10px; color: #333; text-transform: uppercase; font-weight: 700; margin-bottom: 1.5mm; }
          .pof-words-val { font-size: 14px; font-weight: 700; color: #000; text-transform: uppercase; }
          .pof-totals { flex-shrink: 0; }
          .pof-totals-box { width: 72mm; border: 1px solid #000; }
          .pof-totals-row { display: flex; justify-content: space-between; padding: 2.5mm 4mm; border-bottom: 1px solid #000; font-size: 13px; }
          .pof-totals-row:last-child { border-bottom: none; background: #000; color: #fff; font-size: 16px; font-weight: 900; }
          .pof-totals-row.grand .pof-tr-val { color: #fff; }

          .pof-terms { border: 1px solid #000; padding: 3.5mm 4mm; margin-bottom: 4mm; }
          .pof-terms-title { font-size: 12px; font-weight: 700; margin-bottom: 2mm; color: #000; }
          .pof-terms ol { margin: 0; padding-left: 5mm; list-style: disc; }
          .pof-terms li { font-size: 11px; color: #000; margin-bottom: 1mm; }
          .pof-terms-note { font-size: 11px; color: #000; margin-top: 1mm; font-weight: 700; }

          .pof-delivery { font-size: 12px; color: #000; margin-bottom: 3mm; }
          .pof-delivery b { color: #000; }

          .pof-sign-row { display: flex; justify-content: space-between; margin-top: 16mm; }
          .pof-sign-box { width: 45%; border-top: 1px solid #000; padding-top: 2mm; font-size: 12px; font-weight: 700; color: #000; text-align: center; }
        }
      `}</style>

      {/* ── Watermark: faint, repeated company logo behind everything ────── */}
      {logoSrc && (
        <div className="pof-watermark" style={{ '--pof-wm-url': `url("${logoSrc}")` }} />
      )}

      {/* ── Company header (branding-driven, EN + Arabic) ───────────────────── */}
      <div className="pof-header">
        <div className="pof-brand">
          {logoSrc
            ? <img className="pof-logo" src={logoSrc} alt="" />
            : <div className="pof-logo-slot">Logo</div>}
          <div className="pof-brand-text">
            <div className="pof-company-en">{companyEn}</div>
            {b.headerTagline ? <div className="pof-tagline-en">{b.headerTagline}</div> : null}
            {/* All English contact details get their own full-width column —
                previously these shared a single narrow right-hand column with
                the Arabic text, which is what caused everything to wrap/squeeze. */}
            <div className="pof-contact-en">
              {addr ? <div>{addr}</div> : null}
              {b.phone ? <div>Tel: {b.phone}</div> : null}
              {b.email ? <div>Email: {b.email}</div> : null}
              {b.website ? <div>{b.website}</div> : null}
              {b.trn ? <div>TRN: {b.trn}</div> : null}
            </div>
          </div>
        </div>
        <div className="pof-side-ar">
          {b.legalNameAr ? <div className="pof-company-ar" dir="rtl">{b.legalNameAr}</div> : null}
          {b.addressAr ? <div className="pof-address-ar" dir="rtl">{b.addressAr}</div> : null}
        </div>
      </div>
      <div className="pof-title">Order Form</div>

      {/* ── Three-column info block ─────────────────────────────────────────── */}
      <div className="pof-info">
        {/* Col 1 — Billed To */}
        <div className="pof-info-col">
          <div className="pof-info-col-label">Billed To</div>
          <div className="pof-billed-name">{order.customer}</div>
          {order.city && <div className="pof-billed-city">{order.city}{order.country ? `, ${order.country}` : ''}</div>}
          {order.mobile && <div className="pof-billed-city" style={{ marginTop: '2mm' }}>{fmtMobile(order.mobile, order.country)}</div>}
        </div>
        {/* Col 2 — Order Details */}
        <div className="pof-info-col">
          <div className="pof-info-col-label">Order Details</div>
          <div className="pof-info-row"><span className="pof-info-key">Sales Order #:</span><span className="pof-info-val">{order.orderNo}</span></div>
          <div className="pof-info-row"><span className="pof-info-key">Order Date:</span><span className="pof-info-val">{formatDate(order.date)}</span></div>
          <div className="pof-info-row"><span className="pof-info-key">Salesperson:</span><span className="pof-info-val">{order.salespersonName || '—'}</span></div>
          <div className="pof-info-row"><span className="pof-info-key">Status:</span><span className="pof-info-val accent">{order.status}</span></div>
        </div>
        {/* Col 3 — Payment Record */}
        <div className="pof-info-col">
          <div className="pof-info-col-label">Payment Record</div>
          <div className="pof-info-row"><span className="pof-info-key">Payment:</span><span className="pof-info-val accent">{order.payTerms}</span></div>
          <div className="pof-info-row"><span className="pof-info-key">Status:</span><span className="pof-info-val accent">{order.due > 0 ? 'Pending' : 'Paid'}</span></div>
          <div className="pof-info-row"><span className="pof-info-key">Due Amount:</span><span className="pof-info-val blue">{fmtAED(order.due || 0)}</span></div>
        </div>
      </div>

      {/* ── Items table (S.No | Art No | Description | Size | Pcs | Qty | Price | Amount) ── */}
      <table className="pof-table">
        <thead>
          <tr>
            {[
              ['S.No.', 'pof-col-sno'], ['Art No.', 'pof-col-art'], ['Description', 'pof-col-desc'],
              ['Size', 'pof-col-size'], ['Pcs', 'pof-col-pcs'], ['Qty', 'pof-col-qty'],
              ['Price', 'pof-col-price'], ['Amount', 'pof-col-amt'],
            ].map(([h, cls]) => (
              <th key={h} className={cls}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(order.items || []).filter((it) => (it.modelCode || '').trim()).map((it, i) => (
            <tr key={i}>
              <td className="pof-col-sno">{i + 1}</td>
              <td className="pof-col-art bold">{it.modelCode}</td>
              <td className="pof-col-desc">{it.description || '—'}</td>
              <td className="pof-col-size">{it.size || '—'}</td>
              <td className="pof-col-pcs">{it.pieces || 0}</td>
              <td className="pof-col-qty">{it.qty}</td>
              <td className="pof-col-price">{fmtN(it.price)}</td>
              <td className="pof-col-amt bold">{fmtN((it.qty || 0) * (it.price || 0))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pof-col-total-label" colSpan={4}>TOTAL</td>
            <td className="pof-col-pcs bold">{totalPcs}</td>
            <td className="pof-col-qty bold">{totalQty}</td>
            <td className="pof-col-price" />
            <td className="pof-col-amt" />
          </tr>
        </tfoot>
      </table>

      {/* ── Amount in words (left) + totals (right) in ONE row ─────────────── */}
      <div className="pof-summary">
        <div className="pof-words-box">
          <div className="pof-words-label">Order Total in Words</div>
          <div className="pof-words-val">{amountToWords(grandTotal)}</div>
        </div>
        <div className="pof-totals">
          <div className="pof-totals-box">
            <div className="pof-totals-row">
              <span className="pof-tr-key">Sub Total</span>
              <span className="pof-tr-val">{fmtAED(subTotal)}</span>
            </div>
            {order.discount > 0 && (
              <div className="pof-totals-row">
                <span className="pof-tr-key">Discount ({order.discount}%)</span>
                <span className="pof-tr-val">−{fmtAED(subTotal * order.discount / 100)}</span>
              </div>
            )}
            <div className="pof-totals-row grand">
              <span className="pof-tr-key">Grand Total</span>
              <span className="pof-tr-val">{fmtAED(grandTotal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Terms ──────────────────────────────────────────────────────────── */}
      <div className="pof-terms">
        <div className="pof-terms-title">TERMS :</div>
        <ol>
          <li>Any alteration in bill, old sale terms, buyer is not allowed.</li>
          <li>Goods once sold will not be taken back or exchange after 4 days.</li>
          <li>Cartons with shortage will not be taken back.</li>
          <li>Delivery will be made within 1–2 days after confirm the order.</li>
          <li>Check goods received in perfect sound condition at the time of the delivery.</li>
        </ol>
        <div className="pof-terms-note">WE ARE NOT RESPONSIBLE FOR ANY DAMAGE OR SHORTAGE OF THE GOODS EXPORTED OUT OF UAE.</div>
      </div>

      {/* ── Delivery details ───────────────────────────────────────────────── */}
      <div className="pof-delivery">
        {order.delivery && <div><b>Delivery Details:</b> {order.delivery}</div>}
        <div style={{ marginTop: '1mm' }}><b>Delivery Contact No.:</b> {order.deliveryContact || '—'}</div>
        {order.notes && <div style={{ marginTop: '1mm' }}><b>Notes:</b> {order.notes}</div>}
      </div>

      {/* ── Signature row ──────────────────────────────────────────────────── */}
      <div className="pof-sign-row">
        <div className="pof-sign-box">Customer Signature</div>
        <div className="pof-sign-box">For {companyEn}</div>
      </div>
    </div>,
    document.body
  );
}

// ── Main Orders page ──────────────────────────────────────────────────────────
export default function Orders() {
  const navigate = useNavigate();
  const { isAdmin, branding } = useAuth();
  const { show } = useToast();
  const [params] = useSearchParams();
  const { data: orders, loading, error, refetch } = useFetch(() => orderApi.list(), []);
  const { data: users } = useFetch(() => (isAdmin ? userApi.list() : Promise.resolve([])), [isAdmin]);

  const [f, setF] = useState({ search: '', phone: '', status: params.get('status') || '', country: '', employee: '', from: '', to: '' });
  const [statusModal, setStatusModal] = useState(null);
  const [statusForm, setStatusForm] = useState({ status: 'Confirmed', note: '' });
  const [viewOrder, setViewOrder] = useState(null);
  const [printOrder, setPrintOrder] = useState(null);

  useEffect(() => { const s = params.get('status'); if (s) setF((p) => ({ ...p, status: s })); }, [params]);
  useEffect(() => { if (error) show(error, 'error'); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const countries = useMemo(() => [...new Set((orders || []).map((o) => o.country))].sort(), [orders]);

  const filtered = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => {
      if (f.status && o.status !== f.status) return false;
      if (f.country && o.country !== f.country) return false;
      if (f.employee && String(o.salesperson) !== String(f.employee)) return false;
      if (f.phone) {
        let q = f.phone.replace(/\D/g, '');
        if (q.startsWith('00')) q = q.slice(2); // strip international 00 prefix
        if (q) {
          const full = cleanPhone(o.mobile, o.country);              // dial code + local, e.g. 971501234567
          const bare = String(o.mobile || '').replace(/\D/g, '');    // as stored
          const bareNoZero = bare.replace(/^0+/, '');                // local without leading 0
          if (!full.includes(q) && !bare.includes(q) && !bareNoZero.includes(q)) return false;
        }
      }
      if (f.from && new Date(o.date) < new Date(f.from)) return false;
      if (f.to && new Date(o.date) > new Date(f.to + 'T23:59:59')) return false;
      if (f.search) {
        const q = f.search.toLowerCase();
        if (!(`${o.orderNo}`.includes(q) || o.customer.toLowerCase().includes(q) || (o.city || '').toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [orders, f]);

  // Same delivery stages tracked in the Delivery Tracker page — read the
  // real current stage from the status log rather than guessing it.
  // Invoiced orders are always at least 'Confirmed' (matches the Tracker).
  const STEP_KEYS = ['Pending', 'Confirmed', 'Market Delay', 'Packed',  'Out for Delivery', 'Delivered'];
  const currentStageOf = (o) => {
    const hits = (o.statusHistory || []).filter((h) => STEP_KEYS.includes(h.status));
    let stage = 'Pending';
    if (hits.length) {
      const sorted = [...hits].sort((a, b) => new Date(b.at) - new Date(a.at));
      stage = sorted[0].status;
    }
    const invoiced = o.status === 'Invoiced' || o.invoiceId;
    if (invoiced && STEP_KEYS.indexOf(stage) < STEP_KEYS.indexOf('Confirmed')) stage = 'Confirmed';
    return stage;
  };

  const openStatus = (o) => {
    const stage = currentStageOf(o);
    const status = o.status === 'Invoiced' && !DELIVERY_STATUSES.includes(stage) ? DELIVERY_STATUSES[0] : stage;
    setStatusForm({ status, note: '' });
    setStatusModal(o);
  };

  const saveStatus = async () => {
    try {
      await orderApi.setStatus(statusModal._id, statusForm);
      show('Status updated.', 'success');
      setStatusModal(null);
      refetch();
    } catch (e) { show(apiError(e), 'error'); }
  };

  // ── PDF download + shared save-folder ──────────────────────────────────────
  const [pdfFolder, setPdfFolder] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(null);
  useEffect(() => { getDownloadFolderName().then(setPdfFolder); }, []);

  const setFolder = async () => {
    try {
      const name = await chooseDownloadFolder();
      setPdfFolder(name);
      show(`PDFs (order forms & invoices) will be saved to "${name}".`, 'success');
    } catch (e) {
      if (e?.name !== 'AbortError') show(e.message || 'Could not set the folder.', 'error');
    }
  };
  const unsetFolder = async () => {
    await clearDownloadFolder();
    setPdfFolder(null);
    show('Save folder cleared — PDFs will use normal browser downloads.');
  };
  const downloadOrderPdf = async (o) => {
    setPdfBusy(o._id);
    try {
      const { blob, filename } = await buildOrderPdfBlob(o, branding);
      const saved = await savePdfBlob(blob, filename);
      show(saved.via === 'folder' ? `${filename} saved to "${saved.folder}".` : `${filename} downloaded.`, 'success');
    } catch (e) { show(e.message || 'Could not generate the PDF.', 'error'); }
    finally { setPdfBusy(null); }
  };

  const convert = async (o) => {
    if (o.status === 'Invoiced' || o.invoiceId) {
      show(`Order #${o.orderNo} is already invoiced — only one invoice can be created per order.`, 'error');
      return;
    }
    if (!confirm(`Convert order #${o.orderNo} to a tax invoice?`)) return;
    try {
      const inv = await invoiceApi.fromOrder(o._id);
      show(`Invoice #${inv.invoiceNo} created.`, 'success');
      refetch();
    } catch (e) { show(apiError(e), 'error'); }
  };

  const del = async (o) => {
    if (!confirm(`Delete order #${o.orderNo}? This cannot be undone.`)) return;
    try { await orderApi.remove(o._id); show('Order deleted.'); refetch(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  const handlePrint = (o) => {
    setPrintOrder(o);
    setTimeout(() => window.print(), 250);
  };

  const [exporting, setExporting] = useState(false);
  const fmt2 = (n) => Number(n || 0).toFixed(2);
  const buildExport = () => {
    const empMatch = f.employee ? (users || []).find((u) => String(u.id || u._id) === String(f.employee)) : null;
    const empName = f.employee ? (empMatch ? empMatch.name : undefined) : 'All';
    // One row per item for full item detail
    const rows = [];
    filtered.forEach((o, idx) => {
      const items = o.items || [];
      if (!items.length) {
        rows.push([idx + 1, `#${o.orderNo}`, formatDate(o.date), o.customer,
          fmtMobile(o.mobile, o.country) || '—', o.city || '—', o.country,
          o.salespersonName || '—', o.payTerms || '—', o.status,
          '—', '—', '—', '—', '', '', fmt2(o.grandTotal), fmt2(o.due || 0)]);
      } else {
        items.forEach((it, iIdx) => {
          const lineAmt = fmt2((it.qty || 0) * (it.price || it.rate || 0));
          rows.push([
            iIdx === 0 ? idx + 1 : '',
            iIdx === 0 ? `#${o.orderNo}` : '',
            iIdx === 0 ? formatDate(o.date) : '',
            iIdx === 0 ? o.customer : '',
            iIdx === 0 ? (fmtMobile(o.mobile, o.country) || '—') : '',
            iIdx === 0 ? (o.city || '—') : '',
            iIdx === 0 ? o.country : '',
            iIdx === 0 ? (o.salespersonName || '—') : '',
            iIdx === 0 ? (o.payTerms || '—') : '',
            iIdx === 0 ? o.status : '',
            it.description || it.name || '—',
            it.size || '—',
            it.color || '—',
            it.qty ?? '',
            lineAmt,
            iIdx === 0 ? fmt2(o.grandTotal) : '',
            iIdx === 0 ? fmt2(o.due || 0) : '',
          ]);
        });
      }
    });
    return {
      title: 'Orders Report',
      columns: ['Sl. No', 'Order #', 'Date', 'Customer', 'Mobile', 'City', 'Country',
        'Salesperson', 'Pay Terms', 'Status',
        'Description', 'Size', 'Color', 'Qty', 'Line Amt (AED)',
        'Order Total (AED)', 'Due (AED)'],
      rows,
      meta: {
        Employee: empName || 'All',
        Records: filtered.length,
        'Total Value (AED)': fmt2(filtered.reduce((s, o) => s + (o.grandTotal || 0), 0)),
      },
    };
  };
  const exportPdf = async () => {
    setExporting(true);
    try {
      await exportTablePdf(buildExport());
    } catch (e) { show(e.message || 'Export failed. Check your connection.', 'error'); }
    finally { setExporting(false); }
  };
  const exportCsv = () => {
    try { exportTableCsv(buildExport()); }
    catch (e) { show(e.message || 'CSV export failed.', 'error'); }
  };

  if (loading) return <Spinner label="Loading orders…" />;

  return (
    <>
      {/* Hidden print form — rendered but invisible until window.print() */}
      {printOrder && <PrintOrderForm order={printOrder} branding={branding} />}

      <PageTitle icon={<ClipboardList size={18} />} badge={filtered.length}
        actions={<IconBtn icon={Plus} label="New Order" onClick={() => navigate('/orders/new')} />}>
        {f.status ? `${f.status} Orders` : 'All Orders'}
      </PageTitle>

      <div
        className="mb-3.5 flex flex-wrap items-center gap-2 rounded-lg border p-2.5"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      >
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input className="!w-52 !pl-8" placeholder="Search order / customer…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        </div>
        <div className="relative">
          <Phone size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input className="!w-44 !pl-8" placeholder="Phone number…" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </div>
        <Select className="!w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">All Status</option>{ALL_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select className="!w-auto" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
          <option value="">All Countries</option>{countries.map((c) => <option key={c}>{c}</option>)}
        </Select>
        {isAdmin && (
          <Select className="!w-auto" value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })}>
            <option value="">All Employees</option>
            {(users || []).map((u) => <option key={u.id || u._id} value={u.id || u._id}>{u.name}</option>)}
          </Select>
        )}
        <Input className="!w-auto" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input className="!w-auto" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setF({ search: '', phone: '', status: '', country: '', employee: '', from: '', to: '' })}>Clear</Button>
        <Button
          variant="outline" size="sm" onClick={setFolder}
          title={folderPickerSupported()
            ? 'Choose one folder where every downloaded order form & invoice PDF is saved'
            : 'Folder picking needs Chrome/Edge on desktop — PDFs go to the browser Downloads folder'}
        >
          <span className="flex items-center gap-1.5">
            <FolderOpen size={13} />{pdfFolder ? `Save to: ${pdfFolder}` : 'Set PDF Folder'}
          </span>
        </Button>
        {pdfFolder && (
          <button onClick={unsetFolder} title="Clear save folder"
            className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/[0.06]"
            style={{ color: 'var(--text-muted)' }}>
            <X size={12} />
          </button>
        )}
        {isAdmin && (
          <Button variant="outline" size="sm" disabled={!filtered.length} onClick={exportCsv}>
            <span className="flex items-center gap-1.5"><Download size={13} />Export CSV</span>
          </Button>
        )}
        {isAdmin && (
          <Button variant="dark" size="sm" disabled={exporting || !filtered.length} onClick={exportPdf}>
            <span className="flex items-center gap-1.5"><Download size={13} />{exporting ? 'Exporting…' : 'Export PDF'}</span>
          </Button>
        )}
      </div>

      <div className="mb-3.5 flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
        <span>
          Total {f.status || 'Orders'}: <strong style={{ color: 'var(--text-primary)' }}>{filtered.length}</strong>
        </span>
        <span>·</span>
        <span>
          Value: <strong style={{ color: 'var(--text-primary)' }}>{fmtAED(filtered.reduce((s, o) => s + (o.grandTotal || 0), 0))}</strong>
        </span>
      </div>

      <Card className="overflow-x-auto">
        {error ? (
          <EmptyState title="Couldn't load orders" hint={error}
            action={<IconBtn icon={RefreshCw} label="Retry" onClick={refetch} />} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No orders match" hint="Try clearing filters or create a new order."
            action={<IconBtn icon={Plus} label="New Order" onClick={() => navigate('/orders/new')} />} />
        ) : (
          <table className="w-full min-w-[820px] border-collapse">
            <thead><tr className="bg-navy-800 text-white">
              <th className="px-2.5 py-2 text-center text-[11px] font-bold uppercase tracking-wide">Sl. No</th>
              <th className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide">Order #</th>
              <th className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide">Date</th>
              <th className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide">Customer</th>
              <th className="px-2.5 py-2 text-center text-[11px] font-bold uppercase tracking-wide">Country</th>
              <th className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide">Salesperson</th>
              <th className="px-2.5 py-2 text-center text-[11px] font-bold uppercase tracking-wide">Items / Qty</th>
              <th className="px-2.5 py-2 text-right text-[11px] font-bold uppercase tracking-wide">Amount (AED)</th>
              <th className="px-2.5 py-2 text-center text-[11px] font-bold uppercase tracking-wide">Status</th>
              <th className="px-2.5 py-2 text-center text-[11px] font-bold uppercase tracking-wide">Actions</th>
            </tr></thead>
            <tbody>
              {filtered.map((o, idx) => (
                <tr key={o._id} className="border-b border-gray-100 align-middle last:border-0 hover:bg-gold-pale">
                  <td className="px-2.5 py-2 text-center text-xs tabular-nums text-ink-3">{idx + 1}</td>
                  <td className="px-2.5 py-2 text-xs font-bold tabular-nums">#{o.orderNo}</td>
                  <td className="px-2.5 py-2 text-xs whitespace-nowrap">{formatDate(o.date)}</td>
                  <td className="px-2.5 py-2 text-xs">
                    <div className="font-medium">{o.customer}</div>
                    <div className="text-[10px] text-ink-3">{o.city}</div>
                  </td>
                  <td className="px-2.5 py-2 text-center text-xs">{o.country}</td>
                  <td className="px-2.5 py-2 text-xs">{o.salespersonName || '—'}</td>
                  <td className="px-2.5 py-2 text-center text-xs tabular-nums">
                    {(o.items || []).length}
                    <div className="text-[10px] text-ink-3">Qty: {(o.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0)}</div>
                  </td>
                  <td className="px-2.5 py-2 text-right text-xs font-bold tabular-nums text-navy-700 whitespace-nowrap">{fmtAED(o.grandTotal)}</td>
                  <td className="px-2.5 py-2 text-center"><StatusBadge status={o.status} /></td>
                  <td className="px-2.5 py-2">
                    <div className="flex flex-nowrap items-center justify-center gap-1">
                      <IconBtn icon={Eye}      size="sm" variant="outline" title="View"    onClick={() => setViewOrder(o)} />
                      <IconBtn icon={Pencil}   size="sm" variant="gold"    title="Edit"    onClick={() => navigate(`/orders/${o._id}/edit`)} />
                      <IconBtn icon={Truck}    size="sm" variant="blue"    title="Update Status" onClick={() => openStatus(o)} />
                      <a className="btn-green btn-sm flex items-center justify-center" title="WhatsApp" href={orderWhatsAppUrl(o)} target="_blank" rel="noreferrer">
                        <MessageCircle size={14} />
                      </a>
                      <IconBtn icon={Download} size="sm" variant="outline" title={pdfBusy === o._id ? 'Preparing PDF…' : 'Download PDF'} disabled={pdfBusy === o._id} onClick={() => downloadOrderPdf(o)} />
                      {o.status !== 'Cancelled' && o.status !== 'Invoiced' && !o.invoiceId && <IconBtn icon={FileText} size="sm" variant="outline" title="Convert to Invoice" onClick={() => convert(o)} />}
                      {isAdmin && <IconBtn icon={Trash2} size="sm" variant="red" title="Delete" onClick={() => del(o)} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ── Order detail modal ───────────────────────────────────────────────── */}
      <Modal open={!!viewOrder} onClose={() => setViewOrder(null)}
        title={viewOrder ? `Order #${viewOrder.orderNo} — ${viewOrder.customer}` : ''} width="min-w-[600px]">
        {viewOrder && (
          <>
            <div className="grid grid-cols-3 gap-y-2 gap-x-4 text-[13px]">
              <div><span className="font-bold text-navy">Date:</span> {formatDate(viewOrder.date)}</div>
              <div><span className="font-bold text-navy">Country:</span> {viewOrder.country}</div>
              <div><span className="font-bold text-navy">Status:</span> <StatusBadge status={viewOrder.status} /></div>
              <div><span className="font-bold text-navy">Salesperson:</span> {viewOrder.salespersonName || '—'}</div>
              <div><span className="font-bold text-navy">Payment:</span> {viewOrder.payTerms}</div>
              <div><span className="font-bold text-navy">Due:</span> {fmtAED(viewOrder.due || 0)}</div>
              <div><span className="font-bold text-navy">Delivery Contact:</span> {viewOrder.deliveryContact || '—'}</div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full border-collapse text-[12px]">
                <thead><tr className="bg-navy-800 text-white">
                  {['#', 'Art No', 'Desc', 'Size', 'Pcs', 'Qty', 'Price', 'Amount'].map((h) => (
                    <th key={h} className="px-2.5 py-1.5 text-left font-bold uppercase tracking-wide">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {(viewOrder.items || []).map((it, i) => (
                    <tr key={i} className="border-b border-gray-100 last:border-0">
                      <td className="px-2.5 py-1.5">{i + 1}</td>
                      <td className="px-2.5 py-1.5 font-bold">{it.modelCode}</td>
                      <td className="px-2.5 py-1.5">{it.description || '—'}</td>
                      <td className="px-2.5 py-1.5">{it.size || '—'}</td>
                      <td className="px-2.5 py-1.5">{it.pieces || 0}</td>
                      <td className="px-2.5 py-1.5">{it.qty}</td>
                      <td className="px-2.5 py-1.5">{fmtN(it.price)}</td>
                      <td className="px-2.5 py-1.5 text-right font-bold">{fmtN(it.qty * it.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-right text-[13px]">
              <div style={{ color: 'var(--text-muted)' }}>Sub Total: <strong style={{ color: 'var(--text-primary)' }}>{fmtAED(viewOrder.subTotal)}</strong></div>
              {viewOrder.discount > 0 && <div style={{ color: 'var(--text-muted)' }}>Discount ({viewOrder.discount}%): <strong className="text-danger">−{fmtAED((viewOrder.subTotal || 0) * viewOrder.discount / 100)}</strong></div>}
              <div className="mt-1 text-lg font-black text-navy">Grand Total: {fmtAED(viewOrder.grandTotal)}</div>
            </div>

            <p className="mt-2 text-[11px]" style={{ color: 'var(--text-hint)' }}>Created {formatDate(viewOrder.createdAt)}</p>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setViewOrder(null)}>
                <span className="flex items-center gap-1"><X size={14} /> Close</span>
              </Button>
              <Button variant="dark" onClick={() => { setViewOrder(null); handlePrint(viewOrder); }}>
                <span className="flex items-center gap-1"><Printer size={14} /> Print Order Form</span>
              </Button>
              <Button variant="outline" disabled={pdfBusy === viewOrder._id} onClick={() => downloadOrderPdf(viewOrder)}>
                <span className="flex items-center gap-1"><Download size={14} /> Download PDF</span>
              </Button>
              <a className="btn-green btn flex items-center gap-1" href={orderWhatsAppUrl(viewOrder)} target="_blank" rel="noreferrer">
                <MessageCircle size={14} /> WhatsApp
              </a>
              {viewOrder.status !== 'Invoiced' && (
                <Button onClick={() => { const id = viewOrder._id; setViewOrder(null); navigate(`/orders/${id}/edit`); }}>
                  <span className="flex items-center gap-1"><Pencil size={14} /> Edit</span>
                </Button>
              )}
            </div>
          </>
        )}
      </Modal>

      {/* ── Status update modal ──────────────────────────────────────────────── */}
      <Modal open={!!statusModal} onClose={() => setStatusModal(null)}
        title={<span className="flex items-center gap-1.5"><Truck size={16} /> Update Delivery Status</span>} width="max-w-[380px]">
        {statusModal && (
          <>
            <p className="mb-3 text-[13px]" style={{ color: 'var(--text-muted)' }}>Order <strong>#{statusModal.orderNo}</strong> · {statusModal.customer}</p>
            {statusModal.status === 'Invoiced' && (
              <p className="mb-3 text-[11px]" style={{ color: 'var(--text-hint)' }}>This order is already invoiced — you can still update its delivery stage.</p>
            )}
            <Field label="New Status">
              <Select value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })}>
                {(statusModal.status === 'Invoiced' ? DELIVERY_STATUSES : ORDER_STATUSES).map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <div className="mt-3"><Field label="Delivery Note (optional)">
              <Textarea rows={2} value={statusForm.note} placeholder="e.g. Delivered via HURIA TRANSPORT"
                onChange={(e) => setStatusForm({ ...statusForm, note: e.target.value })} />
            </Field></div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStatusModal(null)}>Cancel</Button>
              <Button variant="green" onClick={saveStatus}>
                <span className="flex items-center gap-1"><Check size={14} /> Update Status</span>
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}