import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, relative, type Lead, type Stage } from '../api';
import { Badge, Empty, ErrorNotice, Icon, Spinner, useApi, useToast } from '../ui';

interface Column { stage: Stage; leads: Lead[]; count: number }
interface PipelineData { columns: Column[]; canConfigure: boolean; canAssign: boolean }

export function PipelinePage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi<PipelineData>('/pipeline');
  const [view, setView] = useState<'board' | 'table'>('board');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const move = async (leadId: string, stageId: string) => {
    if (busyId) return;
    setBusyId(leadId);
    try {
      await api(`/leads/${leadId}/transition`, { method: 'POST', body: { stageId } });
      toast('Stage transition saved.', 'success');
      reload();
    } catch (err) {
      // No optimistic state was applied; a failure leaves the card where it was.
      toast(err instanceof ApiError ? err.message : 'Transition failed — the lead was not moved.', 'error');
      reload();
    } finally {
      setBusyId(null); setDragId(null); setOverStage(null);
    }
  };

  const allLeads = data?.columns.flatMap((col) => col.leads.map((lead) => ({ ...lead, stage: col.stage }))) || [];

  return (
    <div className="page">
      <div className="page-head">
        <div><h2>Pipeline</h2><p>Move leads between stages. Every transition is validated on the server and written to stage history.</p></div>
        <div className="page-actions">
          <button className={`btn btn-small ${view === 'board' ? 'btn-accent' : ''}`} onClick={() => setView('board')}><Icon name="board" size={14} /> Board</button>
          <button className={`btn btn-small ${view === 'table' ? 'btn-accent' : ''}`} onClick={() => setView('table')}><Icon name="inbox" size={14} /> Table view</button>
        </div>
      </div>

      {loading && <Spinner label="Loading pipeline" />}
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {data && allLeads.length === 0 && (
        <div className="card"><Empty title="Your pipeline is empty" body="Create a lead or import a CSV to see it on the board." /></div>
      )}

      {data && view === 'board' && allLeads.length > 0 && (
        <div className="kanban" role="list" aria-label="Pipeline board">
          {data.columns.map((col, colIndex) => (
            <div key={col.stage.id} role="listitem"
              className={`kanban-col ${overStage === col.stage.id ? 'drop-target' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOverStage(col.stage.id); }}
              onDragLeave={() => setOverStage((s) => (s === col.stage.id ? null : s))}
              onDrop={(e) => { e.preventDefault(); if (dragId) void move(dragId, col.stage.id); }}>
              <div className="kanban-head">
                <span className="kanban-dot" style={{ background: col.stage.color }} />
                <strong>{col.stage.name}</strong>
                <span className="count">{col.count}</span>
              </div>
              <div className="kanban-body">
                {col.leads.length === 0 && <p className="small muted" style={{ padding: 8, textAlign: 'center' }}>No leads</p>}
                {col.leads.map((lead) => (
                  <div key={lead.id} className={`lead-card ${busyId === lead.id ? 'dragging' : ''}`}
                    draggable={!busyId} onDragStart={() => setDragId(lead.id)} onDragEnd={() => { setDragId(null); setOverStage(null); }}
                    onClick={() => navigate(`/app/leads/${lead.id}`)} role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/app/leads/${lead.id}`); }}>
                    <strong>{lead.name}</strong>
                    <div className="cell-sub">{lead.company || lead.email || lead.phone}</div>
                    <div className="lead-card-foot">
                      <Badge tone={lead.priority === 'urgent' ? 'red' : lead.priority === 'high' ? 'amber' : 'neutral'}>{lead.priority}</Badge>
                      <span className="cell-sub">{relative(lead.created_at)}</span>
                    </div>
                    <div className="move-row" onClick={(e) => e.stopPropagation()}>
                      <button className="move-btn" disabled={colIndex === 0 || Boolean(busyId)}
                        onClick={() => void move(lead.id, data.columns[colIndex - 1].stage.id)}
                        aria-label={`Move ${lead.name} to ${data.columns[colIndex - 1]?.stage.name || 'previous stage'}`}>← Prev</button>
                      <button className="move-btn" disabled={colIndex === data.columns.length - 1 || Boolean(busyId)}
                        onClick={() => void move(lead.id, data.columns[colIndex + 1].stage.id)}
                        aria-label={`Move ${lead.name} to ${data.columns[colIndex + 1]?.stage.name || 'next stage'}`}>Next →</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {data && view === 'table' && allLeads.length > 0 && (
        <section className="card">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Lead</th><th>Owner</th><th>Priority</th><th>Stage</th><th>Created</th></tr></thead>
            <tbody>{allLeads.map((lead) => (
              <tr key={lead.id}>
                <td><a className="cell-strong" href={`/app/leads/${lead.id}`}>{lead.name}</a><div className="cell-sub">{lead.company || lead.email}</div></td>
                <td className="cell-sub">{lead.owner_name || 'Unassigned'}</td>
                <td><Badge tone={lead.priority === 'urgent' ? 'red' : 'neutral'}>{lead.priority}</Badge></td>
                <td><select className="select" value={lead.stage_id} disabled={Boolean(busyId)}
                  onChange={(e) => void move(lead.id, e.target.value)} aria-label={`Stage for ${lead.name}`}>
                  {data.columns.map((c) => <option key={c.stage.id} value={c.stage.id}>{c.stage.name}</option>)}
                </select></td>
                <td className="cell-sub">{relative(lead.created_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
      <p className="hint" style={{ marginTop: 12 }}>Drag and drop, the arrow buttons, and the table selector all call the same validated server transition. A failed request leaves the lead in its original column.</p>
    </div>
  );
}
