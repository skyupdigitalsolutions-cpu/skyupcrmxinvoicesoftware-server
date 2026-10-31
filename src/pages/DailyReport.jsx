import { useState } from 'react';
import { Download, CalendarDays, ChevronLeft, ChevronRight, RefreshCw, ArrowUp, ArrowDown } from 'lucide-react';
import { reportApi } from '../api/endpoints.js';
import { useFetch } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card, CardHead, CardBody } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { exportSectionsPdf, exportSectionsCsv } from '../utils/exportPdf.js';
import {
  formatDate, fmtDateTime, fmtTimeOnly, fmt, fmtNum, curCode, statusClass,
  attendanceStatusLabel, attendanceStatusClass, fmtMobile,
} from '../utils/format.js';

// ── local date helpers (format.js only exposes formatDate) ──────────────────
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isToday = (d) => toKey(d) === toKey(new Date());
const initials = (name) => (name || 'U').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

const SOURCE_COLORS = ['#2563EB', '#7C3AED', '#0891B2', '#059669', '#D97706', '#DC2626', '#0D9488', '#9333EA'];
const STATUS_TONE = {
  Won: 'border-ok', Converted: 'border-ok',
  'Follow-up': 'border-warn', Interested: 'border-info', Contacted: 'border-info',
  New: 'border-gold', Lost: 'border-danger',
};

// ── small pieces ────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, tone = 'border-gold', trend }) {
  return (
    <div className={`rounded-lg border-l-4 bg-white p-4 shadow-card ${tone}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-1 text-2xl font-black text-navy">{value ?? '—'}</div>
      {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      {trend !== undefined && (
        <div className={`mt-0.5 flex items-center gap-1 text-[11px] font-bold ${trend >= 0 ? 'text-ok' : 'text-danger'}`}>
          {trend >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />} {Math.abs(trend)} vs yesterday
        </div>
      )}
    </div>
  );
}

function Bar({ label, value, total, color }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-ink-2">{label}</span>
        <span className="font-bold text-navy">{value} <span className="font-normal text-ink-3">· {pct}%</span></span>
      </div>
      <div className="h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  );
}

export default function DailyReport() {
  const { isAdmin, branding } = useAuth();
  const taxPct = Number.isFinite(branding?.taxPercent) ? branding.taxPercent : 5;
  const { show } = useToast();
  const [tab, setTab] = useState('overview');
  const [viewDate, setViewDate] = useState(new Date());
  const [exporting, setExporting] = useState(false);
  const viewingToday = isToday(viewDate);

  const { data, loading, error, refetch } = useFetch(
    () => reportApi.daily({ date: toKey(viewDate) }),
    [viewDate]
  );

  const summary = data?.summary || {};
  const leads = data?.leads || [];
  const sources = data?.sources || [];
  const employees = data?.employees || [];
  const followUps = data?.followUps || [];
  const conversions = data?.conversions || [];
  const orders = data?.orders || [];
  const invoices = data?.invoices || [];
  const deliveries = data?.deliveries || [];
  const pendingDeliveries = data?.pendingDeliveries || [];

  const goBack = () => setViewDate((d) => addDays(d, -1));
  const goForward = () => { if (!viewingToday) setViewDate((d) => addDays(d, 1)); };
  const goToday = () => setViewDate(new Date());

  const TABS = [
    ['overview', 'Overview', null],
    ['agents', 'Employee Activity', employees.filter((e) => e.callsToday > 0 || e.leads > 0).length],
    ['leads', 'New Leads', leads.length],
    ['orders', 'Orders', orders.length],
    ['invoices', 'Invoices', invoices.length],
    ['delivery', 'Delivery', deliveries.length],
    ['followups', 'Follow-ups', followUps.filter((f) => f.urgency !== 'upcoming').length],
    ['conversions', 'Buyers', conversions.length],
  ];

  // ── Combined export: every section of this day's report, each as its own
  // labeled table, in one PDF/CSV — regardless of which tab is active. ───────
  const buildSections = () => [
    {
      title: 'Leads',
      columns: ['Sl. No', 'Name', 'Mobile', 'Source', 'Status', 'Owner', 'Remark', 'Date'],
      rows: leads.map((l, i) => [
        i + 1, l.name, fmtMobile(l.mobile, l.country) || '—', l.source || '—', l.status,
        l.assignedUserName || 'Unassigned', l.remark || '—', fmtDateTime(l.date),
      ]),
    },
    {
      title: 'Orders',
      columns: ['Sl. No', 'Order #', 'Customer', 'City / Country', 'Items', 'Status', 'Salesperson', `Amount (${curCode()})`, `Due (${curCode()})`, 'Date'],
      rows: orders.map((o, i) => [
        i + 1, `#${o.orderNo}`, o.customer, `${o.city || '—'}${o.country ? `, ${o.country}` : ''}`,
        o.itemCount, o.status, o.salespersonName || '—',
        fmtNum(o.grandTotal), fmtNum(o.due), fmtDateTime(o.date),
      ]),
    },
    {
      title: 'Invoices',
      columns: ['Sl. No', 'Invoice #', 'Order #', 'Customer', 'Country', 'Salesperson', `Sub Total (${curCode()})`, `VAT (${curCode()})`, `Total (${curCode()})`, 'Payment', 'Date'],
      rows: invoices.map((v, i) => [
        i + 1, `INV-${v.invoiceNo}`, `#${v.orderNo}`, v.customer, v.country || '—', v.salespersonName || '—',
        fmtNum(v.subTotal), fmtNum(v.vatAmt), fmtNum(v.total),
        v.paymentStatus, fmtDateTime(v.date),
      ]),
    },
    {
      title: 'Delivery Activity',
      columns: ['Sl. No', 'Order #', 'Customer', 'City', 'Stage', 'Note', 'Updated By', 'Time'],
      rows: deliveries.map((d, i) => [
        i + 1, `#${d.orderNo}`, d.customer, d.city || '—', d.stage,
        d.deliveryDetails || d.note || '—', d.salespersonName || d.by || '—', fmtDateTime(d.at),
      ]),
    },
    {
      title: 'Delivery Pending',
      columns: ['Sl. No', 'Order #', 'Customer', 'Mobile', 'City', 'Stage', 'Delivery Details', 'Salesperson', 'Ordered'],
      rows: pendingDeliveries.map((p, i) => [
        i + 1, `#${p.orderNo}`, p.customer, fmtMobile(p.mobile, p.country) || '—', p.city || '—',
        p.stage, p.deliveryDetails || '—', p.salespersonName || '—', formatDate(p.orderedAt),
      ]),
    },
    {
      title: 'Employee Activity',
      columns: ['Sl. No', 'Employee', 'Attendance', 'Login', 'Logout', 'Hours', 'Leads', 'Calls', 'In Progress', 'Buyers'],
      rows: employees.map((e, i) => [
        i + 1, e.name, e.attendanceStatus ? attendanceStatusLabel(e.attendanceStatus) : '—',
        e.loginTime ? fmtTimeOnly(e.loginTime) : '—', e.logoutTime ? fmtTimeOnly(e.logoutTime) : '—',
        e.workingHours || '—', e.leads, e.callsToday, e.inProgress, e.converted,
      ]),
    },
    {
      title: 'Follow-ups',
      columns: ['Sl. No', 'Name', 'Mobile', 'Note', 'Urgency', 'Due', 'Assigned To'],
      rows: followUps.map((f, i) => [
        i + 1, f.name, fmtMobile(f.mobile, f.country) || '—', f.note || '—', f.urgency, f.daysLabel, f.assignedUser || 'Unassigned',
      ]),
    },
    {
      title: 'Buyers (Conversions)',
      columns: ['Sl. No', 'Name', 'Source', 'Campaign', 'Assigned To'],
      rows: conversions.map((l, i) => [
        i + 1, l.name, l.source || '—', l.campaign || '—', l.assignedUserName || 'Unassigned',
      ]),
    },
  ];

  const exportMeta = () => ({
    Date: formatDate(viewDate),
    Leads: leads.length, Orders: orders.length, Invoices: invoices.length,
    Deliveries: deliveries.length, 'Delivery Pending': pendingDeliveries.length, Employees: employees.length,
  });

  const exportPdf = async () => {
    setExporting(true);
    try {
      await exportSectionsPdf({
        title: `Daily Report · ${formatDate(viewDate)}`,
        sections: buildSections(),
        meta: exportMeta(),
        filename: `daily_report_${toKey(viewDate)}`,
      });
    } catch (e) { show(e.message || 'Export failed. Check your connection.', 'error'); }
    finally { setExporting(false); }
  };
  const exportCsv = () => {
    try {
      exportSectionsCsv({
        title: `Daily Report · ${formatDate(viewDate)}`,
        sections: buildSections(),
        filename: `daily_report_${toKey(viewDate)}`,
      });
    } catch (e) { show(e.message || 'Export failed.', 'error'); }
  };

  if (loading) return <Spinner label="Loading daily report…" />;

  const empMax = Math.max(1, ...employees.map((e) => e.leads));

  return (
    <>
      <PageTitle icon={<CalendarDays size={18} />}>{isAdmin ? 'Daily Report' : 'My Daily Report'}</PageTitle>

      {/* date nav */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${viewingToday ? 'animate-pulse bg-ok' : 'bg-ink-3'}`} />
            <span className={`text-[11px] font-bold uppercase tracking-wide ${viewingToday ? 'text-ok' : 'text-ink-3'}`}>
              {viewingToday ? 'Live report' : 'Historical report'}
            </span>
          </div>
          <p className="text-sm text-ink-2">{formatDate(viewDate)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={goBack}><ChevronLeft size={15} /></Button>
          <Button size="sm" variant={viewingToday ? undefined : 'outline'} onClick={goToday}>
            {viewingToday ? 'Today' : 'Go to Today'}
          </Button>
          <Button size="sm" variant="outline" onClick={goForward} disabled={viewingToday}><ChevronRight size={15} /></Button>
          <Button size="sm" variant="outline" onClick={refetch}><span className="flex items-center gap-1.5"><RefreshCw size={13} />Refresh</span></Button>
        </div>
      </div>

      {/* export — admin only */}
      {isAdmin && (
        <div className="mb-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={exporting} onClick={exportCsv}>
            <span className="flex items-center gap-1.5"><Download size={13} />Export CSV</span>
          </Button>
          <Button variant="dark" size="sm" disabled={exporting} onClick={exportPdf}>
            <span className="flex items-center gap-1.5"><Download size={13} />{exporting ? 'Exporting…' : 'Export PDF'}</span>
          </Button>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-danger-light px-4 py-3">
          <p className="text-xs font-bold text-danger">{error}</p>
          <button onClick={refetch} className="text-[11px] font-bold text-danger underline">Retry</button>
        </div>
      )}

      {/* tabs */}
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-card">
        {TABS.map(([k, l, c]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold transition ${tab === k ? 'bg-navy text-white' : 'text-ink-2 hover:bg-gold-pale'}`}>
            {l}
            {c !== null && c > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === k ? 'bg-white/20' : 'bg-gold-pale text-navy'}`}>{c}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-5">
            <StatCard label="New Leads" value={summary.total} sub="Received this day" tone="border-gold" trend={summary.trendTotal} />
            <StatCard label="Contacted" value={summary.contacted} sub={`${summary.newLeads || 0} not reached`} tone="border-info" />
            <StatCard label="Buyers" value={summary.converted} sub={`${summary.convRate || 0}% rate`} tone="border-ok" trend={summary.trendConverted} />
            <StatCard label="In Progress" value={summary.inProgress} sub="Active follow-ups" tone="border-warn" />
            <StatCard label="Unassigned" value={summary.unassigned} sub="Needs assignment" tone="border-danger" />
          </div>

          <div className="grid gap-3.5 lg:grid-cols-3">
            <Card><CardHead title="Conversion Funnel" /><CardBody>
              <Bar label="New leads" value={summary.total || 0} total={summary.total || 0} color="#2563EB" />
              <Bar label="Contacted" value={summary.contacted || 0} total={summary.total || 0} color="#0891B2" />
              <Bar label="In Progress" value={summary.inProgress || 0} total={summary.total || 0} color="#D97706" />
              <Bar label="Buyer" value={summary.converted || 0} total={summary.total || 0} color="#059669" />
              <Bar label="Lost" value={summary.notInterested || 0} total={summary.total || 0} color="#DC2626" />
            </CardBody></Card>

            <Card><CardHead title="Leads by Source" /><CardBody>
              {sources.length === 0 ? <p className="text-xs text-ink-3">No leads for this date.</p> :
                sources.map((s, i) => <Bar key={s.label} label={s.label} value={s.count} total={summary.total || 1} color={SOURCE_COLORS[i % SOURCE_COLORS.length]} />)}
            </CardBody></Card>

            <Card><CardHead title="Status Breakdown" /><CardBody>
              <div className="grid grid-cols-2 gap-2.5">
                {[['New', summary.newLeads], ['In Progress', summary.inProgress], ['Buyers', summary.converted], ['Lost', summary.notInterested]].map(([label, val]) => (
                  <div key={label} className="rounded-lg bg-gold-pale px-3 py-3">
                    <div className="text-2xl font-black text-navy">{val || 0}</div>
                    <div className="text-[11px] font-bold text-ink-2">{label}</div>
                    <div className="text-[10px] text-ink-3">{Math.round(((val || 0) / (summary.total || 1)) * 100)}%</div>
                  </div>
                ))}
              </div>
            </CardBody></Card>
          </div>
        </div>
      )}

      {/* ── EMPLOYEE ACTIVITY ── */}
      {tab === 'agents' && (
        <Card><CardHead title="Employee Activity" /><CardBody className="!p-0">
          {employees.length === 0 ? <EmptyState title="No activity" hint="No leads recorded for this day." /> : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr className="bg-navy-800 text-white">
                  {['Employee', 'Attendance', 'Login', 'Logout', 'Hours', 'Leads', 'Calls', 'In Progress', 'Buyers', 'Conv. Rate'].map((h) =>
                    <th key={h} className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide">{h}</th>)}
                </tr></thead>
                <tbody>
                  {employees.map((e, i) => {
                    const rate = e.leads > 0 ? Math.round((e.converted / e.leads) * 100) : 0;
                    const active = e.callsToday > 0 || e.leads > 0;
                    return (
                      <tr key={i} className={`border-b border-gray-100 last:border-0 ${active ? '' : 'opacity-40'}`}>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold-pale text-[10px] font-bold text-navy">{initials(e.name)}</span>
                            <span className="text-xs font-bold">{e.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {e.attendanceStatus ? (
                            <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${attendanceStatusClass(e.attendanceStatus)}`}>
                              {attendanceStatusLabel(e.attendanceStatus)}
                            </span>
                          ) : <span className="text-[11px] text-ink-3">—</span>}
                        </td>
                        <td className="px-3 py-3 text-xs text-ink-2">{e.loginTime ? fmtTimeOnly(e.loginTime) : '—'}</td>
                        <td className="px-3 py-3 text-xs text-ink-2">{e.logoutTime ? fmtTimeOnly(e.logoutTime) : '—'}</td>
                        <td className="px-3 py-3 text-xs text-ink-2">{e.workingHours || '—'}</td>
                        <td className="px-3 py-3 text-xs font-bold">{e.leads}</td>
                        <td className="px-3 py-3 text-xs font-bold text-info">{e.callsToday}</td>
                        <td className="px-3 py-3 text-xs font-bold text-warn">{e.inProgress}</td>
                        <td className="px-3 py-3 text-xs font-bold text-ok">{e.converted}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-ok" style={{ width: `${rate}%` }} /></div>
                            <span className="text-xs font-bold text-ok">{rate}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody></Card>
      )}

      {/* ── NEW LEADS ── */}
      {tab === 'leads' && (
        <Card><CardHead title={`Leads · ${formatDate(viewDate)}`} /><CardBody className="!p-0">
          {leads.length === 0 ? <EmptyState title="No leads" hint="Nothing recorded for this date." /> : (
            <div>
              {leads.map((l, i) => (
                <div key={String(l._id || i)} className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-0 hover:bg-gold-pale">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-pale text-[11px] font-bold text-navy">{initials(l.name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold">{l.name}</span>
                      <span className="font-mono text-[11px] text-ink-3">{isAdmin ? (fmtMobile(l.mobile, l.country) || '—') : '••••••'}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] + '22', color: SOURCE_COLORS[i % SOURCE_COLORS.length] }}>{l.source}</span>
                      <span className="text-[10px] font-bold text-ink-2">{l.status}</span>
                      {l.remark && <span className="truncate text-[11px] italic text-ink-3">{l.remark}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[11px]">
                    {l.assignedUserName
                      ? <span className="font-bold text-ink-2">{l.assignedUserName}</span>
                      : <span className="rounded bg-warn-light px-2 py-1 font-bold text-warn">Unassigned</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody></Card>
      )}

      {/* ── ORDERS ── */}
      {tab === 'orders' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3">
            <StatCard label="Orders" value={summary.totalOrders || 0} sub={formatDate(viewDate)} tone="border-gold" />
            <StatCard label="Revenue" value={fmt(summary.ordersRevenue || 0)} sub="Order value" tone="border-ok" />
            <StatCard label="Due" value={fmt(summary.ordersDue || 0)} sub="Outstanding" tone="border-warn" />
          </div>
          <Card><CardHead title={`Orders · ${formatDate(viewDate)}`} /><CardBody className="!p-0">
            {orders.length === 0 ? <EmptyState title="No orders" hint="No orders were placed on this date." /> : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead><tr className="bg-navy-800 text-white">
                    {['Order #', 'Customer', 'City / Country', 'Items', 'Status', 'Salesperson', 'Amount', 'Due'].map((h) =>
                      <th key={h} className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {orders.map((o, i) => (
                      <tr key={String(o._id || i)} className="border-b border-gray-100 last:border-0 hover:bg-gold-pale">
                        <td className="px-3 py-3 text-xs font-bold">#{o.orderNo}</td>
                        <td className="px-3 py-3 text-xs">{o.customer}</td>
                        <td className="px-3 py-3 text-xs text-ink-3">{o.city || '—'}{o.country ? `, ${o.country}` : ''}</td>
                        <td className="px-3 py-3 text-xs">{o.itemCount}</td>
                        <td className="px-3 py-3"><span className={`rounded px-2 py-0.5 text-[10px] font-bold ${statusClass(o.status)}`}>{o.status}</span></td>
                        <td className="px-3 py-3 text-xs text-ink-2">{o.salespersonName || '—'}</td>
                        <td className="px-3 py-3 text-xs font-bold text-navy">{fmt(o.grandTotal)}</td>
                        <td className="px-3 py-3 text-xs font-bold text-warn">{fmt(o.due)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody></Card>
        </div>
      )}

      {/* ── INVOICES ── */}
      {tab === 'invoices' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3">
            <StatCard label="Invoices" value={summary.totalInvoices || 0} sub={formatDate(viewDate)} tone="border-gold" />
            <StatCard label="Invoiced Revenue" value={fmt(summary.invoicedRevenue || 0)} sub="Total" tone="border-ok" />
            <StatCard label="VAT Collected" value={fmt(summary.vatCollected || 0)} sub={`${taxPct}% ${branding?.taxLabel || 'VAT'}`} tone="border-info" />
          </div>
          <Card><CardHead title={`Invoices · ${formatDate(viewDate)}`} /><CardBody className="!p-0">
            {invoices.length === 0 ? <EmptyState title="No invoices" hint="No invoices were raised on this date." /> : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead><tr className="bg-navy-800 text-white">
                    {['Invoice #', 'Order #', 'Customer', 'Country', 'Salesperson', 'Sub Total', 'VAT', 'Total', 'Payment'].map((h) =>
                      <th key={h} className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {invoices.map((v, i) => (
                      <tr key={String(v._id || i)} className="border-b border-gray-100 last:border-0 hover:bg-gold-pale">
                        <td className="px-3 py-3 text-xs font-bold">INV-{v.invoiceNo}</td>
                        <td className="px-3 py-3 text-xs text-ink-3">#{v.orderNo}</td>
                        <td className="px-3 py-3 text-xs">{v.customer}</td>
                        <td className="px-3 py-3 text-xs text-ink-3">{v.country || '—'}</td>
                        <td className="px-3 py-3 text-xs text-ink-2">{v.salespersonName || '—'}</td>
                        <td className="px-3 py-3 text-xs">{fmt(v.subTotal)}</td>
                        <td className="px-3 py-3 text-xs">{fmt(v.vatAmt)}</td>
                        <td className="px-3 py-3 text-xs font-bold text-navy">{fmt(v.total)}</td>
                        <td className="px-3 py-3">
                          <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${v.paymentStatus === 'Paid' ? 'bg-ok-light text-ok' : v.paymentStatus === 'Partial' ? 'bg-warn-light text-warn' : 'bg-danger-light text-danger'}`}>
                            {v.paymentStatus}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody></Card>
        </div>
      )}

      {/* ── DELIVERY ── */}
      {tab === 'delivery' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
            <StatCard label="Delivery Updates" value={deliveries.length} sub={formatDate(viewDate)} tone="border-gold" />
            <StatCard label="Delivery Pending" value={pendingDeliveries.length} sub="Awaiting delivery" tone="border-warn" />
          </div>
          <Card><CardHead title={`Delivery Activity · ${formatDate(viewDate)}`} /><CardBody className="!p-0">
            {deliveries.length === 0 ? <EmptyState title="No delivery activity" hint="No order moved to Shipped, Out for Delivery, or Delivered on this date." /> : (
              <div>
                {deliveries.map((d, i) => (
                  <div key={String(d._id || i)} className="flex items-start gap-3 border-b border-gray-100 px-4 py-3 last:border-0">
                    <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-pale text-[10px] font-bold text-navy">#{d.orderNo}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold">{d.customer} <span className="ml-1 font-mono text-[11px] font-normal text-ink-3">{isAdmin ? (fmtMobile(d.mobile, d.country) || '') : '••••••'}</span></span>
                        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${statusClass(d.stage)}`}>{d.stage}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
                        <span className="truncate text-[11px] text-ink-3">{d.deliveryDetails || d.note || 'No delivery note'}</span>
                        <span className="shrink-0 text-[11px] text-ink-3">{d.salespersonName || d.by || 'Unassigned'} · {fmtTimeOnly(d.at)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody></Card>

          {/* Orders still awaiting delivery — current state, not day-bound. */}
          <Card><CardHead title={`Delivery Pending (${pendingDeliveries.length})`} /><CardBody className="!p-0">
            {pendingDeliveries.length === 0 ? <EmptyState title="Nothing pending" hint="Every order has been delivered. 🎉" /> : (
              <div>
                {pendingDeliveries.map((p, i) => (
                  <div key={String(p._id || i)} className="flex items-start gap-3 border-b border-gray-100 px-4 py-3 last:border-0">
                    <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warn-light text-[10px] font-bold text-warn">#{p.orderNo}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold">
                          {p.customer}
                          <span className="ml-1 font-mono text-[11px] font-normal text-ink-3">{isAdmin ? (fmtMobile(p.mobile, p.country) || '') : '••••••'}</span>
                          {p.invoiced && <span className="ml-2 text-[9px] font-bold uppercase tracking-wide text-purple-700">Invoiced</span>}
                        </span>
                        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${statusClass(p.stage)}`}>{p.stage}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
                        <span className="truncate text-[11px] text-ink-3">{p.deliveryDetails || 'No delivery note'}</span>
                        <span className="shrink-0 text-[11px] text-ink-3">{p.salespersonName || 'Unassigned'} · Ordered {formatDate(p.orderedAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody></Card>
        </div>
      )}

      {/* ── FOLLOW-UPS ── */}
      {tab === 'followups' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
            <StatCard label="Total" value={followUps.length} sub="Open follow-ups" tone="border-warn" />
            <StatCard label="Overdue" value={followUps.filter((f) => f.urgency === 'overdue').length} sub="Past due" tone="border-danger" />
            <StatCard label="Due Today" value={followUps.filter((f) => f.urgency === 'today').length} sub="Call today" tone="border-warn" />
            <StatCard label="Upcoming" value={followUps.filter((f) => f.urgency === 'upcoming').length} sub="Scheduled" tone="border-info" />
          </div>
          <Card><CardHead title="Pending Follow-ups" /><CardBody className="!p-0">
            {followUps.length === 0 ? <EmptyState title="No follow-ups" hint="Set a follow-up date on a lead to see it here." /> : (
              <div>
                {followUps.map((f, i) => (
                  <div key={String(f._id || i)} className="flex items-start gap-3 border-b border-gray-100 px-4 py-3 last:border-0">
                    <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: f.dotColor }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold">{f.name} <span className="ml-1 font-mono text-[11px] font-normal text-ink-3">{isAdmin ? (fmtMobile(f.mobile, f.country) || '') : '••••••'}</span></span>
                        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${f.urgency === 'overdue' ? 'bg-danger-light text-danger' : f.urgency === 'today' ? 'bg-warn-light text-warn' : 'bg-info-light text-info'}`}>{f.daysLabel}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] italic text-ink-3">{f.note || 'Follow-up required'}</span>
                        <span className="shrink-0 text-[11px] text-ink-3">{f.assignedUser || 'Unassigned'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody></Card>
        </div>
      )}

      {/* ── CONVERSIONS ── */}
      {tab === 'conversions' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
            <StatCard label="Buyers" value={conversions.length} sub={formatDate(viewDate)} tone="border-ok" />
            <StatCard label="Conv. Rate" value={`${summary.convRate || 0}%`} sub="This day" tone="border-purple-400" />
            <StatCard label="Calls Made" value={summary.callsMadeToday || 0} sub="Total calls" tone="border-info" />
            <StatCard label="Total Contacts" value={summary.total || 0} sub="This date" tone="border-gold" />
          </div>
          <Card><CardHead title="Buyers" /><CardBody className="!p-0">
            {conversions.length === 0 ? <EmptyState title="No conversions" hint="No deals closed on this day." /> : (
              <div>
                {conversions.map((l, i) => (
                  <div key={String(l._id || i)} className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-0">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ok text-[11px] font-bold text-white">{initials(l.name)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold">{l.name}</span>
                        {l.campaign && <span className="rounded-full bg-gold-pale px-2 py-0.5 text-[10px] font-bold text-ink-2">{l.campaign}</span>}
                      </div>
                      <div className="text-[11px] text-ink-3">{l.assignedUserName || 'Unassigned'} · {l.source}</div>
                    </div>
                    <span className="shrink-0 rounded bg-ok px-2 py-1 text-[10px] font-bold text-white">Buyer</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody></Card>
        </div>
      )}
    </>
  );
}