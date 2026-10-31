import { useState, useMemo } from 'react';
import { Trash2, Download, Search } from 'lucide-react';
import { leadApi } from '../api/endpoints.js';
import { useFetch } from '../hooks/useApi.js';
import { useToast } from '../context/ToastContext.jsx';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { Input } from '../components/ui/Field.jsx';
import { exportTableCsv } from '../utils/exportPdf.js';
import { fmtDateTime, fmtMobile, phoneSearchMatches } from '../utils/format.js';

// Admin-only reference report: contact numbers that were retained when their
// lead was deleted. Data comes from the append-only DeletedContact archive on
// the server, so the numbers stay available even though the leads are gone.
export default function DeletedContacts() {
  const { show } = useToast();
  const { data: contacts, loading } = useFetch(() => leadApi.deletedContacts(), []);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const list = contacts || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) =>
      [c.name, c.city, c.email, c.country].some((v) => (v || '').toLowerCase().includes(q)) ||
      phoneSearchMatches(c.mobile, search)
    );
  }, [contacts, search]);

  const exportCsv = () => {
    try {
      exportTableCsv({
        title: 'Deleted Contacts',
        columns: ['Sl. No', 'Name', 'Mobile', 'City', 'Country', 'Source', 'Last Status', 'Owner', 'Deleted By', 'Deleted On'],
        rows: filtered.map((c, i) => [
          i + 1,
          c.name || '—', fmtMobile(c.mobile, c.country) || '—', c.city || '—', c.country || '—',
          c.source || '—', c.status || '—', c.ownerName || '—',
          c.deletedByName || '—', fmtDateTime(c.createdAt),
        ]),
      });
    } catch (e) {
      show(e.message || 'CSV export failed.', 'error');
    }
  };

  if (loading) return <Spinner label="Loading deleted contacts…" />;

  return (
    <>
      <PageTitle icon={<Trash2 size={18} />} badge={filtered.length}>Deleted Contacts</PageTitle>

      <p className="mb-3 text-[12px] text-ink-2">
        Contact numbers of leads that were deleted are retained here for reference. Deleting a lead does not erase its number.
      </p>

      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input
            className="!w-64 !pl-8"
            placeholder="Search name / mobile / city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" className="ml-auto" disabled={!filtered.length} onClick={exportCsv}>
          <span className="flex items-center gap-1.5"><Download size={13} />Export CSV</span>
        </Button>
      </div>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState title="No deleted contacts" hint="Deleted leads' contact numbers will appear here for reference." />
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-navy-800 text-white">
                  {['Sl. No', 'Name', 'Mobile', 'City', 'Country', 'Source', 'Last Status', 'Owner', 'Deleted By', 'Deleted On'].map((h) => (
                    <th key={h} className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => (
                  <tr key={c._id} className="border-b border-gray-100 last:border-0 hover:bg-gold-pale [&>td]:align-middle">
                    <td className="px-2.5 py-2 text-xs text-ink-3">{idx + 1}</td>
                    <td className="px-2.5 py-2 text-xs font-bold text-navy-700">{c.name || '—'}</td>
                    <td className="px-2.5 py-2 text-xs">{fmtMobile(c.mobile, c.country) || '—'}</td>
                    <td className="px-2.5 py-2 text-xs">{c.city || '—'}</td>
                    <td className="px-2.5 py-2 text-xs whitespace-nowrap">{c.country || '—'}</td>
                    <td className="px-2.5 py-2 text-xs">{c.source || '—'}</td>
                    <td className="px-2.5 py-2 text-xs">{c.status || '—'}</td>
                    <td className="px-2.5 py-2 text-xs">{c.ownerName || '—'}</td>
                    <td className="px-2.5 py-2 text-xs">{c.deletedByName || '—'}</td>
                    <td className="px-2.5 py-2 text-xs whitespace-nowrap text-ink-3">{fmtDateTime(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}