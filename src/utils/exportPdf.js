// Lightweight PDF export for list pages.
// Loads jsPDF + autotable from CDN on first use so no npm install / build change
// is needed. Falls back with a clear error if the CDN can't be reached.

const CDN = {
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
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
    s.src = src;
    s.async = true;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureJsPDF() {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  if (!loadingPromise) {
    loadingPromise = (async () => {
      await loadScript(CDN.jspdf);
      await loadScript(CDN.autotable);
    })();
  }
  await loadingPromise;
  if (!window.jspdf?.jsPDF) throw new Error('PDF library unavailable.');
  return window.jspdf.jsPDF;
}

/**
 * Export a table to a downloadable PDF.
 * @param {Object}   opts
 * @param {string}   opts.title     - Document title (also part of filename)
 * @param {string[]} opts.columns   - Column headers
 * @param {Array[]}  opts.rows      - Array of row arrays (strings/numbers)
 * @param {Object}   [opts.meta]    - Optional key/value lines under the title (e.g. filters, totals)
 * @param {string}   [opts.filename]- Override filename (without extension)
 * @param {('p'|'l')} [opts.orientation]
 */
export async function exportTablePdf({ title, columns, rows, meta = {}, filename, orientation = 'l' }) {
  const JsPDF = await ensureJsPDF();
  const doc = new JsPDF({ orientation, unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const now = new Date();

  // Brand header (left)
  doc.setFontSize(15);
  doc.setTextColor(26, 26, 46);
  doc.setFont(undefined, 'bold');
  

  doc.setFontSize(11);
  doc.setTextColor(37, 99, 235);
  doc.text(title, 40, 56);

  // Meta lines (filters / counts) on the right
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.setFont(undefined, 'normal');
  const metaTop = 34;
  const metaLineH = 12;
  // The built-in font only supports basic Latin; replace common unicode (arrows,
  // dashes) with ASCII so they don't render as garbage, then trim if too long.
  const sanitize = (s) =>
    String(s)
      .replace(/[\u2192\u2190\u2194]/g, 'to')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[^\x20-\x7E]/g, '');
  const metaMaxW = pageW - 80 - 220; // keep meta clear of the left title block
  const metaLines = [`Generated: ${now.toLocaleString()}`, ...Object.entries(meta).map(([k, v]) => `${k}: ${v}`)]
    .map(sanitize)
    .map((line) => {
      let t = line;
      while (t.length > 4 && doc.getTextWidth(t) > metaMaxW) t = t.slice(0, -2);
      return t === line ? t : `${t.slice(0, -1)}...`;
    });
  metaLines.forEach((line, i) => doc.text(line, pageW - 40, metaTop + i * metaLineH, { align: 'right' }));

  // Start the table below BOTH the title block and the (possibly taller) meta
  // block, plus a small gap — otherwise long meta lists overlap the header.
  const metaBottom = metaTop + (metaLines.length - 1) * metaLineH;
  const startY = Math.max(70, metaBottom + 16);

  doc.autoTable({
    head: [columns],
    body: rows,
    startY,
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [22, 33, 62], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 40, right: 40 },
    didDrawPage: (d) => {
      const page = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Page ${page}`, pageW - 40, doc.internal.pageSize.getHeight() - 18, { align: 'right' });
    },
  });

  const safe = (filename || title).replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  doc.save(`${safe}_${now.toISOString().slice(0, 10)}.pdf`);
}

/**
 * Export MULTIPLE labeled sections (e.g. Leads, Orders, Invoices, Employees)
 * into a single PDF — each section gets its own heading + table, stacked
 * top-to-bottom, flowing onto new pages as needed. Use this instead of
 * exportTablePdf when a report has several distinct sub-tables that should
 * stay clearly separated rather than merged into one flat table.
 * @param {Object}   opts
 * @param {string}   opts.title     - Document title (also part of filename)
 * @param {Array}    opts.sections  - [{ title, columns, rows }, ...] — rows-less or empty sections are skipped
 * @param {Object}   [opts.meta]    - Optional key/value lines under the title
 * @param {string}   [opts.filename]
 * @param {('p'|'l')} [opts.orientation]
 */
export async function exportSectionsPdf({ title, sections, meta = {}, filename, orientation = 'l' }) {
  const JsPDF = await ensureJsPDF();
  const doc = new JsPDF({ orientation, unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const now = new Date();

  doc.setFontSize(15);
  doc.setTextColor(26, 26, 46);
  doc.setFont(undefined, 'bold');

  doc.setFontSize(11);
  doc.setTextColor(37, 99, 235);
  doc.text(title, 40, 56);

  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.setFont(undefined, 'normal');
  const metaTop = 34;
  const metaLineH = 12;
  const sanitize = (s) =>
    String(s)
      .replace(/[\u2192\u2190\u2194]/g, 'to')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[^\x20-\x7E]/g, '');
  const metaMaxW = pageW - 80 - 220;
  const metaLines = [`Generated: ${now.toLocaleString()}`, ...Object.entries(meta).map(([k, v]) => `${k}: ${v}`)]
    .map(sanitize)
    .map((line) => {
      let t = line;
      while (t.length > 4 && doc.getTextWidth(t) > metaMaxW) t = t.slice(0, -2);
      return t === line ? t : `${t.slice(0, -1)}...`;
    });
  metaLines.forEach((line, i) => doc.text(line, pageW - 40, metaTop + i * metaLineH, { align: 'right' }));

  const metaBottom = metaTop + (metaLines.length - 1) * metaLineH;
  let cursorY = Math.max(70, metaBottom + 16);

  const addPageFooter = () => {
    const page = doc.internal.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Page ${page}`, pageW - 40, pageH - 18, { align: 'right' });
  };

  const visible = (sections || []).filter((s) => s && s.rows && s.rows.length);

  if (!visible.length) {
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text('No data for any section on this date.', 40, cursorY);
    addPageFooter();
  } else {
    visible.forEach((section, idx) => {
      // Section heading. If it won't fit on the current page, start a new one.
      if (cursorY > pageH - 90) { doc.addPage(); cursorY = 50; }
      doc.setFontSize(11);
      doc.setTextColor(22, 33, 62);
      doc.setFont(undefined, 'bold');
 doc.text(`${section.title} (${section.rows.length})`, 40, cursorY);
      cursorY += 8;

      doc.autoTable({
        head: [section.columns],
        body: section.rows,
        startY: cursorY,
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 3.5, overflow: 'linebreak' },
        headStyles: { fillColor: [22, 33, 62], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 40, right: 40 },
        didDrawPage: addPageFooter,
      });

      // autoTable advances doc.lastAutoTable.finalY; gap before the next section.
      cursorY = doc.lastAutoTable.finalY + 26;
    });
  }

  const safeName = (filename || title).replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  doc.save(`${safeName}_${now.toISOString().slice(0, 10)}.pdf`);
}
/**
 * Export a table to a downloadable CSV file. Same column/row shape as the PDF
 * export so callers can reuse their data. Synchronous (no CDN needed).
 */
export function exportTableCsv({ title, columns, rows, filename }) {
  const esc = (val) => {
    const s = val == null ? '' : String(val);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const safe = (filename || title).replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `${safe}_${new Date().toISOString().slice(0, 10)}.csv`,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export MULTIPLE labeled sections into a single CSV file. Each section is
 * written as: a "## Section Title (N)" row, its own header row, then its
 * data rows, followed by a blank line before the next section. Opens cleanly
 * in Excel/Sheets with each section visually separated.
 * @param {Object} opts
 * @param {string} opts.title    - Used for the filename
 * @param {Array}  opts.sections - [{ title, columns, rows }, ...]
 * @param {string} [opts.filename]
 */
export function exportSectionsCsv({ title, sections, filename }) {
  const esc = (val) => {
    const s = val == null ? '' : String(val);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [];
  const visible = (sections || []).filter((s) => s && s.rows && s.rows.length);

  if (!visible.length) {
    lines.push('No data for any section on this date.');
  } else {
    visible.forEach((section, idx) => {
      if (idx > 0) lines.push('');
      lines.push(esc(`## ${section.title} (${section.rows.length})`));
      lines.push(section.columns.map(esc).join(','));
      section.rows.forEach((r) => lines.push(r.map(esc).join(',')));
    });
  }

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const safe = (filename || title).replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `${safe}_${new Date().toISOString().slice(0, 10)}.csv`,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}