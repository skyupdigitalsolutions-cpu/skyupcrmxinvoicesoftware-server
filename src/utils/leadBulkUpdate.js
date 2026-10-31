// leadBulkUpdate.js — export leads → edit in Excel → re-upload to update them.
// Rows are matched by the "Lead ID" column, never by phone number, so a
// corrected number updates the existing lead instead of creating a duplicate.

import { exportTableCsv } from './exportPdf.js';
import {
  LEAD_STATUSES, LEAD_SOURCES, ALL_COUNTRY_NAMES, cleanPhone, leadStageOf,
} from './format.js';

export const UPDATE_CHUNK = 500; // leads per request (server cap is 1000)

// Editable columns first, read-only reference columns last (ignored on upload).
export const UPDATE_COLUMNS = [
  'Lead ID', 'Name', 'Mobile', 'Country', 'Email', 'City', 'Source', 'Campaign',
  'Interest', 'Remark', 'Delivery', 'Status', 'Owner', 'Follow-up Date',
  'Stage (read-only)', 'Created (read-only)',
];

const HEADER_MAP = {
  'lead id': '_id', 'leadid': '_id', id: '_id', _id: '_id',
  name: 'name', mobile: 'mobile', country: 'country', email: 'email', city: 'city',
  source: 'source', campaign: 'campaign', interest: 'interest', remark: 'remark',
  delivery: 'delivery', status: 'status', owner: 'owner',
  'follow-up date': 'followUpAt', 'follow up date': 'followUpAt', followup: 'followUpAt',
};

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '' : `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

/** Export the given leads in the editable layout. */
export function exportLeadsForUpdate(leads) {
  exportTableCsv({
    title: 'leads_for_update',
    columns: UPDATE_COLUMNS,
    rows: leads.map((l) => [
      l._id, l.name || '', l.mobile || '', l.country || '', l.email || '', l.city || '',
      l.source || '', l.campaign || '', l.interest || '', l.remark || '', l.delivery || '',
      l.status || '', l.ownerName || '', localDate(l.followUpAt),
      leadStageOf(l), localDate(l.createdAt),
    ]),
  });
}

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Accepts YYYY-MM-DD plus what Excel commonly saves: DD/MM/YYYY, DD-MM-YYYY.
function normalizeDate(raw) {
  const v = raw.trim();
  if (!v) return { value: '' };
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y, mo, d;
  if (m) { [, y, mo, d] = m; }
  else if ((m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) { [, d, mo, y] = m; }
  else return { error: `invalid follow-up date "${v}" (use YYYY-MM-DD)` };
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  if (dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(mo) - 1 || dt.getDate() !== Number(d)) {
    return { error: `invalid follow-up date "${v}"` };
  }
  return { value: `${y}-${pad(mo)}-${pad(d)}` };
}

const blankish = (s) => { const v = String(s ?? '').trim(); return v === '—' || v === '-' ? '' : v; };
const ci = (list, v) => list.find((x) => x.toLowerCase() === v.toLowerCase());
const COUNTRY_LOWER = new Map(ALL_COUNTRY_NAMES.map((c) => [c.toLowerCase(), c]));

/**
 * Compare an uploaded file with the leads currently loaded and work out, per
 * row, exactly which fields changed. Only changed fields are sent to the
 * server. Blank cell = "clear it" for Email/City/Campaign/Remark/Delivery/
 * Follow-up; for every other column a blank cell means "leave as is".
 */
export function buildUpdatePlan(text, leads) {
  const parsed = parseCsv(text);
  const plan = { updates: [], preview: [], total: 0, unchanged: 0, errors: [] };
  if (!parsed.length) { plan.errors.push('File is empty.'); return plan; }

  const header = parsed[0].map((h) => HEADER_MAP[h.trim().toLowerCase()] || null);
  if (!header.includes('_id')) {
    plan.errors.push('The file needs a "Lead ID" column. Use "Export for Update" to get the correct layout.');
    return plan;
  }

  const byId = new Map(leads.map((l) => [String(l._id), l]));
  const seen = new Set();

  for (let r = 1; r < parsed.length; r++) {
    const cells = parsed[r];
    const row = {};
    header.forEach((k, c) => { if (k) row[k] = blankish(cells[c]); });
    const rowNo = r + 1;
    plan.total++;

    const id = row._id;
    if (!id) { plan.errors.push(`Row ${rowNo}: Lead ID is empty — skipped.`); continue; }
    if (seen.has(id)) { plan.errors.push(`Row ${rowNo}: Lead ID appears more than once — skipped.`); continue; }
    seen.add(id);
    const lead = byId.get(id);
    if (!lead) { plan.errors.push(`Row ${rowNo}: no lead with this Lead ID (deleted, or not in your list).`); continue; }

    const patch = {};
    const diffs = [];
    let bad = null;
    const set = (key, label, nv, ov) => { patch[key] = nv; diffs.push({ label, from: ov, to: nv }); };

    // name — required, never blank
    if ('name' in row) {
      if (!row.name) bad = 'Name cannot be empty';
      else if (row.name !== (lead.name || '')) set('name', 'Name', row.name, lead.name || '');
    }

    // country (validated against known list)
    let country = lead.country;
    if (row.country) {
      const known = COUNTRY_LOWER.get(row.country.toLowerCase());
      if (!known) bad = bad || `unknown country "${row.country}"`;
      else if (known !== lead.country) { set('country', 'Country', known, lead.country || ''); country = known; }
    }

    // mobile — compared as a normalised number so formatting changes are ignored
    if (row.mobile) {
      if (/^[\d.]+e\+?\d+$/i.test(row.mobile)) {
        bad = bad || `mobile "${row.mobile}" was turned into scientific notation by Excel — format the column as Text`;
      } else if (row.mobile.replace(/\D/g, '').length < 6) {
        bad = bad || `mobile "${row.mobile}" is too short`;
      } else if (cleanPhone(row.mobile, country) !== cleanPhone(lead.mobile, lead.country)
                 && cleanPhone(row.mobile, country) !== cleanPhone(lead.mobile, country)) {
        set('mobile', 'Mobile', row.mobile, lead.mobile || '');
      }
    }

    // free-text columns: blank clears
    ['email', 'city', 'campaign', 'remark', 'delivery'].forEach((k) => {
      if (!(k in row)) return;
      const nv = k === 'email' ? row[k].toLowerCase() : row[k];
      const ov = lead[k] || '';
      if (nv !== ov) set(k, k[0].toUpperCase() + k.slice(1), nv, ov);
    });
    if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) bad = bad || `invalid email "${patch.email}"`;

    // interest: blank = unchanged
    if (row.interest && row.interest !== (lead.interest || '')) set('interest', 'Interest', row.interest, lead.interest || '');

    // source / status: must be valid values, blank = unchanged
    if (row.source) {
      const s = ci(LEAD_SOURCES, row.source);
      if (!s) bad = bad || `unknown source "${row.source}"`;
      else if (s !== lead.source) set('source', 'Source', s, lead.source || '');
    }
    if (row.status) {
      const s = ci(LEAD_STATUSES, row.status);
      if (!s) bad = bad || `unknown status "${row.status}"`;
      else if (s === 'Won' && lead.status !== 'Won') bad = bad || 'status "Won" is set by converting the lead to an order';
      else if (s !== lead.status) set('status', 'Status', s, lead.status || '');
    }

    // owner: matched by user name on the server; blank = unchanged
    if (row.owner && row.owner !== (lead.ownerName || '')) set('owner', 'Owner', row.owner, lead.ownerName || '');

    // follow-up date: blank clears
    if ('followUpAt' in row) {
      const d = normalizeDate(row.followUpAt);
      if (d.error) bad = bad || d.error;
      else if (d.value !== localDate(lead.followUpAt)) set('followUpAt', 'Follow-up', d.value, localDate(lead.followUpAt));
    }

    if (bad) { plan.errors.push(`Row ${rowNo} (${lead.name}): ${bad} — skipped.`); continue; }
    if (!diffs.length) { plan.unchanged++; continue; }

    plan.updates.push({ _id: id, ...patch });
    plan.preview.push({ name: lead.name, diffs });
  }
  return plan;
}
