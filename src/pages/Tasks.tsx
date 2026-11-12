import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, fmtDate, relative } from '../api';
import { Badge, Empty, ErrorNotice, Field, Icon, Modal, Spinner, useApi, useToast } from '../ui';

interface TaskRow {
  id: string; title: string; lead_id: string | null; lead_name: string | null;
  owner_id: string | null; owner_name: string | null; due_at: string;
  priority: string; completed_at: string | null;
}
interface TaskData {
  items: TaskRow[]; timezone: string; bucket: string;
  counts: { overdue: number; dueToday: number };
}
interface LeadFacets { facets: { members: { id: string; name: string }[] }; items: { id: string; name: string }[] }

const BUCKETS = [
  { key: 'overdue', label: 'Overdue' }, { key: 'today', label: 'Due today' },
  { key: 'upcoming', label: 'Upcoming' }, { key: 'all', label: 'All' },
] as const;

export function TasksPage() {
  const toast = useToast();
  const [bucket, setBucket] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const { data, loading, error, reload } = useApi<TaskData>(`/tasks?bucket=${bucket}`);
  const { data: leadData } = useApi<LeadFacets>('/leads?pageSize=100');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [leadId, setLeadId] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = async (task: TaskRow) => {
    try {
      await api(`/tasks/${task.id}`, { method: 'PATCH', body: { completed: !task.completed_at } });
      toast(task.completed_at ? 'Task reopened.' : 'Task marked complete.', 'success');
      reload();
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not update the task.', 'error'); }
  };

  const create = async () => {
    if (!title.trim() || !due) { toast('Add a title and a due date.', 'error'); return; }
    setBusy(true);
    try {
      await api('/tasks', { method: 'POST', body: { title, dueAt: new Date(due).toISOString(), leadId: leadId || undefined, priority: 'normal' } });
      setCreateOpen(false); setTitle(''); setDue(''); setLeadId('');
      toast('Follow-up task created.', 'success'); reload();
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not create the task.', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h2>Follow-ups</h2><p>Due times are stored in UTC and shown in your workspace timezone ({data?.timezone || '…'}).</p></div>
        <div className="page-actions"><button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={15} /> New task</button></div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="stat stat-red"><p className="stat-label">Overdue</p><p className="stat-value">{data?.counts.overdue ?? '—'}</p></div>
        <div className="stat stat-amber"><p className="stat-label">Due today</p><p className="stat-value">{data?.counts.dueToday ?? '—'}</p></div>
        <div className="stat"><p className="stat-label">Shown here</p><p className="stat-value">{data?.items.length ?? '—'}</p></div>
      </div>

      <section className="card">
        <div className="toolbar">
          {BUCKETS.map((b) => (
            <button key={b.key} className={`btn btn-small ${bucket === b.key ? 'btn-accent' : ''}`} onClick={() => setBucket(b.key)}>{b.label}</button>
          ))}
        </div>
        {loading && <Spinner label="Loading tasks" />}
        {error && <div className="card-body"><ErrorNotice message={error} onRetry={reload} /></div>}
        {data && data.items.length === 0 && (
          <Empty icon="check" title="Nothing in this bucket" body="Create a follow-up task on a lead detail page, or add one here."
            action={<button className="btn btn-primary" onClick={() => setCreateOpen(true)}>Add a task</button>} />
        )}
        {data && data.items.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th style={{ width: 40 }}>Done</th><th>Task</th><th>Lead</th><th>Owner</th><th>Due</th><th>Priority</th></tr></thead>
            <tbody>{data.items.map((t) => (
              <tr key={t.id}>
                <td><input type="checkbox" aria-label={`Complete ${t.title}`} checked={Boolean(t.completed_at)} onChange={() => void toggle(t)} /></td>
                <td className="cell-strong">{t.title}</td>
                <td>{t.lead_id ? <Link to={`/app/leads/${t.lead_id}`} style={{ color: 'var(--accent-dark)' }}>{t.lead_name || 'View lead'}</Link> : '—'}</td>
                <td className="cell-sub">{t.owner_name || '—'}</td>
                <td>{t.completed_at ? <span className="cell-sub">{fmtDate(t.completed_at, true)}</span>
                  : <Badge tone={Date.parse(t.due_at) < Date.now() ? 'red' : 'neutral'}>{fmtDate(t.due_at, true)} · {relative(t.due_at)}</Badge>}</td>
                <td><Badge tone={t.priority === 'urgent' ? 'red' : t.priority === 'high' ? 'amber' : 'neutral'}>{t.priority}</Badge></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New follow-up task"
        footer={<><button className="btn" onClick={() => setCreateOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => void create()}>{busy ? 'Saving…' : 'Create task'}</button></>}>
        <Field label="Task title *" htmlFor="t-title"><input id="t-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call back about the quote" /></Field>
        <Field label="Due date and time *" htmlFor="t-due"><input id="t-due" className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Link to a lead (optional)" htmlFor="t-lead">
          <select id="t-lead" className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">No lead</option>
            {leadData?.items.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <p className="hint">The task is a logged next action. No reminder email is sent automatically.</p>
      </Modal>
    </div>
  );
}
