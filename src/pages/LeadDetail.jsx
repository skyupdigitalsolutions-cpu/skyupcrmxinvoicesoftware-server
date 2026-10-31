import { Target, History } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { leadApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { apiError } from '../api/client.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card, CardHead, CardBody } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import { Field, Input, Textarea } from '../components/ui/Field.jsx';
import { formatDate, fmtDateTime, leadStatusClass, LEAD_STATUSES, fmtMobile } from '../utils/format.js';

export default function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();
  const { isAdmin } = useAuth();

  const [payload, setPayload]   = useState(null);  // { lead, isOwner, canEdit, canContribute }
  const [loading, setLoading]   = useState(true);
  const [callText, setCallText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy]         = useState(false);

  const lead    = payload?.lead;
  const canEdit = payload?.canEdit;

  const fetchLead = async () => {
    try {
      const data = await leadApi.get(id);
      setPayload(data);
    } catch (e) {
      show(apiError(e), 'error');
      navigate(location.state?.from || '/leads');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchLead(); }, [id]);

  // ── Discussion helpers ────────────────────────────────────────────────────
  const submitCall = async () => {
    if (!callText.trim()) return;
    setBusy(true);
    try {
      const updated = await leadApi.logCall(id, { summary: callText.trim() });
      setPayload((p) => ({ ...p, lead: updated }));
      setCallText('');
      show('Call logged.', 'success');
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  const submitNote = async () => {
    if (!noteText.trim()) return;
    setBusy(true);
    try {
      const updated = await leadApi.addNote(id, { text: noteText.trim() });
      setPayload((p) => ({ ...p, lead: updated }));
      setNoteText('');
      show('Note added.', 'success');
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  const setStatus = async (status) => {
    setBusy(true);
    try {
      const updated = await leadApi.setStatus(id, { status });
      setPayload((p) => ({ ...p, lead: updated }));
      show(`Status → ${status}`, 'success');
    } catch (e) { show(apiError(e), 'error'); }
    finally { setBusy(false); }
  };

  if (loading) return <Spinner label="Loading lead…" />;
  if (!lead)   return null;

  // Merge calls and notes into a single timeline, newest first
  const timeline = [
    ...(lead.callLogs || []).map((c) => ({ type: 'call', text: c.summary, byName: c.byName, at: c.at, _id: c._id })),
    ...(lead.notes   || []).map((n) => ({ type: 'note', text: n.text,    byName: n.byName, at: n.at, _id: n._id })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <>
      <PageTitle icon={<Target size={18} />}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { if (location.state?.from) navigate(location.state.from); else navigate(-1); }}>← Back to Leads</Button>
            {canEdit && !lead.converted && (
              <Button onClick={() => navigate(location.state?.from || '/leads', { state: { editId: id } })}>✏️ Edit Lead</Button>
            )}
          </div>
        }>
        {lead.name}
      </PageTitle>

      {/* ── Owner / shared banner ─────────────────────────────────────────── */}
      {!payload.isOwner && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-info/30 bg-info-light px-4 py-2.5 text-[12px] text-info">
          <span>ℹ️</span>
          <span>
            This lead belongs to <strong>{lead.ownerName}</strong>. You can read the full discussion and add your own calls or notes.
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Left: core details ─────────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHead title="Lead Details" />
            <CardBody>
              <dl className="space-y-2">
                <Row label="Status">
                  <span className={`status ${leadStatusClass(lead.status)}`}>{lead.status}</span>
                </Row>
                <Row label="Mobile">{fmtMobile(lead.mobile, lead.country) || '—'}</Row>
                <Row label="Email">{lead.email || '—'}</Row>
                <Row label="Country">{lead.country}</Row>
                <Row label="City">{lead.city || '—'}</Row>
                <Row label="Source">{lead.source}</Row>
                {lead.campaign && <Row label="Campaign">{lead.campaign}</Row>}
                <Row label="Interest">{lead.interest || '—'}</Row>
                {lead.remark && <Row label="Remark">{lead.remark}</Row>}
                <Row label="Owner"><strong>{lead.ownerName}</strong></Row>
                <Row label="Added">{formatDate(lead.createdAt)}</Row>
                {lead.converted && (
                  <Row label="Order">
                    <span className="font-bold text-ok">#{lead.orderNo}</span>
                    <Button size="sm" variant="outline" className="ml-2"
                      onClick={() => navigate('/orders')}>View Order</Button>
                  </Row>
                )}
              </dl>

              {/* Quick status buttons — owner/admin only */}
              {canEdit && !lead.converted && (
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <p className="mb-2 text-[11px] text-ink-3 font-semibold uppercase tracking-wide">Change Status</p>
                  <div className="flex flex-wrap gap-1.5">
                    {LEAD_STATUSES.filter((s) => s !== lead.status && s !== 'Won').map((s) => (
                      <Button key={s} size="sm" variant="outline" disabled={busy} onClick={() => setStatus(s)}>
                        {s}
                      </Button>
                    ))}
                    {lead.status !== 'Lost' && (
                      <Button size="sm" variant="red" disabled={busy} onClick={() => setStatus('Lost')}>
                        Lost
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ── Right: discussion ─────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Log a call */}
          <Card>
            <CardHead title="📞 Log a Call" />
            <CardBody>
              <Field label="What was discussed?">
                <Textarea rows={2} value={callText} placeholder="Summarise the call…"
                  onChange={(e) => setCallText(e.target.value)} />
              </Field>
              <div className="mt-2 flex justify-end">
                <Button size="sm" disabled={busy || !callText.trim()} onClick={submitCall}>
                  {busy ? 'Saving…' : '+ Log Call'}
                </Button>
              </div>
            </CardBody>
          </Card>

          {/* Add a note */}
          <Card>
            <CardHead title="📝 Add a Note" />
            <CardBody>
              <Field label="Note">
                <Textarea rows={2} value={noteText} placeholder="Any follow-up, observations, etc…"
                  onChange={(e) => setNoteText(e.target.value)} />
              </Field>
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="outline" disabled={busy || !noteText.trim()} onClick={submitNote}>
                  {busy ? 'Saving…' : '+ Add Note'}
                </Button>
              </div>
            </CardBody>
          </Card>

          {/* Full timeline */}
          <Card>
            <CardHead title={`Discussion History (${timeline.length} entries)`} />
            <CardBody>
              {timeline.length === 0 ? (
                <p className="text-[12px] text-ink-3 py-2">No calls or notes yet. Be the first to log one above.</p>
              ) : (
                <div className="space-y-2">
                  {timeline.map((entry, i) => (
                    <TimelineEntry key={entry._id || i} entry={entry} />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Edit History — admin-only oversight of who changed what */}
          {isAdmin && (
            <Card>
              <CardHead
                title={
                  <span className="flex items-center gap-1.5">
                    <History size={14} /> Edit History ({(lead.editHistory || []).length})
                  </span>
                }
              />
              <CardBody>
                {(lead.editHistory || []).length === 0 ? (
                  <p className="text-[12px] text-ink-3 py-2">No edits recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {[...lead.editHistory].reverse().map((entry, i) => (
                      <EditHistoryEntry key={entry._id || i} entry={entry} />
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

// Human-readable labels — mirrors the server's FIELD_LABELS so admins see the
// same names in both notifications and this history view.
const FIELD_LABELS = {
  name: 'Name', mobile: 'Mobile', country: 'Country', city: 'City', email: 'Email',
  source: 'Source', campaign: 'Campaign', interest: 'Interest', remark: 'Remark',
  delivery: 'Delivery', status: 'Status', followUpAt: 'Follow-up date', owner: 'Owner',
};

const fmtHistVal = (field, v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'followUpAt') return formatDate(v);
  return String(v);
};

function EditHistoryEntry({ entry }) {
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2.5">
      <p className="text-[10px] text-ink-3">
        <span className="font-bold text-ink">{entry.byName || 'Unknown'}</span>
        <span className="mx-1">·</span>
        {fmtDateTime(entry.at)}
      </p>
      <div className="mt-1.5 space-y-1">
        {(entry.changes || []).map((c, i) => (
          <div key={i} className="text-[11.5px] text-ink">
            <span className="font-semibold">{FIELD_LABELS[c.field] || c.field}:</span>{' '}
            <span className="text-ink-3 line-through">{fmtHistVal(c.field, c.from)}</span>
            {' → '}
            <span className="font-semibold">{fmtHistVal(c.field, c.to)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── small sub-components ──────────────────────────────────────────────────────
function Row({ label, children }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="w-20 flex-shrink-0 text-[11px] text-ink-3 font-semibold pt-0.5">{label}</dt>
      <dd className="text-[12px] text-ink">{children}</dd>
    </div>
  );
}

function TimelineEntry({ entry }) {
  const isCall = entry.type === 'call';
  return (
    <div className={`flex gap-3 rounded-md px-3 py-2.5 ${isCall ? 'bg-info-light/50' : 'bg-gold-pale'}`}>
      <span className="text-base mt-0.5 flex-shrink-0">{isCall ? '📞' : '📝'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-ink break-words">{entry.text}</p>
        <p className="mt-1 text-[10px] text-ink-3">
          <span className="font-bold">{entry.byName || 'Unknown'}</span>
          <span className="mx-1">·</span>
          {new Date(entry.at).toLocaleString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
          <span className="ml-2 rounded-full bg-white/70 px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-semibold">
            {isCall ? 'Call' : 'Note'}
          </span>
        </p>
      </div>
    </div>
  );
}