import { beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

let app: any;
let run: any;
let one: any;
let all: any;

interface Reply { status: number; body: any; headers: Headers; text: string }

function client(ip: string) {
  const jar = new Map<string, string>();
  let csrf = '';
  const request = async (method: string, url: string, body?: unknown, extra: Record<string, string> = {}): Promise<Reply> => {
    const headers: Record<string, string> = { 'X-Forwarded-For': ip, ...extra };
    if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf && !['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = csrf;
    const res = await app.request(`http://localhost${url}`, {
      method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    const setCookies: string[] = typeof (res.headers as any).getSetCookie === 'function'
      ? (res.headers as any).getSetCookie() : [];
    for (const raw of setCookies) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' || /^Max-Age=0/i.test(raw)) jar.delete(name); else jar.set(name, value);
    }
    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* csv / plain text */ }
    if (parsed?.data?.csrfToken) csrf = parsed.data.csrfToken;
    return { status: res.status, body: parsed, headers: res.headers, text };
  };
  return { request, getCsrf: () => csrf, setCsrf: (v: string) => { csrf = v; } };
}

const unique = () => crypto.randomBytes(5).toString('hex');

async function signup(name: string, ip: string) {
  const c = client(ip);
  const email = `${name}-${unique()}@example.org`;
  const res = await c.request('POST', '/api/v1/auth/signup', {
    name, email, password: 'test-password-123', workspaceName: `${name} Workspace`,
  });
  if (res.status !== 201) throw new Error(`signup failed ${res.status}: ${res.text}`);
  return { c, email, org: res.body.data.currentOrganization, user: res.body.data.user };
}

beforeAll(async () => {
  // Keep generated databases and the webhook key OUT of the project directory.
  const dir = path.join(os.tmpdir(), `leadpulse-test-${process.pid}-${Date.now()}`);
  process.env.DATA_DIR = dir;
  process.env.DB_FILE = path.join(dir, 'test.db');
  process.env.ALLOW_DEMO = 'false';
  const db = await import('../server/db.js');
  await db.initDb();
  const ctx = await import('../server/context.js');
  run = ctx.run; one = ctx.one; all = ctx.all;
  const mod = await import('../server/app.js');
  app = mod.createApp();
});

describe('platform health and security headers', () => {
  it('reports database driver and migration state', async () => {
    const r = await client('10.0.0.1').request('GET', '/api/v1/health');
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('ok');
    expect(r.body.data.database.migrations).toContain(1);
    expect(r.text).not.toMatch(/password|secret|token_hash/i);
  });

  it('sets security headers and a request id', async () => {
    const r = await client('10.0.0.2').request('GET', '/api/v1/health');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(r.headers.get('x-request-id')).toBeTruthy();
  });

  it('exports a complete workspace backup without leaking other tenants', async () => {
    const a = await signup('BackupA', '10.0.5.1');
    const b = await signup('BackupB', '10.0.5.2');
    await a.c.request('POST', '/api/v1/leads', { name: 'Backup Lead A', email: 'backup-a@example.org' });
    await b.c.request('POST', '/api/v1/leads', { name: 'Backup Lead B', email: 'backup-b@example.org' });
    const backup = await a.c.request('GET', '/api/v1/workspace/export');
    expect(backup.status).toBe(200);
    expect(backup.body.data.tables.organizations).toHaveLength(1);
    expect(backup.body.data.tables.leads).toHaveLength(1);
    expect(backup.text).toContain('Backup Lead A');
    expect(backup.text).not.toContain('Backup Lead B');
  });

  it('rejects protected API access without a session', async () => {
    const r = await client('10.0.0.3').request('GET', '/api/v1/leads');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects mutating requests without a CSRF token', async () => {
    const { c } = await signup('CsrfUser', '10.0.0.4');
    c.setCsrf(''); // clear the token the client normally sends automatically
    const r = await c.request('POST', '/api/v1/leads', { name: 'No Token', email: 'no-token@example.org' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CSRF_FAILED');
  });
});

describe('authentication and tenant isolation', () => {
  it('creates a workspace with default stages on signup', async () => {
    const { c, org } = await signup('OwnerA', '10.1.0.1');
    const r = await c.request('GET', '/api/v1/workspace');
    expect(r.status).toBe(200);
    expect(r.body.data.organization.id).toBe(org.id);
    expect(r.body.data.counts.stages).toBe(6);
  });

  it('rejects invalid credentials uniformly', async () => {
    const { email } = await signup('LoginUser', '10.1.0.2');
    const c = client('10.1.0.3');
    const wrong = await c.request('POST', '/api/v1/auth/login', { email, password: 'wrong-password' });
    const unknown = await c.request('POST', '/api/v1/auth/login', { email: 'nobody@example.org', password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe(unknown.body.error.code);
  });

  it('blocks user B from reading, listing or exporting user A data', async () => {
    const a = await signup('TenantA', '10.1.1.1');
    const b = await signup('TenantB', '10.1.1.2');
    const created = await a.c.request('POST', '/api/v1/leads', {
      name: 'Private Lead', email: 'private@example.org', phone: '+15550000001', company: 'Secret Co',
    });
    expect(created.status).toBe(201);
    const leadId = created.body.data.lead.id;

    const detail = await b.c.request('GET', `/api/v1/leads/${leadId}`);
    expect(detail.status).toBe(404);
    const list = await b.c.request('GET', '/api/v1/leads');
    expect(list.body.data.items.some((l: any) => l.id === leadId)).toBe(false);
    const exported = await b.c.request('GET', '/api/v1/leads/export');
    expect(exported.status).toBe(200);
    expect(exported.text).not.toContain('Private Lead');
    const audit = await b.c.request('GET', `/api/v1/leads/${leadId}/activities`);
    expect(audit.status).toBe(404);
  });

  it('cannot switch into a workspace the user is not a member of', async () => {
    const a = await signup('SwitchA', '10.1.2.1');
    const b = await signup('SwitchB', '10.1.2.2');
    const r = await a.c.request('POST', '/api/v1/auth/switch', { organizationId: b.org.id });
    expect(r.status).toBe(403);
  });
});

describe('roles, invitations and permissions', () => {
  it('invitation is single-use, expiring, email-bound and cannot escalate', async () => {
    const owner = await signup('InviteOwner', '10.2.0.1');
    const invitedEmail = `invitee-${unique()}@example.org`;
    const invite = await owner.c.request('POST', '/api/v1/workspace/invitations', { email: invitedEmail, role: 'agent' });
    expect(invite.status).toBe(201);
    expect(invite.body.data.token).toBeTruthy();
    const token = invite.body.data.token;

    // A different account cannot accept it.
    const stranger = await signup('Stranger', '10.2.0.2');
    const mismatch = await stranger.c.request('POST', `/api/v1/invitations/${token}/accept`, {});
    expect(mismatch.status).toBe(403);

    const invited = client('10.2.0.3');
    const reg = await invited.request('POST', '/api/v1/auth/signup', {
      name: 'Invitee', email: invitedEmail, password: 'test-password-123', workspaceName: 'Invitee Own Workspace',
    });
    expect(reg.status).toBe(201);
    const accepted = await invited.request('POST', `/api/v1/invitations/${token}/accept`, {});
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.role).toBe('agent');

    // Second use fails.
    const again = await invited.request('POST', `/api/v1/invitations/${token}/accept`, {});
    expect(again.status).toBe(410);

    // Agent cannot change workspace settings or export all leads.
    const settings = await invited.request('PATCH', '/api/v1/workspace', { name: 'Hijacked' });
    expect(settings.status).toBe(403);
    const exportAll = await invited.request('GET', '/api/v1/leads/export');
    expect(exportAll.status).toBe(403);

    // Expired invitation is rejected.
    const invite2 = await owner.c.request('POST', '/api/v1/workspace/invitations',
      { email: `expired-${unique()}@example.org`, role: 'agent' });
    run('UPDATE invitations SET expires_at = ? WHERE id = ?', ['2000-01-01T00:00:00.000Z', invite2.body.data.invitation.id]);
    const expired = await stranger.c.request('POST', `/api/v1/invitations/${invite2.body.data.token}/accept`, {});
    expect(expired.status).toBe(410);

    // An admin cannot invite another admin (role escalation).
    const adminEmail = `admin-${unique()}@example.org`;
    const adminInvite = await owner.c.request('POST', '/api/v1/workspace/invitations', { email: adminEmail, role: 'workspace_admin' });
    expect(adminInvite.status).toBe(201);
    const adminReg = client('10.2.0.4');
    await adminReg.request('POST', '/api/v1/auth/signup', { name: 'Admin', email: adminEmail, password: 'test-password-123', workspaceName: 'Admin WS' });
    await adminReg.request('POST', `/api/v1/invitations/${adminInvite.body.data.token}/accept`, {});
    const escalate = await adminReg.request('POST', '/api/v1/workspace/invitations',
      { email: `nope-${unique()}@example.org`, role: 'workspace_admin' });
    expect(escalate.status).toBe(403);
    expect(escalate.body.error.code).toBe('ROLE_ESCALATION');
  });

  it('agent only sees assigned leads and the unassigned queue when permitted', async () => {
    const owner = await signup('ScopeOwner', '10.2.1.1');
    const email = `agent-${unique()}@example.org`;
    const inv = await owner.c.request('POST', '/api/v1/workspace/invitations', { email, role: 'agent' });
    const agentClient = client('10.2.1.2');
    await agentClient.request('POST', '/api/v1/auth/signup', { name: 'Agent', email, password: 'test-password-123', workspaceName: 'Agent WS' });
    await agentClient.request('POST', `/api/v1/invitations/${inv.body.data.token}/accept`, {});
    const agentId = (await one('SELECT id FROM users WHERE email = ?', [email])).id;
    run('UPDATE memberships SET can_view_unassigned = 1 WHERE organization_id = ? AND user_id = ?', [owner.org.id, agentId]);

    const mine = await owner.c.request('POST', '/api/v1/leads', { name: 'Mine', email: 'mine@example.org', ownerId: agentId });
    const unassigned = await owner.c.request('POST', '/api/v1/leads', { name: 'Unassigned', email: 'unassigned@example.org' });
    const others = await owner.c.request('POST', '/api/v1/leads', {
      name: 'Owned By Someone Else', email: 'others@example.org', ownerId: owner.user.id,
    });
    const visible = await agentClient.request('GET', '/api/v1/leads');
    expect(visible.body.data.items.some((l: any) => l.id === mine.body.data.lead.id)).toBe(true);
    // Unassigned queue is explicitly permitted on this membership.
    expect(visible.body.data.items.some((l: any) => l.id === unassigned.body.data.lead.id)).toBe(true);
    expect(visible.body.data.items.some((l: any) => l.id === others.body.data.lead.id)).toBe(false);
    const forbidden = await agentClient.request('GET', `/api/v1/leads/${others.body.data.lead.id}`);
    expect(forbidden.status).toBe(403);
  });
});

describe('lead lifecycle, pipeline and duplicates', () => {
  it('persists create, update, archive, restore and stage history', async () => {
    const { c } = await signup('Lifecycle', '10.3.0.1');
    const created = await c.request('POST', '/api/v1/leads', {
      name: 'Lifecycle Lead', email: 'life@example.org', phone: '+15550000123',
      company: 'Example Ltd', priority: 'high', tags: ['hot'], amount: 12500,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.lead.id;

    const updated = await c.request('PATCH', `/api/v1/leads/${id}`, { name: 'Lifecycle Lead II', notes: 'Updated note' });
    expect(updated.body.data.lead.name).toBe('Lifecycle Lead II');

    const stages = (await c.request('GET', '/api/v1/leads')).body.data.facets.stages;
    const qualified = stages.find((s: any) => s.name === 'Qualified');
    const transition = await c.request('POST', `/api/v1/leads/${id}/transition`, { stageId: qualified.id, reason: 'Budget confirmed' });
    expect(transition.status).toBe(200);
    expect(transition.body.data.lead.stage_name).toBe('Qualified');

    const detail = await c.request('GET', `/api/v1/leads/${id}`);
    expect(detail.body.data.stageEvents.length).toBeGreaterThanOrEqual(2);
    expect(detail.body.data.activities.some((a: any) => a.type === 'system')).toBe(true);
    expect(detail.body.data.lead.tags).toContain('hot');

    expect((await c.request('POST', `/api/v1/leads/${id}/archive`, {})).status).toBe(200);
    expect((await c.request('GET', '/api/v1/leads')).body.data.items.some((l: any) => l.id === id)).toBe(false);
    expect((await c.request('POST', `/api/v1/leads/${id}/restore`, {})).status).toBe(200);
    expect((await c.request('GET', '/api/v1/leads')).body.data.items.some((l: any) => l.id === id)).toBe(true);
  });

  it('records first human response exactly once', async () => {
    const { c } = await signup('Response', '10.3.1.1');
    const created = await c.request('POST', '/api/v1/leads', { name: 'Response Lead', email: 'resp@example.org' });
    const id = created.body.data.lead.id;
    await c.request('POST', `/api/v1/leads/${id}/activities`, { type: 'note', body: 'Internal note only' });
    let lead = (await c.request('GET', `/api/v1/leads/${id}`)).body.data.lead;
    expect(lead.first_response_at).toBeNull();
    await c.request('POST', `/api/v1/leads/${id}/activities`, { type: 'call', body: 'Logged an outbound call' });
    const first = (await c.request('GET', `/api/v1/leads/${id}`)).body.data.lead.first_response_at;
    expect(first).toBeTruthy();
    await c.request('POST', `/api/v1/leads/${id}/activities`, { type: 'email', body: 'Logged a follow-up' });
    lead = (await c.request('GET', `/api/v1/leads/${id}`)).body.data.lead;
    expect(lead.first_response_at).toBe(first);
  });

  it('proposes duplicates but never merges without explicit confirmation', async () => {
    const { c } = await signup('Duplicates', '10.3.2.1');
    const a = await c.request('POST', '/api/v1/leads', { name: 'Same Person', email: 'same@example.org', company: 'Example Co' });
    const b = await c.request('POST', '/api/v1/leads', { name: 'Same Person', email: 'same@example.org', company: 'Example Co' });
    const idA = a.body.data.lead.id; const idB = b.body.data.lead.id;
    const candidates = await c.request('GET', `/api/v1/leads/${idA}/duplicates`);
    expect(candidates.body.data.items.some((x: any) => x.id === idB)).toBe(true);
    expect((await c.request('GET', '/api/v1/leads')).body.data.total).toBe(2);
    const merged = await c.request('POST', `/api/v1/leads/${idA}/merge`, { sourceLeadId: idB });
    expect(merged.status).toBe(200);
    const detail = await c.request('GET', `/api/v1/leads/${idA}`);
    expect(detail.body.data.activities.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects an impossible stage transition', async () => {
    const { c } = await signup('Stages', '10.3.3.1');
    const created = await c.request('POST', '/api/v1/leads', { name: 'Stage Lead', email: 'stage@example.org' });
    const stages = (await c.request('GET', '/api/v1/leads')).body.data.facets.stages;
    const won = stages.find((s: any) => s.kind === 'won');
    const lost = stages.find((s: any) => s.kind === 'lost');
    const id = created.body.data.lead.id;
    expect((await c.request('POST', `/api/v1/leads/${id}/transition`, { stageId: won.id })).status).toBe(200);
    const invalid = await c.request('POST', `/api/v1/leads/${id}/transition`, { stageId: lost.id });
    expect(invalid.status).toBe(409);
    expect(invalid.body.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('CSV safety, public capture and webhooks', () => {
  it('neutralises spreadsheet formulas on export and handles malformed CSV', async () => {
    const { c, org } = await signup('CsvUser', '10.4.0.1');
    await c.request('POST', '/api/v1/leads', {
      name: '=HYPERLINK("http://evil.example","click")', email: 'formula@example.org', notes: '+SUM(1+1)',
    });
    const exported = await c.request('GET', '/api/v1/leads/export');
    expect(exported.status).toBe(200);
    // The cell is prefixed with an apostrophe so spreadsheet apps treat it as text;
    // no field may BEGIN with an unquoted formula.
    expect(exported.text).toContain("\"'=HYPERLINK");
    expect(exported.text).not.toMatch(/(^|,|\r\n)=HYPERLINK/);

    // Under the 2 MB byte cap but above the 5000-row cap: bounded, not a crash.
    const manyRows = 'a,b\n' + 'x,y\n'.repeat(6000);
    const bounded = await c.request('POST', '/api/v1/imports/preview', {
      csv: manyRows, idempotencyKey: `bounded-${unique()}`,
    });
    expect(bounded.status).toBe(201);
    expect(bounded.body.data.job.summary.truncated).toBe(true);
    expect(bounded.body.data.job.summary.parserErrors.join(' ')).toMatch(/truncated/i);

    // Above the byte cap: rejected before parsing.
    const oversized = 'a,b\n' + 'x,y\n'.repeat(600000); // ~2.4 MB, above the 2 MB cap
    const tooBig = await c.request('POST', '/api/v1/imports/preview', {
      csv: oversized, idempotencyKey: `oversized-${unique()}`,
    });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.code).toBe('VALIDATION_ERROR');

    const malformed = await c.request('POST', '/api/v1/imports/preview', {
      csv: 'name,email\n"Unterminated,field@example.org\n', idempotencyKey: `malformed-${unique()}`,
    });
    expect([201, 400]).toContain(malformed.status);
    if (malformed.status === 201) {
      expect(malformed.body.data.job.summary.parserErrors.join(' ')).toMatch(/unterminated/i);
    }
  });

  it('imports a preview idempotently and only after explicit confirmation', async () => {
    const { c } = await signup('ImportUser', '10.4.1.1');
    const key = `import-${unique()}`;
    const preview = await c.request('POST', '/api/v1/imports/preview', {
      filename: 'leads.csv', idempotencyKey: key,
      csv: 'name,email,phone,company\nAlpha One,alpha@example.org,+15550001111,Alpha Co\nBeta Two,beta@example.org,+15550002222,Beta Co',
    });
    expect(preview.status).toBe(201);
    expect(preview.body.data.job.summary.validRows).toBe(2);
    const jobId = preview.body.data.job.id;
    const repeat = await c.request('POST', '/api/v1/imports/preview', {
      filename: 'leads.csv', idempotencyKey: key,
      csv: 'name,email,phone,company\nAlpha One,alpha@example.org,+15550001111,Alpha Co\nBeta Two,beta@example.org,+15550002222,Beta Co',
    });
    expect(repeat.body.data.idempotent).toBe(true);
    expect(repeat.body.data.job.id).toBe(jobId);
    const noConfirm = await c.request('POST', `/api/v1/imports/${jobId}/commit`, { confirm: false });
    expect(noConfirm.status).toBe(400);
    const committed = await c.request('POST', `/api/v1/imports/${jobId}/commit`, { confirm: true });
    expect(committed.status).toBe(200);
    expect(committed.body.data.summary.committedRows).toBe(2);
    const again = await c.request('POST', `/api/v1/imports/${jobId}/commit`, { confirm: true });
    expect(again.body.data.alreadyCommitted).toBe(true);
    expect(again.body.data.summary.committedRows).toBe(2);
    const list = await c.request('GET', '/api/v1/leads');
    expect(list.body.data.total).toBe(2);
  });

  it('public form creates a lead only in its own workspace, blocks bots and rate-limits', async () => {
    const { c, org } = await signup('CaptureOwner', '10.4.2.1');
    const form = await c.request('GET', '/api/v1/capture-forms');
    expect(form.status).toBe(200);
    expect(form.body.data.form.public_id).toBeTruthy();
    const publicId = form.body.data.form.public_id;

    const config = await client('10.4.2.9').request('GET', `/api/v1/public/forms/${publicId}`);
    expect(config.status).toBe(200);
    expect(config.text).not.toContain(org.id);
    expect(config.text).not.toContain('owner');

    const bot = await client('10.4.2.10').request('POST', `/api/v1/public/forms/${publicId}`, {
      name: 'Bot', email: 'bot@example.org', consent: true, website: 'http://spam.example',
    });
    expect(bot.status).toBe(400);

    for (let i = 0; i < 5; i += 1) {
      const r = await client('10.4.2.11').request('POST', `/api/v1/public/forms/${publicId}`, {
        name: `Form Lead ${i}`, email: `form${i}@example.org`, consent: true,
      });
      expect(r.status).toBe(201);
    }
    const limited = await client('10.4.2.11').request('POST', `/api/v1/public/forms/${publicId}`, {
      name: 'Sixth', email: 'sixth@example.org', consent: true,
    });
    expect(limited.status).toBe(429);

    const leads = await c.request('GET', '/api/v1/leads');
    expect(leads.body.data.total).toBe(5);
    expect(leads.body.data.items.every((l: any) => l.source_name === 'Website form')).toBe(true);
  });

  it('webhook verifies HMAC, rejects replay and is idempotent per event id', async () => {
    const { c } = await signup('WebhookOwner', '10.4.3.1');
    const created = await c.request('POST', '/api/v1/webhooks/endpoints', { name: 'Landing page' });
    expect(created.status).toBe(201);
    const endpointId = created.body.data.endpoint.id;
    const secret = created.body.data.secret;
    const pathUrl = `/api/v1/webhooks/inbound/${endpointId}`;
    const eventId = `evt_${unique()}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = JSON.stringify({ name: 'Webhook Lead', email: 'hook@example.org', phone: '+15550003333' });
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
    const headers = {
      'Content-Type': 'application/json',
      'X-LeadPulse-Timestamp': timestamp,
      'X-LeadPulse-Event-Id': eventId,
      'X-LeadPulse-Signature': signature,
    };
    const bad = await client('10.4.3.2').request('POST', pathUrl, payload, { ...headers, 'X-LeadPulse-Signature': 'deadbeef' });
    expect(bad.status).toBe(401);
    const old = await client('10.4.3.3').request('POST', pathUrl, payload,
      { ...headers, 'X-LeadPulse-Timestamp': String(Math.floor(Date.now() / 1000) - 3600) });
    expect(old.status).toBe(401);
    expect(old.body.error.code).toBe('REPLAY_REJECTED');

    const accepted = await client('10.4.3.4').request('POST', pathUrl, payload, headers);
    expect(accepted.status).toBe(201);
    const duplicate = await client('10.4.3.5').request('POST', pathUrl, payload, headers);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.duplicate).toBe(true);
    const list = await c.request('GET', '/api/v1/leads');
    expect(list.body.data.total).toBe(1);
    expect(list.body.data.items[0].source_name).toBe('Webhook');
  });
});

describe('reporting accuracy', () => {
  it('derives dashboard figures from persisted records only', async () => {
    const { c } = await signup('ReportsOwner', '10.5.0.1');
    const empty = await c.request('GET', '/api/v1/reports/summary');
    expect(empty.body.data.metrics.leadsCreated).toBe(0);
    expect(empty.body.data.metrics.responseTimeMedianMinutes).toBeNull();

    await c.request('POST', '/api/v1/leads', { name: 'Report One', email: 'r1@example.org', amount: 10000 });
    await c.request('POST', '/api/v1/leads', { name: 'Report Two', email: 'r2@example.org', amount: 20000 });
    const summary = await c.request('GET', '/api/v1/reports/summary');
    expect(summary.body.data.metrics.leadsCreated).toBe(2);
    expect(summary.body.data.metrics.openPipelineValue).toBe(30000);
    expect(summary.body.data.metrics.leadsWithOwnerPercent).toBe(0);
    expect(summary.body.data.sourceBreakdown.reduce((n: number, s: any) => n + s.leads, 0)).toBe(2);
  });
});
