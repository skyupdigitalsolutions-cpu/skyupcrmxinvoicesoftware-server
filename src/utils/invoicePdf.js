/**
 * invoicePdf.js
 * Generates a Tax Invoice / receipt PDF. The layout is fully company-wise:
 * every label, heading, address line, currency and tax rate is read from the
 * tenant's `company.branding` + `company.currency`, falling back to sensible
 * defaults when a field is blank. Returns a Buffer.
 *
 * Usage:
 *   generateInvoicePdf(invoiceObj, companyDoc)   // companyDoc optional
 */
import PDFDocument from 'pdfkit';

// ── helpers ────────────────────────────────────────────────────────────────────
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const convertNum = (n) => {
  if (n === 0) return '';
  if (n < 20) return ONES[n] + ' ';
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '') + ' ';
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' Hundred ' + convertNum(n % 100);
  if (n < 100000) return convertNum(Math.floor(n / 1000)) + 'Thousand ' + convertNum(n % 1000);
  if (n < 10000000) return convertNum(Math.floor(n / 100000)) + 'Lakh ' + convertNum(n % 100000);
  return convertNum(Math.floor(n / 10000000)) + 'Crore ' + convertNum(n % 10000000);
};

// Amount-to-words using the company's currency name/code.
const amountToWords = (amount, currencyCode, currencyName) => {
  const intPart = Math.floor(amount);
  const fracPart = Math.round((amount - intPart) * 100);
  let result = `${currencyName} `;
  result += convertNum(intPart).trim();
  if (fracPart > 0) result += ` and ${convertNum(fracPart).trim()} Cents`;
  result += ` Only (${currencyCode} ${amount.toFixed(2)})`;
  return result;
};

const fmtDate = (d) => {
  const dt = new Date(d);
  return `${dt.getDate()}-${dt.toLocaleString('en-GB', { month: 'short' })}-${dt.getFullYear()}`;
};

// Resolve all branding/currency values with fallbacks.
const resolveBrand = (company) => {
  const b = company?.branding || {};
  const cur = company?.currency || {};
  return {
    receiptHeading: b.receiptHeading || 'Tax Invoice',
    legalName:      b.legalName || company?.name || 'Company Name',
    addressLine1:   b.addressLine1 || '',
    addressLine2:   b.addressLine2 || '',
    city:           b.city || '',
    phone:          b.phone || '',
    website:        b.website || '',
    email:          b.email || '',
    trn:            b.trn || '',
    taxLabel:       b.taxLabel || 'VAT',
    taxPercent:     Number.isFinite(b.taxPercent) ? b.taxPercent : 5,
    footerNote:     b.footerNote || 'This is a Computer Generated Invoice',
    declaration:    b.declaration || 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
    currencyCode:   cur.code || 'AED',
    // A readable currency name for amount-in-words. Map a few common codes.
    currencyName: ({
      AED: 'UAE Dirhams', INR: 'Indian Rupees', USD: 'US Dollars',
      EUR: 'Euros', GBP: 'British Pounds', SAR: 'Saudi Riyals', QAR: 'Qatari Riyals',
    })[(cur.code || 'AED').toUpperCase()] || `${(cur.code || 'AED')}`,
  };
};

/**
 * Build and return a PDF Buffer for the given invoice object.
 * @param {Object} invoice  – Mongoose Invoice document (plain object is fine too)
 * @param {Object} [company] – Company doc/lean object with branding + currency
 */
export function generateInvoicePdf(invoice, company = null) {
  const B = resolveBrand(company);

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: { Title: `Invoice INV-${invoice.invoiceNo}`, Author: B.legalName },
    });

    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Page constants ────────────────────────────────────────────────────────
    const W = doc.page.width;   // 595.28
    const H = doc.page.height;  // 841.89
    const M = 36;
    const innerW = W - M * 2;

    // ── Helpers ───────────────────────────────────────────────────────────────
    const line = (x1, y1, x2, y2, color = '#000', w = 0.5) =>
      doc.moveTo(x1, y1).lineTo(x2, y2).strokeColor(color).lineWidth(w).stroke();

    const rect = (x, y, w, h, fill = null, stroke = null, sw = 0.5) => {
      doc.rect(x, y, w, h);
      if (fill) doc.fillColor(fill).fill();
      if (stroke) doc.strokeColor(stroke).lineWidth(sw).stroke();
    };

    const text = (str, x, y, opts = {}) => {
      const { font = 'Helvetica', size = 8, color = '#000', align = 'left', width } = opts;
      doc.font(font).fontSize(size).fillColor(color);
      if (width !== undefined) doc.text(str ?? '', x, y, { width, align, lineBreak: false });
      else doc.text(str ?? '', x, y, { lineBreak: false });
    };

    const boldText = (str, x, y, opts = {}) =>
      text(str, x, y, { ...opts, font: 'Helvetica-Bold' });

    // ── Title (company-wise receipt heading) ──────────────────────────────────
    let y = M;
    boldText(B.receiptHeading, M, y, { size: 14, align: 'center', width: innerW });
    y += 20;

    const tableBottom = H - M - 90;

    // ── Header section (two columns) ─────────────────────────────────────────
    const leftColW = innerW * 0.52;
    const rightColX = M + leftColW;
    const rightColW = innerW - leftColW;
    const headerH = 155;

    rect(M, y, leftColW, headerH, null, '#000');
    rect(rightColX, y, rightColW, headerH, null, '#000');

    // Company info (all company-wise)
    let ly = y + 5;
    boldText(B.legalName, M + 4, ly, { size: 8.5, width: leftColW - 8 });
    ly += 11;
    const companyLines = [
      B.addressLine1,
      B.addressLine2,
      B.city,
      B.phone ? `Tel : ${B.phone}` : '',
      B.website,
      B.trn ? `TRN : ${B.trn}` : '',
      B.email ? `E-Mail : ${B.email}` : '',
    ].filter(Boolean);
    companyLines.forEach((l) => { text(l, M + 4, ly, { size: 7, width: leftColW - 8 }); ly += 9; });

    // Buyer section
    ly += 5;
    line(M, ly, M + leftColW, ly, '#000', 0.5);
    ly += 5;
    text('Buyer', M + 4, ly, { size: 7 });
    ly += 11;
    boldText(invoice.customer || 'N/A', M + 4, ly, { size: 8.5 });
    ly += 13;

    const emirate = invoice.city || '';
    const country = invoice.country || '';
    text('City / Area', M + 4, ly, { size: 7 });
    text(`: ${emirate}`, M + 60, ly, { size: 7 });
    ly += 9;
    text('Country', M + 4, ly, { size: 7 });
    text(`: ${country}`, M + 60, ly, { size: 7 });
    ly += 9;
    text('Place of supply', M + 4, ly, { size: 7 });
    text(`: ${[country, emirate].filter(Boolean).join(', ')}`, M + 60, ly, { size: 7 });
    ly += 14;
    text('Contact', M + 4, ly, { size: 7 });
    text(`: ${invoice.mobile || '—'}`, M + 60, ly, { size: 7 });

    // Right column: invoice meta grid
    const rightGutter = 4;
    const rxL = rightColX + rightGutter;
    let ry = y;
    const metaRowH = 25;
    const halfRight = rightColW / 2;

    rect(rightColX, ry, halfRight, metaRowH, null, '#000');
    rect(rightColX + halfRight, ry, halfRight, metaRowH, null, '#000');
    text('Invoice No.', rxL, ry + 4, { size: 7 });
    boldText(`${invoice.invoiceNo}`, rxL, ry + 13, { size: 8.5 });
    text('Dated', rightColX + halfRight + rightGutter, ry + 4, { size: 7 });
    boldText(fmtDate(invoice.date), rightColX + halfRight + rightGutter, ry + 13, { size: 8.5 });
    ry += metaRowH;

    rect(rightColX, ry, halfRight, metaRowH, null, '#000');
    rect(rightColX + halfRight, ry, halfRight, metaRowH, null, '#000');
    text('Delivery Note', rxL, ry + 4, { size: 7 });
    text('Mode/Terms of Payment', rightColX + halfRight + rightGutter, ry + 4, { size: 7 });
    ry += metaRowH;

    rect(rightColX, ry, halfRight, metaRowH, null, '#000');
    rect(rightColX + halfRight, ry, halfRight, metaRowH, null, '#000');
    text("Supplier's Ref.", rxL, ry + 4, { size: 7 });
    boldText(`${invoice.orderNo}`, rxL, ry + 13, { size: 8.5 });
    text('Other Reference(s)', rightColX + halfRight + rightGutter, ry + 4, { size: 7 });
    boldText(emirate || 'N/A', rightColX + halfRight + rightGutter, ry + 13, { size: 8.5 });
    ry += metaRowH;

    rect(rightColX, ry, halfRight, metaRowH, null, '#000');
    rect(rightColX + halfRight, ry, halfRight, metaRowH, null, '#000');
    text("Buyer's Order No.", rxL, ry + 4, { size: 7 });
    text('Dated', rightColX + halfRight + rightGutter, ry + 4, { size: 7 });
    ry += metaRowH;

    rect(rightColX, ry, halfRight, metaRowH, null, '#000');
    rect(rightColX + halfRight, ry, halfRight, metaRowH, null, '#000');
    text('Despatch Document No.', rxL, ry + 4, { size: 7 });
    text('Delivery Note Date', rightColX + halfRight + rightGutter, ry + 4, { size: 7 });
    ry += metaRowH;

    rect(rightColX, ry, halfRight, metaRowH, null, '#000');
    rect(rightColX + halfRight, ry, halfRight, metaRowH, null, '#000');
    text('Despatched through', rxL, ry + 4, { size: 7 });
    text('Destination', rightColX + halfRight + rightGutter, ry + 4, { size: 7 });
    ry += metaRowH;

    const lastRowH = headerH - (ry - y);
    rect(rightColX, ry, rightColW, lastRowH, null, '#000');
    text('Terms of Delivery', rxL, ry + 4, { size: 7 });

    y += headerH;

    // ── Items table ───────────────────────────────────────────────────────────
    const cols = [
      { label: 'Sl\nNo.',    w: 22  },
      { label: 'Description of Goods', w: 195 },
      { label: 'Quantity',  w: 65  },
      { label: 'Rate',      w: 48  },
      { label: 'per',       w: 30  },
      { label: 'Disc. %',   w: 32  },
      { label: 'Amount',    w: 60  },
      { label: `${B.taxLabel}\n%`, w: 30  },
    ];

    let cx = M;
    const colX = cols.map((c) => { const x = cx; cx += c.w; return x; });

    const thH = 20;
    rect(M, y, innerW, thH, '#f0f0f0', '#000');
    cols.forEach((c, i) => {
      rect(colX[i], y, c.w, thH, null, '#000');
      c.label.split('\n').forEach((ln, li) => {
        boldText(ln, colX[i] + 2, y + 3 + li * 8, { size: 7, width: c.w - 4, align: 'center' });
      });
    });
    y += thH;

    const rowH = 22;
    const items = invoice.items || [];
    let subtotal = 0;
    const taxRate = B.taxPercent / 100;

    items.forEach((item, idx) => {
      const amount = (item.qty || 0) * (item.price || 0);
      subtotal += amount;

      if (idx % 2 === 0) rect(M, y, innerW, rowH, '#fafafa', null);
      cols.forEach((c, i) => rect(colX[i], y, c.w, rowH, null, '#000'));

      text(`${idx + 1}`, colX[0] + 2, y + 4, { size: 8, width: cols[0].w - 4, align: 'center' });
      boldText(item.modelCode, colX[1] + 3, y + 4, { size: 8 });

      const ctnQty = item.qty || 0;
      const pcsQty = ctnQty * 24;
      boldText(`${ctnQty} CTN`, colX[2] + 2, y + 4, { size: 8, width: cols[2].w - 4, align: 'center' });
      text(`(${pcsQty}.00 Pcs)`, colX[2] + 2, y + 12, { size: 6.5, width: cols[2].w - 4, align: 'center' });

      text(`${(item.price || 0).toFixed(2)}`, colX[3] + 2, y + 8, { size: 8, width: cols[3].w - 4, align: 'right' });
      text('CTN', colX[4] + 2, y + 8, { size: 7, width: cols[4].w - 4, align: 'center' });
      boldText(`${amount.toFixed(2)}`, colX[6] + 2, y + 8, { size: 8, width: cols[6].w - 4, align: 'right' });
      text(`${B.taxPercent} %`, colX[7] + 2, y + 8, { size: 7.5, width: cols[7].w - 4, align: 'center' });

      y += rowH;
    });

    // ── Subtotal + tax rows ───────────────────────────────────────────────────
    const tax = Number((subtotal * taxRate).toFixed(2));
    const total = Number((subtotal + tax).toFixed(2));

    rect(M, y, innerW, rowH, null, '#000');
    cols.forEach((c, i) => rect(colX[i], y, c.w, rowH, null, '#000'));
    boldText(`${subtotal.toFixed(2)}`, colX[6] + 2, y + 8, { size: 9, width: cols[6].w - 4, align: 'right' });
    y += rowH;

    rect(M, y, innerW, rowH, null, '#000');
    cols.forEach((c, i) => rect(colX[i], y, c.w, rowH, null, '#000'));
    boldText(B.taxLabel, colX[5] - 30, y + 8, { size: 8, width: 40, align: 'right' });
    boldText(`${tax.toFixed(2)}`, colX[6] + 2, y + 8, { size: 9, width: cols[6].w - 4, align: 'right' });
    y += rowH;

    for (let i = 0; i < 4; i++) {
      rect(M, y, innerW, rowH, null, '#000');
      cols.forEach((c, ci) => rect(colX[ci], y, c.w, rowH, null, '#000'));
      y += rowH;
    }

    const totalRowH = 18;
    rect(M, y, innerW, totalRowH, null, '#000');
    cols.forEach((c, i) => rect(colX[i], y, c.w, totalRowH, null, '#000'));
    boldText('Total', colX[1] + 3, y + 5, { size: 8 });
    boldText(`${items.reduce((s, it) => s + (it.qty || 0), 0)} CTN`, colX[2] + 2, y + 5, { size: 8, width: cols[2].w - 4, align: 'center' });
    boldText(`${B.currencyCode} ${total.toFixed(2)}`, colX[6] + 2, y + 5, { size: 9, width: cols[6].w - 4, align: 'right' });
    y += totalRowH;

    // ── Amount in words section ───────────────────────────────────────────────
    const wordsH = 60;
    rect(M, y, innerW * 0.55, wordsH, null, '#000');
    rect(M + innerW * 0.55, y, innerW * 0.45, wordsH, null, '#000');

    const amtWords = amountToWords(total, B.currencyCode, B.currencyName);
    const taxWords = amountToWords(tax, B.currencyCode, B.currencyName);

    text('Amount Chargeable (in words)', M + 3, y + 4, { size: 7 });
    boldText(amtWords, M + 3, y + 15, { size: 7.5, width: innerW * 0.55 - 6 });
    text(`${B.taxLabel} Amount (in words)`, M + 3, y + 32, { size: 7 });
    boldText(taxWords, M + 3, y + 43, { size: 7.5, width: innerW * 0.55 - 6 });

    const rx2 = M + innerW * 0.55 + 4;
    boldText('E. & O.E', M + innerW - 50, y + 4, { size: 7 });
    text(`${B.taxLabel} %`, rx2, y + 4, { size: 7 });
    text('Assessable Value', rx2 + 38, y + 4, { size: 7 });
    boldText('Tax Amount', rx2 + 105, y + 4, { size: 7 });
    line(M + innerW * 0.55, y + 14, W - M, y + 14, '#000', 0.5);
    text(`${B.taxPercent} %`, rx2, y + 17, { size: 7.5 });
    text(`${subtotal.toFixed(2)}`, rx2 + 38, y + 17, { size: 7.5 });
    boldText(`${tax.toFixed(2)}`, rx2 + 105, y + 17, { size: 7.5 });
    line(M + innerW * 0.55, y + 28, W - M, y + 28, '#000', 0.5);
    boldText('Total', rx2 + 10, y + 31, { size: 7.5 });
    text(`${subtotal.toFixed(2)}`, rx2 + 38, y + 31, { size: 7.5 });
    boldText(`${tax.toFixed(2)}`, rx2 + 105, y + 31, { size: 7.5 });

    y += wordsH;

    // ── Declaration + Signature ────────────────────────────────────────────
    const footerH = 90;
    rect(M, y, innerW * 0.55, footerH, null, '#000');
    rect(M + innerW * 0.55, y, innerW * 0.45, footerH, null, '#000');

    text('Declaration', M + 3, y + 6, { size: 7, font: 'Helvetica-Oblique' });
    text(B.declaration, M + 3, y + 17, { size: 7, lineBreak: true, width: innerW * 0.55 - 6 });

    boldText(`for ${B.legalName}`, M + innerW * 0.55 + 4, y + 6, { size: 7.5, width: innerW * 0.45 - 8, align: 'right' });
    text('Authorised Signatory', M + innerW * 0.55 + 4, y + footerH - 14, { size: 7, width: innerW * 0.45 - 8, align: 'right' });

    y += footerH;

    boldText(B.footerNote, M, y + 6, { size: 7, width: innerW, align: 'center' });

    doc.end();
  });
}