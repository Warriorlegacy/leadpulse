import fs from 'node:fs';
import { one, all, run, audit } from '../context.js';
import { ok, fail, rateLimit } from '../security.js';
import { requireAuth } from '../auth.js';
import { resolveTenant, requirePermission, visibleLead, can } from '../rbac.js';
import {
  parseBody, parseQuery, leadCreateSchema, leadUpdateSchema, leadQuerySchema,
  exportQuerySchema, mergeSchema, aiDraftSchema,
} from '../validate.js';
import {
  LEAD_SELECT, hydrate, createLead, updateLead, duplicateCandidates, mergeLeads,
  pagination,
} from '../leads-service.js';
import { nowIso, text, toCsv, clampInt } from '../util.js';
import { generateLeadBrief, generateDraftResponse } from '../ai-service.js';
import {
  saveLeadAttachment, listLeadAttachments, getLeadAttachment, deleteLeadAttachment,
} from '../storage-service.js';

const SORT_COLUMNS = {
  created_at: 'l.created_at', updated_at: 'l.updated_at', name: 'l.name',
  next_follow_up_at: 'l.next_follow_up_at',
  priority: "CASE l.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END",
};

/** All filtering is server-side and always scoped to the verified membership. */
function buildLeadQuery(c, org, q) {
  const where = ['l.organization_id = ?'];
  const args = [org.id];
  where.push(q.archived === 'true' ? 'l.archived_at IS NOT NULL' : 'l.archived_at IS NULL');

  if (q.stage) { where.push('l.stage_id = ?'); args.push(q.stage); }
  if (q.owner === 'unassigned') where.push('l.owner_id IS NULL');
  else if (q.owner) { where.push('l.owner_id = ?'); args.push(q.owner); }
  if (q.source) { where.push('s.name = ?'); args.push(q.source); }
  if (q.tag) {
    where.push('EXISTS (SELECT 1 FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = l.id AND t.name = ?)');
    args.push(q.tag);
  }
  if (q.overdue === 'true') {
    where.push('l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at < ?');
    args.push(nowIso());
  }
  if (q.search) {
    const needle = `%${text(q.search, 200).replace(/[%_\\]/g, '')}%`;
    where.push('(l.name LIKE ? OR l.company LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.campaign LIKE ?)');
    args.push(needle, needle, needle, needle, needle);
  }
  const role = c.get('role');
  if (role === 'agent') {
    const membership = one('SELECT can_view_unassigned FROM memberships WHERE id = ?', [c.get('tenant').membership.id]);
    if (membership?.can_view_unassigned) {
      where.push('(l.owner_id = ? OR l.owner_id IS NULL)'); args.push(c.get('user').id);
    } else {
      where.push('l.owner_id = ?'); args.push(c.get('user').id);
    }
  }
  const sort = SORT_COLUMNS[q.sort] || SORT_COLUMNS.created_at;
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  return { where: where.join(' AND '), args, order: `${sort} ${dir}` };
}

export function registerLeadRoutes(app) {
  // Registered before /:id so "export" cannot be interpreted as a lead id.
  app.get('/api/v1/leads/export', requireAuth, requirePermission('leads:export'), async (c) => {
    const { org } = resolveTenant(c);
    const q = parseQuery(c, exportQuerySchema);
    const { where, args, order } = buildLeadQuery(c, org, q);
    const rows = all(`${LEAD_SELECT} WHERE ${where} ORDER BY ${order} LIMIT 10000`, args);
    const tags = hydrate(org.id, rows);
    const headers = ['id', 'name', 'company', 'email', 'phone', 'source', 'campaign', 'stage', 'owner',
      'priority', 'consent', 'tags', 'amount', 'notes', 'created_at', 'next_follow_up_at', 'first_response_at'];
    const body = toCsv(headers, tags.map((l) => [
      l.id, l.name, l.company, l.email, l.phone, l.source_name || '', l.campaign,
      l.stage_name || '', l.owner_name || '', l.priority, l.consent, l.tags.join('|'),
      l.amount == null ? '' : l.amount, l.notes, l.created_at, l.next_follow_up_at || '', l.first_response_at || '',
    ]));
    audit(c, 'leads.exported', 'lead', '', { count: rows.length, filters: q });
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="leadpulse-leads.csv"');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(`\uFEFF${body}`);
  });

  app.get('/api/v1/leads', requireAuth, async (c) => {
    const { org } = resolveTenant(c);
    const q = parseQuery(c, leadQuerySchema);
    const { page, pageSize } = pagination(q);
    const { where, args, order } = buildLeadQuery(c, org, q);
    const total = one(`SELECT COUNT(*) AS n FROM leads l LEFT JOIN lead_sources s ON s.id = l.source_id WHERE ${where}`, args)?.n ?? 0;
    const rows = all(`${LEAD_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize]);
    const stages = all('SELECT id, name, kind, color, position FROM pipeline_stages WHERE organization_id = ? ORDER BY position', [org.id]);
    const sources = all('SELECT id, name, kind FROM lead_sources WHERE organization_id = ? ORDER BY name', [org.id]);
    const members = all(
      `SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = ? ORDER BY u.name`, [org.id],
    );
    const tags = all('SELECT name FROM tags WHERE organization_id = ? ORDER BY name', [org.id]).map((r) => r.name);
    return ok(c, {
      items: hydrate(org.id, rows), total, page, pageSize,
      facets: { stages, sources, members, tags },
      permissions: {
        canAssign: can(c, 'leads:assign'), canExport: can(c, 'leads:export'),
        canImport: can(c, 'leads:import'), canConfigurePipeline: can(c, 'pipeline:configure'),
      },
    });
  });

  app.post('/api/v1/leads', requireAuth, requirePermission('leads:create'), async (c) => {
    const body = await parseBody(c, leadCreateSchema);
    const { org } = resolveTenant(c);
    if (body.ownerId && !can(c, 'leads:assign')) {
      fail(403, 'FORBIDDEN', 'Your role cannot assign leads to teammates.');
    }
    const lead = createLead(org, {
      lead: body, sourceName: body.source || 'Manual', sourceKind: 'manual',
      createdBy: c.get('user').id, originLabel: 'manual entry',
    });
    audit(c, 'lead.created', 'lead', lead.id);
    return ok(c, { lead: hydrate(org.id, lead) }, 201);
  });

  app.get('/api/v1/leads/:id', requireAuth, async (c) => {
    const { org } = resolveTenant(c);
    const id = c.req.param('id');
    const lead = visibleLead(c, id);
    const activities = all(
      `SELECT a.*, u.name AS actor_name FROM activities a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.lead_id = ? AND a.organization_id = ? ORDER BY a.created_at DESC`, [id, org.id],
    );
    const tasks = all(
      `SELECT t.*, u.name AS owner_name FROM tasks t LEFT JOIN users u ON u.id = t.owner_id
       WHERE t.lead_id = ? AND t.organization_id = ? ORDER BY t.due_at`, [id, org.id],
    );
    const stageEvents = all(
      `SELECT se.*, fs.name AS from_name, ts.name AS to_name, u.name AS actor_name
       FROM stage_events se
       LEFT JOIN pipeline_stages fs ON fs.id = se.from_stage_id
       LEFT JOIN pipeline_stages ts ON ts.id = se.to_stage_id
       LEFT JOIN users u ON u.id = se.actor_id
       WHERE se.lead_id = ? AND se.organization_id = ? ORDER BY se.created_at`, [id, org.id],
    );
    return ok(c, {
      lead: hydrate(org.id, lead), activities, tasks, stageEvents,
      candidates: duplicateCandidates(org.id, lead),
      permissions: { canAssign: can(c, 'leads:assign'), canExport: can(c, 'leads:export') },
    });
  });

  app.patch('/api/v1/leads/:id', requireAuth, requirePermission('leads:edit'), async (c) => {
    const body = await parseBody(c, leadUpdateSchema);
    const lead = visibleLead(c, c.req.param('id'));
    const { org } = resolveTenant(c);
    if (body.ownerId !== undefined && !can(c, 'leads:assign')) {
      fail(403, 'FORBIDDEN', 'Your role cannot reassign leads.');
    }
    const updated = updateLead(org, lead, body, c.get('user').id);
    audit(c, 'lead.updated', 'lead', lead.id, { fields: Object.keys(body) });
    return ok(c, { lead: hydrate(org.id, updated) });
  });

  app.post('/api/v1/leads/:id/archive', requireAuth, requirePermission('leads:archive'), async (c) => {
    const lead = visibleLead(c, c.req.param('id'));
    const { org } = resolveTenant(c);
    const updated = updateLead(org, lead, { archived: true }, c.get('user').id);
    audit(c, 'lead.archived', 'lead', lead.id);
    return ok(c, { lead: hydrate(org.id, updated) });
  });

  app.post('/api/v1/leads/:id/restore', requireAuth, requirePermission('leads:archive'), async (c) => {
    const { org } = resolveTenant(c);
    const id = c.req.param('id');
    const lead = one('SELECT * FROM leads WHERE id = ? AND organization_id = ?', [id, org.id]);
    if (!lead) fail(404, 'NOT_FOUND', 'Lead not found.');
    const updated = updateLead(org, lead, { archived: false }, c.get('user').id);
    audit(c, 'lead.restored', 'lead', id);
    return ok(c, { lead: hydrate(org.id, updated) });
  });

  app.get('/api/v1/leads/:id/duplicates', requireAuth, async (c) => {
    const lead = visibleLead(c, c.req.param('id'));
    const { org } = resolveTenant(c);
    const candidates = duplicateCandidates(org.id, lead);
    return ok(c, { items: candidates, note: 'Candidates are proposals only. Merging requires an explicit confirmation.' });
  });

  app.post('/api/v1/leads/:id/merge', requireAuth, requirePermission('leads:assign'),
    rateLimit({ limit: 30, windowMs: 3600000, scope: 'merge' }), async (c) => {
      const body = await parseBody(c, mergeSchema);
      const target = visibleLead(c, c.req.param('id'));
      const { org } = resolveTenant(c);
      const source = one('SELECT * FROM leads WHERE id = ? AND organization_id = ?', [body.sourceLeadId, org.id]);
      if (!source) fail(404, 'NOT_FOUND', 'The lead to merge was not found.');
      if (source.owner_id && !can(c, 'leads:assign')) {
        fail(403, 'FORBIDDEN', 'Only managers and admins can merge leads owned by someone else.');
      }
      const merged = mergeLeads(org.id, target, source, c.get('user').id);
      audit(c, 'lead.merged', 'lead', target.id, { source: source.id });
      return ok(c, { lead: hydrate(org.id, merged) });
    });

  // AI speed-to-lead brief
  app.post('/api/v1/leads/:id/ai/brief', requireAuth, rateLimit({ limit: 20, windowMs: 60000, scope: 'ai_brief' }), async (c) => {
    const lead = visibleLead(c, c.req.param('id'));
    const { org } = resolveTenant(c);
    const activities = all('SELECT type, body, created_at FROM activities WHERE lead_id = ? ORDER BY created_at DESC LIMIT 10', [lead.id]);
    const stage = one('SELECT name FROM pipeline_stages WHERE id = ?', [lead.stage_id])?.name || 'Open';
    const result = await generateLeadBrief(org.id, lead, activities, stage);
    if (result.available) {
      audit(c, 'lead.ai_brief_generated', 'lead', lead.id);
    }
    return ok(c, result);
  });

  // AI speed-to-lead response drafter
  app.post('/api/v1/leads/:id/ai/draft-response', requireAuth, rateLimit({ limit: 20, windowMs: 60000, scope: 'ai_draft' }), async (c) => {
    const body = await parseBody(c, aiDraftSchema);
    const lead = visibleLead(c, c.req.param('id'));
    const { org } = resolveTenant(c);
    const result = await generateDraftResponse(org.id, lead, body);
    if (result.available) {
      audit(c, 'lead.ai_draft_generated', 'lead', lead.id, { channel: body.channel });
    }
    return ok(c, result);
  });

  // Lead attachments
  app.get('/api/v1/leads/:id/attachments', requireAuth, async (c) => {
    const lead = visibleLead(c, c.req.param('id'));
    const { org } = resolveTenant(c);
    const items = listLeadAttachments(org.id, lead.id);
    return ok(c, { items });
  });

  app.post('/api/v1/leads/:id/attachments', requireAuth, requirePermission('leads:edit'), async (c) => {
    const lead = visibleLead(c, c.req.param('id'));
    const { org, user } = resolveTenant(c);
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!file || typeof file === 'string') {
      fail(400, 'INVALID_FILE', 'A valid file upload is required.');
    }
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    try {
      const attachment = await saveLeadAttachment(org.id, lead.id, user.id, {
        filename: file.name,
        mimeType: file.type,
        buffer,
      });
      audit(c, 'lead.attachment_uploaded', 'lead_attachment', attachment.id, { filename: file.name });
      return ok(c, { attachment }, 201);
    } catch (err) {
      fail(400, 'UPLOAD_FAILED', err.message);
    }
  });

  app.get('/api/v1/leads/:id/attachments/:attachmentId/download', requireAuth, async (c) => {
    const lead = visibleLead(c, c.req.param('id'));
    const { org } = resolveTenant(c);
    const item = getLeadAttachment(org.id, lead.id, c.req.param('attachmentId'));
    if (!item) fail(404, 'NOT_FOUND', 'Attachment not found.');
    const fileStream = fs.createReadStream(item.filePath);
    c.header('Content-Type', item.record.mime_type || 'application/octet-stream');
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(item.record.filename)}"`);
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(fileStream);
  });

  app.delete('/api/v1/leads/:id/attachments/:attachmentId', requireAuth, requirePermission('leads:edit'), async (c) => {
    const lead = visibleLead(c, c.req.param('id'));
    const { org } = resolveTenant(c);
    const deleted = deleteLeadAttachment(org.id, lead.id, c.req.param('attachmentId'));
    if (!deleted) fail(404, 'NOT_FOUND', 'Attachment not found.');
    audit(c, 'lead.attachment_deleted', 'lead_attachment', c.req.param('attachmentId'));
    return ok(c, { deleted: true });
  });
}
