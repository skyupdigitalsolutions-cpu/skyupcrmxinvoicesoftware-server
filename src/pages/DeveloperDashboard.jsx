import { Building2, Users, CircleDollarSign, Target } from 'lucide-react';
import { companyApi } from '../api/endpoints.js';
import { useFetch } from '../hooks/useApi.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card } from '../components/ui/Card.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { fmtINR, formatDate } from '../utils/format.js';

const STATUS_CLASS = {
  Active: 'bg-ok-light text-ok',
  Trial: 'bg-info-light text-info',
  'Past Due': 'bg-warn-light text-warn',
  Expired: 'bg-danger-light text-danger',
  Cancelled: 'bg-gray-100 text-ink-3',
};

const Stat = ({ icon, value, label, color }) => (
  <div className={`flex items-center gap-3 rounded-lg p-4 border-l-4 ${color}`} style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}>
    <div className="shrink-0" style={{ color: 'var(--text-muted)' }}>{icon}</div>
    <div className="min-w-0">
      <div className="truncate text-xl font-black leading-tight" style={{ color: 'var(--text-primary)' }}>{value}</div>
      <div className="mt-0.5 text-[11px] leading-tight" style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  </div>
);

export default function DeveloperDashboard() {
  const { data, loading } = useFetch(() => companyApi.stats(), []);

  if (loading && !data) return <Spinner label="Loading dashboard…" />;
  const totals = data?.totals || {};
  const companies = data?.companies || [];

  return (
    <>
      <PageTitle icon={<Building2 size={18} />}>Developer Dashboard</PageTitle>

      <div className="mb-5 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <Stat icon={<Building2 size={18} />} value={totals.companies ?? 0} label={`Companies (${totals.activeCompanies ?? 0} active)`} color="border-info" />
        <Stat icon={<CircleDollarSign size={18} />} value={fmtINR(totals.monthlyRecurring || 0)} label="Monthly Recurring (plans)" color="border-ok" />
        <Stat icon={<Users size={18} />} value={(totals.totalAdmins ?? 0) + (totals.totalEmployees ?? 0)} label={`Users (${totals.totalAdmins ?? 0} admin · ${totals.totalEmployees ?? 0} sales)`} color="border-gold" />
        <Stat icon={<Target size={18} />} value={totals.totalLeads ?? 0} label="Total Leads (all companies)" color="border-purple-400" />
      </div>

      <Card className="overflow-x-auto">
        {!companies.length ? (
          <EmptyState title="No companies yet" hint="Create a company to see it listed here." />
        ) : (
          <table className="w-full min-w-[860px] border-collapse">
            <thead><tr className="bg-navy-800 text-white">
              {['Sl. No', 'Company', 'Plan', 'Status', 'Monthly Fee', 'Users', 'Leads', 'Subscription Start', 'Renewal', 'Last Payment'].map((h) => (
                <th key={h} className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {companies.map((c, i) => {
                const s = c.subscription || {};
                return (
                  <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gold-pale">
                    <td className="px-2.5 py-2 text-xs text-ink-3">{i + 1}</td>
                    <td className="px-2.5 py-2 text-xs font-bold">
                      {c.name}
                      {!c.active && <span className="ml-1.5 status bg-gray-100 text-ink-3">Inactive</span>}
                    </td>
                    <td className="px-2.5 py-2 text-xs font-bold">{s.plan || 'Free'}</td>
                    <td className="px-2.5 py-2"><span className={`status ${STATUS_CLASS[s.status] || 'bg-gray-100 text-ink-3'}`}>{s.status || 'Trial'}</span></td>
                    <td className="px-2.5 py-2 text-xs whitespace-nowrap">
                      <div className="font-bold">{fmtINR(s.monthlyFee || 0)} <span className="font-normal text-ink-3">/mo</span></div>
                      <div className="text-[10px] text-ink-3">{fmtINR((s.monthlyFee || 0) * 12)} /yr</div>
                    </td>
                    <td className="px-2.5 py-2 text-xs whitespace-nowrap">
                      {(c.usage?.admins || 0) + (c.usage?.employees || 0)}
                      <span className="ml-1 text-[10px] text-ink-3">({c.usage?.admins || 0}a · {c.usage?.employees || 0}s)</span>
                    </td>
                    <td className="px-2.5 py-2 text-xs">{c.usage?.leads || 0}</td>
                    <td className="px-2.5 py-2 text-xs whitespace-nowrap">{s.startDate ? formatDate(s.startDate) : '—'}</td>
                    <td className="px-2.5 py-2 text-xs whitespace-nowrap">{s.renewalDate ? formatDate(s.renewalDate) : '—'}</td>
                    <td className="px-2.5 py-2 text-xs whitespace-nowrap">
                      {s.lastPaymentDate ? (
                        <>
                          {formatDate(s.lastPaymentDate)}
                          <div className="text-[10px] text-ink-3">{fmtINR(s.lastPaymentAmount || 0)}{s.paymentMethod ? ` · ${s.paymentMethod}` : ''}</div>
                        </>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}