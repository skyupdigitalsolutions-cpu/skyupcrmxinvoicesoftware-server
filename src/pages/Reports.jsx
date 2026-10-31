import { useState, useMemo, useEffect } from 'react';
import {
  BarChart2, Users, TrendingUp, AlertCircle, UserCheck,
  Inbox, Target, Pencil, Printer, ChevronLeft, ChevronRight,
  Download,
} from 'lucide-react';
import { reportApi, leadApi, userApi } from '../api/endpoints.js';
import { api } from '../api/client.js';
import { useFetch } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card, CardHead, CardBody } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { Input, Select } from '../components/ui/Field.jsx';
import { LeadFormModal } from './Leads.jsx';
import { exportSectionsPdf, exportSectionsCsv } from '../utils/exportPdf.js';
import {
  fmtDHS, fmtAED, formatDate, fmtNum, curCode,
  LEAD_STATUSES, LEAD_SOURCES, leadStatusClass,
  LEAD_STAGES, leadStageOf, leadStageClass, fmtMobile, phoneSearchMatches,
} from '../utils/format.js';

const SOURCE_COLORS = ['#2563EB', '#7C3AED', '#0891B2', '#059669', '#D97706', '#DC2626', '#0D9488', '#9333EA'];
const PER_PAGE = 10;

// Inclusive day-range check against a date string/Date.
const inRange = (d, from, to) => {
  if (!d) return false;
  const t = new Date(d).getTime();
  if (from && t < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && t > new Date(`${to}T23:59:59`).getTime()) return false;
  return true;
};

// Derives {from, to} date strings from a named period (or explicit custom range).
const getPeriodBounds = (query) => {
  if (query.from || query.to) return { from: query.from, to: query.to };
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (query.period === 'today') {
    const t = ymd(now);
    return { from: t, to: t };
  }
  if (query.period === 'week') {
    const day = now.getDay(); // 0=Sun
    const mon = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: ymd(mon), to: ymd(sun) };
  }
  if (query.period === 'month') {
    const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from, to: ymd(last) };
  }
  if (query.period === 'year') {
    return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
  }
  return { from: undefined, to: undefined }; // "All Time"
};

// ── Single merged report page: Leads + Sales Analytics share one filter bar,
// one combined stat row, side-by-side panels, and one export. ──────────────
export default function Reports() {
  const [activeTab, setActiveTab] = useState('overview'); // overview | monthly
  const { isAdmin, user } = useAuth();
  const { show } = useToast();

  const { data: leads, loading: leadsLoading, refetch: refetchLeads } = useFetch(() => leadApi.list(), []);
  const { data: monthlyData, loading: monthlyLoading } = useFetch(
    () => activeTab === 'monthly' ? reportApi.monthlyComparison() : Promise.resolve(null),
    [activeTab]
  );
  const [query, setQuery] = useState({ period: 'month' });
  const { data: sales, loading: salesLoading } = useFetch(() => reportApi.sales(query), [JSON.stringify(query)]);
  // Lazy-loaded on export only — avoids fetching thousands of records on page load
  const [allOrders, setAllOrders] = useState(null);
  const [allPOs, setAllPOs]       = useState(null);
  const fetchExportData = async () => {
    const [ord, po] = await Promise.all([
      allOrders ? Promise.resolve(allOrders) : api.get('/orders').then(r => r.data.orders || []),
      allPOs    ? Promise.resolve(allPOs)    : api.get('/purchase-orders').then(r => r.data.purchaseOrders || []),
    ]);
    setAllOrders(ord); setAllPOs(po);
    return { allOrders: ord, allPOs: po };
  };

  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [stageFilter, setStageFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [editLead, setEditLead] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (isAdmin) userApi.list()
      .then((u) => setEmployees(u.filter((x) => x.role === 'sales' && x.active)))
      .catch(() => {});
  }, [isAdmin]);

  const allLeads = leads || [];
  const employeeName = query.employee
    ? employees.find((u) => String(u.id || u._id) === String(query.employee))?.name
    : '';

  // Leads filtered by the SHARED filter bar (period, employee, country).
  // Uses getPeriodBounds so named periods (today/week/month/year) actually
  // filter leads.
  const sharedFiltered = useMemo(() => {
    const { from, to } = getPeriodBounds(query);

    // Employee match is keyed on the OWNER ID (robust) rather than the display
    // name. Name matching broke when employees hadn't loaded yet, when the
    // owner's name had been edited after the lead was created, or when two
    // people shared a name. A name fallback stays for the rare legacy lead
    // that has ownerName but no owner id.
    const empId = query.employee ? String(query.employee) : '';
    const ctry  = query.country || '';

    return allLeads.filter((l) => {
      if (empId) {
        const leadOwnerId = l.owner ? String(l.owner?._id || l.owner) : '';
        const byId   = leadOwnerId && leadOwnerId === empId;
        const byName = !leadOwnerId && employeeName && l.ownerName === employeeName;
        if (!byId && !byName) return false;
      }
      if (ctry && l.country !== ctry) return false;
      if (from || to) return inRange(l.createdAt, from, to);
      return true;
    });
  }, [allLeads, employeeName, query.employee, query.country, query.period, query.from, query.to]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return sharedFiltered.filter((l) =>
      (!q || l.name?.toLowerCase().includes(q) || phoneSearchMatches(l.mobile, search) || l.campaign?.toLowerCase().includes(q)) &&
      (statusFilter === 'All' || l.status === statusFilter) &&
      (sourceFilter === 'All' || l.source === sourceFilter) &&
      (stageFilter === 'All' || leadStageOf(l) === stageFilter)
    );
  }, [sharedFiltered, search, statusFilter, sourceFilter, stageFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  // ── Lead-side aggregates (scoped to the shared filter bar) ────────────────
  const won = sharedFiltered.filter((l) => l.status === 'Won' || l.converted).length;
  const convRate = sharedFiltered.length ? Math.round((won / sharedFiltered.length) * 100) : 0;
  const byOwner = useMemo(() => {
    const m = {};
    sharedFiltered.forEach((l) => {
      const n = l.ownerName || 'Unassigned';
      m[n] = m[n] || { name: n, leads: 0, won: 0 };
      m[n].leads += 1;
      if (l.status === 'Won' || l.converted) m[n].won += 1;
    });
    return Object.values(m).sort((a, b) => b.leads - a.leads);
  }, [sharedFiltered]);
  const ownerMax = Math.max(1, ...byOwner.map((o) => o.leads));
  const bySource = useMemo(() => {
    const m = {};
    sharedFiltered.forEach((l) => { if (l.source) m[l.source] = (m[l.source] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [sharedFiltered]);

  // Country options derived from actual data (leads + sales) so the dropdown
  // never shows empty choices.
  const countryOptions = useMemo(() => {
    const set = new Set(Object.keys(sales?.byCountry || {}).filter(Boolean));
    allLeads.forEach((l) => { if (l.country) set.add(l.country); });
    return [...set].sort();
  }, [sales, allLeads]);

  // ── Combined export: Leads + every sales-analytics section, in one file ──
  const buildSections = () => [
    {
      title: 'Leads',
      columns: ['Sl. No', 'Name', 'Phone', 'Source', 'Country', 'Employee', 'Stage', 'Status', 'Date', 'Remark'],
      rows: filtered.map((l, i) => [
        i + 1, l.name, fmtMobile(l.mobile, l.country) || '—', l.source || '—', l.country || '—',
        l.ownerName || '—', leadStageOf(l), l.status, formatDate(l.createdAt), l.remark || '—',
      ]),
    },
    {
      title: 'Employee Performance (Leads)',
      columns: ['Employee', 'Leads', 'Buyers'],
      rows: byOwner.map((o) => [o.name, o.leads, o.won]),
    },
    {
      title: 'By Salesperson (Orders)',
      columns: ['Salesperson', 'Orders', `Revenue (${curCode()})`],
      rows: Object.entries(sales?.bySalesperson || {}).map(([name, v]) => [
        name, v.orders, fmtNum(v.revenue),
      ]),
    },
    {
      title: 'By Country (Revenue)',
      columns: ['Country', `Revenue (${curCode()})`],
      rows: Object.entries(sales?.byCountry || {}).map(([c, v]) => [c, fmtNum(v)]),
    },
    {
      title: 'Orders by Status',
      columns: ['Status', 'Count'],
      rows: Object.entries(sales?.byStatus || {}),
    },
    {
      title: 'Pipeline Status (Leads)',
      columns: ['Status', 'Count'],
      rows: LEAD_STATUSES.map((s) => [s, sharedFiltered.filter((l) => l.status === s).length]),
    },
    {
      title: 'Sales Order Items (Complete)',
      columns: ['Order #', 'Date', 'Customer', 'Mobile', 'City', 'Country', 'Salesperson', 'Status',
                'Article No.', 'Description', 'Size', 'Color', 'Qty', `Rate (${curCode()})`, `Amount (${curCode()})`,
                'Grand Total', 'Pay Terms'],
      rows: (allOrders || []).flatMap((o) =>
        (o.items || []).map((it) => [
          `#${o.orderNo}`,
          formatDate(o.date || o.createdAt),
          o.customer || '—',
          fmtMobile(o.mobile, o.country) || '—',
          o.city || '—',
          o.country || '—',
          o.salespersonName || '—',
          o.status || '—',
          it.modelCode || it.sku || '—',
          it.description || it.name || '—',
          it.size || '—',
          it.color || '—',
          it.qty ?? 0,
          fmtNum(it.price || it.rate || 0),
          fmtNum((it.qty || 0) * (it.price || it.rate || 0)),
          fmtNum(o.grandTotal || 0),
          o.payTerms || '—',
        ])
      ),
    },
    {
      title: 'Purchase Order Items (Complete)',
      columns: ['PO #', 'Date', 'Supplier', 'Contact', 'City', 'Country',
                'Payment Status', 'PO Status',
                'Article No.', 'Description', 'Size', 'Qty', `Rate (${curCode()})`, `Amount (${curCode()})`,
                'Grand Total'],
      rows: (allPOs || []).flatMap((p) =>
        (p.items || []).map((it) => [
          `PO-${p.poNo}`,
          formatDate(p.date || p.createdAt),
          p.supplierName || '—',
          p.supplierContact || '—',
          p.city || '—',
          p.country || '—',
          p.paymentStatus || '—',
          p.status || '—',
          it.modelCode || '—',
          it.description || '—',
          it.size || '—',
          it.qty ?? 0,
          fmtNum(it.price || 0),
          fmtNum((it.qty || 0) * (it.price || 0)),
          fmtNum(p.grandTotal || 0),
        ])
      ),
    },
  ];

  const exportMeta = () => ({
    Period: sales?.period ? `${formatDate(sales.period.from)} - ${formatDate(sales.period.to)}` : 'All Time',
    Employee: employeeName || 'All',
    Country: query.country || 'All',
    Leads: filtered.length,
    Orders: sales?.summary?.totalOrders || 0,
    Revenue: fmtAED(sales?.summary?.totalRevenue || 0),
  });

  const exportPdf = async () => {
    if (!allOrders || !allPOs) { await fetchExportData(); }
    setExporting(true);
    try {
      await exportSectionsPdf({
        title: 'Leads & Sales Report',
        sections: buildSections(),
        meta: exportMeta(),
        filename: 'leads_sales_report',
      });
    } catch (e) { show(e.message || 'Export failed. Check your connection.', 'error'); }
    finally { setExporting(false); }
  };
  const exportCsv = () => {
    try { exportSectionsCsv({ title: 'Leads & Sales Report', sections: buildSections(), filename: 'leads_sales_report' }); }
    catch (e) { show(e.message || 'Export failed.', 'error'); }
  };

  const loading = leadsLoading || salesLoading;

  return (
    <>
      {/* Tab bar */}
      <div className="mb-4 flex gap-1 rounded-xl border p-1" style={{ background: 'var(--bg-card-head)', borderColor: 'var(--border-card)', width: 'fit-content' }}>
        {[['overview', 'Overview'], ['monthly', 'Monthly Comparison']].map(([k, l]) => (
          <button key={k} onClick={() => setActiveTab(k)}
            className="rounded-lg px-4 py-1.5 text-[12px] font-bold transition"
            style={{
              background: activeTab === k ? 'var(--bg-card)' : 'transparent',
              color: activeTab === k ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: activeTab === k ? 'var(--shadow-card)' : 'none',
            }}>
            {l}
          </button>
        ))}
      </div>

      {activeTab === 'monthly' ? (
        <MonthlyComparison data={monthlyData} loading={monthlyLoading} />
      ) : (
      <>
      <PageTitle icon={<BarChart2 size={18} />}>Reports</PageTitle>

      {/* ── shared filter bar (drives BOTH leads + sales analytics) ── */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        {['today', 'week', 'month', 'year'].map((p) => (
          <Button key={p} size="sm" variant={query.period === p && !query.from ? 'gold' : 'outline'}
            onClick={() => setQuery((q) => ({ ...q, period: p, from: undefined, to: undefined }))}>
            {{ today: 'Today', week: 'This Week', month: 'This Month', year: 'This Year' }[p]}
          </Button>
        ))}
        <span className="text-gray-300">|</span>
        <span className="text-[11px] text-ink-3">Custom:</span>
        <Input className="!w-auto" type="date" value={query.from || ''} onChange={(e) => setQuery((q) => ({ ...q, period: undefined, from: e.target.value }))} />
        <Input className="!w-auto" type="date" value={query.to || ''} onChange={(e) => setQuery((q) => ({ ...q, period: undefined, to: e.target.value }))} />
        <Button size="sm" variant="outline" onClick={() => setQuery((q) => ({ employee: q.employee, country: q.country }))}>All Time</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {isAdmin && (
          <Select className="!w-44" value={query.employee || ''} onChange={(e) => setQuery((q) => ({ ...q, employee: e.target.value || undefined }))}>
            <option value="">All Employees</option>
            {employees.map((u) => <option key={u.id || u._id} value={u.id || u._id}>{u.name}</option>)}
          </Select>
        )}
        <Select className="!w-40" value={query.country || ''} onChange={(e) => setQuery((q) => ({ ...q, country: e.target.value || undefined }))}>
          <option value="">All Countries</option>
          {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={exporting || loading} onClick={exportCsv}>
            <span className="flex items-center gap-1.5"><Download size={13} />Export CSV</span>
          </Button>
          <Button size="sm" variant="dark" disabled={exporting || loading} onClick={exportPdf}>
            <span className="flex items-center gap-1.5"><Download size={13} />{exporting ? 'Exporting…' : 'Export PDF'}</span>
          </Button>
          {/* <Button size="sm" onClick={() => window.print()}>
            <Printer size={13} className="mr-1.5" />Print / PDF
          </Button> */}
        </div>
      </div>

      {sales?.period && (
        <p className="mb-3 text-[13px] font-bold text-info">
          {formatDate(sales.period.from)} — {formatDate(sales.period.to)}
        </p>
      )}

      {loading ? <Spinner label="Crunching numbers…" /> : (
        <>
          {/* ── combined headline stats ── */}
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Stat label="Total Contacts"  value={sharedFiltered.length} icon={<Users size={16} />}      tone="border-info" />
            <Stat label="Buyers"       value={won}  sub={`${convRate}% rate`} icon={<UserCheck size={16} />} tone="border-ok" />
            <Stat label="In Progress"  value={sharedFiltered.filter((l) => ['Contacted', 'Interested', 'Follow-up'].includes(l.status)).length} icon={<TrendingUp size={16} />} tone="border-warn" />
            <Stat label="Orders"       value={sales?.summary?.totalOrders ?? 0} />
            <Stat label="Revenue"      value={fmtAED(sales?.summary?.totalRevenue || 0)} tone="border-gold" />
            <Stat label="VAT Collected" value={fmtAED(sales?.summary?.vatCollected || 0)} tone="border-ok" />
          </div>

          {/* ── side-by-side: leads vs sales breakdowns ── */}
          <div className="mb-4 grid gap-3.5 md:grid-cols-2">
            <Card>
              <CardHead title="Employee Performance (Leads)" icon={<Users size={14} className="text-ink-3" />} />
              <CardBody>
                {byOwner.length === 0 ? <p className="text-xs text-ink-3">No leads yet.</p> : byOwner.map((o) => (
                  <div key={o.name} className="mb-2.5">
                    <div className="mb-1 flex justify-between text-[11px]">
                      <span className="font-bold text-ink-2">{o.name}</span>
                      <span className="text-ink-3"><span className="font-bold text-ok">{o.won} won</span> · {o.leads}</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100">
                      <div className="h-2 rounded-full bg-purple-500" style={{ width: `${(o.leads / ownerMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardHead title="By Salesperson (Orders)" icon={<Users size={14} className="text-ink-3" />} />
              <CardBody className="!p-0">
                <Table rows={Object.entries(sales?.bySalesperson || {})} cols={['Salesperson', 'Orders', 'Revenue']}
                  render={([name, v]) => [name, v.orders, fmtDHS(v.revenue)]} empty="No sales in this period." />
              </CardBody>
            </Card>
          </div>

          <div className="mb-4 grid gap-3.5 md:grid-cols-2">
            <Card>
              <CardHead title="Leads by Source" icon={<Inbox size={14} className="text-ink-3" />} />
              <CardBody>
                {bySource.length === 0 ? <p className="text-xs text-ink-3">No leads yet.</p> : bySource.map(([label, count], i) => (
                  <div key={label} className="mb-2.5 flex items-center gap-3">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                    <span className="flex-1 text-xs text-ink-2">{label}</span>
                    <div className="h-2 flex-1 rounded-full bg-gray-100">
                      <div className="h-2 rounded-full" style={{ width: `${Math.round((count / sharedFiltered.length) * 100)}%`, background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                    </div>
                    <span className="w-6 text-right text-xs font-bold text-navy">{count}</span>
                  </div>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardHead title="Revenue by Country" icon={<BarChart2 size={14} className="text-ink-3" />} />
              <CardBody className="!p-0">
                <Table rows={Object.entries(sales?.byCountry || {})} cols={['Country', 'Revenue']}
                  render={([c, v]) => [c, fmtDHS(v)]} empty="No data." />
              </CardBody>
            </Card>
          </div>

          <div className="mb-4 grid gap-3.5 md:grid-cols-2">
            <Card>
              <CardHead title="Pipeline Status (Leads)" icon={<Target size={14} className="text-ink-3" />} />
              <CardBody>
                <div className="grid grid-cols-3 gap-2.5 md:grid-cols-3">
                  {LEAD_STATUSES.map((s) => (
                    <div key={s} className={`rounded-lg px-3 py-2.5 ${leadStatusClass(s)}`}>
                      <div className="text-lg font-black">{sharedFiltered.filter((l) => l.status === s).length}</div>
                      <div className="text-[10px] font-bold">{s}</div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHead title="Orders by Status" icon={<Target size={14} className="text-ink-3" />} />
              <CardBody className="!p-0">
                <Table rows={Object.entries(sales?.byStatus || {})} cols={['Status', 'Count']} render={(e) => e} empty="No data." />
              </CardBody>
            </Card>
          </div>

          {/* ── full leads table, with its own sub-filters layered on top ── */}
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-4">
              <h2 className="flex-1 text-sm font-black text-navy">
                All Leads <span className="text-xs font-normal text-ink-3">· {filtered.length} results</span>
              </h2>
              <Input className="!w-44" placeholder="Search name, phone…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
              <Select className="!w-36" value={stageFilter} onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}>
                <option value="All">All Stages</option>
                {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Select className="!w-36" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="All">All Statuses</option>
                {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Select className="!w-36" value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}>
                <option value="All">All Sources</option>
                {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>

            {paged.length === 0 ? <EmptyState title="No leads match" hint="Try clearing the filters." /> : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-navy-800 text-white">
                      {['#', 'Name', 'Phone', 'Source', 'Country', 'Employee', 'Stage', 'Status', 'Date', 'Remark', 'Edit'].map((h) =>
                        <th key={h} className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap">{h}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((l, i) => (
                      <tr key={l._id} className="border-b border-gray-100 last:border-0 hover:bg-gold-pale">
                        <td className="px-2.5 py-2 text-xs text-ink-3">{(safePage - 1) * PER_PAGE + i + 1}</td>
                        <td className="px-2.5 py-2 text-xs font-bold">{l.name}</td>
                        <td className="px-2.5 py-2 font-mono text-xs text-ink-2">{fmtMobile(l.mobile, l.country) || '—'}</td>
                        <td className="px-2.5 py-2 text-xs">{l.source}</td>
                        <td className="px-2.5 py-2 text-xs">{l.country || '—'}</td>
                        <td className="px-2.5 py-2 text-xs">{l.ownerName || '—'}</td>
                        <td className="px-2.5 py-2"><span className={`status ${leadStageClass(leadStageOf(l))}`}>{leadStageOf(l)}</span></td>
                        <td className="px-2.5 py-2"><span className={`status ${leadStatusClass(l.status)}`}>{l.status}</span></td>
                        <td className="px-2.5 py-2 text-xs whitespace-nowrap">{formatDate(l.createdAt)}</td>
                        <td className="max-w-[140px] truncate px-2.5 py-2 text-xs italic text-ink-3">{l.remark || '—'}</td>
                        <td className="px-2.5 py-2">
                          <Button size="sm" variant="outline" onClick={() => setEditLead(l)}>
                            <Pencil size={13} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
                <span className="text-[11px] text-ink-3">Page {safePage} of {totalPages}</span>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" disabled={safePage === 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft size={13} className="mr-1" />Prev
                  </Button>
                  <Button size="sm" variant="outline" disabled={safePage === totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next<ChevronRight size={13} className="ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {editLead && (
        <LeadFormModal
          open={!!editLead}
          lead={editLead}
          isAdmin={isAdmin}
          currentUser={user}
          sales={employees}
          onClose={() => setEditLead(null)}
          onSaved={() => { setEditLead(null); refetchLeads(); }}
          onOpenExisting={() => setEditLead(null)}
        />
      )}
      </>
      )}
    </>
  );
}

function Stat({ label, value, sub, tone = 'border-gold', icon }) {
  return (
    <div className={`rounded-lg border-l-4 bg-white p-3.5 shadow-card ${tone}`}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-ink-3">{label}</div>
        {icon && <div className="text-ink-3">{icon}</div>}
      </div>
      <div className="mt-1 text-xl font-black text-navy">{value}</div>
      {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

function Table({ rows, cols, render, empty }) {
  if (!rows.length) return <p className="p-4 text-xs text-ink-3">{empty}</p>;
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="bg-gray-50">
          {cols.map((c) => <th key={c} className="px-4 py-2 text-left text-[10px] font-bold uppercase text-ink-2">{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-gray-100">
            {render(r).map((cell, j) => <td key={j} className={`px-4 py-2 text-xs ${j === 0 ? 'font-bold' : ''}`}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Monthly Comparison sub-page ───────────────────────────────────────────────
function MonthlyComparison({ data, loading }) {
  if (loading) return <Spinner label="Loading monthly comparison…" />;
  if (!data?.months) return <EmptyState title="No data yet" hint="Monthly comparison will appear once you have lead data." />;

  const months = data.months;
  const maxVal = Math.max(1, ...months.flatMap(m => [m.buyers, m.opportunity, m.enquiry, m.newLeads]));

  const SERIES = [
    { key: 'buyers',      label: 'Buyers',      color: '#10B981' },
    { key: 'opportunity', label: 'Opportunity',  color: '#F59E0B' },
    { key: 'enquiry',     label: 'Enquiry',      color: '#2563EB' },
    { key: 'newLeads',    label: 'New Leads',    color: '#6B7280' },
  ];

  return (
    <>
      {/* Summary cards — current month vs previous */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SERIES.map(({ key, label, color }) => {
          const cur  = months[months.length - 1]?.[key] || 0;
          const prev = months[months.length - 2]?.[key] || 0;
          const diff = cur - prev;
          return (
            <div key={key} className="rounded-xl border p-3" style={{ borderColor: color + '30', background: 'var(--bg-surface)' }}>
              <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color }}>{label}</div>
              <div className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>{cur}</div>
              <div className="text-[11px] mt-1 font-semibold" style={{ color: diff > 0 ? '#16a34a' : diff < 0 ? '#dc2626' : 'var(--text-muted)' }}>
                {diff > 0 ? `▲ +${diff}` : diff < 0 ? `▼ ${diff}` : '— No change'} vs last month
              </div>
            </div>
          );
        })}
      </div>

      {/* Sales cards — orders & revenue, current month vs previous */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        {[['orders', 'Orders', '#2563EB', (v) => v], ['revenue', 'Revenue', '#B8860B', (v) => fmtAED(v)]].map(([key, label, color, fmt]) => {
          const cur = months[months.length - 1]?.[key] || 0;
          const prev = months[months.length - 2]?.[key] || 0;
          const diff = cur - prev;
          const pct = prev ? Math.round((diff / prev) * 100) : null;
          return (
            <div key={key} className="rounded-xl border p-3" style={{ borderColor: color + '30', background: 'var(--bg-surface)' }}>
              <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color }}>{label} this month</div>
              <div className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>{fmt(cur)}</div>
              <div className="text-[11px] mt-1 font-semibold" style={{ color: diff > 0 ? '#16a34a' : diff < 0 ? '#dc2626' : 'var(--text-muted)' }}>
                {diff > 0 ? `▲ +${key === 'revenue' ? fmtAED(diff) : diff}` : diff < 0 ? `▼ ${key === 'revenue' ? fmtAED(diff) : diff}` : '— No change'}
                {pct !== null && diff !== 0 ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''} vs last month
              </div>
            </div>
          );
        })}
      </div>

      {/* Bar chart comparison */}
      <div className="rounded-xl border p-4 mb-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-card)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>6-Month Comparison</h3>
          <div className="flex flex-wrap gap-3">
            {SERIES.map(({ label, color }) => (
              <div key={label} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ background: color }} />
                {label}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-end gap-2 overflow-x-auto pb-2">
          {months.map((m) => (
            <div key={m.key} className="flex-1 min-w-[60px]">
              <div className="flex items-end gap-0.5 mb-1" style={{ height: '120px' }}>
                {SERIES.map(({ key, color }) => {
                  const val = m[key] || 0;
                  const pct = (val / maxVal) * 100;
                  return (
                    <div key={key} className="flex-1 rounded-t-sm relative group" style={{ height: `${pct}%`, minHeight: val > 0 ? '4px' : '0', background: color, opacity: 0.85 }}>
                      {val > 0 && (
                        <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold opacity-0 group-hover:opacity-100 transition whitespace-nowrap" style={{ color }}>
                          {val}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="text-center text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>{m.label}</div>
              <div className="text-center text-[9px]" style={{ color: 'var(--text-hint)' }}>Total: {m.total}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-card)' }}>
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr style={{ background: 'var(--bg-card-head)' }}>
              <th className="px-4 py-2.5 text-left font-bold" style={{ color: 'var(--text-secondary)' }}>Month</th>
              <th className="px-4 py-2.5 text-center font-bold" style={{ color: '#10B981' }}>Buyers</th>
              <th className="px-4 py-2.5 text-center font-bold" style={{ color: '#F59E0B' }}>Opportunity</th>
              <th className="px-4 py-2.5 text-center font-bold" style={{ color: '#2563EB' }}>Enquiry</th>
              <th className="px-4 py-2.5 text-center font-bold" style={{ color: '#6B7280' }}>New</th>
              <th className="px-4 py-2.5 text-center font-bold" style={{ color: 'var(--text-secondary)' }}>Total Leads</th>
              <th className="px-4 py-2.5 text-center font-bold" style={{ color: '#2563EB' }}>Orders</th>
              <th className="px-4 py-2.5 text-right font-bold" style={{ color: '#B8860B' }}>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => {
              const prev = months[i - 1];
              const isLatest = i === months.length - 1;
              return (
                <tr key={m.key} style={{ background: isLatest ? 'var(--bg-card-head)' : 'transparent', borderTop: '1px solid var(--border-card)' }}>
                  <td className="px-4 py-2.5 font-bold" style={{ color: 'var(--text-primary)' }}>
                    {m.label}{isLatest && <span className="ml-2 text-[9px] bg-gold-100 text-gold-700 px-1.5 py-0.5 rounded-full font-bold">Current</span>}
                  </td>
                  {[['buyers','#10B981'],['opportunity','#F59E0B'],['enquiry','#2563EB'],['newLeads','#6B7280']].map(([key, color]) => {
                    const val = m[key] || 0;
                    const pval = prev?.[key] || 0;
                    const diff = val - pval;
                    return (
                      <td key={key} className="px-4 py-2.5 text-center">
                        <span className="font-black text-[13px]" style={{ color }}>{val}</span>
                        {prev && diff !== 0 && (
                          <span className="ml-1 text-[9px] font-bold" style={{ color: diff > 0 ? '#16a34a' : '#dc2626' }}>
                            {diff > 0 ? `+${diff}` : diff}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2.5 text-center font-bold" style={{ color: 'var(--text-primary)' }}>{m.total}</td>
                  <td className="px-4 py-2.5 text-center font-bold" style={{ color: '#2563EB' }}>{m.orders ?? 0}</td>
                  <td className="px-4 py-2.5 text-right font-bold" style={{ color: 'var(--text-primary)' }}>{fmtAED(m.revenue || 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}