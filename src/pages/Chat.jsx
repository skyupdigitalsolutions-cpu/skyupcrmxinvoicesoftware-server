import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Send, Search, Shield, ArrowLeft, Eye } from 'lucide-react';
import { chatApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { apiError } from '../api/client.js';
import PageTitle from '../components/layout/PageTitle.jsx';
import { Card } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { Input } from '../components/ui/Field.jsx';

const timeLabel = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  const today = new Date();
  const sameDay = dt.toDateString() === today.toDateString();
  return sameDay
    ? dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const Avatar = ({ name, role }) => {
  const initials = (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const admin = role === 'admin';
  return (
    <span
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
      style={{ backgroundColor: admin ? '#1e293b' : '#C9A227' }}
    >
      {initials}
    </span>
  );
};

export default function Chat() {
  const { user, isAdmin } = useAuth();
  const { show } = useToast();

  const [mode, setMode] = useState('mine'); // 'mine' | 'all' (admin oversight)
  const [contacts, setContacts] = useState([]);
  const [threads, setThreads] = useState([]);
  const [search, setSearch] = useState('');
  const [listLoading, setListLoading] = useState(true);

  const [sel, setSel] = useState(null);       // contact (mine) or thread {a,b} (all)
  const [convo, setConvo] = useState(null);    // { user?, a?, b?, messages }
  const [convoLoading, setConvoLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const scrollRef = useRef(null);
  const scrollToBottom = () => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; };

  // ── Load the left-hand list ────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    try {
      if (mode === 'all') setThreads(await chatApi.adminThreads());
      else setContacts(await chatApi.contacts());
    } catch (e) {
      show(apiError(e), 'error');
    } finally {
      setListLoading(false);
    }
  }, [mode, show]);

  useEffect(() => {
    setListLoading(true);
    loadList();
    const t = setInterval(loadList, 15000);
    return () => clearInterval(t);
  }, [loadList]);

  // ── Load / poll the open conversation ──────────────────────────────────────
  const loadConvo = useCallback(async (silent) => {
    if (!sel) return;
    if (!silent) setConvoLoading(true);
    try {
      const data = mode === 'all'
        ? await chatApi.adminThread(sel.a.id, sel.b.id)
        : await chatApi.conversation(sel.id);
      setConvo(data);
    } catch (e) {
      if (!silent) show(apiError(e), 'error');
    } finally {
      if (!silent) setConvoLoading(false);
    }
  }, [sel, mode, show]);

  useEffect(() => {
    if (!sel) { setConvo(null); return undefined; }
    loadConvo(false);
    const t = setInterval(() => loadConvo(true), 5000);
    return () => clearInterval(t);
  }, [sel, loadConvo]);

  useEffect(() => { scrollToBottom(); }, [convo]);

  // Switching mode clears the selection.
  useEffect(() => { setSel(null); setConvo(null); }, [mode]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !sel || mode === 'all') return;
    setSending(true);
    try {
      const msg = await chatApi.send(sel.id, body);
      setConvo((c) => ({ ...c, messages: [...((c && c.messages) || []), msg] }));
      setDraft('');
      loadList();
    } catch (e) {
      show(apiError(e), 'error');
    } finally {
      setSending(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // ── Left list rows ──────────────────────────────────────────────────────────
  const filteredContacts = contacts.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const filteredThreads = threads.filter(
    (t) => t.a.name.toLowerCase().includes(search.toLowerCase()) || t.b.name.toLowerCase().includes(search.toLowerCase())
  );

  const listPane = (
    <div className={`flex w-full flex-col md:w-72 md:border-r ${sel ? 'hidden md:flex' : 'flex'}`} style={{ borderColor: 'var(--border-card)' }}>
      {isAdmin && (
        <div className="flex gap-1 p-2">
          <button
            onClick={() => setMode('mine')}
            className={`flex-1 rounded-md px-2 py-1.5 text-[12px] font-bold transition ${mode === 'mine' ? 'bg-navy text-white' : 'text-ink-2 hover:bg-black/[0.04]'}`}
          >
            My Chats
          </button>
          <button
            onClick={() => setMode('all')}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-bold transition ${mode === 'all' ? 'bg-navy text-white' : 'text-ink-2 hover:bg-black/[0.04]'}`}
          >
            <Shield size={12} /> All Chats
          </button>
        </div>
      )}

      <div className="relative px-2 pb-2">
        <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
        <Input className="!pl-8" placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {listLoading ? (
          <div className="p-6"><Spinner label="Loading…" /></div>
        ) : mode === 'all' ? (
          filteredThreads.length === 0 ? <div className="p-6"><EmptyState title="No conversations yet" /></div> : (
            filteredThreads.map((t) => (
              <button
                key={`${t.a.id}-${t.b.id}`}
                onClick={() => setSel(t)}
                className={`flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition hover:bg-black/[0.03] ${sel && sel.a && sel.a.id === t.a.id && sel.b.id === t.b.id ? 'bg-gold-pale' : ''}`}
                style={{ borderColor: 'var(--border-card)' }}
              >
                <Eye size={15} className="mt-1 flex-shrink-0 text-ink-3" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-bold text-ink-1">{t.a.name} ↔ {t.b.name}</div>
                  <div className="truncate text-[11px] text-ink-3">{t.lastBody}</div>
                </div>
                <div className="flex-shrink-0 text-[10px] text-ink-3">{timeLabel(t.lastAt)}</div>
              </button>
            ))
          )
        ) : (
          filteredContacts.length === 0 ? <div className="p-6"><EmptyState title="No one to chat with yet" /></div> : (
            filteredContacts.map((c) => (
              <button
                key={c.id}
                onClick={() => setSel(c)}
                className={`flex w-full items-center gap-2.5 border-b px-3 py-2.5 text-left transition hover:bg-black/[0.03] ${sel && sel.id === c.id ? 'bg-gold-pale' : ''}`}
                style={{ borderColor: 'var(--border-card)' }}
              >
                <Avatar name={c.name} role={c.role} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-bold text-ink-1">{c.name}</span>
                    {c.lastMessage && <span className="flex-shrink-0 text-[10px] text-ink-3">{timeLabel(c.lastMessage.at)}</span>}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] text-ink-3">
                      {c.lastMessage ? `${c.lastMessage.fromMe ? 'You: ' : ''}${c.lastMessage.body}` : (c.role === 'admin' ? 'Admin' : 'Salesperson')}
                    </span>
                    {c.unread > 0 && (
                      <span className="flex h-4 min-w-4 flex-shrink-0 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">{c.unread}</span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )
        )}
      </div>
    </div>
  );

  // ── Conversation pane ────────────────────────────────────────────────────────
  const readOnly = mode === 'all';
  // The loaded convo must match the current mode's shape, otherwise we're mid
  // transition (mode/selection changed but the fetch for the new one hasn't
  // completed) — treat it as not-ready and show a spinner instead of crashing.
  const ready = !!(convo && (readOnly ? (convo.a && convo.b) : convo.user));
  const headerName = ready
    ? (readOnly ? `${convo.a.name} ↔ ${convo.b.name}` : convo.user.name)
    : '';

  const bubbleSide = (m) => {
    if (readOnly) return String(m.fromId) === String(convo.a.id) ? 'left' : 'right';
    return m.fromMe ? 'right' : 'left';
  };

  const convoPane = (
    <div className={`flex flex-1 flex-col ${sel ? 'flex' : 'hidden md:flex'}`}>
      {!sel ? (
        <div className="flex h-full items-center justify-center p-8">
          <EmptyState title="Select a conversation" hint={isAdmin ? 'Chat with your team, or switch to All Chats to review any conversation.' : 'Pick someone to start chatting.'} />
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: 'var(--border-card)' }}>
            <button className="md:hidden" onClick={() => setSel(null)}><ArrowLeft size={18} /></button>
            {!readOnly && ready && <Avatar name={convo.user.name} role={convo.user.role} />}
            <div className="min-w-0">
              <div className="truncate text-[13px] font-bold text-ink-1">{headerName || '…'}</div>
              {readOnly && <div className="text-[10px] font-bold uppercase tracking-wide text-gold-700">Oversight · read-only</div>}
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3" style={{ backgroundColor: 'var(--bg-base)' }}>
            {convoLoading || !ready ? (
              <div className="p-6"><Spinner label="Loading messages…" /></div>
            ) : convo && convo.messages && convo.messages.length ? (
              convo.messages.map((m) => {
                const side = bubbleSide(m);
                return (
                  <div key={m.id} className={`flex ${side === 'right' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[78%] rounded-2xl px-3 py-2 text-[13px] shadow-sm ${side === 'right' ? 'rounded-br-sm bg-navy text-white' : 'rounded-bl-sm'}`}
                      style={side === 'right' ? undefined : { backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
                    >
                      {readOnly && (
                        <div className="mb-0.5 text-[10px] font-bold opacity-70">
                          {String(m.fromId) === String(convo.a.id) ? convo.a.name : convo.b.name}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className={`mt-0.5 text-[9px] ${side === 'right' ? 'text-white/60' : 'text-ink-3'}`}>{timeLabel(m.at)}</div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-6"><EmptyState title="No messages yet" hint={readOnly ? '' : 'Say hello!'} /></div>
            )}
          </div>

          {/* Composer (hidden in oversight mode) */}
          {readOnly ? (
            <div className="border-t px-3 py-3 text-center text-[11px] italic text-ink-3" style={{ borderColor: 'var(--border-card)' }}>
              You are viewing this conversation as an admin. Replying is disabled here.
            </div>
          ) : (
            <div className="flex items-end gap-2 border-t p-2.5" style={{ borderColor: 'var(--border-card)' }}>
              <textarea
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                placeholder="Type a message…  (Enter to send)"
                className="max-h-28 flex-1 resize-none rounded-lg border px-3 py-2 text-[13px] outline-none"
                style={{ borderColor: 'var(--border-card)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}
              />
              <Button variant="gold" disabled={sending || !draft.trim()} onClick={send}>
                <span className="flex items-center gap-1"><Send size={14} /> Send</span>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <>
      <PageTitle icon={<MessageSquare size={18} />}>Chat</PageTitle>
      <Card>
        <div className="flex h-[calc(100vh-190px)] min-h-[420px]">
          {listPane}
          {convoPane}
        </div>
      </Card>
    </>
  );
}