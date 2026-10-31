import { useEffect } from 'react';
import { attendanceApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';

// Sends a location ping every `intervalMinutes` (admin-set) while the employee
// is clocked in AND the CRM is open in the browser. Renders nothing.
//
// LIMITATION: browsers only run this while the tab is open/foregrounded — they
// suspend background tabs and locked screens, so this cannot track when the app
// is closed. True background tracking needs the native mobile app hitting the
// same POST /attendance/location endpoint.
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
      () => navigator.geolocation.getCurrentPosition(
        ok,
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
      ),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

export default function LiveLocationTracker() {
  const { user, isDeveloper } = useAuth();

  useEffect(() => {
    if (!user || isDeveloper) return undefined;

    let stopped = false;
    let timer = null;

    const pingOnce = async () => {
      try {
        // Only track during an active (clocked-in, not clocked-out) shift.
        const today = await attendanceApi.myToday();
        if (!today || !today.loginTime || today.logoutTime) return;
        const coords = await getCoords();
        if (coords) await attendanceApi.recordLocation(coords);
      } catch {
        /* network / permission errors are non-fatal — try again next tick */
      }
    };

    (async () => {
      let cfg;
      try { cfg = await attendanceApi.trackingConfig(); } catch { return; }
      if (stopped || !cfg || !cfg.enabled) return;
      const minutes = [15, 30, 60].indexOf(Number(cfg.intervalMinutes)) === -1 ? 30 : Number(cfg.intervalMinutes);
      pingOnce(); // first sample right away
      timer = setInterval(pingOnce, minutes * 60000);
    })();

    return () => { stopped = true; if (timer) clearInterval(timer); };
  }, [user, isDeveloper]);

  return null;
}