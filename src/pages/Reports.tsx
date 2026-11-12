import React, { useMemo, useState } from 'react';
import { fmtMoney } from '../api';
import { BarChart, Empty, ErrorNotice, Field, Icon, Spinner, StatCard, useApi } from '../ui';

interface Summary {
  window: { from: string; to: string; timezone: string; businessHoursOnly: boolean };
  metrics: {
    leadsCreated: number; openLeads: number; leadsWithOwnerPercent: number | null;
    overdueTasks: number; openPipelineValue: number | null; currency: string;
    responseTimeMedianMinutes: number | null; responseSampleSize: number;
    withinSlaPercent: number | null; slaTargetMinutes: number;
    leadToQualifiedPercent: number | null; qualifiedToWonPercent: number | null;
    weeklyActiveTeammates: number;
  };
  sourceBreakdown: { source: string; leads: number; won: number; conversionPercent: number | null }[];
  stageBreakdown: { name: string; kind: string; color: string; leads: number }[];
  teamActivity: { name: string; activities: number }[];
  leadsByDay: { day: string; leads: number }[];
  note: string;
}

const isoDay = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
};

export function ReportsPage() {
  const [from, setFrom] = useState(isoDay(-30));
  const [to, setTo] = useState(isoDay(0));
  const path = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set('from', `${from}T00:00:00.000Z`);
    if (to) p.set('to', `${to}T23:59:59.000Z`);
    return `/reports/summary?${p.toString()}`;
  }, [from, to]);
  const { data, loading, error, reload } = useApi<Summary>(path);
  const m = data?.metrics;

  return (
    <div className="page">
      <div className="page-head">
        <div><h2>Reports</h2><p>Computed from persisted leads, activities, stage events and tasks. No estimated figures.</p></div>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-body row">
          <Field label="From" htmlFor="r-from"><input id="r-from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 180 }} /></Field>
          <Field label="To" htmlFor="r-to"><input id="r-to" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 180 }} /></Field>
          <div style={{ alignSelf: 'flex-end', paddingBottom: 4 }} className="small muted">
            <Icon name="clock" size={14} /> {data?.window.timezone || '—'} · {data?.window.businessHoursOnly ? 'business-hours SLA' : 'wall-clock SLA'}
          </div>
        </div>
      </section>

      {loading && <Spinner label="Computing report" />}
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {m && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <StatCard label="Leads created" value={m.leadsCreated} sub="In selected window" />
            <StatCard label="Median response" value={m.responseTimeMedianMinutes == null ? 'No data' : `${m.responseTimeMedianMinutes}m`}
              sub={`${m.responseSampleSize} responses measured`} tone="amber" />
            <StatCard label="Within SLA" value={m.withinSlaPercent == null ? 'No data' : `${m.withinSlaPercent}%`}
              sub={`Target ${m.slaTargetMinutes} minutes`} tone="green" />
            <StatCard label="Overdue tasks" value={m.overdueTasks} sub="Across all open leads" tone={m.overdueTasks > 0 ? 'red' : 'green'} />
          </div>
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <StatCard label="Open pipeline value" value={fmtMoney(m.openPipelineValue, m.currency)} sub="Only leads with an amount" />
            <StatCard label="Leads with owner" value={m.leadsWithOwnerPercent == null ? '—' : `${m.leadsWithOwnerPercent}%`} sub={`${m.openLeads} open leads`} />
            <StatCard label="Lead → qualified" value={m.leadToQualifiedPercent == null ? 'No data' : `${m.leadToQualifiedPercent}%`} sub="Distinct leads reaching Qualified" />
            <StatCard label="Qualified → won" value={m.qualifiedToWonPercent == null ? 'No data' : `${m.qualifiedToWonPercent}%`} sub="Distinct leads reaching Won" />
          </div>

          <div className="grid grid-2">
            <section className="card">
              <div className="card-head"><h3>Stage distribution</h3></div>
              <div className="card-body">
                {data?.stageBreakdown.every((s) => s.leads === 0)
                  ? <Empty title="No open leads" body="Stage counts will appear once leads are created." />
                  : <BarChart data={(data?.stageBreakdown || []).map((s) => ({ label: s.name, value: s.leads }))} />}
              </div>
            </section>
            <section className="card">
              <div className="card-head"><h3>Leads by source</h3></div>
              <div className="card-body">
                {!data?.sourceBreakdown.length
                  ? <Empty title="No leads in this window" body="Widen the date range or import leads." />
                  : <div className="table-wrap"><table className="table">
                    <thead><tr><th>Source</th><th>Leads</th><th>Won</th><th>Conversion</th></tr></thead>
                    <tbody>{data.sourceBreakdown.map((s) => <tr key={s.source}>
                      <td className="cell-strong">{s.source}</td><td>{s.leads}</td><td>{s.won}</td>
                      <td>{s.conversionPercent == null ? '—' : `${s.conversionPercent}%`}</td>
                    </tr>)}</tbody></table></div>}
              </div>
            </section>
            <section className="card">
              <div className="card-head"><h3>Leads per day</h3></div>
              <div className="card-body">
                {!data?.leadsByDay.length
                  ? <Empty title="No leads in this window" body="Daily counts are derived from created-at timestamps." />
                  : <BarChart data={data.leadsByDay.slice(-14).map((d) => ({ label: d.day.slice(5), value: d.leads }))} />}
              </div>
            </section>
            <section className="card">
              <div className="card-head"><h3>Team activity</h3></div>
              <div className="card-body">
                <p className="small muted" style={{ marginBottom: 12 }}>{m.weeklyActiveTeammates} teammate(s) logged activity in the last 7 days.</p>
                {!data?.teamActivity.length
                  ? <Empty icon="users" title="No logged activity" body="Calls, emails and meetings logged by teammates will appear here." />
                  : <BarChart data={data.teamActivity.map((t) => ({ label: t.name, value: t.activities }))} />}
              </div>
            </section>
          </div>
          <p className="hint" style={{ marginTop: 16 }}>{data?.note}</p>
        </>
      )}
    </div>
  );
}
