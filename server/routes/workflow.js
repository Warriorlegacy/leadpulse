import { one, all, run, audit } from '../context.js';
import { ok, fail } from '../security.js';
import { requireAuth } from '../auth.js';
import { resolveTenant, requirePermission, visibleLead, visibleTask, can } from '../rbac.js';
import { parseBody, parseQuery, transitionSchema, stageConfigSchema, activitySchema, taskSchema, taskUpdateSchema } from '../validate.js';
import { LEAD_SELECT, hydrate, logActivity, transitionStage } from '../leads-service.js';
import { uid, nowIso, dateInTz, zonedToUtc } from '../util.js';
import { z } from 'zod';

function scopedLeadWhere(c) {
  if (c.get('role') !== 'agent') return { clause: '', args: [] };
  const m = one('SELECT can_view_unassigned FROM memberships WHERE id = ?', [c.get('tenant').membership.id]);
  if (m?.can_view_unassigned) return { clause: ' AND (l.owner_id = ? OR l.owner_id IS NULL)', args: [c.get('user').id] };
  return { clause: ' AND l.owner_id = ?', args: [c.get('user').id] };
}

export function registerWorkflowRoutes(app) {
  app.get('/api/v1/pipeline', requireAuth, async (c) => {
    const { org } = resolveTenant(c);
    const stages = all('SELECT * FROM pipeline_stages WHERE organization_id = ? ORDER BY position', [org.id]);
    const scope = scopedLeadWhere(c);
    const columns = stages.map((stage) => {
      const rows = all(
        `${LEAD_SELECT} WHERE l.organization_id = ? AND l.stage_id = ? AND l.archived_at IS NULL${scope.clause}
         ORDER BY l.created_at DESC LIMIT 100`,
        [org.id, stage.id, ...scope.args],
      );
      return { stage, leads: hydrate(org.id, rows), count: rows.length };
    });
    return ok(c, {
      columns,
      canConfigure: can(c, 'pipeline:configure'),
      canAssign: can(c, 'leads:assign'),
    });
  });

  app.patch('/api/v1/pipeline/stages', requireAuth, requirePermission('pipeline:configure'), async (c) => {
    const body = await parseBody(c, stageConfigSchema);
    const { org } = resolveTenant(c);
    const names = new Set();
    for (const s of body.stages) {
      if (names.has(s.name.toLowerCase())) fail(400, 'DUPLICATE_STAGE', `Stage name "${s.name}" is used twice.`);
      names.add(s.name.toLowerCase());
    }
    const closed = body.stages.filter((s) => s.kind !== 'open');
    if (closed.length > 2) fail(400, 'TOO_MANY_CLOSED', 'At most two closed stages (won/lost) are supported.');
    body.stages.forEach((s, i) => {
      const existing = s.id ? one('SELECT id FROM pipeline_stages WHERE id = ? AND organization_id = ?', [s.id, org.id]) : null;
      if (existing) {
        run('UPDATE pipeline_stages SET name = ?, position = ?, kind = ?, color = ? WHERE id = ? AND organization_id = ?',
          [s.name, i, s.kind, s.color || '#6B7280', s.id, org.id]);
      } else {
        run(`INSERT INTO pipeline_stages(id, organization_id, name, position, kind, color, created_at)
             VALUES(?, ?, ?, ?, ?, ?, ?)`,
          [uid('stg'), org.id, s.name, i, s.kind, s.color || '#6B7280', nowIso()]);
      }
    });
    audit(c, 'pipeline.updated', 'pipeline', org.id, { count: body.stages.length });
    return ok(c, { stages: all('SELECT * FROM pipeline_stages WHERE organization_id = ? ORDER BY position', [org.id]) });
  });

  app.post('/api/v1/leads/:id/transition', requireAuth, requirePermission('pipeline:transition'), async (c) => {
    const body = await parseBody(c, transitionSchema);
    const lead = visibleLead(c, c.req.param('id'));
    const { org } = resolveTenant(c);
    const updated = transitionStage(org.id, lead, body.stageId, c.get('user').id, body.reason);
    audit(c, 'lead.stage_changed', 'lead', lead.id, { to: body.stageId });
    return ok(c, { lead: hydrate(org.id, updated) });
  });

  app.get('/api/v1/leads/:id/activities', requireAuth, async (c) => {
    visibleLead(c, c.req.param('id'));
    const { org } = resolveTenant(c);
    const items = all(
      `SELECT a.*, u.name AS actor_name FROM activities a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.lead_id = ? AND a.organization_id = ? ORDER BY a.created_at DESC LIMIT 500`,
      [c.req.param('id'), org.id],
    );
    return ok(c, { items });
  });

  app.post('/api/v1/leads/:id/activities', requireAuth, requirePermission('activities:create'), async (c) => {
    const body = await parseBody(c, activitySchema);
    const lead = visibleLead(c, c.req.param('id'));
    const { org } = resolveTenant(c);
    const activity = logActivity(org, lead.id, c.get('user').id, body.type, body.body);
    audit(c, 'activity.logged', 'lead', lead.id, { type: body.type });
    return ok(c, { activity, note: 'This is a logged record. No email, call or message was sent by the system.' }, 201);
  });

  app.get('/api/v1/leads/:id/stage-events', requireAuth, async (c) => {
    visibleLead(c, c.req.param('id'));
    const { org } = resolveTenant(c);
    const items = all(
      `SELECT se.*, fs.name AS from_name, ts.name AS to_name FROM stage_events se
       LEFT JOIN pipeline_stages fs ON fs.id = se.from_stage_id
       LEFT JOIN pipeline_stages ts ON ts.id = se.to_stage_id
       WHERE se.lead_id = ? AND se.organization_id = ? ORDER BY se.created_at`,
      [c.req.param('id'), org.id],
    );
    return ok(c, { items });
  });

  app.get('/api/v1/tasks', requireAuth, async (c) => {
    const { org } = resolveTenant(c);
    const q = parseQuery(c, z.object({ bucket: z.enum(['all', 'overdue', 'today', 'upcoming']).optional().default('all') }));
    const today = dateInTz(Date.now(), org.timezone);
    const startUtc = new Date(zonedToUtc(today, '00:00', org.timezone)).toISOString();
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const endUtc = new Date(zonedToUtc(tomorrow, '00:00', org.timezone)).toISOString();
    const where = ['t.organization_id = ?']; const args = [org.id];
    if (q.bucket === 'overdue') { where.push('t.completed_at IS NULL AND t.due_at < ?'); args.push(nowIso()); }
    if (q.bucket === 'today') { where.push('t.completed_at IS NULL AND t.due_at >= ? AND t.due_at < ?'); args.push(startUtc, endUtc); }
    if (q.bucket === 'upcoming') { where.push('t.completed_at IS NULL AND t.due_at >= ?'); args.push(endUtc); }
    if (c.get('role') === 'agent') { where.push('t.owner_id = ?'); args.push(c.get('user').id); }
    const items = all(
      `SELECT t.*, u.name AS owner_name, l.name AS lead_name FROM tasks t
       LEFT JOIN users u ON u.id = t.owner_id LEFT JOIN leads l ON l.id = t.lead_id
       WHERE ${where.join(' AND ')} ORDER BY t.due_at LIMIT 500`, args,
    );
    const counts = {
      overdue: one('SELECT COUNT(*) AS n FROM tasks WHERE organization_id = ? AND completed_at IS NULL AND due_at < ?', [org.id, nowIso()])?.n ?? 0,
      dueToday: one('SELECT COUNT(*) AS n FROM tasks WHERE organization_id = ? AND completed_at IS NULL AND due_at >= ? AND due_at < ?', [org.id, startUtc, endUtc])?.n ?? 0,
    };
    return ok(c, { items, counts, timezone: org.timezone, bucket: q.bucket });
  });

  app.post('/api/v1/tasks', requireAuth, requirePermission('tasks:create'), async (c) => {
    const body = await parseBody(c, taskSchema);
    const { org } = resolveTenant(c);
    const id = uid('tsk'); const ts = nowIso();
    let leadId = body.leadId || null;
    if (leadId) {
      const lead = one('SELECT id FROM leads WHERE id = ? AND organization_id = ?', [leadId, org.id]);
      if (!lead) fail(404, 'NOT_FOUND', 'Lead not found.');
    }
    let ownerId = body.ownerId || c.get('user').id;
    if (body.ownerId) {
      const member = one('SELECT user_id FROM memberships WHERE organization_id = ? AND user_id = ?', [org.id, body.ownerId]);
      if (!member) fail(400, 'INVALID_OWNER', 'The selected owner is not a workspace member.');
    }
    run(
      `INSERT INTO tasks(id, organization_id, lead_id, title, owner_id, due_at, priority, reminder, created_by, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, org.id, leadId, body.title, ownerId, body.dueAt, body.priority || 'normal',
        body.reminder || 'in_app', c.get('user').id, ts, ts],
    );
    if (leadId) {
      run(`INSERT INTO activities(id, organization_id, lead_id, type, body, actor_id, created_at)
           VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [uid('act'), org.id, leadId, 'system', `Follow-up task created: ${body.title} (logged).`, c.get('user').id, ts]);
    }
    audit(c, 'task.created', 'task', id);
    return ok(c, { task: one('SELECT * FROM tasks WHERE id = ?', [id]) }, 201);
  });

  app.patch('/api/v1/tasks/:id', requireAuth, requirePermission('tasks:edit'), async (c) => {
    const body = await parseBody(c, taskUpdateSchema);
    const task = visibleTask(c, c.req.param('id'));
    const sets = []; const args = [];
    if (body.title !== undefined) { sets.push('title = ?'); args.push(body.title); }
    if (body.dueAt !== undefined) { sets.push('due_at = ?'); args.push(body.dueAt); }
    if (body.priority !== undefined) { sets.push('priority = ?'); args.push(body.priority); }
    if (body.ownerId !== undefined) { sets.push('owner_id = ?'); args.push(body.ownerId || null); }
    if (body.completed !== undefined) { sets.push('completed_at = ?'); args.push(body.completed ? nowIso() : null); }
    if (!sets.length) fail(400, 'NO_CHANGES', 'No supported fields were provided.');
    sets.push('updated_at = ?'); args.push(nowIso(), task.id);
    run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, args);
    audit(c, 'task.updated', 'task', task.id, { fields: Object.keys(body) });
    return ok(c, { task: one('SELECT * FROM tasks WHERE id = ?', [task.id]) });
  });

  app.get('/api/v1/tags', requireAuth, async (c) => {
    const { org } = resolveTenant(c);
    return ok(c, { items: all('SELECT id, name, color FROM tags WHERE organization_id = ? ORDER BY name', [org.id]) });
  });
}
