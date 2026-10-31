// utils/purchaseOrderPdf.js
// Generates a Purchase Order PDF matching the sketch layout:
// Header → PO meta box (PO#, Date, Supplier, Payment, Status, City, Country, Contact)
// → Items table (Art No. | Description | Size | Qty | Rate | Amount) → Totals → Signature

import { fmtNum, formatDate } from './format.js';

const CDN = {
  jspdf:     'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
};
let loadingPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
      return;
    }
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureJsPDF() {
  if (window.jspdf?.jsPDF && window.jspdf.jsPDF.API?.autoTable) return window.jspdf.jsPDF;
  if (!loadingPromise) {
    loadingPromise = (async () => {
      await loadScript(CDN.jspdf);
      await loadScript(CDN.autotable);
    })();
  }
  await loadingPromise;
  if (!window.jspdf?.jsPDF) throw new Error('PDF library unavailable — check your internet connection.');
  return window.jspdf.jsPDF;
}

const clean = (s) => String(s ?? '').replace(/[\u2013\u2014]/g, '-').replace(/[^\x20-\x7E]/g, '').trim();

async function loadLogoForPdf(logoUrl) {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl, { mode: 'cors', cache: 'no-store' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(blob);
    });
    const { width, height } = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve({ width: im.naturalWidth, height: im.naturalHeight });
      im.onerror = () => reject(new Error('dim failed'));
      im.src = dataUrl;
    });
    const fmt = /image\/png/i.test(dataUrl) ? 'PNG' : 'JPEG';
    return { dataUrl, width, height, fmt };
  } catch { return null; }
}

const ONES = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
  'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function h2w(n) {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n/10)] + (n%10 ? ' '+ONES[n%10] : '');
  return ONES[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' '+h2w(n%100) : '');
}
function amountToWords(amount) {
  const n = Math.round(Number(amount) || 0);
  if (n === 0) return 'Zero Only';
  const mil = Math.floor(n/1_000_000), tho = Math.floor((n%1_000_000)/1_000), rem = n%1_000;
  let r = '';
  if (mil) r += h2w(mil) + ' Million ';
  if (tho) r += h2w(tho) + ' Thousand ';
  if (rem) r += h2w(rem);
  return r.trim() + ' Only';
}

const PAGE_BOTTOM_MARGIN = 55;
function ensureSpace(doc, y, needed, pageH, topMargin) {
  if (y + needed > pageH - PAGE_BOTTOM_MARGIN) { doc.addPage(); return topMargin; }
  return y;
}

export async function buildPurchaseOrderPdfBlob(po, branding = {}) {
  const JsPDF = await ensureJsPDF();
  const doc   = new JsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M     = 40;

  const b          = branding || {};
  const companyEn  = clean(b.legalName || b.headerName || 'Company');
  const addr       = clean([b.addressLine1, b.addressLine2, b.city].filter(Boolean).join(', '));
  const contactLines = [
    addr,
    b.phone ? `Tel: ${clean(b.phone)}` : '',
    b.trn   ? `TRN: ${clean(b.trn)}`   : '',
  ].filter(Boolean);

  // ── Company header ──────────────────────────────────────────────────────
  let y = 40;
  let nameX = M;
  const logoAsset = await loadLogoForPdf(b.receiptLogoUrl || b.logoUrl || '');
  if (logoAsset) {
    const logoH = 48;
    const logoW = (logoAsset.width / logoAsset.height) * logoH;
    doc.addImage(logoAsset.dataUrl, logoAsset.fmt, M, y - 8, logoW, logoH);
    nameX = M + logoW + 14;
  }
  doc.setFont(undefined, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text(companyEn, nameX, y);
  let cy = y + 14;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8.5);
  contactLines.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, pageW / 2 - nameX + M);
    wrapped.forEach((wl) => { doc.text(wl, nameX, cy); cy += 12; });
  });
  y = Math.max(cy, y + 52) + 12;

  // ── Title ───────────────────────────────────────────────────────────────
  doc.setFont(undefined, 'bold');
  doc.setFontSize(17);
  doc.setTextColor(0, 0, 0);
  doc.text('PURCHASE ORDER FORM', pageW / 2, y, { align: 'center', charSpace: 1.2 });
  doc.setLineWidth(0.8);
  doc.line(M, y + 8, pageW - M, y + 8);
  y += 24;

  // ── Meta info box  ──────────────────────────────────────────────────────
  // 3 columns: Order Details | Supplier Details | Payment & Status
  const boxW = pageW - M * 2;
  const colW = boxW / 3;
  const padX = 10;

  const leftCol = [
    ['Order No.',    `PO-${po.poNo}`],
    ['Order Date',   formatDate(po.date)],
  ];
  const midCol = [
    ['Supplier Name',    clean(po.supplierName)],
    ['Contact No.',      clean(po.supplierContact) || '—'],
    ['City / Area',      clean(po.city) || '—'],
    ['Country',          clean(po.country) || '—'],
  ];
  const rightCol = [
    ['Payment Status', po.paymentStatus || 'Unpaid'],
    ['Order Status',   po.status        || 'Draft'],
  ];

  const rows = Math.max(leftCol.length, midCol.length, rightCol.length);
  const rowH = 18;
  const boxH = 20 + rows * rowH + 8;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.rect(M, y, boxW, boxH);
  doc.line(M + colW,     y, M + colW,     y + boxH);
  doc.line(M + colW * 2, y, M + colW * 2, y + boxH);

  // Column headers
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  doc.setFont(undefined, 'bold');
  doc.text('ORDER DETAILS',   M + padX,           y + 13);
  doc.text('SUPPLIER DETAILS', M + colW + padX,    y + 13);
  doc.text('PAYMENT & STATUS', M + colW*2 + padX,  y + 13);

  const drawKV = (col, rows, startX, startY) => {
    rows.forEach(([label, val], i) => {
      const ry = startY + 22 + i * rowH;
      doc.setFont(undefined, 'bold');
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      doc.text(label + ':', startX, ry);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(0, 0, 0);
      const wrapped = doc.splitTextToSize(clean(val), colW - padX * 2 - 50);
      doc.text(wrapped, startX + 62, ry);
    });
  };
  drawKV('left',  leftCol,  M + padX,            y);
  drawKV('mid',   midCol,   M + colW + padX,      y);
  drawKV('right', rightCol, M + colW * 2 + padX,  y);

  y += boxH + 18;

  // ── Items table ─────────────────────────────────────────────────────────
  const items    = po.items || [];
  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const subTotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);

  const tableRows = items.map((it, i) => [
    i + 1,
    clean(it.modelCode),
    clean(it.description) || '—',
    clean(it.size) || '—',
    fmtNum(it.qty  || 0),
    fmtNum(it.price || 0),
    fmtNum((Number(it.qty) || 0) * (Number(it.price) || 0)),
  ]);

  doc.autoTable({
    startY: y,
    margin: { left: M, right: M, bottom: 50, top: M },
    head:   [['S.No.', 'Article No.', 'Description', 'Size', 'Qty', 'Rate', 'Amount']],
    body:   tableRows,
    foot:   [[
      { content: 'TOTAL', colSpan: 4, styles: { halign: 'right' } },
      { content: fmtNum(totalQty), styles: { halign: 'right' } },
      '',
      { content: fmtNum(subTotal), styles: { halign: 'right' } },
    ]],
    theme: 'grid',
    styles:     { fontSize: 9, textColor: [0,0,0], lineColor: [0,0,0], lineWidth: 0.4, cellPadding: 4.5 },
    headStyles: { fillColor: [0,0,0], textColor: [255,255,255], fontStyle: 'bold', lineColor: [0,0,0], lineWidth: 0.6 },
    footStyles: { fillColor: [235,235,235], textColor: [0,0,0], fontStyle: 'bold', lineColor: [0,0,0], lineWidth: 0.6 },
    columnStyles: {
      0: { cellWidth: 26, halign: 'center' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
    showHead: 'everyPage',
    showFoot: 'lastPage',
  });
  y = doc.lastAutoTable.finalY + 14;
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setFont(undefined, 'normal');

  // ── Totals box ───────────────────────────────────────────────────────────
  const grandTotal  = po.grandTotal ?? subTotal;
  const totBoxW     = 180;
  const wordsBoxW   = pageW - M * 2 - totBoxW - 12;
  const totRowH     = 22;
  const totBoxH     = totRowH; // single row: Grand Total
  const totBoxX     = pageW - M - totBoxW;

  y = ensureSpace(doc, y, totBoxH + 14, pageH, M);

  // Words box
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.rect(M, y, wordsBoxW, totBoxH);
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.setFont(undefined, 'bold');
  doc.text('TOTAL IN WORDS', M + 8, y + 13);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  doc.text(clean(amountToWords(grandTotal)), M + 8, y + 26, { maxWidth: wordsBoxW - 16 });

  // Grand total row
  doc.setFillColor(0, 0, 0);
  doc.rect(totBoxX, y, totBoxW, totRowH, 'F');
  doc.setDrawColor(0, 0, 0);
  doc.rect(totBoxX, y, totBoxW, totRowH);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text('Grand Total', totBoxX + 8, y + totRowH / 2 + 3.5);
  doc.text(fmtNum(grandTotal), totBoxX + totBoxW - 8, y + totRowH / 2 + 3.5, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  y += totBoxH + 22;

  // ── Notes ────────────────────────────────────────────────────────────────
  if (po.notes) {
    y = ensureSpace(doc, y, 18, pageH, M);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(`Notes: ${clean(po.notes)}`, M, y, { maxWidth: pageW - M * 2 });
    y += 16;
  }

  // ── Signatures ───────────────────────────────────────────────────────────
  y = ensureSpace(doc, y, 56, pageH, M);
  const sigY = y + 40;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.line(M, sigY, M + 160, sigY);
  doc.line(pageW - M - 160, sigY, pageW - M, sigY);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  doc.text("Authorised By", M + 80, sigY + 12, { align: 'center' });
  const forLine = `For ${companyEn}`;
  let fs = 9.5; doc.setFontSize(fs);
  while (fs > 7 && doc.getTextWidth(forLine) > 150) { fs -= 0.5; doc.setFontSize(fs); }
  doc.text(forLine, pageW - M - 80, sigY + 12, { align: 'center' });

  return {
    blob:     doc.output('blob'),
    filename: `PO-${po.poNo}.pdf`,
  };
}
