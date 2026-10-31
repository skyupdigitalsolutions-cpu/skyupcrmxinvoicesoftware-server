import { Users as UsersIcon, Plus, X, MapPin, Loader2, LocateFixed, Eye, EyeOff, Copy } from 'lucide-react';
import { useState, useEffect } from 'react';
import { userApi } from '../api/endpoints.js';
import { useFetch } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { apiError } from '../api/client.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import { Field, Input, Select } from '../components/ui/Field.jsx';
import { fmtDHS, formatDate, fmtTimeOnly } from '../utils/format.js';

const WORK_TONE = {
  Working: 'bg-ok text-white',
  'On break': 'bg-warn text-white',
  'Clocked out': 'bg-info-light text-info',
  'Not clocked in': 'bg-gray-100 text-ink-3',
};
const fmtMins = (m) => `${Math.floor((m || 0) / 60)}h ${String((m || 0) % 60).padStart(2, '0')}m`;
const initials = (name) => (name || 'U').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

// ── Employee detail drawer ──────────────────────────────────────────────────
function EmployeeDrawer({ id, onClose }) {
  const { show } = useToast();
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    userApi.get(id)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { show(apiError(e), 'error'); onClose(); });
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const u = data?.user;
  const att = data?.attendance;
  const st = data?.stats;

  return (
    <>
      <div className="fixed inset-0 z-[190] bg-black/40" onClick={onClose} />
      <div className="fixed right-0 top-0 z-[200] flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 bg-navy px-5 py-4 text-white">
          <h2 className="text-sm font-black">Employee Details</h2>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10"><X size={15} /></button>
        </div>

        {!data ? <div className="flex-1"><Spinner label="Loading…" /></div> : (
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold-pale text-base font-black text-navy">
                {initials(u.name)}
              </span>
              <div>
                <div className="text-base font-black text-navy">{u.name}</div>
                <div className="text-xs text-ink-3">@{u.username}</div>
              </div>
              <span className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-bold ${WORK_TONE[data.working] || 'bg-gray-100 text-ink-3'}`}>
                {data.working}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-lg bg-gold-pale px-3 py-2.5"><div className="text-ink-3">Status</div><div className="font-bold">{u.active ? <span className="text-ok">Active</span> : <span className="text-ink-3">Inactive</span>}</div></div>
              <div className="rounded-lg bg-gold-pale px-3 py-2.5"><div className="text-ink-3">Joined</div><div className="font-bold">{formatDate(data.createdAt)}</div></div>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-3">Today's Attendance</div>
              {att ? (
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="rounded-lg border border-gray-100 px-3 py-2.5"><div className="text-ink-3">Clock In</div><div className="font-bold">{fmtTimeOnly(att.loginTime) || '—'}</div></div>
                  <div className="rounded-lg border border-gray-100 px-3 py-2.5"><div className="text-ink-3">Clock Out</div><div className="font-bold">{fmtTimeOnly(att.logoutTime) || '—'}</div></div>
                  <div className="rounded-lg border border-gray-100 px-3 py-2.5"><div className="text-ink-3">Worked</div><div className="font-bold">{fmtMins(att.totalWorkMinutes)}</div></div>
                  <div className="rounded-lg border border-gray-100 px-3 py-2.5"><div className="text-ink-3">Break</div><div className="font-bold">{fmtMins(att.totalBreakMinutes)}</div></div>
                </div>
              ) : <p className="text-xs italic text-ink-3">No attendance record for today.</p>}
            </div>

            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-3">Performance</div>
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-lg border-l-4 border-gold bg-white px-3 py-2.5 shadow-card"><div className="text-lg font-black text-navy">{st.orders}</div><div className="text-ink-3">Orders</div></div>
                <div className="rounded-lg border-l-4 border-info bg-white px-3 py-2.5 shadow-card"><div className="text-lg font-black text-navy">{fmtDHS(st.revenue)}</div><div className="text-ink-3">Revenue</div></div>
                <div className="rounded-lg border-l-4 border-purple-400 bg-white px-3 py-2.5 shadow-card"><div className="text-lg font-black text-navy">{st.leads}</div><div className="text-ink-3">Leads</div></div>
                <div className="rounded-lg border-l-4 border-ok bg-white px-3 py-2.5 shadow-card"><div className="text-lg font-black text-navy">{st.won} <span className="text-xs font-bold text-ok">· {st.convRate}%</span></div><div className="text-ink-3">Won</div></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Add / Edit user modal ────────────────────────────────────────────────────
// mode: 'add' creates a salesperson; 'edit' updates name + optional password.
function UserFormModal({ mode, user, onClose, onSaved }) {
  const { show } = useToast();
  const isEdit = mode === 'edit';
  const [form, setForm] = useState({
    name: user?.name || '',
    username: user?.username || '',
    email: user?.email || '',
    password: '',
    loc: {
      enabled: user?.clockInLocation?.enabled ?? false,
      lat: user?.clockInLocation?.lat ?? '',
      lng: user?.clockInLocation?.lng ?? '',
      label: user?.clockInLocation?.label ?? '',
    },
    track: {
      enabled: user?.locationTracking?.enabled ?? false,
      intervalMinutes: user?.locationTracking?.intervalMinutes ?? 30,
    },
  });
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setLoc = (k, v) => setForm((f) => ({ ...f, loc: { ...f.loc, [k]: v } }));
  const setTrack = (k, v) => setForm((f) => ({ ...f, track: { ...f.track, [k]: v } }));

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return show('Geolocation is not supported on this device.', 'error');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, loc: { ...f.loc, lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6), enabled: true } }));
        setLocating(false);
        show('Captured current location.', 'success');
      },
      () => { setLocating(false); show('Could not get location. Allow location access and retry.', 'error'); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const buildLoc = () => ({
    enabled: !!form.loc.enabled,
    lat: form.loc.lat === '' ? null : Number(form.loc.lat),
    lng: form.loc.lng === '' ? null : Number(form.loc.lng),
    label: form.loc.label,
  });

  const buildTrack = () => ({
    enabled: !!form.track.enabled,
    intervalMinutes: Number(form.track.intervalMinutes) || 30,
  });

  const submit = async () => {
    if (!form.name.trim()) return show('Name is required.', 'error');
    if (!isEdit) {
      if (!form.username.trim()) return show('Username is required.', 'error');
      if (form.username.trim().length < 3) return show('Username must be at least 3 characters.', 'error');
      if (!form.password || form.password.length < 6) return show('Password must be at least 6 characters.', 'error');
    } else if (form.password && form.password.length < 6) {
      return show('New password must be at least 6 characters.', 'error');
    }
    if (form.loc.enabled && (form.loc.lat === '' || form.loc.lng === '')) {
      return show('Set a latitude & longitude for the clock-in location, or turn it off.', 'error');
    }
    setBusy(true);
    try {
      if (isEdit) {
        const payload = { name: form.name.trim(), email: form.email.trim(), clockInLocation: buildLoc(), locationTracking: buildTrack() };
        if (form.password) payload.password = form.password;
        await userApi.update(user.id, payload);
        show('User updated.', 'success');
      } else {
        await userApi.create({
          name: form.name.trim(),
          username: form.username.trim().toLowerCase(),
          email: form.email.trim(),
          password: form.password,
          role: 'sales',
          clockInLocation: buildLoc(),
          locationTracking: buildTrack(),
        });
        show('Salesperson added.', 'success');
      }
      onSaved();
      onClose();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${user.name}` : 'Add Salesperson'} width="sm:max-w-[480px]">
      <div className="space-y-3.5">
        <Field label="Full Name">
          <Input value={form.name} placeholder="e.g. Rahul Sharma" onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Username">
          <Input value={form.username} placeholder="e.g. rahul1" disabled={isEdit}
            className={isEdit ? '!bg-gray-50 !text-ink-3' : ''}
            onChange={(e) => set('username', e.target.value.toLowerCase().replace(/\s+/g, ''))} />
          {isEdit && <p className="mt-1 text-[10px] text-ink-3">Username can't be changed.</p>}
          {!isEdit && <p className="mt-1 text-[10px] text-ink-3">Lowercase only, no spaces. Min 3 characters.</p>}
        </Field>
        <Field label="Email Address (used for password reset)">
          <Input type="email" value={form.email} placeholder="employee@company.com"
            onChange={(e) => set('email', e.target.value)} />
          <p className="mt-1 text-[10px] text-ink-3">Required for the "Forgot password" flow.</p>
        </Field>
        <Field label={isEdit ? 'New Password (leave blank to keep current)' : 'Password'}>
          <Input type="password" value={form.password} placeholder={isEdit ? 'Leave blank to keep' : 'Min 6 characters'}
            onChange={(e) => set('password', e.target.value)} />
        </Field>

        {/* ── Per-employee clock-in location ──────────────────────────────── */}
        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border-card)' }}>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" className="h-4 w-4 accent-purple-500"
              checked={form.loc.enabled} onChange={(e) => setLoc('enabled', e.target.checked)} />
            <MapPin size={13} /> Custom clock-in location for this employee
          </label>
          <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            When on, this employee must clock in within the company radius of the point below.
            When off, the company office location applies.
          </p>
          {form.loc.enabled && (
            <div className="mt-2.5 space-y-2.5">
              <Field label="Location Label (optional)">
                <Input value={form.loc.label} placeholder="e.g. Dubai Branch" onChange={(e) => setLoc('label', e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Latitude">
                  <Input type="number" step="any" value={form.loc.lat} placeholder="25.2048" onChange={(e) => setLoc('lat', e.target.value)} />
                </Field>
                <Field label="Longitude">
                  <Input type="number" step="any" value={form.loc.lng} placeholder="55.2708" onChange={(e) => setLoc('lng', e.target.value)} />
                </Field>
              </div>
              <Button variant="outline" size="sm" disabled={locating} onClick={useCurrentLocation}>
                <span className="flex items-center gap-1.5">
                  {locating ? <Loader2 size={13} className="animate-spin" /> : <LocateFixed size={13} />}
                  {locating ? 'Getting location…' : 'Use my current location'}
                </span>
              </Button>
            </div>
          )}
        </div>

        {/* ── Live-location tracking rule ─────────────────────────────────── */}
        <div className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--border-card)' }}>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" className="h-4 w-4 accent-purple-500"
              checked={form.track.enabled} onChange={(e) => setTrack('enabled', e.target.checked)} />
            <MapPin size={13} /> Live-location tracking for this employee
          </label>
          <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            When on, this employee's app sends their location on the interval below while they are
            clocked in, and each ping is flagged inside/outside their clock-in area. View the trail
            from the Location column on the Attendance page.
          </p>
          {form.track.enabled && (
            <div className="mt-2.5">
              <Field label="Send location every">
                <Select value={form.track.intervalMinutes} onChange={(e) => setTrack('intervalMinutes', Number(e.target.value))}>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>60 minutes</option>
                </Select>
              </Field>
              <p className="mt-1.5 text-[10px] italic" style={{ color: 'var(--text-secondary)' }}>
                Note: the web app can only send pings while the employee has the CRM open. Continuous
                background tracking (app closed / screen off) requires the mobile app.
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={submit}>{busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Save'}</Button>
      </div>
    </Modal>
  );
}

export default function Users() {
  const { user } = useAuth();
  const { show } = useToast();
  const { data: users, loading, refetch } = useFetch(() => userApi.list(), []);
  const [modal, setModal] = useState(null);   // { mode: 'add' } | { mode: 'edit', user }
  const [drawerId, setDrawerId] = useState(null);
  const [revealed, setRevealed] = useState(() => new Set()); // rows with password shown

  const toggleReveal = (id) => setRevealed((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const copyPwd = async (pwd) => {
    try { await navigator.clipboard.writeText(pwd); show('Password copied.', 'success'); }
    catch { show('Could not copy — reveal it and copy manually.', 'error'); }
  };

  const toggleActive = async (u) => {
    try { await userApi.update(u.id, { active: !u.active }); show(`${u.username} ${u.active ? 'deactivated' : 'activated'}.`, 'success'); refetch(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  const del = async (u) => {
    if (!confirm(`Remove ${u.name}? Their orders remain in the system.`)) return;
    try { await userApi.remove(u.id); show('User removed.', 'success'); refetch(); }
    catch (e) { show(apiError(e), 'error'); }
  };

  if (loading) return <Spinner label="Loading users…" />;

  // Employees only — admins are not shown in this management view.
  const employees = (users || []).filter((u) => u.role !== 'admin');

  return (
    <>
     <PageTitle icon={<UsersIcon size={18} />} actions={<Button onClick={() => setModal({ mode: 'add' })}><Plus size={14} className="mr-1.5" />Add Salesperson</Button>}>User Management</PageTitle>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead><tr className="bg-navy-800 text-white">
            {['Sl. No', 'Username', 'Name', 'Password', 'Orders', 'Status', 'Actions'].map((h) =>
              <th key={h} className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide">{h}</th>)}
          </tr></thead>
          <tbody>
            {employees.length === 0 ? (
              <tr><td colSpan={7} className="px-2.5 py-6 text-center text-xs text-ink-3">No employees yet. Add a salesperson to get started.</td></tr>
            ) : employees.map((u, idx) => (
              <tr key={u.id} className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gold-pale" onClick={() => setDrawerId(u.id)}>
                <td className="px-2.5 py-2 text-xs text-ink-3">{idx + 1}</td>
                <td className="px-2.5 py-2 text-xs font-bold text-info underline-offset-2 hover:underline">{u.username}</td>
                <td className="px-2.5 py-2 text-xs">{u.name}</td>
                <td className="px-2.5 py-2 text-xs" onClick={(e) => e.stopPropagation()}>
                  {u.password ? (
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono">{revealed.has(u.id) ? u.password : '••••••••'}</span>
                      <button type="button" className="text-ink-3 hover:text-navy" title={revealed.has(u.id) ? 'Hide' : 'Show'} onClick={() => toggleReveal(u.id)}>
                        {revealed.has(u.id) ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      {revealed.has(u.id) && (
                        <button type="button" className="text-ink-3 hover:text-navy" title="Copy" onClick={() => copyPwd(u.password)}>
                          <Copy size={13} />
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="italic text-ink-3">— set to view</span>
                  )}
                </td>
                <td className="px-2.5 py-2 text-xs">{u.orders}</td>
                <td className="px-2.5 py-2 text-xs">{u.active ? <span className="text-ok font-bold">Active</span> : <span className="text-ink-3">Inactive</span>}</td>
                <td className="px-2.5 py-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => setModal({ mode: 'edit', user: u })}>Edit</Button>
                    {u.id !== user.id ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => toggleActive(u)}>{u.active ? 'Deactivate' : 'Activate'}</Button>
                        <Button size="sm" variant="red" onClick={() => del(u)}>🗑</Button>
                      </>
                    ) : <span className="self-center text-[10px] text-ink-3">(you)</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {modal && (
        <UserFormModal
          mode={modal.mode}
          user={modal.user}
          onClose={() => setModal(null)}
          onSaved={refetch}
        />
      )}

      {drawerId && <EmployeeDrawer id={drawerId} onClose={() => setDrawerId(null)} />}
    </>
  );
}