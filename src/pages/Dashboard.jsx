import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, Radio, Megaphone,
  BarChart2, Target, Trophy, Inbox, Package, Globe,
  ListOrdered, Clock, AlertTriangle, Ban,
} from 'lucide-react';
import { reportApi } from '../api/endpoints.js';
import { useFetch } from '../hooks/useApi.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card, CardHead, CardBody } from '../components/ui/Card.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import { fmtAED,  formatDate } from '../utils/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import TeamAttendanceCard from '../components/TeamAttendanceCard.jsx';
import { LineChart, DonutWithCenter } from '../components/charts/MiniCharts.jsx';

// Full funnel — matches LEAD_STAGES / leadStageOf used everywhere else in the
// app (Leads page, reports): Lead → Opportunity → Enquiry → Buyer.
const STAGES = [
  { key: 'Lead',        color: '#6B7280' },
  { key: 'Opportunity', color: '#F59E0B' },
  { key: 'Enquiry',     color: '#2563EB' },
  { key: 'Buyer',       color: '#10B981' },
];
const stageOfStatus = (status) => {
  if (status === 'Won') return 'Buyer';
  if (status === 'Follow-up') return 'Enquiry';
  if (status === 'Interested' || status === 'Contacted') return 'Opportunity';
  return 'Lead'; // New / Lost / anything else
};
const LEAD_STATUS_LIST = ['New', 'Contacted', 'Interested', 'Follow-up', 'Won', 'Lost'];
const DELIVERY_STAGE_LIST = ['Pending', 'Confirmed', 'Packed', 'Market Delay', 'Out for Delivery'];

const Stat = ({ value, label, color, hint, onClick }) => (
  <button onClick={onClick} disabled={!onClick}
    className={`group rounded-lg p-4 text-left transition border-l-4 ${color} ${onClick ? 'hover:-translate-y-0.5' : 'cursor-default'}`}
    style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}>
    <div className="text-2xl font-black text-navy dark:text-white">{value}</div>
    <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>{label}</div>
    {hint && <div className="mt-1 text-[9px] font-bold text-gold opacity-0 transition group-hover:opacity-100">{hint}</div>}
  </button>
);

const Bar = ({ label, value, max, tone = 'bg-gold' }) => (
  <div className="mb-2">
    <div className="mb-1 flex justify-between text-[11px]">
      <span className="font-bold" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-hint)' }}>{value}</span>
    </div>
    <div className="h-2 rounded-full bg-gray-100 dark:bg-white/10">
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
    </div>
  </div>
);

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAdmin, subscription } = useAuth();
  const [range, setRange] = useState('daily');
  const { data, loading, error } = useFetch(() => reportApi.dashboard({ range }), [range]);

  if (loading && !data) return <Spinner label="Loading dashboard…" />;
  if (error) return <PageTitle icon={<LayoutDashboard size={18} />}>Dashboard</PageTitle>;
  if (!data) return <Spinner label="Loading dashboard…" />;

  const { stats, byStatus, byCountry, leads, recentOrders, recentLeads } = data;
  const statusMax = Math.max(1, ...Object.values(byStatus));
  const countryMax = Math.max(1, ...Object.values(byCountry));

  const stageCounts = { Lead: 0, Opportunity: 0, Enquiry: 0, Buyer: 0 };
  Object.entries(leads.byStatus).forEach(([status, n]) => { stageCounts[stageOfStatus(status)] += n; });
  const pipeline = STAGES.map((s) => ({ label: s.key, value: stageCounts[s.key] || 0, color: s.color }));
  const sourceEntries = Object.entries(leads.bySource).sort((a, b) => b[1] - a[1]);
  const sourceMax = Math.max(1, ...sourceEntries.map(([, v]) => v));
  const empMax = Math.max(1, ...leads.topEmployees.map((e) => e.leads));

  return (
    <>
      <PageTitle icon={<LayoutDashboard size={18} />}>Dashboard</PageTitle>

      <ExpiryBanner subscription={subscription} isAdmin={isAdmin} />

      <div className="mb-5 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <Stat value={stats.totalLeads} label="Total Contacts Enquired" color="border-info"     hint="View leads →"   onClick={() => navigate('/leads')} />
        <Stat value={stats.buyers}     label="Buyers"               color="border-ok"       hint="View won →"     onClick={() => navigate('/leads?status=Won')} />
        <Stat value={stageCounts.Enquiry} label="Enquiries"          color="border-purple-400" hint="View leads →"  onClick={() => navigate('/leads')} />
        <Stat value={stats.pending}    label="Pending Delivery"     color="border-gold"       hint="Go to Delivery Tracker →" onClick={() => navigate('/tracker')} />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-hint)' }}>Leads by status:</span>
        {LEAD_STATUS_LIST.map((s) => {
          const count = leads.byStatus[s] || 0;
          return (
            <button key={s} onClick={() => navigate(`/leads?status=${encodeURIComponent(s)}`)}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition hover:border-gold hover:bg-gold-pale"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-card)', color: 'var(--text-muted)' }}>
              {s}
              <span className="rounded-full bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-navy dark:text-white">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Delivery Tracker status — same style as leads by status row */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-hint)' }}>Delivery tracker:</span>
        {DELIVERY_STAGE_LIST.map((s) => {
          const count = (data.deliveryByStage || {})[s] || 0;
          return (
            <button key={s} onClick={() => navigate('/tracker')}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition hover:border-gold hover:bg-gold-pale"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-card)', color: 'var(--text-muted)' }}>
              {s}
              <span className="rounded-full bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-navy dark:text-white">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-3.5 grid gap-3.5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHead title="Leads Over Time" icon={<TrendingUp size={14} />}>
            <div className="flex gap-1 rounded-lg p-0.5" style={{ backgroundColor: 'var(--bg-base)' }}>
              {[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([k, l]) => (
                <button key={k} onClick={() => setRange(k)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition ${range === k ? 'bg-white dark:bg-navy text-navy dark:text-white shadow-sm' : 'hover:text-ink-2'}`}
                  style={{ color: range === k ? undefined : 'var(--text-hint)' }}>
                  {l}
                </button>
              ))}
            </div>
          </CardHead>
          <CardBody>
            <LineChart data={leads.overTime} series={[
              { key: 'newLeads', label: 'New leads', color: '#2563EB', fill: true },
              { key: 'converted', label: 'Buyers', color: '#10B981', dashed: true },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHead title="Pipeline by Stage" icon={<Target size={14} />} />
          <CardBody>
            {stats.totalLeads === 0 ? <p className="text-xs" style={{ color: 'var(--text-hint)' }}>No leads yet.</p>
              : <DonutWithCenter data={pipeline} total={stats.totalLeads} label="total" />}
          </CardBody>
        </Card>
      </div>

      <div className="mb-3.5 grid gap-3.5 md:grid-cols-2">
        {isAdmin && (
          <Card>
            <CardHead title="Top Employees" icon={<Trophy size={14} />} />
            <CardBody>
              {leads.topEmployees.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-hint)' }}>No leads yet.</p>
                : leads.topEmployees.map((e) => (
                  <div key={e.name} className="mb-2.5">
                    <div className="mb-1 flex justify-between text-[11px]">
                      <span className="font-bold" style={{ color: 'var(--text-muted)' }}>{e.name}</span>
                      <span className="text-ok font-bold">{e.converted} conv · {e.leads}</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 dark:bg-white/10">
                      <div className="h-2 rounded-full bg-purple-500" style={{ width: `${(e.leads / empMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
            </CardBody>
          </Card>
        )}
        <Card className={isAdmin ? '' : 'md:col-span-2'}>
          <CardHead title="Leads by Source" icon={<Inbox size={14} />} />
          <CardBody>
            {sourceEntries.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-hint)' }}>No leads yet.</p>
              : sourceEntries.map(([k, v]) => <Bar key={k} label={k} value={v} max={sourceMax} tone="bg-info" />)}
          </CardBody>
        </Card>
      </div>

      <div className={`mb-5 grid grid-cols-2 gap-3.5 ${isAdmin ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        <Stat value={stats.totalOrders}         label="Total Orders"   color="border-gold" hint="View all →"         onClick={() => navigate('/orders')} />
        <Stat value={stats.pending}             label="Pending"        color="border-warn" hint="Go to tracker →"    onClick={() => navigate('/tracker')} />
        <Stat value={stats.delivered}           label="Delivered"      color="border-ok"   hint="Filter delivered →" onClick={() => navigate('/orders?status=Delivered')} />
        {isAdmin && <Stat value={fmtAED(stats.totalRevenue)} label="Total Revenue" color="border-info" />}
      </div>

      <div className="mb-3.5 grid gap-3.5 md:grid-cols-2">
        <Card>
          <CardHead title="Delivery Status Breakdown" icon={<Package size={14} />} />
          <CardBody>
            {Object.keys(byStatus).length === 0 ? <p className="text-xs" style={{ color: 'var(--text-hint)' }}>No orders yet.</p>
              : Object.entries(byStatus).map(([k, v]) => <Bar key={k} label={k} value={v} max={statusMax} />)}
          </CardBody>
        </Card>
        <Card>
          <CardHead title="Orders by Country" icon={<Globe size={14} />} />
          <CardBody>
            {Object.keys(byCountry).length === 0 ? <p className="text-xs" style={{ color: 'var(--text-hint)' }}>No orders yet.</p>
              : Object.entries(byCountry).map(([k, v]) => <Bar key={k} label={k} value={v} max={countryMax} tone="bg-info" />)}
          </CardBody>
        </Card>
      </div>

      {isAdmin && <div className="mb-3.5"><TeamAttendanceCard /></div>}

      <div className="grid gap-3.5 md:grid-cols-2">
        <Card>
          <CardHead title="Recent Leads" icon={<Radio size={14} />} />
          <CardBody className="!p-0">
            {recentLeads.length === 0 ? <p className="p-4 text-xs" style={{ color: 'var(--text-hint)' }}>No leads yet.</p>
              : recentLeads.map((l) => (
                <button key={l._id} onClick={() => navigate('/leads')}
                  className="flex w-full items-center justify-between border-b px-4 py-2.5 text-left last:border-0 transition"
                  style={{ borderColor: 'var(--border-card)' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--table-row-hover)'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>
                  <div>
                    <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{l.name} — {l.status}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-hint)' }}>{l.ownerName} · {l.source} · {formatDate(l.createdAt)}</div>
                  </div>
                </button>
              ))}
          </CardBody>
        </Card>
        <Card>
          <CardHead title="Recent Orders" icon={<ListOrdered size={14} />} />
          <CardBody className="!p-0">
            {recentOrders.length === 0 ? <p className="p-4 text-xs" style={{ color: 'var(--text-hint)' }}>No orders yet.</p>
              : recentOrders.map((o) => (
                <button key={o._id} onClick={() => navigate('/orders')}
                  className="flex w-full items-center justify-between border-b px-4 py-2.5 text-left last:border-0 transition"
                  style={{ borderColor: 'var(--border-card)' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--table-row-hover)'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>
                  <div>
                    <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>#{o.orderNo} · {o.customer}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-hint)' }}>{formatDate(o.date)} · {o.country}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-navy-700 dark:text-white">{fmtAED(o.grandTotal)}</span>
                    <StatusBadge status={o.status} />
                  </div>
                </button>
              ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
// ── Subscription expiry banner ────────────────────────────────────────────────
// Shows on the admin dashboard when the subscription expires within 5 days (or
// has already expired). Mirrors the email/notification reminder so admins see
// the warning prominently every day of the countdown.
function ExpiryBanner({ subscription, isAdmin }) {
  if (!isAdmin || !subscription?.renewalDate) return null;
  if (['Cancelled'].includes(subscription.status)) return null;

  const now = new Date();
  const renewal = new Date(subscription.renewalDate);
  const DAY = 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((renewal.getTime() - now.getTime()) / DAY);

  // Only show within the 5-day window (including overdue/expired).
  if (daysLeft > 5) return null;

  const expired = daysLeft < 0 || subscription.status === 'Expired' || subscription.status === 'Past Due';
  const fmt = renewal.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const label = expired
    ? 'Your subscription has expired.'
    : daysLeft === 0
      ? 'Your subscription expires today.'
      : `Your subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`;

  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-lg border-l-4 px-4 py-3"
      style={{
        borderColor: expired ? '#DC2626' : '#D97706',
        background: expired ? 'rgba(220,38,38,.08)' : 'rgba(217,119,6,.08)',
      }}
    >
      <span className="mt-0.5 shrink-0" style={{ color: expired ? '#DC2626' : '#B45309' }}>
        {expired ? <Ban size={18} /> : <AlertTriangle size={18} />}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-bold" style={{ color: expired ? '#DC2626' : '#B45309' }}>
          {label}
        </div>
        <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          Renewal date: {fmt}. {expired
            ? 'Access may be paused until the subscription is renewed — please contact support.'
            : 'Please renew before then to avoid your account being paused.'}
        </div>
      </div>
    </div>
  );
}