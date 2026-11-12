import { one, all, run, exec, tx, audit } from '../context.js';
import { ok, fail, rateLimit } from '../security.js';
import {
  requireAuth, createSession, clearSession, readSession, publicUser,
  validateCredentials, makePasswordHash, passwordMatches,
  userOrganizations, activeOrgId, setActiveOrg, ORG_COOKIE,
} from '../auth.js';
import { resolveTenant, requirePermission } from '../rbac.js';
import { createWorkspaceForUser } from '../leads-service.js';
import {
  uid, nowIso, addMinutes, sha256, randomToken, text, clampInt, normalizeEmail,
} from '../util.js';
import {
  parseBody, parseQuery, signupSchema, loginSchema, switchOrgSchema,
  workspaceUpdateSchema, inviteSchema, acceptInviteSchema, memberRoleSchema,
} from '../validate.js';
import { z } from 'zod';

const ROLE_RANK = { agent: 1, manager: 2, workspace_admin: 3, workspace_owner: 4 };
const INVITE_TTL_HOURS = 72;

function currentOrg(c) {
  const userId = c.get('user').id;
  const orgId = activeOrgId(c, userId);
  return orgId ? one('SELECT * FROM organizations WHERE id = ?', [orgId]) : null;
}

function authPayload(c, csrfToken) {
  const user = c.get('user');
  const orgs = userOrganizations(user.id);
  return {
    user,
    organizations: orgs,
    currentOrganization: currentOrg(c),
    ...(csrfToken ? { csrfToken } : {}),
  };
}

export function registerAuthRoutes(app) {
  app.post('/api/v1/auth/signup', rateLimit({ limit: 8, windowMs: 300000, scope: 'signup' }), async (c) => {
    const body = await parseBody(c, signupSchema);
    const email = validateCredentials(body.email, body.password, body.name);
    if (one('SELECT id FROM users WHERE email = ?', [email])) {
      fail(409, 'EMAIL_TAKEN', 'An account with this email already exists. Sign in instead.');
    }
    const userId = uid('usr');
    const ts = nowIso();
    const org = tx(() => {
      run('INSERT INTO users(id, email, name, password_hash, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)',
        [userId, email, text(body.name, 120), makePasswordHash(body.password), ts, ts]);
      return createWorkspaceForUser(userId, body.workspaceName);
    });
    const session = createSession(c, userId);
    c.set('user', { id: userId, email, name: text(body.name, 120), isPlatformAdmin: false });
    c.set('orgId', org.id);
    setActiveOrg(c, org.id);
    audit(c, 'workspace.created', 'organization', org.id);
    return ok(c, authPayload(c, session.csrfToken), 201);
  });

  app.post('/api/v1/auth/login', rateLimit({ limit: 12, windowMs: 300000, scope: 'login' }), async (c) => {
    const body = await parseBody(c, loginSchema);
    const email = normalizeEmail(body.email);
    const row = one('SELECT * FROM users WHERE email = ?', [email]);
    // Uniform response for unknown email and wrong password (no account enumeration).
    if (!row || !passwordMatches(body.password, row.password_hash)) {
      fail(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    const session = createSession(c, row.id);
    c.set('user', publicUser(row));
    return ok(c, authPayload(c, session.csrfToken));
  });

  app.post('/api/v1/auth/logout', async (c) => {
    clearSession(c);
    return ok(c, { signedOut: true });
  });

  app.get('/api/v1/auth/me', requireAuth, async (c) => {
    const session = c.get('session');
    return ok(c, authPayload(c, session.csrf_token));
  });

  app.post('/api/v1/auth/switch', requireAuth, async (c) => {
    const body = await parseBody(c, switchOrgSchema);
    const member = one('SELECT * FROM memberships WHERE user_id = ? AND organization_id = ?',
      [c.get('user').id, body.organizationId]);
    if (!member) fail(403, 'FORBIDDEN', 'You are not a member of that workspace.');
    setActiveOrg(c, body.organizationId);
    const org = one('SELECT * FROM organizations WHERE id = ?', [body.organizationId]);
    c.set('orgId', org.id);
    audit(c, 'workspace.switched', 'organization', org.id);
    return ok(c, { currentOrganization: org, role: member.role });
  });
}

export function registerWorkspaceRoutes(app) {
  app.get('/api/v1/workspace', requireAuth, async (c) => {
    const { org, role } = resolveTenant(c);
    const counts = {
      leads: one('SELECT COUNT(*) AS n FROM leads WHERE organization_id = ? AND archived_at IS NULL', [org.id])?.n ?? 0,
      members: one('SELECT COUNT(*) AS n FROM memberships WHERE organization_id = ?', [org.id])?.n ?? 0,
      stages: one('SELECT COUNT(*) AS n FROM pipeline_stages WHERE organization_id = ?', [org.id])?.n ?? 0,
    };
    return ok(c, { organization: org, role, counts });
  });

  app.patch('/api/v1/workspace', requireAuth, requirePermission('workspace:update'), async (c) => {
    const body = await parseBody(c, workspaceUpdateSchema);
    const { org } = resolveTenant(c);
    const columnMap = {
      name: 'name', timezone: 'timezone', industry: 'industry', currency: 'currency',
      workingHoursStart: 'working_hours_start', workingHoursEnd: 'working_hours_end',
      slaTargetMinutes: 'sla_target_minutes',
    };
    const sets = []; const args = [];
    for (const [key, column] of Object.entries(columnMap)) {
      if (body[key] !== undefined) { sets.push(`${column} = ?`); args.push(body[key]); }
    }
    if (body.workingDays !== undefined) { sets.push('working_days = ?'); args.push(body.workingDays.join(',')); }
    if (body.slaBusinessHoursOnly !== undefined) { sets.push('sla_business_hours_only = ?'); args.push(body.slaBusinessHoursOnly ? 1 : 0); }
    if (body.timezone) {
      try { new Intl.DateTimeFormat('en-US', { timeZone: body.timezone }); }
      catch { fail(400, 'INVALID_TIMEZONE', 'Enter a valid IANA timezone, e.g. Asia/Kolkata.'); }
    }
    if (!sets.length) fail(400, 'NO_CHANGES', 'No supported fields were provided.');
    sets.push('updated_at = ?'); args.push(nowIso());
    args.push(org.id);
    run(`UPDATE organizations SET ${sets.join(', ')} WHERE id = ?`, args);
    audit(c, 'workspace.updated', 'organization', org.id, { fields: Object.keys(body) });
    return ok(c, { organization: one('SELECT * FROM organizations WHERE id = ?', [org.id]) });
  });

  /** Full JSON backup. Export before any destructive workspace action. */
  app.get('/api/v1/workspace/export', requireAuth, requirePermission('workspace:update'), async (c) => {
    const { org } = resolveTenant(c);
    const tables = ['organizations', 'memberships', 'invitations', 'lead_sources', 'pipeline_stages', 'leads',
      'stage_events', 'tags', 'activities', 'tasks', 'capture_forms', 'notifications',
      'webhook_endpoints', 'csv_import_jobs', 'audit_events', 'notification_preferences', 'plan_limits'];
    const payload = { exportedAt: nowIso(), timezone: org.timezone, warning: 'Contains personal data. Store securely.', tables: {} };
    for (const t of tables) {
      // `organizations` is keyed by id; every other table carries organization_id.
      const column = t === 'organizations' ? 'id' : 'organization_id';
      payload.tables[t] = all(`SELECT * FROM ${t} WHERE ${column} = ?`, [org.id]);
    }
    // lead_tags has no organization_id column; scope it through the owning lead.
    payload.tables.lead_tags = all(
      `SELECT lt.lead_id, lt.tag_id FROM lead_tags lt JOIN leads l ON l.id = lt.lead_id
       WHERE l.organization_id = ?`, [org.id],
    );
    audit(c, 'workspace.exported', 'organization', org.id);
    c.header('Content-Disposition', `attachment; filename="leadpulse-backup-${org.slug}.json"`);
    return ok(c, payload);
  });

  app.delete('/api/v1/workspace', requireAuth, requirePermission('workspace:delete'), async (c) => {
    const body = await parseBody(c, z.object({ confirmation: z.string().min(1) }));
    const { org } = resolveTenant(c);
    if (body.confirmation !== org.slug) {
      fail(400, 'CONFIRMATION_MISMATCH', `Type the workspace slug "${org.slug}" to confirm permanent deletion.`);
    }
    audit(c, 'workspace.deleted', 'organization', org.id);
    run('DELETE FROM organizations WHERE id = ?', [org.id]);
    return ok(c, { deleted: true, note: 'All workspace rows were removed. Restore from a previously downloaded backup.' });
  });

  app.get('/api/v1/workspace/members', requireAuth, async (c) => {
    const { org } = resolveTenant(c);
    const members = all(
      `SELECT m.id, m.role, m.can_view_unassigned, m.created_at, u.id AS user_id, u.name, u.email
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = ? ORDER BY m.created_at`, [org.id],
    );
    return ok(c, { items: members });
  });

  app.patch('/api/v1/workspace/members/:id', requireAuth, requirePermission('members:manage'), async (c) => {
    const body = await parseBody(c, memberRoleSchema);
    const { org } = resolveTenant(c);
    const target = one('SELECT * FROM memberships WHERE id = ? AND organization_id = ?', [c.req.param('id'), org.id]);
    if (!target) fail(404, 'NOT_FOUND', 'Member not found.');
    if (target.role === 'workspace_owner') fail(409, 'PROTECTED_ROLE', 'The workspace owner role cannot be changed.');
    const sets = ['role = ?']; const args = [body.role];
    if (body.canViewUnassigned !== undefined) { sets.push('can_view_unassigned = ?'); args.push(body.canViewUnassigned ? 1 : 0); }
    args.push(target.id);
    run(`UPDATE memberships SET ${sets.join(', ')} WHERE id = ?`, args);
    audit(c, 'member.role_changed', 'membership', target.id, { role: body.role });
    return ok(c, { member: one('SELECT * FROM memberships WHERE id = ?', [target.id]) });
  });

  app.delete('/api/v1/workspace/members/:id', requireAuth, requirePermission('members:manage'), async (c) => {
    const { org } = resolveTenant(c);
    const target = one('SELECT * FROM memberships WHERE id = ? AND organization_id = ?', [c.req.param('id'), org.id]);
    if (!target) fail(404, 'NOT_FOUND', 'Member not found.');
    if (target.role === 'workspace_owner') fail(409, 'PROTECTED_ROLE', 'The workspace owner cannot be removed.');
    run('DELETE FROM memberships WHERE id = ?', [target.id]);
    audit(c, 'member.removed', 'membership', target.id);
    return ok(c, { removed: true });
  });

  app.get('/api/v1/workspace/invitations', requireAuth, requirePermission('invites:manage'), async (c) => {
    const { org } = resolveTenant(c);
    const items = all(
      `SELECT id, email, role, expires_at, accepted_at, revoked_at, created_at
       FROM invitations WHERE organization_id = ? ORDER BY created_at DESC`, [org.id],
    );
    return ok(c, { items });
  });

  app.post('/api/v1/workspace/invitations', requireAuth, requirePermission('invites:manage'),
    rateLimit({ limit: 20, windowMs: 3600000, scope: 'invite' }), async (c) => {
      const body = await parseBody(c, inviteSchema);
      const { org, role, user } = resolveTenant(c);
      if (ROLE_RANK[body.role] >= ROLE_RANK[role]) {
        fail(403, 'ROLE_ESCALATION', 'You cannot invite someone to a role at or above your own.');
      }
      const email = normalizeEmail(body.email);
      const exists = one(
        `SELECT m.id FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = ? AND u.email = ?`, [org.id, email],
      );
      if (exists) fail(409, 'ALREADY_MEMBER', 'That person is already a member of this workspace.');
      const limits = one('SELECT max_members FROM plan_limits WHERE organization_id = ?', [org.id]);
      const memberCount = one('SELECT COUNT(*) AS n FROM memberships WHERE organization_id = ?', [org.id])?.n ?? 0;
      if (memberCount >= (limits?.max_members ?? 25)) fail(429, 'PLAN_LIMIT', 'Workspace member limit reached.');

      const token = randomToken(32);
      const id = uid('inv');
      const ts = nowIso();
      run(
        `INSERT INTO invitations(id, organization_id, email, role, token_hash, invited_by, issuer_role, expires_at, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, org.id, email, body.role, sha256(token), user.id, role, addMinutes(ts, INVITE_TTL_HOURS * 60), ts],
      );
      audit(c, 'invitation.created', 'invitation', id, { role: body.role });
      // Plain token is returned ONCE and never logged or stored in clear text.
      return ok(c, {
        invitation: { id, email, role: body.role, expiresAt: addMinutes(ts, INVITE_TTL_HOURS * 60) },
        token,
        note: 'Copy this link now — the token cannot be shown again.',
      }, 201);
    });

  app.delete('/api/v1/workspace/invitations/:id', requireAuth, requirePermission('invites:manage'), async (c) => {
    const { org } = resolveTenant(c);
    const row = one('SELECT * FROM invitations WHERE id = ? AND organization_id = ?', [c.req.param('id'), org.id]);
    if (!row) fail(404, 'NOT_FOUND', 'Invitation not found.');
    run('UPDATE invitations SET revoked_at = ? WHERE id = ? AND accepted_at IS NULL', [nowIso(), row.id]);
    audit(c, 'invitation.revoked', 'invitation', row.id);
    return ok(c, { revoked: true });
  });

  app.post('/api/v1/invitations/:token/accept', requireAuth, async (c) => {
    const body = await parseBody(c, acceptInviteSchema);
    const tokenHash = sha256(c.req.param('token'));
    const inv = one('SELECT * FROM invitations WHERE token_hash = ?', [tokenHash]);
    if (!inv) fail(404, 'INVALID_INVITATION', 'This invitation link is invalid.');
    if (inv.revoked_at) fail(410, 'INVITATION_REVOKED', 'This invitation was revoked.');
    if (inv.accepted_at) fail(410, 'INVITATION_USED', 'This invitation has already been used.');
    if (Date.parse(inv.expires_at) <= Date.now()) fail(410, 'INVITATION_EXPIRED', 'This invitation has expired.');
    const user = c.get('user');
    if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
      fail(403, 'EMAIL_MISMATCH', `Sign in as ${inv.email} before accepting this invitation.`);
    }
    if (ROLE_RANK[inv.role] > ROLE_RANK[inv.issuer_role]) {
      fail(403, 'ROLE_ESCALATION', 'This invitation would grant a higher role than its issuer holds.');
    }
    const exists = one('SELECT id FROM memberships WHERE organization_id = ? AND user_id = ?', [inv.organization_id, user.id]);
    if (exists) fail(409, 'ALREADY_MEMBER', 'You are already a member of this workspace.');
    tx(() => {
      run('INSERT INTO memberships(id, organization_id, user_id, role, can_view_unassigned, created_at) VALUES(?, ?, ?, ?, ?, ?)',
        [uid('mem'), inv.organization_id, user.id, inv.role, 0, nowIso()]);
      run('INSERT OR IGNORE INTO notification_preferences(user_id, organization_id, in_app, email) VALUES(?, ?, 1, 0)',
        [user.id, inv.organization_id]);
      run('UPDATE invitations SET accepted_at = ? WHERE id = ?', [nowIso(), inv.id]);
    });
    c.set('orgId', inv.organization_id);
    setActiveOrg(c, inv.organization_id);
    audit(c, 'invitation.accepted', 'invitation', inv.id, { role: inv.role });
    return ok(c, { organization: one('SELECT * FROM organizations WHERE id = ?', [inv.organization_id]), role: inv.role });
  });

  app.get('/api/v1/audit', requireAuth, requirePermission('audit:view'), async (c) => {
    const { org } = resolveTenant(c);
    const q = parseQuery(c, z.object({ page: z.coerce.number().int().min(1).optional().default(1), pageSize: z.coerce.number().int().min(1).max(100).optional().default(50) }));
    const offset = (q.page - 1) * q.pageSize;
    const items = all(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at, u.name AS actor_name
       FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.organization_id = ? ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      [org.id, q.pageSize, offset],
    );
    const total = one('SELECT COUNT(*) AS n FROM audit_events WHERE organization_id = ?', [org.id])?.n ?? 0;
    return ok(c, { items, total, page: q.page, pageSize: q.pageSize });
  });

  app.get('/api/v1/notifications', requireAuth, async (c) => {
    const { org } = resolveTenant(c);
    const items = all(
      `SELECT id, kind, message, lead_id, read_at, created_at FROM notifications
       WHERE organization_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [org.id, c.get('user').id],
    );
    const unread = one('SELECT COUNT(*) AS n FROM notifications WHERE organization_id = ? AND user_id = ? AND read_at IS NULL',
      [org.id, c.get('user').id])?.n ?? 0;
    return ok(c, { items, unread });
  });

  app.post('/api/v1/notifications/:id/read', requireAuth, async (c) => {
    const { org } = resolveTenant(c);
    run('UPDATE notifications SET read_at = ? WHERE id = ? AND organization_id = ? AND user_id = ?',
      [nowIso(), c.req.param('id'), org.id, c.get('user').id]);
    return ok(c, { read: true });
  });

  /** Truthful configuration state. No adapter pretends to be active. */
  app.get('/api/v1/integrations', requireAuth, async (c) => {
    resolveTenant(c);
    return ok(c, {
      items: [
        { key: 'email', label: 'Transactional email', configured: false, state: 'disabled', reason: 'No RESEND_API_KEY/EMAIL_FROM and no email adapter enabled. In-app notifications are used instead.' },
        { key: 'ai', label: 'AI assistance', configured: false, state: 'disabled', reason: 'No provider configured. No AI output is generated.' },
        { key: 'meta', label: 'Meta lead forms', configured: false, state: 'disabled', reason: 'Requires official Marketing API access, app review and business verification. CSV/manual/webhook capture is the default.' },
        { key: 'whatsapp', label: 'WhatsApp Cloud API', configured: false, state: 'disabled', reason: 'No approved account or templates. Only a user-initiated click-to-chat link is offered.' },
        { key: 'billing', label: 'Payments', configured: false, state: 'disabled', reason: 'Pricing is unvalidated. No billing provider is connected and no payments are simulated.' },
      ],
    });
  });

  app.get('/api/v1/admin/overview', requireAuth, requirePermission('platform:overview'), async (c) => {
    const count = (table) => one(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;
    return ok(c, {
      workspaces: count('organizations'), users: count('users'), leads: count('leads'),
      note: 'Aggregate counts only. No personal data is exposed.',
    });
  });
}
