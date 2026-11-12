import React from 'react';
import { Link } from 'react-router-dom';
import type { Lead } from '../api';
import { fmtMoney, relative } from '../api';
import { Badge, BarChart, Empty, ErrorNotice, Icon, Spinner, StatCard, useApi } from '../ui';

interface Summary {
  metrics: {
    leadsCreated: number; openLeads: number; leadsWithOwnerPercent: number | null;
    overdueTasks: number; openPipelineValue: number | null; currency: string;
    responseTimeMedianMinutes: number | null; responseSampleSize: number;
    withinSlaPercent: number | null; slaTargetMinutes: number;
    leadToQualifiedPercent: number | null; qualifiedToWonPercent: number | null;
    weeklyActiveTeammates: number;
  };
  window: { from: string; to: string; timezone: string };
  sourceBreakdown: { source: string; leads: number; won: number; conversionPercent: number | null }[];
  leadsByDay: { day: string; leads: number }[];
  teamActivity: { name: string; activities: number }[];
}

interface TaskList { items: { id: string; title: string; due_at: string; lead_id: string | null; lead_name: string | null; priority: string }[] }
interface LeadList { items: Lead[]; total: number }

export function Dashboard() {
  const reports = useApi<Summary>('/reports/summary');
  const tasks = useApi<TaskList>('/tasks?bucket=overdue');
  const leads = useApi<LeadList>('/leads?pageSize=6&sort=created_at&dir=desc');
  const m = reports.data?.metrics;

  const minutesLabel = (value: number | null) => value == null ? 'No data' : value < 60 ? `${value}m` : `${Math.round(value / 60 * 10) / 10}h`;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Today at a glance</h2>
          <p>Every figure below comes from records in this workspace — nothing is estimated.</p>
        </div>
        <div className="page-actions">
          <Link className="btn btn-primary" to="/app/leads"><Icon name="plus" size={15} /> New lead</Link>
          <Link className="btn" to="/app/reports">Full reports <Icon name="arrow" size={15} /></Link>
        </div>
      </div>

      {reports.loading && <Spinner label="Computing workspace metrics" />}
      {reports.error && (
        <ErrorNotice message={`Reports are available to managers and admins: ${reports.error}`} onRetry={reports.reload} />
      )}
      {m && (
        <div className="grid grid-4" style={{ marginBottom: 16 }}>
          <StatCard label="Leads created (30d)" value={m.leadsCreated} sub={`${m.openLeads} open in pipeline`} />
          <StatCard label="Median first response" value={minutesLabel(m.responseTimeMedianMinutes)}
            sub={`${m.responseSampleSize} measured · target ${m.slaTargetMinutes}m`}
            tone={m.responseTimeMedianMinutes != null && m.responseTimeMedianMinutes > m.slaTargetMinutes ? 'red' : 'green'} />
          <StatCard label="Overdue follow-ups" value={m.overdueTasks} sub="Uncompleted tasks past due"
            tone={m.overdueTasks > 0 ? 'red' : 'green'} />
          <StatCard label="Leads with an owner" value={m.leadsWithOwnerPercent == null ? '—' : `${m.leadsWithOwnerPercent}%`}
            sub="Of all open leads" tone="amber" />
        </div>
      )}

      <div className="split">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h3>Needs a response</h3>
              <Link className="btn btn-small" to="/app/tasks">All follow-ups</Link>
            </div>
            {tasks.loading && <Spinner label="Loading follow-ups" />}
            {tasks.error && <div className="card-body"><ErrorNotice message={tasks.error} onRetry={tasks.reload} /></div>}
            {tasks.data && tasks.data.items.length === 0 && (
              <Empty icon="check" title="Nothing overdue" body="When a follow-up passes its due time it will appear here with the linked lead." />
            )}
            {tasks.data && tasks.data.items.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Task</th><th>Lead</th><th>Due</th><th>Priority</th></tr></thead>
                  <tbody>
                    {tasks.data.items.slice(0, 6).map((t) => (
                      <tr key={t.id}>
                        <td className="cell-strong">{t.title}</td>
                        <td>{t.lead_id ? <Link to={`/app/leads/${t.lead_id}`} style={{ color: 'var(--accent-dark)' }}>{t.lead_name || 'View lead'}</Link> : '—'}</td>
                        <td><Badge tone="red">{relative(t.due_at)}</Badge></td>
                        <td><Badge tone={t.priority === 'urgent' ? 'red' : 'neutral'}>{t.priority}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Recent leads</h3>
              <Link className="btn btn-small" to="/app/leads">Open inbox</Link>
            </div>
            {leads.loading && <Spinner label="Loading leads" />}
            {leads.error && <div className="card-body"><ErrorNotice message={leads.error} onRetry={leads.reload} /></div>}
            {leads.data && leads.data.items.length === 0 && (
              <Empty title="No leads yet" body="Create your first lead, share the public capture form, or import a CSV to get started."
                action={<Link className="btn btn-primary" to="/app/leads">Create a lead</Link>} />
            )}
            {leads.data && leads.data.items.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Lead</th><th>Stage</th><th>Owner</th><th>Created</th></tr></thead>
                  <tbody>
                    {leads.data.items.map((l) => (
                      <tr className="row-link" key={l.id} onClick={() => window.location.assign(`/app/leads/${l.id}`)}>
                        <td><div className="cell-strong">{l.name}</div><div className="cell-sub">{l.company || l.email}</div></td>
                        <td><span className="badge badge-neutral" style={{ borderLeft: `3px solid ${l.stage_color}` }}>{l.stage_name}</span></td>
                        <td>{l.owner_name || <Badge tone="amber">Unassigned</Badge>}</td>
                        <td className="cell-sub">{relative(l.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="stack">
          {m && (
            <section className="card">
              <div className="card-head"><h3>Pipeline value</h3></div>
              <div className="card-body">
                <p className="stat-value" style={{ fontSize: 28 }}>{fmtMoney(m.openPipelineValue, m.currency)}</p>
                <p className="small muted" style={{ marginTop: 4 }}>Sum of amounts on open-stage leads. Blank when no amounts are recorded.</p>
                <div className="row-between" style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                  <span className="small muted">Within SLA target</span>
                  <strong>{m.withinSlaPercent == null ? 'No data' : `${m.withinSlaPercent}%`}</strong>
                </div>
                <div className="row-between" style={{ marginTop: 8 }}>
                  <span className="small muted">Lead → qualified</span>
                  <strong>{m.leadToQualifiedPercent == null ? 'No data' : `${m.leadToQualifiedPercent}%`}</strong>
                </div>
                <div className="row-between" style={{ marginTop: 8 }}>
                  <span className="small muted">Qualified → won</span>
                  <strong>{m.qualifiedToWonPercent == null ? 'No data' : `${m.qualifiedToWonPercent}%`}</strong>
                </div>
                <div className="row-between" style={{ marginTop: 8 }}>
                  <span className="small muted">Active teammates (7d)</span>
                  <strong>{m.weeklyActiveTeammates}</strong>
                </div>
              </div>
            </section>
          )}
          {reports.data && (
            <section className="card">
              <div className="card-head"><h3>Leads by source</h3></div>
              <div className="card-body">
                {reports.data.sourceBreakdown.length === 0
                  ? <p className="small muted">No leads in this date window yet.</p>
                  : <BarChart data={reports.data.sourceBreakdown.map((s) => ({ label: s.source, value: s.leads }))} />}
                <p className="hint" style={{ marginTop: 14 }}>Window: {reports.data.window.timezone} · last 30 days</p>
              </div>
            </section>
          )}
          <section className="card">
            <div className="card-head"><h3>Shortcuts</h3></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Link className="btn" to="/app/pipeline"><Icon name="board" size={16} /> Open pipeline board</Link>
              <Link className="btn" to="/app/data"><Icon name="upload" size={16} /> Import a CSV</Link>
              <Link className="btn" to="/app/settings"><Icon name="link" size={16} /> Share capture form</Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
