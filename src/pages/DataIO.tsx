import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, downloadFile, fmtDate } from '../api';
import { Badge, Empty, ErrorNotice, Field, Icon, Spinner, useApi, useToast } from '../ui';

interface PreviewRow {
  name: string; company: string; email: string; phone: string; source: string;
  duplicateOf: { id: string; name: string } | null;
}
interface PreviewResponse {
  job: { id: string; status: string; createdAt: string; header: string[]; mapping: Record<string, string>;
    summary: { totalRows: number; validRows: number; invalidRows: number; duplicates: number; parserErrors: string[]; truncated: boolean; warnings: string[] } };
  invalid: { row: number; values: Record<string, string>; errors: string[] }[];
  preview: PreviewRow[];
  errors?: string[];
  idempotent: boolean;
}
interface CommitResponse { summary: { committedRows: number }; status: string }

const randomKey = () => `imp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function DataIOPage() {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('leads.csv');
  const [key, setKey] = useState(randomKey());
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResponse | null>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError('That file is larger than the 2 MB limit.'); return; }
    setFilename(file.name); setResult(null); setPreview(null); setConfirmed(false);
    const reader = new FileReader();
    reader.onload = () => { setCsv(String(reader.result || '')); setKey(randomKey()); setError(null); };
    reader.readAsText(file);
  };

  const runPreview = async () => {
    if (!csv.trim()) { setError('Choose a CSV file or paste CSV text first.'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await api<PreviewResponse>('/imports/preview', {
        method: 'POST', body: { csv, filename, idempotencyKey: key },
      });
      setPreview(res);
      toast('Preview ready. Review it before committing.', 'info');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not parse the CSV.'); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!preview || !confirmed) return;
    setBusy(true); setError(null);
    try {
      const res = await api<CommitResponse>(`/imports/${preview.job.id}/commit`, { method: 'POST', body: { confirm: true } });
      setResult(res); setPreview(null); setConfirmed(false); setCsv(''); setKey(randomKey());
      toast(`${res.summary.committedRows} leads imported.`, 'success');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Import failed.'); }
    finally { setBusy(false); }
  };

  const exportCsv = async () => {
    try { await downloadFile('/leads/export', 'leadpulse-leads.csv'); toast('CSV downloaded.', 'success'); }
    catch (err) { toast(err instanceof ApiError ? err.message : 'Export failed.', 'error'); }
  };
  const exportJson = async () => {
    try { await downloadFile('/workspace/export', 'leadpulse-backup.json'); toast('JSON backup downloaded.', 'success'); }
    catch (err) { toast(err instanceof ApiError ? err.message : 'Export failed.', 'error'); }
  };

  return (
    <div className="page page-narrow">
      <div className="page-head"><div><h2>Import &amp; export</h2><p>Previews are validated row by row. Nothing is written until you explicitly confirm.</p></div></div>
      {error && <ErrorNotice message={error} />}

      <div className="stack">
        <section className="card">
          <div className="card-head"><h3>Import a CSV</h3><Badge tone="neutral">Max 2 MB · 500 rows per pilot</Badge></div>
          <div className="card-body stack" style={{ gap: 14 }}>
            {result && <div className="notice notice-success"><Icon name="check" size={17} /><span>Import complete — {result.summary.committedRows} leads created.</span></div>}
            <Field label="CSV file" htmlFor="csv-file" hint="First row must be a header. Recognised columns: name, email, phone, company, source, campaign, notes, tags, amount, priority.">
              <input id="csv-file" className="input" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
            </Field>
            <Field label="Or paste CSV text" htmlFor="csv-text">
              <textarea id="csv-text" className="textarea mono" value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); setKey(randomKey()); }}
                placeholder={'name,email,phone,company\nAarav Mehta,aarav@example.org,+15550100001,Maple Interiors'} />
            </Field>
            <div className="row">
              <button className="btn btn-primary" disabled={busy} onClick={() => void runPreview()}><Icon name="search" size={15} /> {busy ? 'Working…' : 'Validate and preview'}</button>
              {preview && <button className="btn" onClick={() => { setPreview(null); setConfirmed(false); }}>Clear preview</button>}
            </div>
            <p className="hint">Formula-like cells are prefixed with an apostrophe on import and neutralised again on export. Malformed and oversized files are rejected or bounded safely.</p>
          </div>
        </section>

        {preview && <section className="card">
          <div className="card-head"><h3>Review before importing</h3><Badge tone="amber">{preview.job.summary.validRows} valid · {preview.job.summary.invalidRows} invalid</Badge></div>
          <div className="card-body stack" style={{ gap: 14 }}>
            <div className="grid grid-4">
              <div className="stat"><p className="stat-label">Rows read</p><p className="stat-value">{preview.job.summary.totalRows}</p></div>
              <div className="stat stat-green"><p className="stat-label">Will import</p><p className="stat-value">{preview.job.summary.validRows}</p></div>
              <div className="stat stat-red"><p className="stat-label">Rejected</p><p className="stat-value">{preview.job.summary.invalidRows}</p></div>
              <div className="stat stat-amber"><p className="stat-label">Duplicate suggestions</p><p className="stat-value">{preview.job.summary.duplicates}</p></div>
            </div>
            {preview.job.summary.warnings.map((w) => <div className="notice notice-info" key={w}><Icon name="alert" size={16} /><span>{w}</span></div>)}
            {preview.job.summary.parserErrors.map((e) => <div className="notice notice-info" key={e}><Icon name="alert" size={16} /><span>{e}</span></div>)}
            {preview.invalid.length > 0 && <div>
              <h3 style={{ marginBottom: 8 }}>Rows that will be skipped</h3>
              <div className="table-wrap"><table className="table"><thead><tr><th>Row</th><th>Name</th><th>Errors</th></tr></thead>
                <tbody>{preview.invalid.slice(0, 20).map((r) => <tr key={r.row}>
                  <td>{r.row}</td><td>{r.values.name || '—'}</td><td className="cell-sub">{r.errors.join('; ')}</td>
                </tr>)}</tbody></table></div>
            </div>}
            {preview.preview.length > 0 && <div>
              <h3 style={{ marginBottom: 8 }}>First rows to be created</h3>
              <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Duplicate?</th></tr></thead>
                <tbody>{preview.preview.map((r, i) => <tr key={`${r.email}-${i}`}>
                  <td className="cell-strong">{r.name}</td><td className="cell-sub">{r.email || '—'}</td><td className="cell-sub">{r.phone || '—'}</td>
                  <td>{r.duplicateOf ? <Badge tone="amber">Matches {r.duplicateOf.name}</Badge> : <Badge tone="green">New</Badge>}</td>
                </tr>)}</tbody></table></div>
            </div>}
            <label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>I have reviewed the preview and confirm importing {preview.job.summary.validRows} leads.</span></label>
            <div className="row"><button className="btn btn-primary" disabled={!confirmed || busy || preview.job.summary.validRows === 0} onClick={() => void commit()}>
              <Icon name="upload" size={15} /> Confirm import</button></div>
            <p className="hint">Duplicate matches are shown as proposals only — no records are merged automatically.</p>
          </div>
        </section>}

        <section className="card">
          <div className="card-head"><h3>Export</h3></div>
          <div className="card-body stack" style={{ gap: 12 }}>
            <p className="small muted">CSV export honours your role and the filters you choose in the lead inbox. The JSON backup contains the full workspace and includes personal data — store it securely.</p>
            <div className="row">
              <button className="btn" onClick={() => void exportCsv()}><Icon name="download" size={15} /> Export leads as CSV</button>
              <button className="btn" onClick={() => void exportJson()}><Icon name="shield" size={15} /> Download workspace backup</button>
              <Link className="btn" to="/app/leads">Apply filters in inbox</Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- audit log */
interface AuditRow {
  id: string; action: string; entity_type: string; entity_id: string;
  metadata: string; actor_name: string | null; created_at: string;
}
interface AuditData { items: AuditRow[]; total: number; page: number; pageSize: number }

export function AuditPage() {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApi<AuditData>(`/audit?page=${page}&pageSize=50`);
  return (
    <div className="page">
      <div className="page-head"><div><h2>Audit log</h2><p>Sensitive actions are recorded with the actor, entity and timestamp. Personal data and secrets are never written to logs.</p></div></div>
      <section className="card">
        {loading && <Spinner label="Loading audit events" />}
        {error && <div className="card-body"><ErrorNotice message={error} onRetry={reload} /></div>}
        {data && data.items.length === 0 && <Empty icon="shield" title="No audit events yet" body="Workspace changes, exports, invitations, webhook creation and lead merges will appear here." />}
        {data && data.items.length > 0 && <div className="table-wrap"><table className="table">
          <thead><tr><th>Action</th><th>Entity</th><th>Actor</th><th>Time</th></tr></thead>
          <tbody>{data.items.map((r) => <tr key={r.id}>
            <td><span className="cell-strong mono">{r.action}</span></td>
            <td className="cell-sub">{r.entity_type || '—'} <span className="mono">{r.entity_id ? r.entity_id.slice(0, 14) : ''}</span></td>
            <td className="cell-sub">{r.actor_name || 'System'}</td>
            <td className="cell-sub">{fmtDate(r.created_at, true)}</td>
          </tr>)}</tbody></table></div>}
        {data && <div className="pager">
          <span>{data.total} events · page {data.page}</span>
          <div className="row"><button className="btn btn-small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button className="btn btn-small" disabled={data.items.length < data.pageSize} onClick={() => setPage((p) => p + 1)}>Next</button></div>
        </div>}
      </section>
    </div>
  );
}
