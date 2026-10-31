import { useEffect, useState, useCallback } from 'react';
import { attendanceApi } from '../api/endpoints.js';
import { Card, CardHead, CardBody } from './ui/Card.jsx';
import { fmtTimeOnly } from '../utils/format.js';

const POLL_MS = 30_000; // refresh every 30s so admin sees live movement

// Live status pill — driven by the *raw* status field (active/on_break/
// logged_out), not the derived present/late/absent classification, since
// admin wants to know what's happening right now, not the day's verdict.
const LIVE = {
  active: { label: 'Working', cls: 'bg-ok-light text-ok' },
  on_break: { label: 'On Break', cls: 'bg-warn-light text-warn' },
  logged_out: { label: 'Clocked Out', cls: 'bg-gray-100 text-gray-500' },
  not_logged_in: { label: 'Not In Yet', cls: 'bg-danger-light text-danger' },
};

const liveOf = (r) => {
  if (!r.loginTime) return 'not_logged_in';
  if (r.logoutTime) return 'logged_out';
  if (r.status === 'on_break') return 'on_break';
  return 'active';
};

const fmtMins = (m) => `${Math.floor((m || 0) / 60)}h ${String((m || 0) % 60).padStart(2, '0')}m`;

// totalWorkMinutes is only finalized by the backend at clock-out, so while a
// session is still open we derive "worked so far" on the frontend instead of
// showing a stale 0.
const liveWorkedMinutes = (r) => {
  if (!r.loginTime) return 0;
  if (r.logoutTime) return r.totalWorkMinutes || 0;
  const openBreak = (r.breaks || []).find((b) => !b.endTime);
  const breakMins = (r.totalBreakMinutes || 0) +
    (openBreak ? Math.round((Date.now() - new Date(openBreak.startTime)) / 60000) : 0);
  return Math.max(0, Math.round((Date.now() - new Date(r.loginTime)) / 60000) - breakMins);
};

export default function TeamAttendanceCard() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const records = await attendanceApi.report({ startDate: today, endDate: today });
      setRows(records || []);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const counts = (rows || []).reduce((acc, r) => {
    const k = liveOf(r);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return (
    <Card>
      <CardHead title="🕐 Team Attendance — Live">
        <span className="text-[10px] text-ink-3">Updates every 30s</span>
      </CardHead>
      <CardBody className="!p-0">
        {error ? (
          <p className="p-4 text-xs text-danger">Couldn&rsquo;t load attendance.</p>
        ) : rows === null ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />)}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-4 text-xs text-ink-3">No employees found.</p>
        ) : (
          <>
            <div className="flex gap-2 border-b border-gray-100 px-4 py-2.5">
              {Object.entries(LIVE).map(([k, v]) => (
                <span key={k} className={`status ${v.cls}`}>{v.label}: {counts[k] || 0}</span>
              ))}
            </div>
            <div className="max-h-72 overflow-y-auto">
              {rows.map((r, i) => {
                const live = LIVE[liveOf(r)];
                return (
                  <div key={r._id || `${r.user?._id}-${i}`} className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5 last:border-0">
                    <div>
                      <div className="text-xs font-bold">{r.user?.name || 'Unknown'}</div>
                      <div className="text-[10px] text-ink-3">
                        {r.loginTime ? `In ${fmtTimeOnly(r.loginTime)}` : 'Not clocked in'}
                        {r.logoutTime ? ` · Out ${fmtTimeOnly(r.logoutTime)}` : ''}
                        {r.loginTime && !r.logoutTime ? ` · ${fmtMins(liveWorkedMinutes(r))} so far` : ''}
                      </div>
                    </div>
                    <span className={`status ${live.cls}`}>{live.label}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}