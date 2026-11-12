import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, downloadFile, fmtDate, relative, type Lead, type Stage } from '../api';
import { Badge, Empty, ErrorNotice, Field, Icon, Modal, Spinner, useApi, useToast } from '../ui';

interface LeadListResponse {
  items: Lead[]; total: number; page: number; pageSize: number;
  facets: { stages: Stage[]; sources: { id: string; name: string }[]; members: { id: string; name: string }[]; tags: string[] };
  permissions: { canAssign: boolean; canExport: boolean; canImport: boolean; canConfigrePipeline?: boolean };
}

const PRIORITY_TONE: Record<string, 'neutral' | 'amber' | 'red' | 'green' | 'blue'> = {
  low: 'neutral', normal: 'blue', high: 'amber', urgent: 'red',
};

export function LeadsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [owner, setOwner] = useState('');
  const [tag, setTag] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState('created_at');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams({ sort, dir: 'desc', page: String(page), pageSize: '25' });
    if (search) p.set('search', search);
    if (stage) p.set('stage', stage);
    if (owner) p.set('owner', owner);
    if (tag) p.set('tag', tag);
    if (overdue) p.set('overdue', 'true');
    if (archived) p.set('archived', 'true');
    return p.toString();
  }, [search, stage, owner, tag, overdue, archived, sort, page]);

  const { data, loading, error, reload } = useApi<LeadListResponse>(`/leads?${query}`);

  const doExport = async () => {
    try {
      await downloadFile(`/leads/export?${query}`, 'leadpulse-leads.csv');
      toast('CSV exported with the active filters applied.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Export failed', 'error');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Lead inbox</h2>
          <p>{data ? `${data.total} lead${data.total === 1 ? '' : 's'} match your filters.` : 'Search, filter and work every enquiry in one place.'}</p>
        </div>
        <div className="page-actions">
          {data?.permissions.canExport && <button className="btn" onClick={() => void doExport()}><Icon name="download" size={15} /> Export CSV</button>}
          <Link className="btn" to="/app/data"><Icon name="upload" size={15} /> Import</Link>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={15} /> New lead</button>
        </div>
      </div>

      <section className="card">
        <div className="toolbar">
          <div className="search-box">
            <Icon name="search" size={16} />
            <input className="input" aria-label="Search leads" placeholder="Search name, email, phone, campaign…"
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <select className="select" aria-label="Filter by stage" value={stage} onChange={(e) => { setStage(e.target.value); setPage(1); }}>
            <option value="">All stages</option>
            {data?.facets.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="select" aria-label="Filter by owner" value={owner} onChange={(e) => { setOwner(e.target.value); setPage(1); }}>
            <option value="">All owners</option>
            <option value="unassigned">Unassigned</option>
            {data?.facets.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select className="select" aria-label="Filter by tag" value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); }}>
            <option value="">All tags</option>
            {data?.facets.tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="select" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="created_at">Newest first</option>
            <option value="updated_at">Recently updated</option>
            <option value="name">Name</option>
            <option value="next_follow_up_at">Next follow-up</option>
            <option value="priority">Priority</option>
          </select>
          <button className={`btn btn-small ${overdue ? 'btn-accent' : ''}`} onClick={() => { setOverdue((v) => !v); setPage(1); }}>
            <Icon name="clock" size={14} /> Overdue
          </button>
          <button className={`btn btn-small ${archived ? 'btn-accent' : ''}`} onClick={() => { setArchived((v) => !v); setPage(1); }}>
            {archived ? 'Showing archived' : 'Show archived'}
          </button>
        </div>

        {loading && <Spinner label="Loading leads" />}
        {error && <div className="card-body"><ErrorNotice message={error} onRetry={reload} /></div>}
        {data && data.items.length === 0 && (
          <Empty icon="inbox" title={search || stage || owner ? 'No leads match these filters' : 'Your inbox is empty'}
            body={search || stage || owner ? 'Clear a filter to see more leads.' : 'Create a lead manually, share your capture form, or import a CSV.'}
            action={<button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={15} /> Create the first lead</button>} />
        )}
        {data && data.items.length > 0 && (
          <>
            <div className="table-wrap desktop-table">
              <table className="table">
                <thead><tr>
                  <th>Lead</th><th>Stage</th><th>Owner</th><th>Source</th><th>Priority</th>
                  <th>Next follow-up</th><th>Created</th><th />
                </tr></thead>
                <tbody>
                  {data.items.map((l) => (
                    <tr key={l.id} className="row-link" onClick={() => navigate(`/app/leads/${l.id}`)}>
                      <td>
                        <div className="cell-strong">{l.name}</div>
                        <div className="cell-sub">{l.company || l.email || l.phone || '—'}</div>
                        {l.tags.map((t) => <span className="tag" key={t}>{t}</span>)}
                      </td>
                      <td><span className="badge badge-neutral" style={{ borderLeft: `3px solid ${l.stage_color || '#888'}` }}>{l.stage_name}</span></td>
                      <td>{l.owner_name || <Badge tone="amber">Unassigned</Badge>}</td>
                      <td className="cell-sub">{l.source_name || '—'}</td>
                      <td><Badge tone={PRIORITY_TONE[l.priority] || 'neutral'}>{l.priority}</Badge></td>
                      <td className="cell-sub">{l.next_follow_up_at ? (
                        <Badge tone={Date.parse(l.next_follow_up_at) < Date.now() ? 'red' : 'neutral'}>{relative(l.next_follow_up_at)}</Badge>
                      ) : '—'}</td>
                      <td className="cell-sub">{fmtDate(l.created_at)}</td>
                      <td className="cell-actions"><Icon name="chevron" size={16} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-cards">
              {data.items.map((l) => (
                <button key={l.id} className="lead-card" style={{ width: '100%', textAlign: 'left', margin: '10px 12px' }}
                  onClick={() => navigate(`/app/leads/${l.id}`)}>
                  <strong>{l.name}</strong>
                  <div className="cell-sub">{l.company || l.email}</div>
                  <div className="lead-card-foot">
                    <span className="badge badge-neutral">{l.stage_name}</span>
                    <span className="cell-sub">{relative(l.created_at)}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="pager">
              <span>Showing {data.items.length} of {data.total} · page {data.page}</span>
              <div className="row">
                <button className="btn btn-small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <button className="btn btn-small" disabled={data.items.length < data.pageSize} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </section>

      <CreateLeadModal open={createOpen} onClose={() => setCreateOpen(false)} stages={data?.facets.stages || []}
        members={data?.facets.members || []} canAssign={Boolean(data?.permissions.canAssign)}
        onCreated={(lead) => { setCreateOpen(false); reload(); toast(`Lead "${lead.name}" created.`, 'success'); navigate(`/app/leads/${lead.id}`); }} />
    </div>
  );
}

function CreateLeadModal({ open, onClose, stages, members, canAssign, onCreated }: {
  open: boolean; onClose: () => void; stages: Stage[]; members: { id: string; name: string }[];
  canAssign: boolean; onCreated: (lead: Lead) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: '', company: '', email: '', phone: '', source: '', campaign: '',
    priority: 'normal', notes: '', tags: '', amount: '', stageId: '', ownerId: '', consent: 'unknown',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name, company: form.company, email: form.email, phone: form.phone,
        source: form.source, campaign: form.campaign, priority: form.priority,
        notes: form.notes, consent: form.consent,
        tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      };
      if (form.stageId) payload.stageId = form.stageId;
      if (form.ownerId) payload.ownerId = form.ownerId;
      if (form.amount !== '') payload.amount = Number(form.amount);
      const result = await api<{ lead: Lead }>('/leads', { method: 'POST', body: payload });
      onCreated(result.lead);
      setForm({ name: '', company: '', email: '', phone: '', source: '', campaign: '', priority: 'normal', notes: '', tags: '', amount: '', stageId: '', ownerId: '', consent: 'unknown' });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not create the lead.';
      setError(message);
      toast(message, 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New lead" wide
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Create lead'}</button></>}>
      {error && <ErrorNotice message={error} />}
      <div className="form-grid">
        <Field label="Name *" htmlFor="c-name"><input id="c-name" className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Company" htmlFor="c-company"><input id="c-company" className="input" value={form.company} onChange={(e) => set('company', e.target.value)} /></Field>
        <Field label="Email" htmlFor="c-email"><input id="c-email" className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Phone" htmlFor="c-phone"><input id="c-phone" className="input" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Source" htmlFor="c-source" hint="At least one of email or phone is required."><input id="c-source" className="input" placeholder="e.g. Referral" value={form.source} onChange={(e) => set('source', e.target.value)} /></Field>
        <Field label="Campaign" htmlFor="c-campaign"><input id="c-campaign" className="input" value={form.campaign} onChange={(e) => set('campaign', e.target.value)} /></Field>
        <Field label="Stage" htmlFor="c-stage">
          <select id="c-stage" className="select" value={form.stageId} onChange={(e) => set('stageId', e.target.value)}>
            <option value="">Default (New)</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Owner" htmlFor="c-owner">
          <select id="c-owner" className="select" disabled={!canAssign} value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
            <option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="Priority" htmlFor="c-priority">
          <select id="c-priority" className="select" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
            {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Amount (optional)" htmlFor="c-amount"><input id="c-amount" className="input" type="number" min="0" value={form.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
        <Field label="Tags (comma separated)" htmlFor="c-tags"><input id="c-tags" className="input" placeholder="hot, callback" value={form.tags} onChange={(e) => set('tags', e.target.value)} /></Field>
        <Field label="Consent" htmlFor="c-consent">
          <select id="c-consent" className="select" value={form.consent} onChange={(e) => set('consent', e.target.value)}>
            <option value="unknown">Unknown</option><option value="granted">Granted</option><option value="declined">Declined</option>
          </select>
        </Field>
        <div className="full"><Field label="Notes" htmlFor="c-notes"><textarea id="c-notes" className="textarea" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ detail */
interface DetailResponse {
  lead: Lead;
  activities: { id: string; type: string; body: string; actor_name: string | null; created_at: string }[];
  tasks: { id: string; title: string; due_at: string; priority: string; completed_at: string | null; owner_name: string | null }[];
  stageEvents: { id: string; from_name: string | null; to_name: string; reason: string; actor_name: string | null; created_at: string }[];
  candidates: (Lead & { reasons: string[]; score: number })[];
  permissions: { canAssign: boolean; canExport: boolean };
}

const ACTIVITY_ICON: Record<string, 'phone' | 'mail' | 'calendar' | 'note' | 'pulse'> = {
  call: 'phone', email: 'mail', meeting: 'calendar', note: 'note', system: 'pulse',
};

export function LeadDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi<DetailResponse>(id ? `/leads/${id}` : null);
  const { data: facets } = useApi<LeadListResponse>('/leads?pageSize=1');
  const [tab, setTab] = useState<'timeline' | 'tasks' | 'history'>('timeline');
  const [activityType, setActivityType] = useState('call');
  const [activityBody, setActivityBody] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<Lead | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await fn(); toast(success, 'success'); reload(); }
    catch (err) { toast(err instanceof ApiError ? err.message : 'Action failed', 'error'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="page"><Spinner label="Loading lead" /></div>;
  if (error || !data) return <div className="page"><ErrorNotice message={error || 'Lead not found.'} onRetry={reload} /><p style={{ marginTop: 14 }}><Link className="btn" to="/app/leads">Back to inbox</Link></p></div>;

  const lead = data.lead;

  const logActivity = async () => {
    if (!activityBody.trim()) { toast('Write a short note about what happened.', 'error'); return; }
    await act(() => api(`/leads/${lead.id}/activities`, { method: 'POST', body: { type: activityType, body: activityBody } }), 'Activity logged — no message was sent.');
    setActivityBody('');
  };

  const addTask = async () => {
    if (!taskTitle.trim() || !taskDue) { toast('Add a title and a due date.', 'error'); return; }
    await act(() => api('/tasks', { method: 'POST', body: { title: taskTitle, leadId: lead.id, dueAt: new Date(taskDue).toISOString(), priority: 'normal' } }), 'Follow-up task created.');
    setTaskTitle(''); setTaskDue('');
  };

  const onTransition = async (stageId: string) => {
    if (!stageId) return;
    await act(() => api(`/leads/${lead.id}/transition`, { method: 'POST', body: { stageId } }), 'Stage updated and recorded.');
  };

  const onOwner = async (ownerId: string) => {
    await act(() => api(`/leads/${lead.id}`, { method: 'PATCH', body: { ownerId: ownerId || null } }), 'Owner updated.');
  };

  return (
    <div className="page">
      <p className="small muted" style={{ marginBottom: 14 }}><Link to="/app/leads" style={{ color: 'var(--accent-dark)' }}>← Lead inbox</Link></p>
      <div className="detail-head" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="detail-name">{lead.name}</h1>
          <div className="detail-meta">
            <Badge tone={lead.stage_kind === 'won' ? 'green' : lead.stage_kind === 'lost' ? 'red' : 'blue'}>{lead.stage_name}</Badge>
            <Badge tone={PRIORITY_TONE[lead.priority] || 'neutral'}>{lead.priority}</Badge>
            {lead.tags.map((t) => <span className="tag" key={t}>{t}</span>)}
            {lead.archived_at && <Badge tone="red">Archived</Badge>}
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            {lead.company} {lead.company && '·'} Created {fmtDate(lead.created_at, true)} · Source: {lead.source_name || '—'}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setEditOpen(true)}><Icon name="settings" size={15} /> Edit</button>
          <button className="btn btn-danger" onClick={() => setConfirmArchive(true)}>
            <Icon name="trash" size={15} /> {lead.archived_at ? 'Restore' : 'Archive'}
          </button>
        </div>
      </div>

      <div className="split">
        <div className="stack">
          <section className="card">
            <div className="card-head"><h3>Log what happened</h3><span className="small muted">Logged records only — nothing is sent</span></div>
            <div className="card-body">
              <div className="row">
                <select className="select" aria-label="Activity type" value={activityType} onChange={(e) => setActivityType(e.target.value)} style={{ width: 150 }}>
                  <option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="note">Note</option>
                </select>
                <input className="input" aria-label="Activity description" placeholder="e.g. Spoke with Priya; asked for a quote"
                  value={activityBody} onChange={(e) => setActivityBody(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
                <button className="btn btn-primary" disabled={busy} onClick={() => void logActivity()}>Log activity</button>
              </div>
              <p className="hint" style={{ marginTop: 9 }}>The first logged call, email or meeting starts the response-time clock. It is never rewritten.</p>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div className="tabs" style={{ margin: 0, border: 0 }}>
                {(['timeline', 'tasks', 'history'] as const).map((t) => (
                  <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                    {t === 'timeline' ? 'Timeline' : t === 'tasks' ? `Tasks (${data.tasks.length})` : 'Stage history'}
                  </button>
                ))}
              </div>
            </div>
            <div className="card-body">
              {tab === 'timeline' && (
                data.activities.length === 0
                  ? <Empty icon="note" title="No activity yet" body="Log a call, meeting, email or note to build the timeline." />
                  : <div className="timeline">
                    {data.activities.map((a) => (
                      <div className="timeline-item" key={a.id}>
                        <div className="timeline-icon"><Icon name={ACTIVITY_ICON[a.type] || 'pulse'} size={15} /></div>
                        <div className="timeline-body">
                          <p>{a.body}</p>
                          <p className="timeline-time">{a.type.toUpperCase()} · {a.actor_name || 'System'} · {fmtDate(a.created_at, true)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
              )}
              {tab === 'tasks' && (
                <>
                  <div className="row" style={{ marginBottom: 16 }}>
                    <input className="input" aria-label="Task title" placeholder="Follow-up task" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                    <input className="input" aria-label="Due date and time" type="datetime-local" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} style={{ width: 220 }} />
                    <button className="btn btn-primary" disabled={busy} onClick={() => void addTask()}>Add task</button>
                  </div>
                  {data.tasks.length === 0
                    ? <Empty icon="check" title="No follow-up tasks" body="Add a dated task so the next action is never implicit." />
                    : <div className="table-wrap"><table className="table"><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
                      <tbody>{data.tasks.map((t) => <tr key={t.id}>
                        <td className="cell-strong">{t.title}</td><td className="cell-sub">{t.owner_name || '—'}</td>
                        <td className="cell-sub">{fmtDate(t.due_at, true)}</td>
                        <td>{t.completed_at ? <Badge tone="green">Done</Badge> : <Badge tone={Date.parse(t.due_at) < Date.now() ? 'red' : 'neutral'}>{Date.parse(t.due_at) < Date.now() ? 'Overdue' : 'Open'}</Badge>}</td>
                      </tr>)}</tbody></table></div>}
                </>
              )}
              {tab === 'history' && (
                <div className="table-wrap"><table className="table"><thead><tr><th>From</th><th>To</th><th>Reason</th><th>By</th><th>When</th></tr></thead>
                  <tbody>{data.stageEvents.map((e) => <tr key={e.id}>
                    <td>{e.from_name || '—'}</td><td className="cell-strong">{e.to_name}</td><td className="cell-sub">{e.reason || '—'}</td>
                    <td className="cell-sub">{e.actor_name || 'System'}</td><td className="cell-sub">{fmtDate(e.created_at, true)}</td>
                  </tr>)}</tbody></table></div>
              )}
            </div>
          </section>

          {data.candidates.length > 0 && (
            <section className="card">
              <div className="card-head"><h3>Possible duplicates</h3><Badge tone="amber">{data.candidates.length} proposed</Badge></div>
              <div className="card-body">
                <p className="small muted" style={{ marginBottom: 12 }}>These are proposals only. Nothing is merged without your explicit confirmation, and all activity history is preserved.</p>
                {data.candidates.map((c) => (
                  <div className="row-between" key={c.id} style={{ padding: '9px 0', borderTop: '1px solid var(--line)' }}>
                    <div><strong>{c.name}</strong><div className="cell-sub">{c.email || c.phone} · {c.reasons.join(', ')}</div></div>
                    <button className="btn btn-small" onClick={() => setMergeTarget(c)}>Compare & merge</button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-head"><h3>Lead record</h3></div>
            <div className="card-body">
              <dl className="kv">
                <dt>Stage</dt><dd><select className="select" value={lead.stage_id} onChange={(e) => void onTransition(e.target.value)} disabled={busy} aria-label="Change stage">
                  {facets?.facets.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></dd>
                <dt>Owner</dt><dd><select className="select" value={lead.owner_id || ''} disabled={!data.permissions.canAssign || busy}
                  onChange={(e) => void onOwner(e.target.value)} aria-label="Change owner">
                  <option value="">Unassigned</option>{facets?.facets.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select></dd>
                <dt>Email</dt><dd>{lead.email ? <a href={`mailto:${lead.email}`} style={{ color: 'var(--accent-dark)' }}>{lead.email}</a> : '—'}</dd>
                <dt>Phone</dt><dd>{lead.phone || '—'}</dd>
                <dt>Company</dt><dd>{lead.company || '—'}</dd>
                <dt>Campaign</dt><dd>{lead.campaign || '—'}</dd>
                <dt>Amount</dt><dd>{lead.amount == null ? '—' : lead.amount.toLocaleString('en-IN')}</dd>
                <dt>Consent</dt><dd><Badge tone={lead.consent === 'granted' ? 'green' : lead.consent === 'declined' ? 'red' : 'neutral'}>{lead.consent}</Badge></dd>
                <dt>First response</dt><dd>{lead.first_response_at ? fmtDate(lead.first_response_at, true) : <Badge tone="red">Not yet</Badge>}</dd>
                <dt>Next follow-up</dt><dd>{lead.next_follow_up_at ? fmtDate(lead.next_follow_up_at, true) : '—'}</dd>
              </dl>
              {lead.phone && (
                <button className="btn" style={{ marginTop: 14 }}
                  onClick={() => { window.open(`https://wa.me/${lead.phone.replace(/\D/g, '')}`, '_blank', 'noopener,noreferrer'); toast('Opened a click-to-chat link. No message was sent automatically.', 'info'); }}>
                  <Icon name="phone" size={15} /> Open WhatsApp for this contact
                </button>
              )}
              <p className="hint" style={{ marginTop: 8 }}>This link opens only after you click it. LeadPulse does not automate WhatsApp messages.</p>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h3>Notes</h3></div>
            <div className="card-body"><p style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{lead.notes || 'No notes recorded yet.'}</p></div>
          </section>
        </div>
      </div>

      <EditLeadModal open={editOpen} onClose={() => setEditOpen(false)} lead={lead} onSaved={() => { setEditOpen(false); reload(); toast('Lead updated.', 'success'); }} />
      <Modal open={confirmArchive} title={lead.archived_at ? 'Restore this lead?' : 'Archive this lead?'} onClose={() => setConfirmArchive(false)}
        footer={<><button className="btn" onClick={() => setConfirmArchive(false)}>Cancel</button>
          <button className={`btn ${lead.archived_at ? 'btn-primary' : 'btn-danger'}`} disabled={busy}
            onClick={() => void act(async () => {
              await api(`/leads/${lead.id}/${lead.archived_at ? 'restore' : 'archive'}`, { method: 'POST', body: {} });
              setConfirmArchive(false);
            }, lead.archived_at ? 'Lead restored.' : 'Lead archived.')}>
            {lead.archived_at ? 'Restore' : 'Archive lead'}
          </button></>}>
        <p>{lead.archived_at ? 'The lead will return to the active inbox with its full history intact.' : 'Archived leads are hidden from the active inbox and pipeline. History is preserved and the lead can be restored at any time.'}</p>
      </Modal>
      <Modal open={Boolean(mergeTarget)} title="Compare before merging" onClose={() => setMergeTarget(null)} wide
        footer={<><button className="btn" onClick={() => setMergeTarget(null)}>Cancel</button>
          <button className="btn btn-danger" disabled={busy} onClick={() => void act(async () => {
            if (!mergeTarget) return;
            await api(`/leads/${lead.id}/merge`, { method: 'POST', body: { sourceLeadId: mergeTarget.id } });
            setMergeTarget(null); navigate(`/app/leads/${lead.id}`);
          }, 'Leads merged. History preserved.')}>Merge into this lead</button></>}>
        <p className="small muted">The selected record will be archived and its activities, tasks, stage history and tags moved into <strong>{lead.name}</strong>. This cannot be undone automatically.</p>
        {mergeTarget && (
          <div className="table-wrap"><table className="table"><thead><tr><th>Field</th><th>Keep (this lead)</th><th>Merge from</th></tr></thead>
            <tbody>{[['Name', lead.name, mergeTarget.name], ['Email', lead.email, mergeTarget.email], ['Phone', lead.phone, mergeTarget.phone],
              ['Company', lead.company, mergeTarget.company], ['Stage', lead.stage_name, mergeTarget.stage_name], ['Created', fmtDate(lead.created_at), fmtDate(mergeTarget.created_at)]]
              .map(([k, a, b]) => <tr key={k}><td className="cell-strong">{k}</td><td>{a || '—'}</td><td>{b || '—'}</td></tr>)}</tbody></table></div>
        )}
      </Modal>
    </div>
  );
}

function EditLeadModal({ open, onClose, lead, onSaved }: { open: boolean; onClose: () => void; lead: Lead; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: lead.name, company: lead.company, email: lead.email, phone: lead.phone,
    priority: lead.priority, notes: lead.notes, campaign: lead.campaign,
    amount: lead.amount == null ? '' : String(lead.amount), tags: lead.tags.join(', '), consent: lead.consent,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api(`/leads/${lead.id}`, {
        method: 'PATCH',
        body: {
          name: form.name, company: form.company, email: form.email, phone: form.phone,
          priority: form.priority, notes: form.notes, campaign: form.campaign, consent: form.consent,
          amount: form.amount === '' ? null : Number(form.amount),
          tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        },
      });
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save changes.';
      setError(message); toast(message, 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${lead.name}`} wide
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Save changes'}</button></>}>
      {error && <ErrorNotice message={error} />}
      <div className="form-grid">
        <Field label="Name" htmlFor="e-name"><input id="e-name" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Company" htmlFor="e-company"><input id="e-company" className="input" value={form.company} onChange={(e) => set('company', e.target.value)} /></Field>
        <Field label="Email" htmlFor="e-email"><input id="e-email" className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Phone" htmlFor="e-phone"><input id="e-phone" className="input" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Priority" htmlFor="e-priority"><select id="e-priority" className="select" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
          {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
        <Field label="Consent" htmlFor="e-consent"><select id="e-consent" className="select" value={form.consent} onChange={(e) => set('consent', e.target.value)}>
          <option value="unknown">Unknown</option><option value="granted">Granted</option><option value="declined">Declined</option></select></Field>
        <Field label="Campaign" htmlFor="e-campaign"><input id="e-campaign" className="input" value={form.campaign} onChange={(e) => set('campaign', e.target.value)} /></Field>
        <Field label="Amount" htmlFor="e-amount"><input id="e-amount" className="input" type="number" min="0" value={form.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
        <div className="full"><Field label="Tags" htmlFor="e-tags"><input id="e-tags" className="input" value={form.tags} onChange={(e) => set('tags', e.target.value)} /></Field></div>
        <div className="full"><Field label="Notes" htmlFor="e-notes"><textarea id="e-notes" className="textarea" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}
