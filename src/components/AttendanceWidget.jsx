import { useState, useRef, useEffect } from 'react';
import { Clock } from 'lucide-react';
import AttendancePanel from './AttendancePanel.jsx';

const DOT = {
  active:   'bg-ok',
  on_break: 'bg-warn',
  idle:     'bg-gray-400',
};

export default function AttendanceWidget() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('idle');
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleStatusChange = (record) => {
    if (!record?.loginTime || record.logoutTime) setStatus('idle');
    else if (record.status === 'on_break') setStatus('on_break');
    else setStatus('active');
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="My Attendance"
        className="relative flex h-8 w-8 items-center justify-center rounded-full border transition hover:opacity-80"
        style={{
          backgroundColor: 'var(--bg-card-head)',
          borderColor: 'var(--border-card)',
          color: 'var(--text-primary)',
        }}
      >
        <Clock size={16} />
        <span
          className={`absolute right-0 top-0 h-2 w-2 rounded-full ring-2 ${DOT[status]}`}
          style={{ '--tw-ring-color': 'var(--bg-header)' }}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 z-[200] w-72 rounded-xl p-4 shadow-lift"
          style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
        >
          <AttendancePanel onStatusChange={handleStatusChange} />
        </div>
      )}
    </div>
  );
}