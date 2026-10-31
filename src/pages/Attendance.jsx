import { Clock, Settings, Trash2, X, MapPin, Download } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { attendanceApi } from '../api/endpoints.js';
import { useFetch } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { apiError } from '../api/client.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { Field, Input, Select } from '../components/ui/Field.jsx';
import { exportTablePdf, exportTableCsv } from '../utils/exportPdf.js';
import {
  ATTENDANCE_STATUSES, attendanceStatusLabel, attendanceStatusClass,
  formatDate, fmtTimeOnly, todayStr,
} from '../utils/format.js';

const SUMMARY = [
  { key: 'present', label: 'Present', color: 'border-ok' },
  { key: 'absent', label: 'Absent', color: 'border-danger' },
  { key: 'late', label: 'Late', color: 'border-warn' },
  { key: 'half_day', label: 'Half-Day', color: 'border-info' },
  { key: 'leave', label: 'Leave', color: 'border-purple-400' },
];

const toInputTime = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
};
const combine = (dateStr, timeStr) => (timeStr ? new Date(`${dateStr}T${timeStr}:00`).toISOString() : null);

const minsToTime = (m) => `${String(Math.floor((m || 0) / 60)).padStart(2, '0')}:${String((m || 0) % 60).padStart(2, '0')}`;
const timeToMins = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const DOW = [['0', 'Sun'], ['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat']];

// Google Maps link for a captured clock-in/out coordinate (null when none).
const mapsUrl = (loc) =>
  (loc && loc.lat != null && loc.lng != null) ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : null;

// Country-wise timezone presets for the attendance config. The value is an IANA
// zone; day-boundaries and late calculations on the server use this zone.
const TZ_PRESETS = [
  { tz: 'Asia/Dubai',    label: 'UAE — Dubai (GST, UTC+4)' },
  { tz: 'Asia/Riyadh',   label: 'Saudi Arabia — Riyadh (UTC+3)' },
  { tz: 'Asia/Qatar',    label: 'Qatar — Doha (UTC+3)' },
  { tz: 'Asia/Kuwait',   label: 'Kuwait (UTC+3)' },
  { tz: 'Asia/Bahrain',  label: 'Bahrain (UTC+3)' },
  { tz: 'Asia/Muscat',   label: 'Oman — Muscat (UTC+4)' },
  { tz: 'Asia/Kolkata',  label: 'India — Kolkata (IST, UTC+5:30)' },
  { tz: 'Europe/London', label: 'UK — London (UTC+0/+1)' },
  { tz: 'America/New_York', label: 'US — New York (ET)' },
  { tz: 'UTC',           label: 'UTC' },
];

// ── Edit / backfill modal ─────────────────────────────────────────────────────
function EditModal({ rec, onClose, onSaved }) {
  const { show } = useToast();
  const [form, setForm] = useState({
    loginTime: toInputTime(rec.loginTime),
    logoutTime: toInputTime(rec.logoutTime),
    crmStatus: rec.derivedStatus || '',
    remarks: rec.remarks || '',
  });
  const [busy, setBusy] = useState(false);
  const nonWorking = ['leave', 'holiday', 'absent'].includes(form.crmStatus);

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        loginTime: nonWorking ? null : combine(rec.date, form.loginTime),
        logoutTime: nonWorking ? null : combine(rec.date, form.logoutTime),
        crmStatus: form.crmStatus || null,
        remarks: form.remarks,
      };
      if (rec._id) await attendanceApi.update(rec._id, payload);
      else await attendanceApi.upsert({ ...payload, user: rec.user?._id, date: rec.date });
      show('Attendance saved.', 'success');
      onSaved();
      onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`${rec.user?.name} · ${formatDate(rec.date)}`}>
      <div className="space-y-3.5">
        <Field label="Status">
          <Select value={form.crmStatus} onChange={(e) => setForm({ ...form, crmStatus: e.target.value })}>
            <option value="">— Auto-calculate —</option>
            {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{attendanceStatusLabel(s)}</option>)}
          </Select>
        </Field>

        {!nonWorking && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Clock In"><Input type="time" value={form.loginTime} onChange={(e) => setForm({ ...form, loginTime: e.target.value })} /></Field>
            <Field label="Clock Out"><Input type="time" value={form.logoutTime} onChange={(e) => setForm({ ...form, logoutTime: e.target.value })} /></Field>
          </div>
        )}

        {nonWorking && (
          <p className="rounded-md bg-warn-light px-3 py-2 text-[11px] text-warn">
            Clock-in/out times don&rsquo;t apply for this status and will be cleared.
          </p>
        )}

        <Field label="Remarks">
          <Input
            value={form.remarks}
            placeholder="Optional note…"
            onChange={(e) => setForm({ ...form, remarks: e.target.value })}
          />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}

// ── Attendance rules / config modal (admin) ────────────────────────────────
function RulesModal({ onClose }) {
  const { show } = useToast();
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newHol, setNewHol] = useState({ date: '', name: '' });
  const [office, setOffice] = useState({ enabled: false, lat: '', lng: '', radiusMeters: 100 });
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    attendanceApi.getConfig()
      .then((c) => {
        setCfg(c);
        const o = c.office || {};
        setOffice({
          enabled: !!o.enabled,
          lat: o.lat ?? '',
          lng: o.lng ?? '',
          radiusMeters: o.radiusMeters ?? 100,
        });
      })
      .catch((e) => { show(apiError(e), 'error'); onClose(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const useCurrentLocation = () => {
    if (!('geolocation' in navigator)) return show('Geolocation not supported on this device.', 'error');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOffice((o) => ({ ...o, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6), enabled: true }));
        setLocating(false);
        show('Office location set to your current position.', 'success');
      },
      () => { setLocating(false); show('Could not get your location. Allow location access and retry.', 'error'); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const toggleDay = (n) => setCfg((c) => {
    const has = c.weeklyOffDays.includes(n);
    return { ...c, weeklyOffDays: has ? c.weeklyOffDays.filter((d) => d !== n) : [...c.weeklyOffDays, n].sort() };
  });

  const addHoliday = () => {
    if (!newHol.date) return;
    if (cfg.holidays.some((h) => h.date === newHol.date)) return show('That date is already a holiday.', 'error');
    setCfg((c) => ({ ...c, holidays: [...c.holidays, { date: newHol.date, name: newHol.name || 'Holiday' }].sort((a, b) => a.date.localeCompare(b.date)) }));
    setNewHol({ date: '', name: '' });
  };
  const removeHoliday = (date) => setCfg((c) => ({ ...c, holidays: c.holidays.filter((h) => h.date !== date) }));

  const save = async () => {
    setBusy(true);
    try {
      await attendanceApi.saveConfig({
        lateAfterMinutes: cfg.lateAfterMinutes,
        halfDayMinMinutes: cfg.halfDayMinMinutes,
        fullDayMinMinutes: cfg.fullDayMinMinutes,
        weeklyOffDays: cfg.weeklyOffDays,
        holidays: cfg.holidays,
        shiftStart: cfg.shiftStart || '09:00',
        shiftEnd: cfg.shiftEnd || '18:00',
        timezone: cfg.timezone || 'Asia/Dubai',
        office: {
          enabled: !!office.enabled,
          lat: office.lat === '' ? null : Number(office.lat),
          lng: office.lng === '' ? null : Number(office.lng),
          radiusMeters: Number(office.radiusMeters) || 100,
        },
      });
      show('Attendance rules saved.', 'success');
      onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Attendance Rules">
      {!cfg ? <Spinner label="Loading rules…" /> : (
        <div className="space-y-4">
          <Field label="Timezone (country-wise — used for date & late calculation)">
            <Select
              value={cfg.timezone || 'Asia/Dubai'}
              onChange={(e) => setCfg({ ...cfg, timezone: e.target.value })}
            >
              {TZ_PRESETS.some((p) => p.tz === (cfg.timezone || 'Asia/Dubai'))
                ? null
                : <option value={cfg.timezone}>{cfg.timezone} (current)</option>}
              {TZ_PRESETS.map((p) => <option key={p.tz} value={p.tz}>{p.label}</option>)}
            </Select>
            <p className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              All clock-in dates and late checks use this zone, regardless of where the server runs.
            </p>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Shift Start (expected clock-in)">
              <Input type="time" value={cfg.shiftStart || '09:00'} onChange={(e) => setCfg({ ...cfg, shiftStart: e.target.value })} />
            </Field>
            <Field label="Shift End (expected clock-out)">
              <Input type="time" value={cfg.shiftEnd || '18:00'} onChange={(e) => setCfg({ ...cfg, shiftEnd: e.target.value })} />
            </Field>
          </div>

          <Field label="Mark Late After (clock-in past this time = Late)">
            <Input type="time" value={minsToTime(cfg.lateAfterMinutes)} onChange={(e) => setCfg({ ...cfg, lateAfterMinutes: timeToMins(e.target.value) })} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Half-Day min (hours)">
              <Input type="number" min={0} step={0.5} value={(cfg.halfDayMinMinutes / 60).toFixed(1)}
                onChange={(e) => setCfg({ ...cfg, halfDayMinMinutes: Math.round(Number(e.target.value) * 60) })} />
            </Field>
            <Field label="Full-Day min (hours)">
              <Input type="number" min={0} step={0.5} value={(cfg.fullDayMinMinutes / 60).toFixed(1)}
                onChange={(e) => setCfg({ ...cfg, fullDayMinMinutes: Math.round(Number(e.target.value) * 60) })} />
            </Field>
          </div>
          <p className="-mt-2 text-[11px] text-ink-3">
            Worked &lt; {(cfg.halfDayMinMinutes / 60).toFixed(1)}h after clock-out is marked Half-Day; on-time clock-in counts as Present.
          </p>

          <Field label="Weekly Off Days">
            <div className="flex flex-wrap gap-1.5">
              {DOW.map(([n, label]) => {
                const num = Number(n);
                const off = cfg.weeklyOffDays.includes(num);
                return (
                  <button key={n} type="button" onClick={() => toggleDay(num)}
                    className={`w-11 rounded-md border py-1.5 text-[11px] font-bold transition ${off ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-gray-200 text-ink-3 hover:border-purple-300'}`}>
                    {label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Holidays">
            <div className="mb-2 flex gap-2">
              <Input type="date" value={newHol.date} onChange={(e) => setNewHol({ ...newHol, date: e.target.value })} />
              <Input value={newHol.name} placeholder="Name" onChange={(e) => setNewHol({ ...newHol, name: e.target.value })} />
              <Button size="sm" variant="outline" onClick={addHoliday}>Add</Button>
            </div>
            {cfg.holidays.length ? (
              <div className="max-h-36 space-y-1 overflow-y-auto">
                {cfg.holidays.map((h) => (
                  <div key={h.date} className="flex items-center justify-between rounded-md bg-gold-pale px-2.5 py-1.5 text-xs">
                    <span><b>{h.name}</b> · {h.date}</span>
                    <button type="button" className="text-danger" onClick={() => removeHoliday(h.date)}><X size={13} /></button>
                  </div>
                ))}
              </div>
            ) : <p className="text-[11px] italic text-ink-3">No holidays added.</p>}
          </Field>

          {/* ── Office location / geofence ──────────────────────────────── */}
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border-card)' }}>
            <label className="flex cursor-pointer items-center justify-between">
              <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                Restrict clock-in to office location
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-purple-500"
                checked={office.enabled}
                onChange={(e) => setOffice({ ...office, enabled: e.target.checked })}
              />
            </label>
            <p className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              When enabled, employees can only clock in within the set radius of this point.
            </p>

            {office.enabled && (
              <div className="mt-3 space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Latitude">
                    <Input type="number" step="0.000001" placeholder="e.g. 25.276987"
                      value={office.lat} onChange={(e) => setOffice({ ...office, lat: e.target.value })} />
                  </Field>
                  <Field label="Longitude">
                    <Input type="number" step="0.000001" placeholder="e.g. 55.296249"
                      value={office.lng} onChange={(e) => setOffice({ ...office, lng: e.target.value })} />
                  </Field>
                </div>
                <Field label="Allowed Radius (metres)">
                  <Input type="number" min={10} max={5000} step={10}
                    value={office.radiusMeters} onChange={(e) => setOffice({ ...office, radiusMeters: e.target.value })} />
                </Field>
                <Button size="sm" variant="outline" disabled={locating} onClick={useCurrentLocation}>
                  <MapPin size={13} className="mr-1.5" />{locating ? 'Locating…' : 'Use my current location'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !cfg} onClick={save}>{busy ? 'Saving…' : 'Save Rules'}</Button>
      </div>
    </Modal>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function Attendance() {
  const { isAdmin } = useAuth();
  const { show } = useToast();
  const today = todayStr();
  const [filters, setFilters] = useState({ startDate: today, endDate: today, userId: '', status: '' });
  const [editRec, setEditRec] = useState(null);
  const [trail, setTrail] = useState(null); // { user, date, pings } for the location-trail modal
  const [trailLoading, setTrailLoading] = useState(false);

  const openTrail = async (r) => {
    const uid = r.user?._id || r.user?.id;
    if (!uid) return;
    setTrailLoading(true);
    setTrail({ user: r.user, date: r.date, pings: null });
    try {
      const data = await attendanceApi.userLocations(uid, r.date);
      setTrail({ user: data.user || r.user, date: r.date, pings: data.pings || [] });
    } catch (e) {
      show(apiError(e), 'error');
      setTrail(null);
    } finally {
      setTrailLoading(false);
    }
  };
  const [rulesOpen, setRulesOpen] = useState(false);
  const { data: users } = useFetch(() => attendanceApi.users(), []);
  const { data: records, loading, refetch } = useFetch(() => attendanceApi.report(filters), [filters]);

  const setRange = (startDate, endDate) => setFilters((f) => ({ ...f, startDate, endDate }));
  const quickRange = (type) => {
    const d = new Date();
    if (type === 'today') return setRange(today, today);
    if (type === 'week') { const s = new Date(d); s.setDate(d.getDate() - 7); return setRange(s.toISOString().slice(0, 10), today); }
    if (type === 'month') return setRange(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10), today);
  };

  const summary = useMemo(() => {
    const counts = Object.fromEntries(SUMMARY.map((s) => [s.key, 0]));
    (records || []).forEach((r) => { if (counts[r.derivedStatus] !== undefined) counts[r.derivedStatus]++; });
    return counts;
  }, [records]);

  const remove = async (rec) => {
    if (!rec._id) return;
    if (!confirm(`Delete this attendance record for ${rec.user?.name}?`)) return;
    try { await attendanceApi.remove(rec._id); show('Record deleted.'); refetch(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  const [exporting, setExporting] = useState(false);
  const buildExport = () => ({
    title: 'Attendance Report',
    columns: ['Sl. No', 'Employee', 'Date', 'Clock In', 'Clock Out', 'Working Hours', 'Status', 'Remarks'],
    rows: (records || []).map((r, idx) => [
      idx + 1,
      r.user?.name || 'Unknown', formatDate(r.date), fmtTimeOnly(r.loginTime) || '—',
      fmtTimeOnly(r.logoutTime) || '—', r.workingHours || '—',
      attendanceStatusLabel(r.derivedStatus), r.remarks || '—',
    ]),
    meta: {
      Range: `${filters.startDate} to ${filters.endDate}`,
      Records: (records || []).length,
      Present: summary.present, Absent: summary.absent, Late: summary.late,
    },
  });
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

  return (
    <>
      <PageTitle icon={<Clock size={18} />} badge={records ? records.length : undefined}>Attendance</PageTitle>

      {isAdmin && (
        <div className="mb-3.5 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" disabled={!records?.length} onClick={exportCsv}>
            <span className="flex items-center gap-1.5"><Download size={14} />Export CSV</span>
          </Button>
          <Button size="sm" variant="dark" disabled={exporting || !records?.length} onClick={exportPdf}>
            <span className="flex items-center gap-1.5"><Download size={14} />{exporting ? 'Exporting…' : 'Export PDF'}</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRulesOpen(true)}><Settings size={14} className="mr-1.5" />Attendance Rules</Button>
        </div>
      )}

      <div className="mb-3.5 grid grid-cols-2 gap-2.5 md:grid-cols-5">
        {SUMMARY.map((s) => (
          <div key={s.key} className={`rounded-lg border-l-4 bg-white p-3 shadow-card ${s.color}`}>
            <div className="text-lg font-black text-navy">{loading ? '—' : summary[s.key]}</div>
            <div className="text-[10px] font-bold text-ink-2">{s.label}</div>
          </div>
        ))}
      </div>

      <Card>
        <div className="p-4 pb-0">
          <div className="mb-3 flex flex-wrap gap-2">
            {[['today', 'Today'], ['week', 'Last 7 Days'], ['month', 'This Month']].map(([k, l]) => (
              <Button key={k} size="sm" variant="outline" onClick={() => quickRange(k)}>{l}</Button>
            ))}
          </div>
          <div className="mb-4 flex flex-wrap items-end gap-2.5">
            <Field label="From"><Input type="date" value={filters.startDate} max={filters.endDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} /></Field>
            <Field label="To"><Input type="date" value={filters.endDate} min={filters.startDate} max={today} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} /></Field>
            {isAdmin && (
              <Field label="Employee">
                <Select className="!w-44" value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value })}>
                  <option value="">All Employees</option>
                  {(users || []).map((u) => <option key={u.id || u._id} value={u.id || u._id}>{u.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Status">
              <Select className="!w-36" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">All Statuses</option>
                {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{attendanceStatusLabel(s)}</option>)}
              </Select>
            </Field>
            <Button variant="outline" size="sm" onClick={() => setFilters({ startDate: today, endDate: today, userId: '', status: '' })}>Reset</Button>
          </div>
        </div>

        {loading ? <Spinner label="Loading attendance…" /> : !records?.length ? (
          <EmptyState title="No attendance records" hint="Try widening the date range or clearing filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr className="bg-navy-800 text-white">
                {['Sl. No', 'Employee', 'Date', 'Clock In', 'Clock Out', 'Working Hours', 'Location', 'Status', 'Remarks', isAdmin && 'Actions'].filter(Boolean).map((h) =>
                  <th key={h} className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={r._id || `${r.user?._id}-${r.date}-${i}`} className="border-b last:border-0 theme-table-row" style={{borderColor: "var(--border-card)"}}>
                    <td className="px-2.5 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                    <td className="px-2.5 py-2 text-xs font-bold">{r.user?.name || 'Unknown'}</td>
                    <td className="px-2.5 py-2 text-xs whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="px-2.5 py-2 text-xs">{fmtTimeOnly(r.loginTime)}</td>
                    <td className="px-2.5 py-2 text-xs">{fmtTimeOnly(r.logoutTime)}</td>
                    <td className="px-2.5 py-2 text-xs font-bold">{r.workingHours}</td>
                    <td className="px-2.5 py-2 text-xs">
                      <div className="flex flex-col gap-0.5">
                        {mapsUrl(r.loginLocation) && (
                          <a className="flex items-center gap-1 text-info hover:underline" href={mapsUrl(r.loginLocation)} target="_blank" rel="noreferrer">
                            <MapPin size={11} /> In
                          </a>
                        )}
                        {mapsUrl(r.logoutLocation) && (
                          <a className="flex items-center gap-1 text-info hover:underline" href={mapsUrl(r.logoutLocation)} target="_blank" rel="noreferrer">
                            <MapPin size={11} /> Out
                          </a>
                        )}
                        {!mapsUrl(r.loginLocation) && !mapsUrl(r.logoutLocation) && <span className="text-ink-3">—</span>}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => openTrail(r)}
                            className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-gold-700 hover:underline"
                          >
                            <MapPin size={11} /> Trail
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-2.5 py-2 text-xs"><span className={`status ${attendanceStatusClass(r.derivedStatus)}`}>{attendanceStatusLabel(r.derivedStatus)}</span></td>
                    <td className="px-2.5 py-2 text-xs italic text-ink-3">{r.remarks || '—'}</td>
                    {isAdmin && (
                      <td className="px-2.5 py-2"><div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setEditRec(r)}>{r._id ? 'Edit' : 'Add'}</Button>
                        {r._id && <Button size="sm" variant="red" onClick={() => remove(r)}><Trash2 size={13} /></Button>}
                      </div></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editRec && <EditModal rec={editRec} onClose={() => setEditRec(null)} onSaved={refetch} />}

      {trail && (
        <Modal open onClose={() => setTrail(null)} title={<span className="flex items-center gap-1.5"><MapPin size={16} /> Location trail · {trail.user?.name}</span>} width="sm:max-w-[460px]">
          <p className="mb-3 text-[12px] text-ink-2">{formatDate(trail.date)}</p>
          {trailLoading || trail.pings === null ? (
            <div className="py-6"><Spinner label="Loading trail…" /></div>
          ) : trail.pings.length === 0 ? (
            <EmptyState title="No location pings" hint="This employee sent no location samples on this day (tracking off, or the CRM wasn't open while clocked in)." />
          ) : (
            <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
              {trail.pings.map((p, i) => (
                <a
                  key={i}
                  href={mapsUrl(p)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-[12px] transition hover:bg-black/[0.03]"
                  style={{ borderColor: 'var(--border-card)' }}
                >
                  <span className="flex items-center gap-2">
                    <MapPin size={12} className="text-info" />
                    {new Date(p.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="flex items-center gap-2">
                    {p.distanceMeters != null && <span className="text-ink-3">{p.distanceMeters}m</span>}
                    {p.insideFence === true && <span className="rounded-full bg-ok-light px-2 py-0.5 text-[10px] font-bold text-ok">Inside</span>}
                    {p.insideFence === false && <span className="rounded-full bg-danger-light px-2 py-0.5 text-[10px] font-bold text-danger">Outside</span>}
                  </span>
                </a>
              ))}
            </div>
          )}
        </Modal>
      )}
      {rulesOpen && <RulesModal onClose={() => { setRulesOpen(false); refetch(); }} />}
    </>
  );
}