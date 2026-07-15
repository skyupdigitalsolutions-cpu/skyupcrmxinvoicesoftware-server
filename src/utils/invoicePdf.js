/**
 * invoicePdf.js
 * Generates a Tax Invoice / receipt PDF. The layout is fully company-wise:
 * every label, heading, address line, currency and tax rate is read from the
 * tenant's `company.branding` + `company.currency`, falling back to sensible
 * defaults when a field is blank. Returns a Buffer.
 *
 * Design: strictly black & white (no shaded fills). The header shows a logo
 * image when one is available, otherwise the company legal name as a wordmark.
 * Item columns: Sl No | Article No. | Description | Size | Quantity | Pieces |
 * Rate | Amount | VAT %. "Pieces" is the count inside ONE box/carton and is
 * entered per line (12/24/36/60/72...), replacing the old hardcoded x24.
 *
 * Usage:
 *   generateInvoicePdf(invoiceObj, companyDoc)   // companyDoc optional
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';
import { displayPhone } from '../models/Lead.js';
import { fileURLToPath } from 'url';

// Resolve an optional invoice logo. Priority:
//   1. INVOICE_LOGO_PATH env var (absolute path)
//   2. bundled asset at src/assets/invoice-logo.png (drop the Spotak PNG here)
// If neither exists, the header falls back to a text wordmark, so PDF
// generation never crashes just because the image is missing.
const resolveLogoFile = () => {
  const envPath = process.env.INVOICE_LOGO_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  try {
    const bundled = fileURLToPath(new URL('../assets/invoice-logo.png', import.meta.url));
    if (fs.existsSync(bundled)) return bundled;
  } catch (e) {
    // ignore resolution errors
  }
  return null;
};
const LOGO_FILE = resolveLogoFile();

// Fetch a per-company receipt logo (a hosted URL, e.g. Cloudinary) into a
// Buffer, because pdfkit's doc.image() needs bytes/a path, not a URL. Returns
// null on any problem (bad URL, network error, timeout) so the caller falls
// back to the bundled file and then the text wordmark — PDF generation never
// fails just because the logo could not be loaded.
async function fetchLogoBuffer(url) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (e) {
    return null;
  }
}

// -- helpers --------------------------------------------------------------------
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
  const b = company && company.branding ? company.branding : {};
  const cur = company && company.currency ? company.currency : {};
  return {
    receiptHeading: b.receiptHeading || 'Tax Invoice',
    legalName:      b.legalName || (company && company.name) || 'Company Name',
    receiptLogoUrl: b.receiptLogoUrl || '',
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
 * @param {Object} invoice  - Mongoose Invoice document (plain object is fine too)
 * @param {Object} [company] - Company doc/lean object with branding + currency
 */
export async function generateInvoicePdf(invoice, company = null) {
  const B = resolveBrand(company);

  // Prefer the rate captured on the invoice at creation time over the company's
  // *current* default. This keeps a reprinted/regenerated old invoice showing
  // the rate it was actually billed at, even after the company later changes
  // its default taxPercent. Legacy invoices with no stored rate fall back to
  // the company branding value resolved above.
  if (invoice && Number.isFinite(invoice.taxPercent)) B.taxPercent = invoice.taxPercent;

  // Per-company receipt logo (separate from the sidebar logo). Fetched to a
  // Buffer here so it can be embedded below; null falls back to the bundled
  // file / wordmark.
  const logoBuffer = await fetchLogoBuffer(B.receiptLogoUrl);

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

    // -- Page constants --------------------------------------------------------
    const W = doc.page.width;   // 595.28
    const H = doc.page.height;  // 841.89
    const M = 36;
    const innerW = W - M * 2;

    // -- Helpers ---------------------------------------------------------------
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
      if (width !== undefined) doc.text(str === undefined || str === null ? '' : str, x, y, { width, align, lineBreak: false });
      else doc.text(str === undefined || str === null ? '' : str, x, y, { lineBreak: false });
    };

    const boldText = (str, x, y, opts = {}) =>
      text(str, x, y, { ...opts, font: 'Helvetica-Bold' });

    // -- Header band: logo (left) + receipt heading (right) --------------------
    let y = M;
    const bandH = 44;
    let logoDrawn = false;
    try {
      if (logoBuffer) {
        doc.image(logoBuffer, M, y, { fit: [170, bandH - 4] });
        logoDrawn = true;
      } else if (LOGO_FILE) {
        doc.image(LOGO_FILE, M, y, { fit: [170, bandH - 4] });
        logoDrawn = true;
      }
    } catch (e) {
      logoDrawn = false;
    }
    if (!logoDrawn) boldText(B.legalName, M, y + 14, { size: 16 });
    boldText(B.receiptHeading, M, y + 14, { size: 14, align: 'right', width: innerW });
    y += bandH;

    // -- Header section (two columns) -----------------------------------------
    const leftColW = innerW * 0.52;
    const rightColX = M + leftColW;
    const rightColW = innerW - leftColW;
    const headerH = 178;

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
    // Render each line with wrapping enabled, advancing by the measured height
    // so a long address wraps cleanly instead of overlapping the next line.
    companyLines.forEach((l) => {
      doc.font('Helvetica').fontSize(7).fillColor('#000');
      const h = doc.heightOfString(l, { width: leftColW - 8 });
      doc.text(l, M + 4, ly, { width: leftColW - 8 });
      ly += h + 1;
    });

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
    text(`: ${displayPhone(invoice.mobile, invoice.country) || '-'}`, M + 60, ly, { size: 7 });

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

    // -- Items table -----------------------------------------------------------
    // Tally-style Tax Invoice columns. Widths sum to innerW (~523.28).
    // Strict B&W: black borders, no fills.
    const cols = [
      { label: 'Sl\nNo.',                                   w: 20  },
      { label: 'Description of Goods',                       w: 152 },
      { label: 'Quantity',                                   w: 62  },
      { label: 'Rate',                                       w: 46  },
      { label: 'per',                                        w: 26  },
      { label: 'Amount',                                     w: 58  },
      { label: `${B.taxLabel}\n%`,                           w: 26  },
      { label: `${B.taxLabel}\n(${B.currencyCode})`,         w: 52  },
      { label: `Total\nIncl.${B.taxLabel}(${B.currencyCode})`, w: 81 },
    ];
    const C_SL = 0, C_DESC = 1, C_QTY = 2, C_RATE = 3, C_PER = 4, C_AMT = 5, C_VATP = 6, C_VATA = 7, C_TOT = 8;

    let cx = M;
    const colX = cols.map((c) => { const x = cx; cx += c.w; return x; });

    const thH = 22;
    rect(M, y, innerW, thH, null, '#000');
    cols.forEach((c, i) => {
      rect(colX[i], y, c.w, thH, null, '#000');
      const lines = c.label.split('\n');
      const startY = lines.length > 1 ? y + 4 : y + 8;
      lines.forEach((ln, li) => {
        boldText(ln, colX[i] + 1, startY + li * 8, { size: 6.8, width: c.w - 2, align: 'center' });
      });
    });
    y += thH;

    const rowH = 24;
    const items = invoice.items || [];
    let subtotal = 0;
    const taxRate = B.taxPercent / 100;
    // Order-level discount (percent) carried from the source order.
    const disc = Math.min(100, Math.max(0, Number(invoice.discount) || 0));

    // Label region ending just before the Amount column (used for the
    // right-aligned Sub Total / Discount / VAT labels below the items).
    const labelX = M + 2;
    const labelW = colX[C_AMT] - M - 4;

    items.forEach((item, idx) => {
      const boxes = Number(item.qty) || 0;
      const perBox = Number(item.pieces) || 0;
      const totalPcs = boxes * perBox;
      const amount = boxes * (Number(item.price) || 0);
      const lineVat = Number((amount * taxRate).toFixed(2));
      const lineTotal = Number((amount + lineVat).toFixed(2));
      subtotal += amount;

      cols.forEach((c, i) => rect(colX[i], y, c.w, rowH, null, '#000'));

      text(`${idx + 1}`, colX[C_SL] + 1, y + 8, { size: 8, width: cols[C_SL].w - 2, align: 'center' });

      // Description of Goods: article code (bold) + category / size beneath.
      boldText(item.modelCode || '', colX[C_DESC] + 3, y + 5, { size: 8.5, width: cols[C_DESC].w - 6 });
      const descLine = [item.description, item.size ? `Size ${item.size}` : ''].filter(Boolean).join('   ');
      if (descLine) text(descLine, colX[C_DESC] + 3, y + 15, { size: 6.5, width: cols[C_DESC].w - 6 });

      // Quantity: cartons (bold) + total pieces beneath (boxes x pcs-per-box).
      boldText(`${boxes.toFixed(2)} CTN`, colX[C_QTY] + 2, y + 5, { size: 8, width: cols[C_QTY].w - 4, align: 'center' });
      if (totalPcs) text(`(${totalPcs.toFixed(2)} Pcs)`, colX[C_QTY] + 2, y + 14, { size: 6.5, width: cols[C_QTY].w - 4, align: 'center' });

      text(`${(Number(item.price) || 0).toFixed(2)}`, colX[C_RATE] + 2, y + 8, { size: 8, width: cols[C_RATE].w - 4, align: 'right' });
      text('CTN', colX[C_PER] + 1, y + 8, { size: 7, width: cols[C_PER].w - 2, align: 'center' });
      boldText(`${amount.toFixed(2)}`, colX[C_AMT] + 2, y + 8, { size: 8, width: cols[C_AMT].w - 4, align: 'right' });
      text(`${B.taxPercent} %`, colX[C_VATP] + 1, y + 8, { size: 7, width: cols[C_VATP].w - 2, align: 'center' });
      text(`${lineVat.toFixed(2)}`, colX[C_VATA] + 2, y + 8, { size: 7.5, width: cols[C_VATA].w - 4, align: 'right' });
      boldText(`${lineTotal.toFixed(2)}`, colX[C_TOT] + 2, y + 8, { size: 8, width: cols[C_TOT].w - 4, align: 'right' });

      y += rowH;
    });

    // -- Subtotal + discount + tax rows ----------------------------------------
    const discountAmt = Number((subtotal * disc / 100).toFixed(2));
    const taxable = Math.max(0, Number((subtotal - discountAmt).toFixed(2)));
    const tax = Number((taxable * taxRate).toFixed(2));
    const total = Number((taxable + tax).toFixed(2));

    // Sub Total row — gross total of the Amount column.
    cols.forEach((c, i) => rect(colX[i], y, c.w, rowH, null, '#000'));
    boldText(`${subtotal.toFixed(2)}`, colX[C_AMT] + 2, y + 8, { size: 9, width: cols[C_AMT].w - 4, align: 'right' });
    y += rowH;

    if (disc > 0) {
      cols.forEach((c, i) => rect(colX[i], y, c.w, rowH, null, '#000'));
      boldText(`Less : Discount ${disc}%`, labelX, y + 8, { size: 8, width: labelW, align: 'right' });
      boldText(`-${discountAmt.toFixed(2)}`, colX[C_AMT] + 2, y + 8, { size: 9, width: cols[C_AMT].w - 4, align: 'right' });
      y += rowH;
    }

    // VAT row — label at left, total tax in the Amount column.
    cols.forEach((c, i) => rect(colX[i], y, c.w, rowH, null, '#000'));
    boldText(B.taxLabel, colX[C_DESC] + 3, y + 8, { size: 8, font: 'Helvetica-BoldOblique' });
    boldText(`${tax.toFixed(2)}`, colX[C_AMT] + 2, y + 8, { size: 9, width: cols[C_AMT].w - 4, align: 'right' });
    y += rowH;

    // Blank filler rows - one fewer when the discount row consumed a slot, so
    // the total-row position (and overall table height) stays fixed.
    const fillerRows = disc > 0 ? 2 : 3;
    for (let i = 0; i < fillerRows; i++) {
      cols.forEach((c, ci) => rect(colX[ci], y, c.w, rowH, null, '#000'));
      y += rowH;
    }

    const totalRowH = 18;
    const totBoxes = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    cols.forEach((c, i) => rect(colX[i], y, c.w, totalRowH, null, '#000'));
    boldText('Total', colX[C_DESC] + 3, y + 5, { size: 8 });
    boldText(`${totBoxes.toFixed(2)} CTN`, colX[C_QTY] + 2, y + 5, { size: 8, width: cols[C_QTY].w - 4, align: 'center' });
    // Grand total on one line, right-aligned manually (a width box wraps here).
    const gt = `${B.currencyCode} ${total.toFixed(2)}`;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
    const gtW = doc.widthOfString(gt);
    doc.text(gt, colX[C_AMT] + cols[C_AMT].w - 3 - gtW, y + 5, { lineBreak: false });
    boldText(`${tax.toFixed(2)}`, colX[C_VATA] + 2, y + 5, { size: 8, width: cols[C_VATA].w - 4, align: 'right' });
    y += totalRowH;

    // -- Amount in words section -----------------------------------------------
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
    text(`${taxable.toFixed(2)}`, rx2 + 38, y + 17, { size: 7.5 });
    boldText(`${tax.toFixed(2)}`, rx2 + 105, y + 17, { size: 7.5 });
    line(M + innerW * 0.55, y + 28, W - M, y + 28, '#000', 0.5);
    boldText('Total', rx2 + 10, y + 31, { size: 7.5 });
    text(`${taxable.toFixed(2)}`, rx2 + 38, y + 31, { size: 7.5 });
    boldText(`${tax.toFixed(2)}`, rx2 + 105, y + 31, { size: 7.5 });

    y += wordsH;

    // -- Declaration + Signature -----------------------------------------------
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