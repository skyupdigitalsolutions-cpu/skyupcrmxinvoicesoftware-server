import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import AttendanceWidget from '../AttendanceWidget.jsx';
import LiveLocationTracker from '../LiveLocationTracker.jsx';
import {
  ShoppingCart, Plug,
  LayoutDashboard, Target, ClipboardList, FilePlus,
  Receipt, Truck, BarChart2, CalendarDays, Users, Clock,
  LogOut, Sun, Moon, Menu, X, Building2, Bell, Check, CheckCheck, MessageSquare,
  Trash2, AlertCircle, ArrowRight, Banknote, AlertTriangle, Ban,
} from 'lucide-react';
import { notificationApi, chatApi } from '../../api/endpoints.js';
import TermsViewerModal from '../TermsViewerModal.jsx';

const NAV = [
  { to: '/dashboard',        label: 'Dashboard',       icon: LayoutDashboard },
  { to: '/leads',            label: 'Leads',            icon: Target },
  { to: '/deleted-contacts', label: 'Deleted Contacts', icon: Trash2, admin: true },
  { to: '/orders',           label: 'Orders',           icon: ClipboardList },
  { to: '/orders/new',       label: 'Order Form',       icon: FilePlus },
  { to: '/invoices',         label: 'Invoices',         icon: Receipt },
  { to: '/cheques',          label: 'Cheque Calendar',  icon: Banknote },
  { to: '/communication',    label: 'Communication',    icon: MessageSquare },
  { to: '/tracker',          label: 'Delivery Tracker', icon: Truck },
  { to: '/reports',          label: 'Reports',          icon: BarChart2,   admin: true },
  { to: '/daily-report',     label: 'Daily Report',     icon: CalendarDays },
  { to: '/users',            label: 'Users',            icon: Users,       admin: true },
  { to: '/attendance',       label: 'Attendance',       icon: Clock },
  { to: '/chat',             label: 'Chat',             icon: MessageSquare },
  { to: '/purchase-orders',  label: 'Purchase Orders',  icon: ShoppingCart },
  { to: '/integrations/sensy', label: 'Sensy Integration', icon: Plug, admin: true },
];

const DEV_NAV = [
  { to: '/developer',               label: 'Dashboard',    icon: LayoutDashboard },
  { to: '/developer/companies',     label: 'Companies',    icon: Building2 },
  { to: '/developer/subscriptions', label: 'Subscription', icon: Receipt },
];

function BrandMark({ branding }) {
  const { branding: platform } = useTheme();
  const name    = branding?.headerName || platform.companyName;
  const tagline = branding?.headerTagline || '';
  const logo    = branding?.logoUrl || platform.logo || '';
  return (
    <div className="flex min-w-0 items-center gap-2">
      {logo ? (
        <img src={logo} alt={name} className="h-8 w-8 flex-shrink-0 rounded object-contain"
          onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      ) : null}
      <div className="truncate text-sm font-black tracking-wide" style={{ color: 'var(--text-primary)' }}>
        {name}{tagline ? <> <span style={{ color: 'var(--primary)' }}>{tagline}</span></> : null}
      </div>
    </div>
  );
}

const DEVELOPER_NAME = 'SkyUp Digital Solutions';
const DEVELOPER_URL  = 'https://www.skyupdigitalsolutions.com';

function DevCredit() {
  return (
    <div className="shrink-0 px-5 pt-3 text-[10px] leading-relaxed"
      style={{ borderTop: '1px solid var(--header-border)', color: 'var(--text-muted)' }}>
      <div>© {new Date().getFullYear()} · Developed by</div>
      <a href={DEVELOPER_URL} target="_blank" rel="noopener noreferrer"
        className="font-bold hover:underline" style={{ color: 'var(--primary)' }}>
        {DEVELOPER_NAME}
      </a>
    </div>
  );
}

// ── NotificationBell ──────────────────────────────────────────────────────────
// Polls on a single 30s interval using the cheap unread-count endpoint.
// Only fetches full notification list when count changes or bell is opened.
function NotificationBell({ onWaUnreadChange }) {
  const navigate = useNavigate();
  const [open, setOpen]     = useState(false);
  const [items, setItems]   = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef     = useRef(null);
  const prevTotal   = useRef(null); // tracks total unread to detect any new notification
  const prevWa      = useRef(null); // tracks WA-only count for chime
  const audioCtxRef = useRef(null);

  const getAudioCtx = () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
    return audioCtxRef.current;
  };

  useEffect(() => {
    const unlock = () => {
      const ctx = getAudioCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  const playChime = () => {
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const t0 = ctx.currentTime;
      [[659.25, 0], [880, 0.22]].forEach(([freq, dt]) => {
        [[freq, 0.25], [freq * 2, 0.07]].forEach(([f, vol]) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = f;
          gain.gain.setValueAtTime(0.0001, t0 + dt);
          gain.gain.exponentialRampToValueAtTime(vol, t0 + dt + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.6);
          osc.connect(gain); gain.connect(ctx.destination);
          osc.start(t0 + dt); osc.stop(t0 + dt + 0.65);
        });
      });
    } catch { /* audio unavailable */ }
  };

  // Lightweight poll: uses unread-count endpoint (1 DB query) instead of
  // fetching 100 full notification documents every 30s.
  // Only fetches full list when total count changes, to split WA vs other types.
  const loadCount = async () => {
    try {
      const total = await notificationApi.unreadCount();
      if (prevTotal.current !== null && total === prevTotal.current) return;
      prevTotal.current = total;

      // Count changed — fetch to split by type (WA vs follow-up etc.)
      const { notifications } = await notificationApi.list({ limit: 100, unread: 1 });
      const waOnly = (notifications || []).filter(
        n => !n.read && (n.type === 'whatsapp-reply' || n.type === 'whatsapp-reply-unlinked')
      );
      const waCount = waOnly.length;
      setUnread(waCount);
      onWaUnreadChange?.(waCount);
      if (prevWa.current !== null && waCount > prevWa.current) playChime();
      prevWa.current = waCount;
    } catch { /* ignore */ }
  };

  // Load full notification list for the dropdown
  const loadList = async () => {
    setLoading(true);
    try {
      const { notifications } = await notificationApi.list({ limit: 50 });
      const waItems = (notifications || []).filter(
        n => n.type === 'whatsapp-reply' || n.type === 'whatsapp-reply-unlinked'
      );
      setItems(waItems);
      const waCount = waItems.filter(n => !n.read).length;
      setUnread(waCount);
      onWaUnreadChange?.(waCount);
      prevWa.current = waCount;
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  // Single 30s interval — was 15s before, halves the DB load
  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 30000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const toggle = () => { const next = !open; setOpen(next); if (next) loadList(); };

  const openItem = async (n) => {
    try { if (!n.read) await notificationApi.markRead(n._id); } catch { /* ignore */ }
    setOpen(false);
    loadCount();
    if (n.link) navigate(n.link);
  };

  const markAll = async () => {
    try { await notificationApi.markAllRead(); } catch { /* ignore */ }
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    setUnread(0); onWaUnreadChange?.(0);
    prevWa.current = 0; prevTotal.current = 0;
  };

  const fmt = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button onClick={toggle}
        className="relative flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-black/[0.05]"
        style={{ color: 'var(--text-primary)' }} aria-label="Notifications">
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
            style={{ background: 'var(--danger, #DC2626)' }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-[300] mt-2 w-[330px] max-w-[88vw] overflow-hidden rounded-lg border shadow-xl"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}>
          <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: 'var(--border-card)' }}>
            <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>WhatsApp Replies</span>
            {unread > 0 && (
              <button onClick={markAll} className="flex items-center gap-1 text-[11px] font-bold" style={{ color: 'var(--primary)' }}>
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {loading ? (
              <div className="px-3 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</div>
            ) : !items.length ? (
              <div className="px-3 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>No new WhatsApp replies.</div>
            ) : items.map((n) => (
              <button key={n._id} onClick={() => openItem(n)}
                className="flex w-full items-start gap-2 border-b px-3 py-2.5 text-left transition hover:bg-black/[0.03]"
                style={{ borderColor: 'var(--border-card)' }}>
                <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ background: n.read ? 'transparent' : 'var(--primary)' }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{n.title}</span>
                  {n.body ? <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>{n.body}</span> : null}
                  <span className="mt-1 block text-[10px]" style={{ color: 'var(--text-muted)' }}>{fmt(n.createdAt)}</span>
                </span>
                {!n.read && <Check size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── FollowUpReminderPopup ─────────────────────────────────────────────────────
// Checks every 60s. Uses unread-count first to skip the full fetch when
// nothing changed, reducing DB queries from ~60/hour to ~1-2/hour.
function FollowUpReminderPopup() {
  const navigate = useNavigate();
  const [items, setItems]     = useState([]);
  const [visible, setVisible] = useState(false);
  const dismissedRef = useRef(new Set());
  const prevCountRef = useRef(null);

  const check = async () => {
    try {
      // Quick check first — only fetch full list if something is unread
      const total = await notificationApi.unreadCount();
      if (total === 0) { prevCountRef.current = 0; return; }
      if (prevCountRef.current !== null && total === prevCountRef.current) return;
      prevCountRef.current = total;

      const { notifications } = await notificationApi.list({ unread: 1, limit: 50 });
      const reminders = (notifications || []).filter(
        n => typeof n.type === 'string' && n.type.startsWith('lead-followup')
      );
      const fresh = reminders.filter(n => !dismissedRef.current.has(n._id));
      setItems(reminders);
      if (fresh.length > 0) setVisible(true);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = () => { items.forEach(n => dismissedRef.current.add(n._id)); setVisible(false); };

  const openItem = async (n) => {
    try { if (!n.read) await notificationApi.markRead(n._id); } catch { /* ignore */ }
    dismissedRef.current.add(n._id);
    setVisible(false);
    if (n.link) navigate(n.link);
  };

  if (!visible || !items.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[400] w-[320px] max-w-[90vw] overflow-hidden rounded-lg border shadow-2xl"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}>
      <div className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: 'var(--border-card)', background: 'var(--danger, #DC2626)' }}>
        <span className="flex items-center gap-1.5 text-xs font-bold text-white">
          <AlertCircle size={14} /> Follow-up reminder{items.length > 1 ? `s (${items.length})` : ''}
        </span>
        <button onClick={dismiss}
          className="flex h-6 w-6 items-center justify-center rounded-full text-white/90 transition hover:bg-white/20"
          aria-label="Dismiss"><X size={14} /></button>
      </div>
      <div className="max-h-[280px] overflow-y-auto">
        {items.slice(0, 5).map(n => (
          <button key={n._id} onClick={() => openItem(n)}
            className="flex w-full items-start gap-2 border-b px-3 py-2.5 text-left transition hover:bg-black/[0.03]"
            style={{ borderColor: 'var(--border-card)' }}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{n.title}</span>
              {n.body ? <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>{n.body}</span> : null}
            </span>
            <ArrowRight size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
          </button>
        ))}
        {items.length > 5 && (
          <div className="px-3 py-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            …and {items.length - 5} more pending.
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 px-3 py-2 border-t" style={{ borderColor: 'var(--border-card)' }}>
        <button onClick={dismiss} className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>Dismiss</button>
        <button onClick={() => { setVisible(false); navigate('/daily-report'); }}
          className="text-[11px] font-bold" style={{ color: 'var(--primary)' }}>View all</button>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="relative flex h-7 w-[52px] flex-shrink-0 items-center rounded-full px-1 transition"
      style={{ background: dark ? 'linear-gradient(90deg, var(--secondary), var(--primary))' : '#E5E7EB' }}>
      <span className="flex h-5.5 w-5.5 items-center justify-center rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: dark ? 'translateX(22px)' : 'translateX(0)' }}>
        {dark ? <Moon size={12} className="text-secondary" /> : <Sun size={12} className="text-amber-500" />}
      </span>
    </button>
  );
}

function SidebarNav({ isAdmin, isDeveloper, onNavigate, handleLogout, chatUnread = 0, waUnread = 0 }) {
  const items = isDeveloper ? DEV_NAV : NAV.filter(n => !n.admin || isAdmin);
  return (
    <>
      <div className="px-5 pb-1 pt-3.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Menu</div>
      {items.map(n => {
        const Icon = n.icon;
        const showChatBadge = n.to === '/chat' && chatUnread > 0;
        const showWaBadge   = n.to === '/communication' && waUnread > 0;
        return (
          <NavLink key={n.to} to={n.to} end={n.to === '/orders' || n.to === '/developer'}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-2.5 border-l-[3px] px-5 py-2.5 text-xs font-bold transition ${
                isActive ? 'border-primary' : 'border-transparent hover:bg-black/[0.03]'
              }`
            }
            style={({ isActive }) => ({
              color: isActive ? 'var(--text-sidebar-active)' : 'var(--text-sidebar)',
              backgroundColor: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
            })}>
            <Icon size={15} className="shrink-0" />
            <span className="flex-1">{n.label}</span>
            {showWaBadge && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                style={{ background: '#25D366' }}>
                {waUnread > 99 ? '99+' : waUnread}
              </span>
            )}
            {showChatBadge && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                style={{ background: 'var(--danger, #DC2626)' }}>
                {chatUnread > 99 ? '99+' : chatUnread}
              </span>
            )}
          </NavLink>
        );
      })}
      <div className="mt-6 border-t pt-4 px-5" style={{ borderColor: 'var(--header-border)' }}>
        <button onClick={handleLogout}
          className="flex items-center gap-2 text-xs font-bold transition hover:text-danger"
          style={{ color: 'var(--text-muted)' }}>
          <LogOut size={14} />Sign out
        </button>
      </div>
    </>
  );
}


// ── GlobalExpiryBanner ────────────────────────────────────────────────────────
// Shows on every page (inside AppLayout) when subscription is within 5 days
// of expiry or already expired. Only visible to admins.
function GlobalExpiryBanner({ subscription, isAdmin }) {
  if (!isAdmin || !subscription?.renewalDate) return null;
  if (subscription.status === 'Cancelled') return null;
  const renewal  = new Date(subscription.renewalDate);
  const daysLeft = Math.ceil((renewal.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (daysLeft > 5) return null;
  const expired = daysLeft <= 0 || subscription.status === 'Expired' || subscription.status === 'Past Due';
  const label   = expired
    ? 'Your subscription has expired. Contact support to renew.'
    : daysLeft === 0
      ? 'Your subscription expires today — please renew now.'
      : `Your subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${renewal.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}).`;
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold"
      style={{
        background: expired ? 'rgba(220,38,38,.10)' : 'rgba(217,119,6,.10)',
        borderBottom: `1px solid ${expired ? '#FCA5A5' : '#FCD34D'}`,
        color: expired ? '#DC2626' : '#B45309',
      }}>
      {expired ? <Ban size={14} className="shrink-0" /> : <AlertTriangle size={14} className="shrink-0" />}
      <span>{label}</span>
      <a href="/dashboard" className="ml-auto shrink-0 underline underline-offset-2 hover:opacity-80">
        View details
      </a>
    </div>
  );
}

export default function AppLayout({ children }) {
  const { user, isAdmin, isDeveloper, logout, branding, subscription } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [waUnread, setWaUnread]     = useState(0);
  const [showTerms, setShowTerms]   = useState(false);

  // Chat unread badge — 30s interval, NOT re-created on every route change.
  // Previously this re-subscribed on every navigation, firing an extra query
  // per page visit. isDeveloper is the only valid dep.
  useEffect(() => {
    if (isDeveloper) return;
    let alive = true;
    const load = async () => {
      try { const u = await chatApi.unreadCount(); if (alive) setChatUnread(u || 0); }
      catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [isDeveloper]); // removed location.pathname dep — no need to reset on nav

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handleLogout = async () => { await logout(); navigate('/login'); };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-base)' }}>
      <LiveLocationTracker />
      {!isDeveloper && <FollowUpReminderPopup />}
      <header
        className="sticky top-0 z-[100] flex h-13 items-center justify-between gap-2 px-3 py-3 border-b shadow-sm sm:px-5"
        style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--header-border)' }}>
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={() => setMobileOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-black/[0.05] lg:hidden"
            style={{ color: 'var(--text-primary)' }} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <BrandMark branding={branding} />
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {!isAdmin && !isDeveloper && <AttendanceWidget />}
          {!isDeveloper && <NotificationBell onWaUnreadChange={setWaUnread} />}
          <ThemeToggle />
          <div className="hidden text-right text-[11px] sm:block" style={{ color: 'var(--text-secondary)' }}>
            Logged in as <strong className="text-xs" style={{ color: 'var(--primary)' }}>{user?.name}</strong>
            <span className="mx-1.5">|</span>{isDeveloper ? 'Developer' : isAdmin ? 'Administrator' : 'Sales Person'}
          </div>
        </div>
      </header>
      <GlobalExpiryBanner subscription={subscription} isAdmin={isAdmin} />

      <div className="flex h-[calc(100vh-52px)] items-stretch overflow-hidden">
        <aside className="hidden w-[200px] flex-shrink-0 self-stretch border-r lg:block"
          style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--header-border)' }}>
          <div className="sticky top-[52px] flex h-[calc(100vh-52px)] flex-col py-4">
            <div className="flex-1 overflow-y-auto">
              <SidebarNav isAdmin={isAdmin} isDeveloper={isDeveloper} handleLogout={handleLogout} chatUnread={chatUnread} waUnread={waUnread} />
            </div>
            <DevCredit />
          </div>
        </aside>

        {mobileOpen && (
          <div className="fixed inset-0 z-[200] lg:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
            <aside className="absolute left-0 top-0 flex h-full w-[240px] max-w-[80vw] flex-col border-r shadow-xl"
              style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--header-border)' }}>
              <div className="flex h-13 items-center justify-between border-b px-4"
                style={{ borderColor: 'var(--header-border)' }}>
                <span className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>Menu</span>
                <button onClick={() => setMobileOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-black/10"
                  style={{ color: 'var(--text-primary)' }} aria-label="Close menu">
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                <SidebarNav isAdmin={isAdmin} isDeveloper={isDeveloper} handleLogout={handleLogout}
                  onNavigate={() => setMobileOpen(false)} chatUnread={chatUnread} waUnread={waUnread} />
              </div>
              <DevCredit />
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-hidden p-3 sm:p-5"
          style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Page area fills the space left above the footer. Pages that manage
              their own scrolling (Leads, Invoices) use h-full to fit exactly;
              everything else scrolls here. */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {children}
          </div>
          <footer className="flex flex-shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t pt-2 text-[11px]"
            style={{ borderColor: 'var(--header-border)', color: 'var(--text-muted)' }}>
            <span>&copy; {new Date().getFullYear()} SkyUp CRM Software</span>
            <span aria-hidden>·</span>
            <button type="button" onClick={() => setShowTerms(true)}
              className="underline-offset-2 hover:underline" style={{ color: 'var(--text-muted)' }}>
              Terms &amp; Conditions
            </button>
          </footer>
        </main>
      </div>
      <TermsViewerModal open={showTerms} onClose={() => setShowTerms(false)} />
    </div>
  );
}