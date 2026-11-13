import React, { useState } from 'react';
import { api, ApiError, downloadFile, fmtDate, type Organization, type AiSettings, type EmailSettings } from '../api';
import { Badge, Empty, ErrorNotice, Field, Icon, Modal, Spinner, useApi, useToast } from '../ui';
import { useAuth } from '../App';

/* ---------------------------------------------------------------- team page */
interface Member { id: string; user_id: string; name: string; email: string; role: string; can_view_unassigned: number; created_at: string }
interface Invitation { id: string; email: string; role: string; expires_at: string; accepted_at: string | null; revoked_at: string | null; created_at: string }
interface IssuedInvitation { id: string; email: string; role: string; expiresAt: string }

const ASSIGNABLE_ROLES = ['agent', 'manager', 'workspace_admin'];

export function TeamPage() {
  const toast = useToast();
  const { auth } = useAuth();
  const role = auth?.organizations.find((o) => o.id === auth.currentOrganization?.id)?.role || 'agent';
  const canManage = role === 'workspace_owner' || role === 'workspace_admin';
  const members = useApi<{ items: Member[] }>('/workspace/members');
  const invitations = useApi<{ items: Invitation[] }>(canManage ? '/workspace/invitations' : null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('agent');
  const [issued, setIssued] = useState<{ token: string; invitation: IssuedInvitation } | null>(null);
  const [busy, setBusy] = useState(false);

  const createInvite = async () => {
    setBusy(true);
    try {
      const res = await api<{ token: string; invitation: IssuedInvitation }>('/workspace/invitations',
        { method: 'POST', body: { email, role: inviteRole } });
      setIssued(res); setEmail(''); invitations.reload();
      toast('Invitation created. Copy the link now.', 'success');
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not create the invitation.', 'error'); }
    finally { setBusy(false); }
  };

  const changeRole = async (member: Member, nextRole: string) => {
    try {
      await api(`/workspace/members/${member.id}`, { method: 'PATCH', body: { role: nextRole } });
      toast('Role updated.', 'success'); members.reload();
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not change the role.', 'error'); }
  };

  const toggleQueue = async (member: Member) => {
    try {
      await api(`/workspace/members/${member.id}`, { method: 'PATCH', body: { canViewUnassigned: !member.can_view_unassigned } });
      members.reload();
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not update access.', 'error'); }
  };

  const remove = async (member: Member) => {
    try {
      await api(`/workspace/members/${member.id}`, { method: 'DELETE' });
      toast('Member removed.', 'success'); members.reload();
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not remove the member.', 'error'); }
  };

  const revoke = async (invitation: Invitation) => {
    try {
      await api(`/workspace/invitations/${invitation.id}`, { method: 'DELETE' });
      toast('Invitation revoked.', 'success'); invitations.reload();
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not revoke.', 'error'); }
  };

  const inviteLink = issued ? `${window.location.origin}/accept/${issued.token}` : '';
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast('Link copied.', 'success'); }
    catch { toast('Copy failed — select the text and copy manually.', 'error'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h2>Team</h2><p>Roles are enforced on the server. Agents see only their assigned leads unless you grant queue access.</p></div>
        {canManage && <div className="page-actions"><button className="btn btn-primary" onClick={() => { setIssued(null); setInviteOpen(true); }}><Icon name="plus" size={15} /> Invite teammate</button></div>}
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>Members</h3><span className="small muted">{members.data?.items.length ?? '—'} people</span></div>
        {members.loading && <Spinner label="Loading members" />}
        {members.error && <div className="card-body"><ErrorNotice message={members.error} onRetry={members.reload} /></div>}
        {members.data && <div className="table-wrap"><table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Unassigned queue</th><th>Joined</th><th /></tr></thead>
          <tbody>{members.data.items.map((member) => <tr key={member.id}>
            <td><span className="cell-strong">{member.name}</span></td>
            <td className="cell-sub">{member.email}</td>
            <td>{canManage && member.role !== 'workspace_owner'
              ? <select className="select" value={member.role} onChange={(e) => void changeRole(member, e.target.value)} aria-label={`Role for ${member.name}`}>
                {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{r.replace('workspace_', '')}</option>)}
              </select>
              : <Badge tone="blue">{member.role.replace('workspace_', '')}</Badge>}</td>
            <td>{canManage
              ? <button className={`btn btn-small ${member.can_view_unassigned ? 'btn-accent' : ''}`} onClick={() => void toggleQueue(member)}>
                {member.can_view_unassigned ? 'Allowed' : 'Hidden'}</button>
              : <span className="cell-sub">{member.can_view_unassigned ? 'Allowed' : 'Hidden'}</span>}</td>
            <td className="cell-sub">{fmtDate(member.created_at)}</td>
            <td className="cell-actions">{canManage && member.role !== 'workspace_owner' &&
              <button className="btn btn-small btn-danger" onClick={() => void remove(member)} aria-label={`Remove ${member.name}`}><Icon name="trash" size={14} /></button>}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>

      {canManage && <section className="card">
        <div className="card-head"><h3>Invitations</h3><span className="small muted">Single-use · expires in 72 hours</span></div>
        {invitations.loading && <Spinner label="Loading invitations" />}
        {invitations.data && invitations.data.items.length === 0 && <Empty icon="mail" title="No invitations yet" body="Invite a teammate to give them a role in this workspace." />}
        {invitations.data && invitations.data.items.length > 0 && <div className="table-wrap"><table className="table">
          <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Expires</th><th /></tr></thead>
          <tbody>{invitations.data.items.map((i) => <tr key={i.id}>
            <td className="cell-strong">{i.email}</td><td className="cell-sub">{i.role.replace('workspace_', '')}</td>
            <td>{i.accepted_at ? <Badge tone="green">Accepted</Badge> : i.revoked_at ? <Badge tone="red">Revoked</Badge>
              : Date.parse(i.expires_at) < Date.now() ? <Badge tone="neutral">Expired</Badge> : <Badge tone="amber">Pending</Badge>}</td>
            <td className="cell-sub">{fmtDate(i.expires_at, true)}</td>
            <td className="cell-actions">{!i.accepted_at && !i.revoked_at &&
              <button className="btn btn-small" onClick={() => void revoke(i)}>Revoke</button>}</td>
          </tr>)}</tbody></table></div>}
      </section>}

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite a teammate"
        footer={issued
          ? <button className="btn btn-primary" onClick={() => setInviteOpen(false)}>Done</button>
          : <><button className="btn" onClick={() => setInviteOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => void createInvite()}>{busy ? 'Creating…' : 'Create invitation'}</button></>}>
        {issued ? (
          <>
            <div className="notice notice-success"><Icon name="check" size={17} /><span>Invitation created for {issued.invitation.email}.</span></div>
            <Field label="One-time invitation link" htmlFor="invite-link" hint="Shown once. The token is stored as a hash and cannot be retrieved later. The recipient must sign in with this exact email.">
              <input id="invite-link" className="input mono" readOnly value={inviteLink} onFocus={(e) => e.target.select()} />
            </Field>
            <button className="btn" onClick={() => void copy(inviteLink)}>
              <Icon name="copy" size={15} /> Copy link
            </button>
            <p className="hint">Expires {fmtDate(issued.invitation.expiresAt, true)}. Accepting is verified against the signed-in account email.</p>
          </>
        ) : (
          <>
            <Field label="Email address" htmlFor="inv-email"><input id="inv-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" /></Field>
            <Field label="Role" htmlFor="inv-role" hint="You cannot invite someone to a role at or above your own.">
              <select id="inv-role" className="select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{r.replace('workspace_', '')}</option>)}
              </select>
            </Field>
          </>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------ settings page */
interface CaptureForm {
  id: string; public_id: string; title: string; intro: string; consent_notice: string;
  fields: string[]; active: number; publicUrl: string;
}
interface WebhookEndpoint { id: string; name: string; active: number; created_at: string; revoked_at: string | null }
interface StageConfig { id: string; name: string; kind: string; color: string; position: number }
interface Integration { key: string; label: string; configured: boolean; state: string; reason: string }

const FIELD_OPTIONS = ['name', 'email', 'phone', 'company', 'message'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function SettingsPage() {
  const toast = useToast();
  const { auth, refresh, signOut } = useAuth();
  const role = auth?.organizations.find((o) => o.id === auth.currentOrganization?.id)?.role || 'agent';
  const isOwner = role === 'workspace_owner';
  const canConfigure = role === 'workspace_owner' || role === 'workspace_admin';
  const org = auth?.currentOrganization as Organization | undefined;

  const workspace = useApi<{ organization: Organization; role: string; counts: { leads: number; members: number; stages: number } }>('/workspace');
  const capture = useApi<{ form: CaptureForm; canConfigure: boolean }>('/capture-forms');
  const webhooks = useApi<{ items: WebhookEndpoint[] }>(canConfigure ? '/webhooks/endpoints' : null);
  const integrations = useApi<{ items: Integration[] }>('/integrations');
  const pipeline = useApi<{ columns: { stage: StageConfig }[] }>('/pipeline');
  const aiSettings = useApi<AiSettings>(canConfigure ? '/workspace/ai-settings' : null);
  const emailSettings = useApi<EmailSettings>(canConfigure ? '/workspace/email-settings' : null);

  const [ws, setWs] = useState<Record<string, string | boolean>>({});
  const [captureForm, setCaptureForm] = useState<Record<string, unknown>>({});
  const [selectedFields, setSelectedFields] = useState<string[] | null>(null);
  const [webhookName, setWebhookName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // AI local settings state
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [aiProvider, setAiProvider] = useState<string | null>(null);

  // Email local settings state
  const [emailProvider, setEmailProvider] = useState<string | null>(null);
  const [emailFromName, setEmailFromName] = useState<string | null>(null);
  const [emailFromAddress, setEmailFromAddress] = useState<string | null>(null);

  const saveAi = async () => {
    try {
      await api('/workspace/ai-settings', {
        method: 'PATCH',
        body: {
          enabled: aiEnabled ?? aiSettings.data?.enabled ?? false,
          provider: aiProvider ?? aiSettings.data?.provider ?? 'gemini',
        },
      });
      toast('AI settings saved.', 'success');
      aiSettings.reload();
      integrations.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to save AI settings', 'error');
    }
  };

  const saveEmail = async () => {
    try {
      await api('/workspace/email-settings', {
        method: 'PATCH',
        body: {
          provider: emailProvider ?? emailSettings.data?.provider ?? 'console',
          fromName: emailFromName ?? emailSettings.data?.fromName ?? 'LeadPulse CRM',
          fromEmail: emailFromAddress ?? emailSettings.data?.fromEmail ?? 'notifications@leadpulse.example',
        },
      });
      toast('Email settings saved.', 'success');
      emailSettings.reload();
      integrations.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to save Email settings', 'error');
    }
  };

  const saveWorkspace = async () => {
    setBusy(true);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ws)) {
      if (k === 'slaTargetMinutes') body[k] = Number(v);
      else if (k === 'slaBusinessHoursOnly') body[k] = Boolean(v);
      else if (k === 'workingDays') body[k] = String(v).split(',').map(Number).filter((n) => n >= 1 && n <= 7);
      else body[k] = v;
    }
    try {
      await api('/workspace', { method: 'PATCH', body });
      toast('Workspace settings saved.', 'success'); setWs({}); workspace.reload(); void refresh();
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not save settings.', 'error'); }
    finally { setBusy(false); }
  };

  const saveCapture = async () => {
    const fields = selectedFields || capture.data?.form.fields || ['name'];
    try {
      await api('/capture-forms', { method: 'PATCH', body: { ...captureForm, fields: [...new Set(['name', ...fields])] } });
      toast('Capture form updated.', 'success'); setCaptureForm({}); setSelectedFields(null); capture.reload();
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not update the form.', 'error'); }
  };

  const rotate = async () => {
    try {
      await api('/capture-forms/rotate', { method: 'POST', body: {} });
      toast('Public link rotated. The old link no longer works.', 'success'); capture.reload();
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not rotate.', 'error'); }
  };

  const createWebhook = async () => {
    if (!webhookName.trim()) { toast('Give the endpoint a name.', 'error'); return; }
    try {
      const res = await api<{ secret: string; endpoint: { id: string } }>('/webhooks/endpoints', { method: 'POST', body: { name: webhookName } });
      setSecret(res.secret); setWebhookName(''); webhooks.reload();
      toast('Endpoint created. Copy the secret now.', 'success');
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not create endpoint.', 'error'); }
  };

  const saveStages = async (next: StageConfig[]) => {
    try {
      await api('/pipeline/stages', { method: 'PATCH', body: { stages: next.map((s) => ({ id: s.id, name: s.name, kind: s.kind, color: s.color })) } });
      toast('Pipeline stages saved.', 'success'); pipeline.reload(); workspace.reload();
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not save stages.', 'error'); }
  };

  const exportWorkspace = async () => {
    try { await downloadFile('/workspace/export', `leadpulse-backup-${org?.slug || 'workspace'}.json`); toast('JSON backup downloaded.', 'success'); }
    catch (err) { toast(err instanceof ApiError ? err.message : 'Export failed.', 'error'); }
  };

  const deleteWorkspace = async () => {
    try {
      await api('/workspace', { method: 'DELETE', body: { confirmation: deleteConfirm } });
      toast('Workspace deleted.', 'success');
      await signOut();
      window.location.assign('/');
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Deletion failed.', 'error'); }
  };

  const fieldValue = (key: string, fallback: string | number | boolean) => (ws[key] !== undefined ? ws[key] : fallback) as string;

  return (
    <div className="page page-narrow">
      <div className="page-head"><div><h2>Workspace settings</h2><p>{org?.name} · {role.replace('workspace_', '')}</p></div></div>
      {!canConfigure && <div className="notice notice-info" style={{ marginBottom: 16 }}><Icon name="lock" size={17} /><span>Your role can view these settings but cannot change them.</span></div>}

      <div className="stack">
        <section className="card">
          <div className="card-head"><h3>General</h3></div>
          <div className="card-body form-grid">
            <Field label="Workspace name" htmlFor="s-name"><input id="s-name" className="input" disabled={!canConfigure}
              value={fieldValue('name', org?.name || '')} onChange={(e) => setWs((w) => ({ ...w, name: e.target.value }))} /></Field>
            <Field label="Timezone" htmlFor="s-tz" hint="IANA name; affects SLA and due-today buckets."><input id="s-tz" className="input" disabled={!canConfigure}
              value={fieldValue('timezone', org?.timezone || 'Asia/Kolkata')} onChange={(e) => setWs((w) => ({ ...w, timezone: e.target.value }))} /></Field>
            <Field label="Industry" htmlFor="s-industry"><input id="s-industry" className="input" disabled={!canConfigure}
              value={fieldValue('industry', org?.industry || '')} onChange={(e) => setWs((w) => ({ ...w, industry: e.target.value }))} /></Field>
            <Field label="Currency" htmlFor="s-currency"><input id="s-currency" className="input" disabled={!canConfigure}
              value={fieldValue('currency', org?.currency || 'INR')} onChange={(e) => setWs((w) => ({ ...w, currency: e.target.value }))} /></Field>
            <Field label="Working hours start" htmlFor="s-start"><input id="s-start" className="input" type="time" disabled={!canConfigure}
              value={fieldValue('workingHoursStart', org?.working_hours_start || '09:00')} onChange={(e) => setWs((w) => ({ ...w, workingHoursStart: e.target.value }))} /></Field>
            <Field label="Working hours end" htmlFor="s-end"><input id="s-end" className="input" type="time" disabled={!canConfigure}
              value={fieldValue('workingHoursEnd', org?.working_hours_end || '18:00')} onChange={(e) => setWs((w) => ({ ...w, workingHoursEnd: e.target.value }))} /></Field>
            <Field label="SLA target (minutes)" htmlFor="s-sla"><input id="s-sla" className="input" type="number" min="1" disabled={!canConfigure}
              value={fieldValue('slaTargetMinutes', org?.sla_target_minutes || 60)} onChange={(e) => setWs((w) => ({ ...w, slaTargetMinutes: e.target.value }))} /></Field>
            <Field label="Response clock" htmlFor="s-clock">
              <select id="s-clock" className="select" disabled={!canConfigure}
                value={String(ws.slaBusinessHoursOnly ?? Boolean(org?.sla_business_hours_only))}
                onChange={(e) => setWs((w) => ({ ...w, slaBusinessHoursOnly: e.target.value === 'true' }))}>
                <option value="false">Wall-clock (elapsed real time)</option>
                <option value="true">Business hours only</option>
              </select>
            </Field>
            <div className="full"><Field label="Working days" hint="Used only when the business-hours clock is enabled.">
              <div className="row">{DAYS.map((d, i) => {
                const current = String(org?.working_days || '1,2,3,4,5').split(',').map(Number);
                const selected = ws.workingDays ? String(ws.workingDays).split(',').map(Number) : current;
                const has = selected.includes(i + 1);
                return <button key={d} className={`btn btn-small ${has ? 'btn-accent' : ''}`} disabled={!canConfigure}
                  onClick={() => {
                    const next = has ? selected.filter((x) => x !== i + 1) : [...selected, i + 1];
                    setWs((w) => ({ ...w, workingDays: next.sort().join(',') }));
                  }}>{d}</button>;
              })}</div>
            </Field></div>
            <div className="full"><button className="btn btn-primary" disabled={!canConfigure || busy || Object.keys(ws).length === 0} onClick={() => void saveWorkspace()}>
              {busy ? 'Saving…' : 'Save workspace settings'}</button></div>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h3>Pipeline stages</h3><span className="small muted">Order, names and won/lost classification</span></div>
          <div className="card-body">
            {pipeline.loading && <Spinner label="Loading stages" />}
            {pipeline.data && <div className="stack" style={{ gap: 8 }}>
              {pipeline.data.columns.map((col, index) => <StageRow key={col.stage.id} stage={col.stage} index={index}
                disabled={!canConfigure} onChange={(patch) => {
                  const next = pipeline.data!.columns.map((c) => ({ ...c.stage }));
                  next[index] = { ...next[index], ...patch };
                  void saveStages(next);
                }} />)}
              <p className="hint">Changes save immediately. Existing leads keep their stage; removing stages is not supported because stage history must stay intact.</p>
            </div>}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h3>Public capture form</h3><Badge tone={capture.data?.form.active ? 'green' : 'neutral'}>{capture.data?.form.active ? 'Active' : 'Inactive'}</Badge></div>
          <div className="card-body stack" style={{ gap: 14 }}>
            <Field label="Public link" htmlFor="s-public" hint="Share this link to collect enquiries into this workspace. It exposes no lead data or internal IDs.">
              <div className="row"><input id="s-public" className="input mono" readOnly value={capture.data?.form.publicUrl || ''} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
                <button className="btn" aria-label="Copy capture form link" title="Copy capture form link" onClick={() => { void navigator.clipboard.writeText(capture.data?.form.publicUrl || ''); toast('Link copied.', 'success'); }}><Icon name="copy" size={15} /></button>
                <a className="btn" href={capture.data?.form.publicUrl || '#'} target="_blank" rel="noreferrer">Open</a></div>
            </Field>
            {/* Keyed on the loaded form id so async data replaces the initial empty value. */}
            <Field label="Title" htmlFor="s-title"><input id="s-title" key={`title-${capture.data?.form.id || 'loading'}`} className="input" disabled={!canConfigure}
              defaultValue={capture.data?.form.title || ''} onChange={(e) => setCaptureForm((f) => ({ ...f, title: e.target.value }))} /></Field>
            <Field label="Intro text" htmlFor="s-intro"><textarea id="s-intro" key={`intro-${capture.data?.form.id || 'loading'}`} className="textarea" disabled={!canConfigure}
              defaultValue={capture.data?.form.intro || ''} onChange={(e) => setCaptureForm((f) => ({ ...f, intro: e.target.value }))} /></Field>
            <Field label="Consent notice" htmlFor="s-consent"><input id="s-consent" key={`consent-${capture.data?.form.id || 'loading'}`} className="input" disabled={!canConfigure}
              defaultValue={capture.data?.form.consent_notice || ''} onChange={(e) => setCaptureForm((f) => ({ ...f, consentNotice: e.target.value }))} /></Field>
            <Field label="Fields shown" hint="The form always requires a name. At least one contact field is recommended.">
              <div className="row">{FIELD_OPTIONS.map((f) => {
                const current = selectedFields || capture.data?.form.fields || ['name'];
                return <label key={f} className="checkbox-row" style={{ border: '1px solid var(--line)', padding: '6px 10px', borderRadius: 5 }}>
                  <input type="checkbox" disabled={!canConfigure || f === 'name'} checked={f === 'name' || current.includes(f)}
                    onChange={(e) => {
                      const next = new Set(current);
                      if (e.target.checked) next.add(f); else next.delete(f);
                      next.add('name');
                      setSelectedFields([...next]);
                    }} /> {f}</label>;
              })}</div>
            </Field>
            <div className="row">
              <button className="btn btn-primary" disabled={!canConfigure || Object.keys(captureForm).length === 0} onClick={() => void saveCapture()}>Save form</button>
              <button className="btn" disabled={!canConfigure} onClick={() => void rotate()}><Icon name="refresh" size={15} /> Rotate public link</button>
            </div>
          </div>
        </section>

        {canConfigure && <section className="card">
          <div className="card-head"><h3>Inbound webhooks</h3><span className="small muted">HMAC-SHA256 signed</span></div>
          <div className="card-body">
            <p className="small muted" style={{ marginBottom: 12 }}>
              Sign the exact raw body as <code className="mono">HMAC_SHA256(secret, timestamp + "." + body)</code> and send
              <code className="mono"> X-LeadPulse-Timestamp</code>, <code className="mono">X-LeadPulse-Signature</code> and a unique <code className="mono">X-LeadPulse-Event-Id</code>.
              Requests older than 5 minutes are rejected; repeated event ids are idempotent.
            </p>
            {secret && <div className="notice notice-success" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
              <Icon name="lock" size={17} /><span>New secret (shown once): <code className="mono">{secret}</code></span>
              <button className="btn btn-small" onClick={() => { void navigator.clipboard.writeText(secret); toast('Secret copied.', 'success'); }}>Copy</button>
              <button className="btn btn-small" onClick={() => setSecret(null)}>Dismiss</button>
            </div>}
            <div className="row" style={{ marginBottom: 14 }}>
              <input className="input" aria-label="Endpoint name" placeholder="e.g. Landing page A" value={webhookName} onChange={(e) => setWebhookName(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
              <button className="btn btn-primary" onClick={() => void createWebhook()}><Icon name="plus" size={15} /> Create endpoint</button>
            </div>
            {webhooks.data?.items.length === 0 && <p className="small muted">No endpoints yet.</p>}
            {webhooks.data && webhooks.data.items.length > 0 && <div className="table-wrap"><table className="table">
              <thead><tr><th>Name</th><th>Endpoint id</th><th>Status</th><th /></tr></thead>
              <tbody>{webhooks.data.items.map((w) => <tr key={w.id}>
                <td className="cell-strong">{w.name}</td><td className="mono">{w.id}</td>
                <td>{w.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Revoked</Badge>}</td>
                <td className="cell-actions">{w.active && <button className="btn btn-small btn-danger" onClick={() => void (async () => {
                  try { await api(`/webhooks/endpoints/${w.id}`, { method: 'DELETE' }); toast('Endpoint revoked.', 'success'); webhooks.reload(); }
                  catch (err) { toast(err instanceof ApiError ? err.message : 'Could not revoke.', 'error'); }
                })()}>Revoke</button>}</td>
              </tr>)}</tbody></table></div>}
          </div>
        </section>}

        {canConfigure && (
          <>
            <section className="card">
              <div className="card-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3>Speed-to-Lead AI Settings</h3>
                  <Badge tone={aiSettings.data?.enabled ? 'amber' : 'neutral'}>
                    {aiSettings.data?.enabled ? 'Opted In' : 'Disabled'}
                  </Badge>
                </div>
              </div>
              <div className="card-body stack" style={{ gap: 14 }}>
                <p className="small muted">
                  AI features generate 3-bullet instant lead briefs and personalized first-response drafts.
                  Strictly opt-in: no lead data is transmitted without explicit workspace enablement.
                </p>

                <div className="row" style={{ alignItems: 'center', gap: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 500 }}>
                    <input
                      type="checkbox"
                      checked={aiEnabled ?? aiSettings.data?.enabled ?? false}
                      onChange={(e) => setAiEnabled(e.target.checked)}
                    />
                    <span>Enable AI assistance for this workspace</span>
                  </label>
                </div>

                <div className="grid-2" style={{ gap: 12 }}>
                  <Field label="AI Model Provider" htmlFor="ai-prov">
                    <select
                      id="ai-prov"
                      className="select"
                      value={aiProvider ?? aiSettings.data?.provider ?? 'gemini'}
                      onChange={(e) => setAiProvider(e.target.value)}
                    >
                      <option value="gemini">Google Gemini 2.5 Flash</option>
                      <option value="groq">Groq (Llama / GPT-OSS)</option>
                    </select>
                  </Field>
                </div>

                <div className="row">
                  <button className="btn btn-primary" onClick={() => void saveAi()}>
                    Save AI settings
                  </button>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3>Transactional Email Settings</h3>
                  <Badge tone={emailSettings.data?.provider === 'resend' ? 'green' : 'blue'}>
                    {emailSettings.data?.provider || 'Console'}
                  </Badge>
                </div>
              </div>
              <div className="card-body stack" style={{ gap: 14 }}>
                <p className="small muted">
                  Configure outgoing notification, invitation, and password-reset email transport.
                </p>

                <div className="grid-3" style={{ gap: 12 }}>
                  <Field label="Transport provider" htmlFor="em-prov">
                    <select
                      id="em-prov"
                      className="select"
                      value={emailProvider ?? emailSettings.data?.provider ?? 'console'}
                      onChange={(e) => setEmailProvider(e.target.value)}
                    >
                      <option value="console">Console (Zero-cost Dev/Test)</option>
                      <option value="resend">Resend HTTP API</option>
                      <option value="smtp">Standard SMTP</option>
                    </select>
                  </Field>
                  <Field label="Sender name" htmlFor="em-from-name">
                    <input
                      id="em-from-name"
                      className="input"
                      value={emailFromName ?? emailSettings.data?.fromName ?? 'LeadPulse CRM'}
                      onChange={(e) => setEmailFromName(e.target.value)}
                    />
                  </Field>
                  <Field label="Sender address" htmlFor="em-from-email">
                    <input
                      id="em-from-email"
                      className="input"
                      type="email"
                      value={emailFromAddress ?? emailSettings.data?.fromEmail ?? 'notifications@leadpulse.example'}
                      onChange={(e) => setEmailFromAddress(e.target.value)}
                    />
                  </Field>
                </div>

                <div className="row">
                  <button className="btn btn-primary" onClick={() => void saveEmail()}>
                    Save email settings
                  </button>
                </div>
              </div>
            </section>
          </>
        )}

        <section className="card">
          <div className="card-head"><h3>Integrations</h3></div>
          <div className="card-body">
            {integrations.data?.items.map((i) => <div className="row-between" key={i.key} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div><strong>{i.label}</strong><div className="cell-sub">{i.reason}</div></div>
              <Badge tone={i.configured ? 'green' : 'neutral'}>{i.configured ? 'Configured' : 'Disabled'}</Badge>
            </div>)}
            <p className="hint" style={{ marginTop: 10 }}>All optional providers are behind adapters. The core product works with every one of them disabled.</p>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h3>Data ownership</h3></div>
          <div className="card-body stack" style={{ gap: 12 }}>
            <p className="small muted">Download a full JSON backup before any destructive action. CSV export respects your role and active filters.</p>
            <div className="row"><button className="btn" disabled={!canConfigure} onClick={() => void exportWorkspace()}><Icon name="download" size={15} /> Download workspace backup</button></div>
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              <h3 style={{ color: 'var(--danger)', marginBottom: 6 }}>Delete workspace</h3>
              <p className="small muted">Permanently removes all leads, activities, tasks, members and audit records. This cannot be undone from the application.</p>
              <button className="btn btn-danger" style={{ marginTop: 10 }} disabled={!isOwner} onClick={() => setDeleteOpen(true)}>
                <Icon name="trash" size={15} /> Delete workspace
              </button>
              {!isOwner && <p className="hint" style={{ marginTop: 8 }}>Only the workspace owner can delete it.</p>}
            </div>
          </div>
        </section>
      </div>

      <Modal open={deleteOpen} title="Delete this workspace?" onClose={() => setDeleteOpen(false)}
        footer={<><button className="btn" onClick={() => setDeleteOpen(false)}>Cancel</button>
          <button className="btn btn-danger" disabled={deleteConfirm !== org?.slug} onClick={() => void deleteWorkspace()}>Permanently delete</button></>}>
        <p>This removes every record in <strong>{org?.name}</strong>. Download a backup first.</p>
        <Field label={`Type "${org?.slug || ''}" to confirm`} htmlFor="s-delete">
          <input id="s-delete" className="input" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}

function StageRow({ stage, index, disabled, onChange }: {
  stage: StageConfig; index: number; disabled: boolean;
  onChange: (patch: Partial<StageConfig>) => void;
}) {
  const [name, setName] = useState(stage.name);
  return (
    <div className="row" style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6 }}>
      <span className="mono muted" style={{ width: 24 }}>{index + 1}</span>
      <span className="kanban-dot" style={{ background: stage.color }} />
      <input className="input" aria-label={`Stage ${index + 1} name`} value={name} disabled={disabled}
        onChange={(e) => setName(e.target.value)} onBlur={() => { if (name !== stage.name) onChange({ name }); }} style={{ flex: 1, minHeight: 32 }} />
      <select className="select" aria-label={`Stage ${index + 1} type`} value={stage.kind} disabled={disabled}
        onChange={(e) => onChange({ kind: e.target.value })} style={{ width: 130, minHeight: 32 }}>
        <option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option>
      </select>
      <input className="input" type="color" aria-label={`Stage ${index + 1} colour`} value={stage.color} disabled={disabled}
        onChange={(e) => onChange({ color: e.target.value })} style={{ width: 48, height: 32, padding: 2 }} />
    </div>
  );
}
