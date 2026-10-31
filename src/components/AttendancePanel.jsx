import { useState, useEffect, useRef, useCallback } from 'react';
import { attendanceApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { apiError } from '../api/client.js';
import Button from './ui/Button.jsx';
import { fmtTimeOnly } from '../utils/format.js';

const fmtMins = (m) => `${Math.floor((m || 0) / 60)}h ${String((m || 0) % 60).padStart(2, '0')}m`;

// Self-service clock-in/out widget content. Used inside the header's
// AttendanceWidget popover (sales view). Exposes onStatusChange so the
// parent can color the trigger icon (active / on break / clocked out).
export default function AttendancePanel({ onStatusChange }) {
  const { show } = useToast();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const tickRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await attendanceApi.myToday();
      setRecord(r);
      onStatusChange?.(r);
    } catch (e) { show(apiError(e), 'error'); }
    finally { setLoading(false); }
  }, [show, onStatusChange]);

  useEffect(() => { load(); }, [load]);

  // Live work timer while clocked in and not on break
  useEffect(() => {
    clearInterval(tickRef.current);
    if (!record?.loginTime || record.logoutTime) { setElapsedSec(0); return; }

    const openBreak = record.breaks?.find((b) => !b.endTime);
    const tick = () => {
      const breakMins = (record.totalBreakMinutes || 0) +
        (openBreak ? Math.round((Date.now() - new Date(openBreak.startTime)) / 60000) : 0);
      setElapsedSec(Math.max(0, Math.round((Date.now() - new Date(record.loginTime)) / 1000) - breakMins * 60));
    };
    tick();
    tickRef.current = setInterval(tick, 1000);
    return () => clearInterval(tickRef.current);
  }, [record]);

  const act = async (fn, label) => {
    setBusy(true);
    try {
      const r = await fn();
      setRecord(r);
      onStatusChange?.(r);
    } catch (e) { show(apiError(e), 'error'); return; }
    finally { setBusy(false); }
    if (label) show(label, 'success');
  };

  // Clock-in needs the device location so the server can enforce the office
  // geofence (if the admin enabled one). We attach coords AND the reading's
  // accuracy so the server can forgive GPS imprecision. We try a high-accuracy
  // fix first, then fall back to a quicker coarse fix if it times out. If the
  // user denies access we still send the request (the server decides whether
  // location is mandatory and returns a clear message if so).
  const getCoords = () =>
    new Promise((resolve) => {
      if (!('geolocation' in navigator)) return resolve(null);
      const ok = (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });
      navigator.geolocation.getCurrentPosition(
        ok,
        () => {
          // High-accuracy attempt failed/timed out — try a faster coarse fix.
          navigator.geolocation.getCurrentPosition(
            ok,
            () => resolve(null),
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
          );
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });

  const doClockIn = async () => {
    setBusy(true);
    const coords = await getCoords();
    setBusy(false);
    await act(() => attendanceApi.clockIn(coords), 'Clocked in');
  };

  const doClockOut = async () => {
    setBusy(true);
    const coords = await getCoords();
    setBusy(false);
    await act(() => attendanceApi.clockOut(coords), 'Clocked out');
  };

  if (loading) return <div className="h-20 animate-pulse rounded bg-gray-100" />;

  const notClockedIn = !record?.loginTime;
  const clockedOut = !!record?.logoutTime;
  const onBreak = record?.status === 'on_break';

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wide text-navy-700">🕐 My Attendance</h3>
        {record?.loginTime && !clockedOut && (
          <span className={`status ${onBreak ? 'bg-warn-light text-warn' : 'bg-ok-light text-ok'}`}>
            {onBreak ? 'On Break' : 'Active'}
          </span>
        )}
      </div>

      {record?.loginTime && (
        <div className="mb-3.5 grid grid-cols-3 gap-2">
          <div className="rounded-md bg-gray-50 p-2 text-center">
            <div className="text-[9px] text-ink-3">Worked</div>
            <div className="text-xs font-black text-navy">{fmtMins(Math.floor(elapsedSec / 60))}</div>
          </div>
          <div className="rounded-md bg-gray-50 p-2 text-center">
            <div className="text-[9px] text-ink-3">Break</div>
            <div className="text-xs font-black text-warn">{fmtMins(record.totalBreakMinutes)}</div>
          </div>
          <div className="rounded-md bg-gray-50 p-2 text-center">
            <div className="text-[9px] text-ink-3">Clock-In</div>
            <div className="text-xs font-black text-navy">{fmtTimeOnly(record.loginTime)}</div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {notClockedIn && (
          <Button variant="green" size="sm" className="flex-1" disabled={busy} onClick={doClockIn}>
            ▶ Clock In
          </Button>
        )}
        {record?.loginTime && !clockedOut && (
          <>
            {!onBreak ? (
              <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => act(() => attendanceApi.startBreak('Break'))}>
                ⏸ Break
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => act(attendanceApi.endBreak, 'Back from break')}>
                ▶ Resume
              </Button>
            )}
            <Button variant="red" size="sm" className="flex-1" disabled={busy} onClick={doClockOut}>
              ■ Clock Out
            </Button>
          </>
        )}
        {clockedOut && (
          <div className="flex-1 rounded-md bg-gray-50 py-2 text-center text-[11px] font-bold text-ink-3">
            Clocked out at {fmtTimeOnly(record.logoutTime)} · worked {fmtMins(record.totalWorkMinutes)}
          </div>
        )}
      </div>
    </div>
  );
}