import { useState } from 'react';
import { Users, RefreshCw, GitMerge, MessageSquare, StickyNote, Loader2 } from 'lucide-react';
import { leadApi } from '../api/endpoints.js';
import { useFetch } from '../hooks/useApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { apiError } from '../api/client.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card, CardHead, CardBody } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { fmtDateTime, fmtMobile } from '../utils/format.js';

// One duplicate group: leads sharing the same normalised phone number. The
// oldest lead is pre-selected as "keep" (usually the original), but any lead
// in the group can be picked instead.
function DuplicateGroup({ group, onMerged }) {
  const { show } = useToast();
  const [keepId, setKeepId] = useState(group.leads[0].id);
  const [busy, setBusy] = useState(false);

  const merge = async () => {
    const mergeIds = group.leads.map((l) => l.id).filter((id) => id !== keepId);
    if (!mergeIds.length) return;
    if (!confirm(`Merge ${mergeIds.length} duplicate lead(s) into the selected one? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await leadApi.merge({ keepId, mergeIds });
      show(res.message || 'Leads merged.', 'success');
      onMerged();
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHead title={fmtMobile(group.leads[0].mobile, group.leads[0].country) || group.mobileKey}>
        <span className="text-[10px] font-normal text-ink-3">{group.leads.length} leads share this number</span>
      </CardHead>
      <CardBody className="space-y-2">
        {group.leads.map((l) => (
          <label
            key={l.id}
            className="flex cursor-pointer items-center gap-3 rounded-md border p-2.5"
            style={{ borderColor: keepId === l.id ? 'var(--gold-700, #a16207)' : 'var(--border-card)', backgroundColor: keepId === l.id ? 'var(--bg-card-head)' : 'transparent' }}
          >
            <input type="radio" name={`keep-${group.mobileKey}`} className="h-4 w-4 accent-purple-500" checked={keepId === l.id} onChange={() => setKeepId(l.id)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                {l.name}
                {keepId === l.id && <span className="rounded-full bg-ok-light px-2 py-0.5 text-[10px] font-bold text-ok">Keep this one</span>}
                {l.converted && <span className="rounded-full bg-gold-light px-2 py-0.5 text-[10px] font-bold text-navy-700">Converted — Order #{l.orderNo}</span>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                <span>Owner: <strong>{l.ownerName || '—'}</strong></span>
                <span>Status: {l.status}</span>
                <span>City: {l.city || '—'}</span>
                <span className="flex items-center gap-1"><MessageSquare size={11} />{l.callLogCount} calls</span>
                <span className="flex items-center gap-1"><StickyNote size={11} />{l.noteCount} notes</span>
                <span>Added {fmtDateTime(l.createdAt)}</span>
              </div>
            </div>
          </label>
        ))}
        <div className="flex justify-end pt-1">
          <Button disabled={busy} onClick={merge}>
            {busy ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Merging…</> : <><GitMerge size={13} className="mr-1.5" />Merge into selected</>}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

// Admin-only tool: finds leads that share the same phone number (created as
// separate records — e.g. auto-created from the Order Form for the same
// returning customer under two different sales users) and merges them into
// one, combining call logs / notes / edit history and reassigning any
// cheques or WhatsApp messages that pointed at the duplicate.
export default function DuplicateLeads() {
  const { data: groups, loading, refetch } = useFetch(() => leadApi.listDuplicates(), []);

  if (loading) return <Spinner label="Scanning for duplicate leads…" />;

  return (
    <>
      <PageTitle
        icon={<Users size={18} />}
        badge={groups ? groups.length : 0}
        actions={<Button variant="outline" onClick={refetch}><RefreshCw size={13} className="mr-1.5" />Rescan</Button>}
      >
        Duplicate Leads
      </PageTitle>

      <p className="mb-3 text-[12px] text-ink-2">
        Leads that share the exact same phone number are grouped below. Pick which one to keep, then merge —
        call logs, notes, and edit history are combined, and any cheques or WhatsApp messages linked to the
        removed lead(s) are moved to the kept one. Removed leads are archived to Deleted Contacts, same as a normal delete.
      </p>

      {!groups || !groups.length ? (
        <Card><CardBody><EmptyState title="No duplicates found" hint="Every lead in this company has a unique phone number." /></CardBody></Card>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <DuplicateGroup key={g.mobileKey} group={g} onMerged={refetch} />
          ))}
        </div>
      )}
    </>
  );
}