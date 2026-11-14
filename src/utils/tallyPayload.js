// utils/tallyPayload.js
// PURE functions (no database, no network) that turn a CRM Sales Order or
// Purchase Order into the normalized, already-mapped snapshot the Windows
// connector turns into Tally XML. Kept DB-free so it is easy to unit test.
//
// Rules implemented (agreed for v1):
//   • currency must be AED on the CRM company
//   • Sales Order must not be Pending/Cancelled; Purchase Order must be Ordered/Received
//   • customer / supplier / item / unit must resolve through TallyMapping
//   • item lookup: "<modelCode>|<size>" first, then "<modelCode>|*"
//   • order-level discount % is folded into each line's rate (no VAT, no tax ledgers)
//   • qty is the Tally quantity (`pieces` is informational and not sent)
//   • order due date = order date (CRM has no delivery date)

export const SNAPSHOT_VERSION = 1;
export const SALES_ORDER = 'SALES_ORDER';
export const PURCHASE_ORDER = 'PURCHASE_ORDER';

export const SO_BLOCKED_STATUSES = ['Pending', 'Cancelled'];
export const PO_ALLOWED_STATUSES = ['Ordered', 'Received'];

export const normalizeKey = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
export const itemKey = (modelCode, size) => `${normalizeKey(modelCode)}|${normalizeKey(size) || '*'}`;
export const itemAnySizeKey = (modelCode) => `${normalizeKey(modelCode)}|*`;

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

// Date -> YYYYMMDD in the business timezone (orders are stored as UTC Dates).
export function toTallyDate(date, timeZone = 'Asia/Dubai') {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}${parts.month}${parts.day}`;
}

// Strip control characters and cap length — narration goes into Tally XML.
const cleanText = (s, max = 400) =>
  String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export const referenceFor = (sourceType, no) => `${sourceType === SALES_ORDER ? 'CRM-SO' : 'CRM-PO'}-${no}`;
export const idempotencyKeyFor = (sourceType, companyId, no) =>
  `${sourceType === SALES_ORDER ? 'SO' : 'PO'}:${String(companyId)}:${no}`;

// Which mapping keys a document needs (used to load mappings in one query).
export function collectMappingKeys(sourceType, doc) {
  const party = sourceType === SALES_ORDER ? doc.customer : doc.supplierName;
  const items = new Set();
  const units = new Set();
  for (const it of doc.items || []) {
    items.add(itemKey(it.modelCode, it.size));
    items.add(itemAnySizeKey(it.modelCode));
    if (it.unit) units.add(normalizeKey(it.unit));
  }
  return {
    partyKind: sourceType === SALES_ORDER ? 'customer' : 'supplier',
    partyKey: normalizeKey(party),
    itemKeys: [...items],
    unitKeys: [...units],
  };
}

/**
 * Build the snapshot.
 * @param {object} a
 * @param {'SALES_ORDER'|'PURCHASE_ORDER'} a.sourceType
 * @param {object} a.doc         plain Order / PurchaseOrder object
 * @param {object} a.companyId
 * @param {string} a.currencyCode CRM company currency code
 * @param {object} a.settings    TallyConnector.settings
 * @param {object} a.maps        { party: Map<key,{tallyName}>, item: Map<key,{tallyName,tallyUnit}>, unit: Map<key,{tallyName}> }
 * @returns {{ ok: boolean, payload?: object, errors: Array<{code,message,field?}> }}
 */
export function buildTallySnapshot({ sourceType, doc, companyId, currencyCode, settings, maps, skipStatusGate = false }) {
  const errors = [];
  const err = (code, message, field) => errors.push({ code, message, ...(field ? { field } : {}) });
  const isSO = sourceType === SALES_ORDER;

  if (![SALES_ORDER, PURCHASE_ORDER].includes(sourceType)) {
    return { ok: false, errors: [{ code: 'UNSUPPORTED_TYPE', message: `Unsupported voucher type ${sourceType}` }] };
  }

  // ── Gate: status (first send only; later edits of a linked doc skip it) ──
  if (!skipStatusGate && isSO && SO_BLOCKED_STATUSES.includes(doc.status)) {
    err('INVALID_STATUS', `Order is ${doc.status}. Confirm it before syncing to Tally.`, 'status');
  }
  if (!skipStatusGate && !isSO && !PO_ALLOWED_STATUSES.includes(doc.status)) {
    err('INVALID_STATUS', `Purchase order is ${doc.status}. Only Ordered or Received POs can be synced.`, 'status');
  }

  // ── Gate: currency ───────────────────────────────────────────────────────
  const expectedCurrency = String(settings?.baseCurrency || 'AED').toUpperCase();
  if (String(currencyCode || '').toUpperCase() !== expectedCurrency) {
    err('CURRENCY_MISMATCH', `CRM company currency is ${currencyCode || 'not set'}; Tally sync requires ${expectedCurrency}.`, 'currency');
  }

  // ── Gate: connector settings ─────────────────────────────────────────────
  const tallyCompany = settings?.tallyCompanyName;
  const voucherTypeName = isSO ? settings?.salesOrderVoucherType : settings?.purchaseOrderVoucherType;
  const accountLedger = isSO ? settings?.salesLedger : settings?.purchaseLedger;
  if (!tallyCompany) err('SETTINGS_MISSING', 'Tally company name is not configured.', 'settings.tallyCompanyName');
  if (!voucherTypeName) err('SETTINGS_MISSING', 'Tally voucher type name is not configured.', 'settings.voucherType');
  if (!accountLedger) err('SETTINGS_MISSING', `Tally ${isSO ? 'sales' : 'purchase'} ledger is not configured.`, isSO ? 'settings.salesLedger' : 'settings.purchaseLedger');
  if (!settings?.godown) err('SETTINGS_MISSING', 'Tally godown is not configured.', 'settings.godown');

  // ── Date ─────────────────────────────────────────────────────────────────
  const date = toTallyDate(doc.date, settings?.timezone || 'Asia/Dubai');
  if (!date) err('INVALID_DATE', 'Order date is missing or invalid.', 'date');

  // ── Party ────────────────────────────────────────────────────────────────
  const partyRaw = isSO ? doc.customer : doc.supplierName;
  const partyMap = maps?.party?.get(normalizeKey(partyRaw));
  if (!partyMap) err('UNMAPPED_MASTER', `${isSO ? 'Customer' : 'Supplier'} "${partyRaw}" has no Tally ledger mapping.`, 'party');

  // ── Lines ────────────────────────────────────────────────────────────────
  const discountPct = isSO ? Math.min(100, Math.max(0, Number(doc.discount) || 0)) : 0;
  const factor = 1 - discountPct / 100;
  const items = Array.isArray(doc.items) ? doc.items : [];
  if (!items.length) err('NO_ITEMS', 'Order has no items.', 'items');

  const lines = items.map((it, i) => {
    const qty = Number(it.qty);
    const price = Number(it.price);
    if (!Number.isFinite(qty) || qty <= 0) err('INVALID_LINE', `Line ${i + 1}: quantity must be greater than 0.`, `items.${i}.qty`);
    if (!Number.isFinite(price) || price < 0) err('INVALID_LINE', `Line ${i + 1}: price is invalid.`, `items.${i}.price`);

    const m = maps?.item?.get(itemKey(it.modelCode, it.size)) || maps?.item?.get(itemAnySizeKey(it.modelCode));
    if (!m) {
      err('UNMAPPED_MASTER', `Item "${it.modelCode}${it.size ? ` / size ${it.size}` : ''}" has no Tally stock item mapping.`, `items.${i}`);
    }
    // Unit: item mapping wins, else CRM unit through unit mapping.
    let unit = m?.tallyUnit || '';
    if (!unit && it.unit) unit = maps?.unit?.get(normalizeKey(it.unit))?.tallyName || '';
    if (m && !unit) {
      err('UNMAPPED_MASTER', `Line ${i + 1}: no Tally unit for "${it.modelCode}"${it.unit ? ` (CRM unit ${it.unit})` : ''}.`, `items.${i}.unit`);
    }

    return {
      stockItem: m?.tallyName || '',
      unit,
      qty: Number.isFinite(qty) ? qty : 0,
      rate: round4((Number.isFinite(price) ? price : 0) * factor),
      amount: round2((Number.isFinite(qty) ? qty : 0) * (Number.isFinite(price) ? price : 0) * factor),
      crm: { modelCode: it.modelCode, size: it.size || '', description: cleanText(it.description, 120) },
    };
  });

  // ── Totals must agree with the CRM ───────────────────────────────────────
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  const crmTotal = round2(Number(doc.grandTotal) || 0);
  const tolerance = round2(0.01 * Math.max(1, lines.length));
  if (lines.length && Math.abs(total - crmTotal) > tolerance) {
    err('AMOUNT_MISMATCH', `Line amounts total ${total.toFixed(2)} but CRM total is ${crmTotal.toFixed(2)}.`, 'grandTotal');
  }

  if (errors.length) return { ok: false, errors };

  const no = isSO ? doc.orderNo : doc.poNo;
  const reference = referenceFor(sourceType, no);
  const narration = isSO
    ? cleanText(`CRM Order #${no}${doc.salespersonName ? ` | Salesperson: ${doc.salespersonName}` : ''}${discountPct ? ` | Discount ${discountPct}% applied in rates` : ''}`)
    : cleanText(`CRM Purchase Order PO-${no}`);

  return {
    ok: true,
    errors: [],
    payload: {
      snapshotVersion: SNAPSHOT_VERSION,
      operation: 'CREATE',
      voucherType: sourceType,
      voucherTypeName,
      tallyCompany,
      currency: expectedCurrency,
      date,
      dueDate: date,
      reference,
      idempotencyKey: idempotencyKeyFor(sourceType, companyId, no),
      partyLedger: partyMap.tallyName,
      accountLedger,
      godown: settings.godown,
      lines,
      total,
      crmTotal,
      narration,
      source: { type: sourceType, id: String(doc._id), no },
    },
  };
}

// True when two snapshots would produce the same voucher in Tally (used to
// skip pointless ALTER jobs, e.g. when only the CRM mobile number changed).
export function tallyRelevantEqual(a, b) {
  if (!a || !b) return false;
  const pick = (p) => JSON.stringify({
    voucherTypeName: p.voucherTypeName, tallyCompany: p.tallyCompany, date: p.date, dueDate: p.dueDate,
    partyLedger: p.partyLedger, accountLedger: p.accountLedger, godown: p.godown, narration: p.narration, total: p.total,
    lines: (p.lines || []).map((l) => [l.stockItem, l.unit, l.qty, l.rate, l.amount]),
  });
  return pick(a) === pick(b);
}
