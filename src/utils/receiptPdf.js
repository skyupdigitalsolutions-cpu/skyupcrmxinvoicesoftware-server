// receiptPdf.js — Receipt Voucher (سند قبض)
// Reproduces the company's printed receipt-book voucher on a single full A4
// PORTRAIT page — the same page size and margins as the Invoice and Order Form
// PDFs. Layout, labels, boxes and dotted lines follow the paper original; only
// the company name (English + Arabic) is replaced.
//
// Arabic labels are drawn with the browser's canvas (which shapes and joins
// Arabic correctly) and embedded as images, because jsPDF's built-in fonts have
// no Arabic glyphs.

import { RECEIPT_TEMPLATE as VOUCHER } from './receiptTemplate.js';

const CDN_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
let _loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const ex = document.querySelector(`script[src="${src}"]`);
    if (ex) { if (ex.dataset.loaded === '1') return resolve(); ex.addEventListener('load', resolve); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error('Failed to load PDF lib'));
    document.head.appendChild(s);
  });
}

async function ensureJsPDF() {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  if (!_loading) _loading = loadScript(CDN_JSPDF);
  await _loading;
  return window.jspdf.jsPDF;
}

const clean = (s) => String(s ?? '').replace(/[^\x20-\x7E]/g, '').trim();
const fmt2 = (n) => Number(n || 0).toFixed(2);

// Amount to words
const ONES = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function h2w(n) {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n/10)] + (n%10?' '+ONES[n%10]:'');
  return ONES[Math.floor(n/100)]+' Hundred'+(n%100?' '+h2w(n%100):'');
}
function toWords(amount) {
  const n = Math.round(Number(amount)||0);
  if (!n) return 'Zero Only';
  const m=Math.floor(n/1_000_000), t=Math.floor((n%1_000_000)/1_000), r=n%1_000;
  return ((m?h2w(m)+' Million ':'')+(t?h2w(t)+' Thousand ':'')+(r?h2w(r):'')).trim()+' Only';
}

async function loadLogo(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode:'cors', cache:'no-store' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(blob); });
    const {width,height} = await new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res({width:im.naturalWidth,height:im.naturalHeight}); im.onerror=rej; im.src=dataUrl; });
    return { dataUrl, width, height, fmt: /png/i.test(dataUrl)?'PNG':'JPEG' };
  } catch { return null; }
}


// ── Look & feel (matches the printed voucher) ───────────────────────────────
const BLUE = [32, 100, 210];   // logo box, headings, labels, boxes
const NAVY = [28, 40, 110];    // "No."
const TEXT = [24, 34, 92];     // phones / address
const RED  = [214, 58, 38];    // receipt number
const INK  = [20, 28, 80];     // filled-in values
const DOT  = [90, 135, 205];   // dotted rules
const WHITE = [255, 255, 255];

// Bundled fonts (client/public/fonts): Noto Kufi Arabic Bold for the Arabic
// company name, Aldrich for the squared English headings — the closest match
// to the printed voucher. Loaded once; if loading fails, system fonts are used.
const KUFI = '"RcptKufi","Noto Kufi Arabic","Segoe UI",Tahoma,Arial,sans-serif';
const HEAD = '"RcptHead",Aldrich,"Arial Black",Arial,sans-serif';
const AR_FONT = '"Segoe UI",Tahoma,"Noto Naskh Arabic","Noto Sans Arabic",Arial,sans-serif';

let _fontsReady = null;
function loadFonts() {
  if (_fontsReady) return _fontsReady;
  const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
  const defs = [
    ['RcptKufi', 'NotoKufiArabic_700Bold.ttf', '700'],
    ['RcptHead', 'Aldrich_400Regular.ttf', '400'],
  ];
  _fontsReady = Promise.all(defs.map(async ([fam, file, weight]) => {
    try {
      if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
      const face = new FontFace(fam, `url(${base}fonts/${file})`, { weight });
      await face.load();
      document.fonts.add(face);
    } catch { /* fall back to system fonts */ }
  }));
  return _fontsReady;
}

// Render text to a transparent PNG using the browser's canvas (correct Arabic
// shaping + our web fonts). rtl=true for Arabic.
function textImg(text, sizePt, rgb, { family = AR_FONT, weight = 'bold', rtl = false } = {}) {
  const t = String(text || '').trim();
  if (!t || typeof document === 'undefined') return null;
  try {
    const S = 5; // supersampling for crisp print
    const c = document.createElement('canvas');
    const font = `${weight} ${sizePt * S}px ${family}`;
    let ctx = c.getContext('2d');
    ctx.font = font; ctx.direction = rtl ? 'rtl' : 'ltr';
    const tw = ctx.measureText(t).width;
    const pad = 2 * S;
    c.width = Math.ceil(tw + pad * 2);
    c.height = Math.ceil(sizePt * S * 1.8);
    ctx = c.getContext('2d');               // resizing resets canvas state
    ctx.font = font; ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = `rgb(${rgb.join(',')})`;
    const base = sizePt * S * 1.3;
    ctx.fillText(t, c.width / 2, base);
    return { url: c.toDataURL('image/png'), w: c.width / S, h: c.height / S, base: base / S, pad: pad / S };
  } catch { return null; }
}

// Draw text-image with its visible edge at x. align: 'right' | 'center'. Returns visible width (pt).
function drawTextImg(doc, text, x, yBase, size, rgb, opts = {}, align = 'right', maxW) {
  let img = textImg(text, size, rgb, opts);
  if (!img) return 0;
  let vis = img.w - 2 * img.pad;
  if (maxW && vis > maxW) { img = textImg(text, size * maxW / vis, rgb, opts); vis = img.w - 2 * img.pad; }
  const x0 = align === 'center' ? x - img.w / 2 : x - vis - img.pad;
  doc.addImage(img.url, 'PNG', x0, yBase - img.base, img.w, img.h);
  return vis;
}
const arRight  = (doc, text, xRight, yBase, size, rgb, maxW) => drawTextImg(doc, text, xRight, yBase, size, rgb, { rtl: true }, 'right', maxW);

// Shrink to fit, then ellipsise as a last resort.
function fitText(doc, text, maxW, size, minSize = 7) {
  let s = text;
  doc.setFontSize(size);
  while (size > minSize && doc.getTextWidth(s) > maxW) { size -= 0.5; doc.setFontSize(size); }
  if (doc.getTextWidth(s) > maxW) {
    while (s.length > 1 && doc.getTextWidth(s + '...') > maxW) s = s.slice(0, -1);
    s += '...';
  }
  return s;
}

// ── Small vector icons (x,y = centre, s = scale) ────────────────────────────
function iconDesk(doc, x, y, rgb, s = 1) {            // desk phone ☎
  doc.setFillColor(...rgb);
  doc.roundedRect(x - 4 * s, y - 0.5 * s, 8 * s, 3.6 * s, 0.8 * s, 0.8 * s, 'F');        // base
  doc.roundedRect(x - 3.6 * s, y - 3.4 * s, 7.2 * s, 1.9 * s, 0.9 * s, 0.9 * s, 'F');    // handset
  doc.setFillColor(255, 255, 255); doc.circle(x, y + 1.3 * s, 0.8 * s, 'F');
}
function iconMobile(doc, x, y, rgb, s = 1) {          // mobile phone
  doc.setFillColor(...rgb); doc.roundedRect(x - 2.6 * s, y - 3.8 * s, 5.2 * s, 7.6 * s, 0.9 * s, 0.9 * s, 'F');
  doc.setFillColor(255, 255, 255); doc.rect(x - 1.7 * s, y - 2.8 * s, 3.4 * s, 3.6 * s, 'F');
}
function iconWhatsApp(doc, x, y, rgb, s = 1) {        // chat bubble ring + handset dot
  doc.setDrawColor(...rgb); doc.setLineWidth(0.9 * s); doc.circle(x, y, 3.3 * s, 'S');
  doc.setFillColor(...rgb);
  doc.triangle(x - 3.3 * s, y + 3.8 * s, x - 3.5 * s, y + 1.0 * s, x - 1.0 * s, y + 2.9 * s, 'F');
  doc.circle(x, y, 1.2 * s, 'F');
}
function iconPin(doc, x, y, rgb, s = 1) {
  doc.setFillColor(...rgb);
  doc.circle(x, y - 1 * s, 3 * s, 'F');
  doc.triangle(x - 2.5 * s, y + 0.4 * s, x + 2.5 * s, y + 0.4 * s, x, y + 5.2 * s, 'F');
  doc.setFillColor(255, 255, 255); doc.circle(x, y - 1 * s, 1.1 * s, 'F');
}
function iconGlobe(doc, x, y, rgb, s = 1) {
  doc.setDrawColor(...rgb); doc.setLineWidth(0.7 * s);
  doc.circle(x, y, 3.2 * s, 'S'); doc.ellipse(x, y, 1.4 * s, 3.2 * s, 'S'); doc.line(x - 3.2 * s, y, x + 3.2 * s, y);
}
function iconMail(doc, x, y, rgb, s = 1) {
  doc.setFillColor(...rgb); doc.rect(x - 4 * s, y - 2.8 * s, 8 * s, 5.6 * s, 'F');
  doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.6 * s);
  doc.lines([[4 * s, 3 * s], [4 * s, -3 * s]], x - 4 * s, y - 2.6 * s, [1, 1]);
}

// ── WAK SHW logo (blue rounded box, white "VV" mark, wordmark, tagline) ─────
// Drawn as vectors so it stays sharp at any size. All numbers are in "logo
// units" measured from the printed logo (box = 910 x 485 units).
function drawLogo(doc, x, y, w) {
  const u = w / 910;
  const h = 485 * u;
  doc.setFillColor(...BLUE);
  doc.roundedRect(x, y, w, h, 40 * u, 40 * u, 'F');

  // mark: two overlapping chevrons + a small tick
  doc.setDrawColor(...WHITE);
  doc.setLineCap('round'); doc.setLineJoin('round');
  const MS = 1.3, MCX = 457, MCY = 112;            // mark scale + centre
  const seg = (raw, width) => {
    const pts = raw.map(([px, py]) => [MCX + (px - MCX) * MS, MCY + (py - MCY) * MS]);
    doc.setLineWidth(width * MS * u);
    const [x0, y0] = pts[0];
    doc.lines(pts.slice(1).map((p, i) => [(p[0] - pts[i][0]) * u, (p[1] - pts[i][1]) * u]), x + x0 * u, y + y0 * u, [1, 1], 'S');
  };
  seg([[362, 76], [415, 158], [482, 76]], 40);       // big V
  seg([[466, 92], [498, 160], [552, 82]], 26);       // second V
  seg([[536, 160], [572, 124]], 9);                  // tick
  doc.setLineCap('butt'); doc.setLineJoin('miter');

  // wordmark
  doc.setTextColor(...WHITE); doc.setFont('helvetica', 'bold');
  const word = 'WAK SHW';
  let fs = 30; doc.setFontSize(fs);
  while (fs > 8 && doc.getTextWidth(word) > 800 * u) { fs -= 0.5; doc.setFontSize(fs); }
  doc.text(word, x + w / 2, y + 365 * u, { align: 'center' });

  // tagline, letter-spaced to the logo's width
  const tag = 'WHOLESALE FOOTWEAR';
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2);
  const tw = doc.getTextWidth(tag);
  const target = 585 * u;
  const cs = Math.max(0, (target - tw) / (tag.length - 1));
  doc.setCharSpace(cs);
  doc.text(tag, x + w / 2 - target / 2, y + 440 * u);
  doc.setCharSpace(0);
}

// "One Thousand Five Hundred Ninety Six and Fifty Fils Only"
function amountWords(dhs, fils) {
  const w = toWords(dhs).replace(/ Only$/, '');
  return `${w}${fils ? ` and ${h2w(fils)} Fils` : ''} Only`;
}

/**
 * Build the receipt voucher PDF.
 *   buildReceiptPdfBlob(invoice, payment, branding)            → filled-in receipt
 *   buildReceiptPdfBlob(null, null, branding, { blank: true })  → empty template to print & fill by hand
 */
export async function buildReceiptPdfBlob(invoice, payment, branding = {}, opts = {}) {
  const blank = !!opts.blank;
  invoice = invoice || {};
  payment = payment || {};
  const only = (v) => (blank ? '' : v);       // blank template prints no data
  const JsPDF = await ensureJsPDF();
  await loadFonts();
  const doc = new JsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });   // A4 portrait 595 x 842 (same as invoice / order form)
  const W = doc.internal.pageSize.getWidth();
  const b = branding || {};

  // Horizontal positions come from the paper original (measured in pixels,
  // 88 = left edge, 1130 = right edge) scaled to the page width; vertical
  // positions are set explicitly so the voucher fills the whole page height.
  const MX = 36;
  const CW = W - 2 * MX;                 // 523pt content width
  const kx = CW / 1042;
  const X = (px) => MX + (px - 88) * kx;
  const L = MX;
  const R = MX + CW;

  // ── Data ──────────────────────────────────────────────────────────────────
  const normName = (s) => String(s || '').trim().replace(/L\.?L\.?C\.?$/i, 'L.L.C.');
  const nameEn = clean(normName(b.legalName || b.headerName || VOUCHER.nameEn)).toUpperCase() || VOUCHER.nameEn;
  const nameAr = String(b.legalNameAr || '').trim() || VOUCHER.nameAr;
  const paid = Number(payment.amount) || 0;
  const totalPaid = (invoice.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const due = Math.max(0, (invoice.total || 0) - totalPaid);
  const cents = Math.round(paid * 100);
  const dhs = Math.floor(cents / 100);
  const fils = cents % 100;
  const dateStr = blank ? '' : new Date(payment.date).toLocaleDateString('en-GB');
  const method = payment.method || 'Cash';
  const isCash = method === 'Cash';
  const cashValue = only(method === 'Cheque' ? (payment.note || 'Cheque') : method);
  const bankValue = only(method === 'Bank Transfer' ? (payment.note || '') : '');
  let beingValue = `Payment for Invoice INV-${invoice.invoiceNo} | Order #${invoice.orderNo}`;
  if (due > 0) beingValue += ` | Balance AED ${fmt2(due)}`;
  beingValue = only(beingValue);

  // ── Header: logo + phones (left) ──────────────────────────────────────────
  const TOP = 46;
  const logoW = 112;
  drawLogo(doc, L, TOP, logoW);
  const logoH = 485 * (logoW / 910);

  VOUCHER.phones.forEach((ph, i) => {
    const py = TOP + logoH + 12 + i * 12.6;
    if (ph.icon === 'desk') iconDesk(doc, L + 4, py - 3, TEXT, 1.05); else iconMobile(doc, L + 4, py - 3, TEXT, 1.0);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...TEXT);
    doc.text(ph.text, L + 13, py);
    if (ph.whatsapp) iconWhatsApp(doc, L + 13 + doc.getTextWidth(ph.text) + 7, py - 3, TEXT, 1.0);
  });

  // ── Header: names, rule, address ──────────────────────────────────────────
  const ruleY = TOP + 0.37 * logoH;
  doc.setDrawColor(...BLUE); doc.setLineWidth(1.6);
  doc.line(L + logoW + 2, ruleY, R, ruleY);

  const nameMaxW = R - (L + logoW + 16);
  drawTextImg(doc, nameAr, R, ruleY - 8, 26, BLUE, { family: KUFI, weight: '700', rtl: true }, 'right', nameMaxW);
  drawTextImg(doc, nameEn, R, ruleY + 28, 26, BLUE, { family: HEAD, weight: 'bold' }, 'right', nameMaxW);

  // address block (right-aligned) with icons, exactly as printed
  const aRight = R - 13;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...TEXT);
  let ay = ruleY + 52;
  VOUCHER.address.forEach((ln, i) => {
    doc.text(ln, aRight, ay, { align: 'right' });
    if (i === 0) iconPin(doc, R - 4, ay - 3.2, BLUE, 1.05);
    ay += 12.6;
  });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  doc.text(VOUCHER.email, aRight, ay, { align: 'right' });
  iconMail(doc, R - 4, ay - 2.8, BLUE, 1.05);
  const emW = doc.getTextWidth(VOUCHER.email);
  doc.setFont('helvetica', 'bold');
  const webRight = aRight - emW - 20;
  doc.text(VOUCHER.website, webRight, ay, { align: 'right' });
  iconGlobe(doc, webRight - doc.getTextWidth(VOUCHER.website) - 8, ay - 2.8, TEXT, 1.05);

  // ── Band: Dhs./Fils boxes (left) · title (centre) · No. & Date (right) ────
  const bandY = 196;                      // baseline of the Dhs./Fils labels
  const bx = L, by = bandY + 8, bw = 300 * kx, bh = 56, split = bx + 190 * kx;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...BLUE);
  doc.text('Dhs.', bx + 20 * kx, bandY);
  arRight(doc, 'درهم', bx + 142 * kx, bandY, 9.5, BLUE);
  doc.text('Fils', split + 3, bandY);
  arRight(doc, 'فلس', bx + bw, bandY, 9, BLUE);
  doc.setDrawColor(...BLUE); doc.setLineWidth(1.5);
  doc.rect(bx, by, bw, bh);
  doc.line(split, by, split, by + bh);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...INK);
  if (!blank) {
    doc.text(String(dhs), bx + (split - bx) / 2, by + bh / 2 + 6, { align: 'center' });
    doc.text(String(fils).padStart(2, '0'), split + (bx + bw - split) / 2, by + bh / 2 + 6, { align: 'center' });
  }

  // title
  const cx = X(597);
  const titleW = 150;
  drawTextImg(doc, 'ســـنـــد   قـــبـــض', cx, bandY + 34, 26, BLUE, { family: AR_FONT, weight: '500', rtl: true }, 'center', titleW);
  drawTextImg(doc, 'RECEIPT VOUCHER', cx, bandY + 58, 15, BLUE, { family: HEAD, weight: 'bold' }, 'center', titleW);
  doc.setDrawColor(...BLUE); doc.setLineWidth(1.8);
  doc.line(cx - titleW / 2, bandY + 64, cx + titleW / 2, bandY + 64);

  // receipt number: "No." (serif bold) + red typewriter digits
  doc.setFont('times', 'bold'); doc.setFontSize(19); doc.setTextColor(...NAVY);
  doc.text('No.', X(800), bandY + 30);
  const noW = doc.getTextWidth('No. ');
  doc.setFont('courier', 'bold'); doc.setFontSize(21); doc.setTextColor(...RED);
  if (!blank) doc.text(String(payment.receiptNo), X(800) + noW, bandY + 30);

  // ── Dotted-rule rows ──────────────────────────────────────────────────────
  const LAB = 11.5, ARS = 11, VAL = 11;
  const row = ({ y, label, x = L, ar, arRightX = R, value = '' }) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(LAB); doc.setTextColor(...BLUE);
    doc.text(label, x, y);
    const dotStart = x + doc.getTextWidth(label) + 5;
    const arW = ar ? arRight(doc, ar, arRightX, y, ARS, BLUE) : 0;
    const dotEnd = arRightX - arW - 7;
    doc.setDrawColor(...DOT); doc.setLineWidth(0.7);
    doc.setLineDashPattern([1, 2], 0);
    doc.line(dotStart, y + 2.5, dotEnd, y + 2.5);
    doc.setLineDashPattern([], 0);
    if (value) {
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK);
      doc.text(fitText(doc, value, dotEnd - dotStart - 10, VAL, 7), dotStart + 6, y - 1);
    }
  };

  // Date (right, level with RECEIPT VOUCHER)
  row({ y: bandY + 58, label: 'Date :', x: X(800), ar: 'التاريخ', value: dateStr });

  // Main rows spread evenly down the page
  const r0 = 345, gap = 76;
  row({ y: r0,           label: 'Received From Mr./M/s.', ar: 'استلمنا من السيد/السادة', value: only(clean(invoice.customer)) });
  row({ y: r0 + gap,     label: 'The Sum of Dhs.', ar: 'مبلغ وقدره درهم', value: only(amountWords(dhs, fils)) });
  row({ y: r0 + gap * 2, label: 'By Cash/Cheque No.', ar: 'نقداً/شيك رقم', value: clean(cashValue) });
  row({ y: r0 + gap * 3, label: 'Bank', ar: 'البنك', arRightX: X(752), value: clean(bankValue) });
  row({ y: r0 + gap * 3, label: 'Date', x: X(757), ar: 'التاريخ', value: (blank || isCash) ? '' : dateStr });
  row({ y: r0 + gap * 4, label: 'Being', ar: 'وذلك عن', value: clean(beingValue) });

  // Signatures
  const sy = r0 + gap * 4 + 118;
  row({ y: sy, label: "Receiver's Sign.", ar: 'توقيع المستلم', arRightX: X(512) });
  row({ y: sy, label: 'Signature', x: X(792), ar: 'التوقيع' });

  return {
    blob: doc.output('blob'),
    filename: blank ? VOUCHER.blankFilename : `Receipt-${payment.receiptNo}-INV${invoice.invoiceNo}.pdf`,
  };
}
