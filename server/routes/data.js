import { one, all, run, tx, audit } from '../context.js';
import { ok, fail, rateLimit, clientIp } from '../security.js';
import { requireAuth } from '../auth.js';
import { resolveTenant, requirePermission } from '../rbac.js';
import { encryptSecret, decryptSecret } from '../secrets.js';
import {
  parseBody, parseQuery, captureConfigSchema, captureSubmitSchema,
  importPreviewSchema, commitSchema, webhookCreateSchema, webhookPayloadSchema,
  reportQuerySchema,
} from '../validate.js';
import { createLead, ensureSource } from '../leads-service.js';
import {
  uid, nowIso, addMinutes, sha256, randomToken, hmacHex, safeEqual,
  text, parseCsv, validEmail, validPhone, normalizeEmail, normalizePhone,
  elapsedMinutes, dateInTz, parseJson,
} from '../util.js';
import { z } from 'zod';

/* ------------------------------------------------------------------ reports */
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function registerReportRoutes(app) {
  app.get('/api/v1/reports/summary', requireAuth, requirePermission('reports:view'), async (c) => {
    const { org } = resolveTenant(c);
    const q = parseQuery(c, reportQuerySchema);
    const to = q.to || nowIso();
    const from = q.from || addMinutes(to, -30 * 1440);
    const businessOnly = Boolean(org.sla_business_hours_only);

    const inRange = (column) => `${column} >= ? AND ${column} <= ?`;
    const created = one(
      `SELECT COUNT(*) AS n FROM leads WHERE organization_id = ? AND ${inRange('created_at')}`,
      [org.id, from, to],
    )?.n ?? 0;
    const totalOpen = one(
      'SELECT COUNT(*) AS n FROM leads WHERE organization_id = ? AND archived_at IS NULL', [org.id],
    )?.n ?? 0;
    const owned = one(
      'SELECT COUNT(*) AS n FROM leads WHERE organization_id = ? AND archived_at IS NULL AND owner_id IS NOT NULL', [org.id],
    )?.n ?? 0;
    const overdueTasks = one(
      'SELECT COUNT(*) AS n FROM tasks WHERE organization_id = ? AND completed_at IS NULL AND due_at < ?',
      [org.id, nowIso()],
    )?.n ?? 0;
    const openValue = one(
      `SELECT SUM(l.amount_cents) AS total FROM leads l
       JOIN pipeline_stages s ON s.id = l.stage_id
       WHERE l.organization_id = ? AND l.archived_at IS NULL AND s.kind = 'open'
         AND l.amount_cents IS NOT NULL`, [org.id],
    )?.total ?? null;

    const responded = all(
      `SELECT created_at, first_response_at FROM leads
       WHERE organization_id = ? AND first_response_at IS NOT NULL AND ${inRange('created_at')}`,
      [org.id, from, to],
    );
    const responseTimes = responded.map((r) => elapsedMinutes(r.created_at, r.first_response_at, org, businessOnly));
    const responseMedian = median(responseTimes);
    const withinSla = responseTimes.filter((m) => m <= org.sla_target_minutes).length;

    const qualified = one(
      `SELECT COUNT(DISTINCT se.lead_id) AS n FROM stage_events se
       JOIN pipeline_stages s ON s.id = se.to_stage_id
       WHERE se.organization_id = ? AND s.name = 'Qualified'`, [org.id],
    )?.n ?? 0;
    const won = one(
      `SELECT COUNT(DISTINCT se.lead_id) AS n FROM stage_events se
       JOIN pipeline_stages s ON s.id = se.to_stage_id
       WHERE se.organization_id = ? AND s.kind = 'won'`, [org.id],
    )?.n ?? 0;
    const sourceRows = all(
      `SELECT COALESCE(s.name, 'Unknown') AS source, COUNT(*) AS leads,
              SUM(CASE WHEN ps.kind = 'won' THEN 1 ELSE 0 END) AS won
       FROM leads l
       LEFT JOIN lead_sources s ON s.id = l.source_id
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       WHERE l.organization_id = ? AND l.archived_at IS NULL AND ${inRange('l.created_at')}
       GROUP BY COALESCE(s.name, 'Unknown') ORDER BY leads DESC`,
      [org.id, from, to],
    );
    const stageRows = all(
      `SELECT st.name, st.kind, st.color, COUNT(l.id) AS leads
       FROM pipeline_stages st LEFT JOIN leads l ON l.stage_id = st.id AND l.archived_at IS NULL
       WHERE st.organization_id = ? GROUP BY st.id ORDER BY st.position`, [org.id],
    );
    const teamRows = all(
      `SELECT u.name, COUNT(a.id) AS activities FROM activities a
       JOIN users u ON u.id = a.actor_id
       WHERE a.organization_id = ? AND a.type != 'system' AND ${inRange('a.created_at')}
       GROUP BY u.id ORDER BY activities DESC LIMIT 20`,
      [org.id, from, to],
    );
    const weeklyActive = one(
      `SELECT COUNT(DISTINCT actor_id) AS n FROM activities
       WHERE organization_id = ? AND actor_id IS NOT NULL AND created_at >= ?`,
      [org.id, addMinutes(nowIso(), -7 * 1440)],
    )?.n ?? 0;
    const byDay = all(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS leads
       FROM leads WHERE organization_id = ? AND ${inRange('created_at')}
       GROUP BY substr(created_at, 1, 10) ORDER BY day`,
      [org.id, from, to],
    );

    return ok(c, {
      window: { from, to, timezone: org.timezone, businessHoursOnly: businessOnly },
      metrics: {
        leadsCreated: created,
        openLeads: totalOpen,
        leadsWithOwnerPercent: totalOpen ? Math.round((owned / totalOpen) * 1000) / 10 : null,
        overdueTasks,
        openPipelineValue: openValue == null ? null : openValue / 100,
        currency: org.currency,
        responseTimeMedianMinutes: responseMedian,
        responseSampleSize: responseTimes.length,
        withinSlaPercent: responseTimes.length ? Math.round((withinSla / responseTimes.length) * 1000) / 10 : null,
        slaTargetMinutes: org.sla_target_minutes,
        leadToQualifiedPercent: created ? Math.round((qualified / created) * 1000) / 10 : null,
        qualifiedToWonPercent: qualified ? Math.round((won / qualified) * 1000) / 10 : null,
        weeklyActiveTeammates: weeklyActive,
      },
      sourceBreakdown: sourceRows.map((r) => ({ ...r, conversionPercent: r.leads ? Math.round((r.won / r.leads) * 1000) / 10 : null })),
      stageBreakdown: stageRows,
      teamActivity: teamRows,
      leadsByDay: byDay,
      note: 'All figures are computed from persisted records. No sample or estimated values are shown.',
    });
  });
}

/* ------------------------------------------------------------------ imports */
const previews = new Map(); // job id -> { rows, expiresAt }. PII is NOT written to disk.
const PREVIEW_TTL_MS = 15 * 60 * 1000;

const FIELD_ALIASES = {
  name: 'name', fullname: 'name', 'full name': 'name', contact: 'name',
  email: 'email', 'email address': 'email', mail: 'email',
  phone: 'phone', mobile: 'phone', 'phone number': 'phone', tel: 'phone',
  company: 'company', organisation: 'company', organization: 'company', business: 'company',
  source: 'source', 'lead source': 'source', channel: 'source',
  campaign: 'campaign', notes: 'notes', note: 'notes', message: 'notes',
  tags: 'tags', amount: 'amount', value: 'amount', priority: 'priority',
};
const SUPPORTED_FIELDS = ['name', 'email', 'phone', 'company', 'source', 'campaign', 'notes', 'tags', 'amount', 'priority'];

function autoMap(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const key = FIELD_ALIASES[h.trim().toLowerCase()];
    if (key && !Object.values(map).includes(key)) map[String(i)] = key;
  });
  return map;
}

function neutralizeCell(v) {
  const s = String(v ?? '').trim();
  if (/^[=+@\t\r]/.test(s)) return `'${s}`;
  return s;
}

function validateImportRows(rows, columnMap, orgId, limit) {
  const [header, ...dataRows] = rows;
  if (!header) return { valid: [], invalid: [], warnings: ['CSV has no header row'] };
  const mapping = Object.keys(columnMap).length ? columnMap : autoMap(header);
  const valid = []; const invalid = []; const warnings = [];
  for (const [index, row] of dataRows.entries()) {
    const line = index + 2;
    if (!row.some((cell) => String(cell).trim())) continue; // blank line
    const record = {};
    for (const [colIndex, field] of Object.entries(mapping)) {
      if (SUPPORTED_FIELDS.includes(field)) record[field] = neutralizeCell(row[Number(colIndex)] ?? '');
    }
    const problems = [];
    if (!record.name) problems.push('name is required');
    if (record.email && !validEmail(record.email)) problems.push('invalid email');
    if (record.phone && !validPhone(record.phone)) problems.push('invalid phone');
    if (!record.email && !record.phone) problems.push('at least one of email or phone is required');
    if (record.amount && !Number.isFinite(Number(record.amount))) problems.push('amount must be numeric');
    if (problems.length) { invalid.push({ row: line, values: record, errors: problems }); continue; }
    const emailNorm = normalizeEmail(record.email || '');
    const phoneNorm = normalizePhone(record.phone || '');
    const dupe = emailNorm || phoneNorm
      ? one(
        `SELECT id, name FROM leads WHERE organization_id = ? AND archived_at IS NULL
           AND ((? != '' AND email_norm = ?) OR (? != '' AND phone_norm = ?)) LIMIT 1`,
        [orgId, emailNorm, emailNorm, phoneNorm, phoneNorm],
      )
      : null;
    valid.push({
      name: record.name, company: record.company || '', email: record.email || '', phone: record.phone || '',
      source: record.source || 'CSV import', campaign: record.campaign || '',
      notes: record.notes || '', tags: record.tags ? record.tags.split('|').map((t) => t.trim()).filter(Boolean) : [],
      amount: record.amount ? Number(record.amount) : undefined,
      priority: ['low', 'normal', 'high', 'urgent'].includes(record.priority) ? record.priority : 'normal',
      duplicateOf: dupe ? { id: dupe.id, name: dupe.name } : null,
    });
  }
  if (valid.length > limit) {
    warnings.push(`Only the first ${limit} valid rows will be imported (plan limit).`);
    valid.length = limit;
  }
  return { valid, invalid, warnings, mapping, header };
}

export function registerImportRoutes(app) {
  app.post('/api/v1/imports/preview', requireAuth, requirePermission('leads:import'),
    rateLimit({ limit: 20, windowMs: 3600000, scope: 'import' }), async (c) => {
      const body = await parseBody(c, importPreviewSchema);
      const { org } = resolveTenant(c);
      const key = `${org.id}:${body.idempotencyKey}`;
      const existing = one('SELECT * FROM idempotency_keys WHERE key = ? AND scope = ?', [key, 'csv_import']);
      if (existing) {
        return ok(c, { ...parseJson(existing.result, {}), idempotent: true });
      }
      const parsed = parseCsv(body.csv);
      if (parsed.errors.length && !parsed.rows.length) {
        return ok(c, { job: null, errors: parsed.errors, truncated: parsed.truncated }, 400);
      }
      const limits = one('SELECT max_import_rows FROM plan_limits WHERE organization_id = ?', [org.id]);
      const result = validateImportRows(parsed.rows, body.columnMap || {}, org.id, limits?.max_import_rows ?? 500);
      const jobId = uid('imp'); const ts = nowIso();
      const summary = {
        totalRows: Math.max(0, parsed.rows.length - 1),
        validRows: result.valid.length,
        invalidRows: result.invalid.length,
        duplicates: result.valid.filter((r) => r.duplicateOf).length,
        parserErrors: parsed.errors,
        truncated: parsed.truncated,
        warnings: result.warnings,
      };
      run(
        `INSERT INTO csv_import_jobs(id, organization_id, idempotency_key, filename, column_map, summary, status, created_by, created_at)
         VALUES(?, ?, ?, ?, ?, ?, 'preview', ?, ?)`,
        [jobId, org.id, body.idempotencyKey, text(body.filename || 'upload.csv', 200),
          JSON.stringify(result.mapping || {}), JSON.stringify(summary), c.get('user').id, ts],
      );
      previews.set(jobId, { rows: result.valid, expiresAt: Date.now() + PREVIEW_TTL_MS });
      const payload = {
        job: { id: jobId, status: 'preview', createdAt: ts, summary, header: result.header || [], mapping: result.mapping || {} },
        invalid: result.invalid,
        preview: result.valid.slice(0, 10),
        idempotent: false,
      };
      run('INSERT INTO idempotency_keys(key, scope, result, created_at) VALUES(?, ?, ?, ?)',
        [key, 'csv_import', JSON.stringify(payload), ts]);
      audit(c, 'import.preview', 'csv_import', jobId, summary);
      return ok(c, payload, 201);
    });

  app.get('/api/v1/imports/:id', requireAuth, requirePermission('leads:import'), async (c) => {
    const { org } = resolveTenant(c);
    const job = one('SELECT * FROM csv_import_jobs WHERE id = ? AND organization_id = ?', [c.req.param('id'), org.id]);
    if (!job) fail(404, 'NOT_FOUND', 'Import job not found.');
    return ok(c, { job: { ...job, summary: parseJson(job.summary, {}), column_map: parseJson(job.column_map, {}) } });
  });

  app.post('/api/v1/imports/:id/commit', requireAuth, requirePermission('leads:import'), async (c) => {
    await parseBody(c, commitSchema);
    const { org } = resolveTenant(c);
    const id = c.req.param('id');
    const job = one('SELECT * FROM csv_import_jobs WHERE id = ? AND organization_id = ?', [id, org.id]);
    if (!job) fail(404, 'NOT_FOUND', 'Import job not found.');
    if (job.status === 'committed') {
      return ok(c, { jobId: id, status: 'committed', alreadyCommitted: true, summary: parseJson(job.summary, {}) });
    }
    const cached = previews.get(id);
    if (!cached || cached.expiresAt < Date.now()) {
      run("UPDATE csv_import_jobs SET status = 'expired' WHERE id = ?", [id]);
      fail(410, 'PREVIEW_EXPIRED', 'This import preview has expired. Upload the CSV again.');
    }
    const created = [];
    for (const row of cached.rows) {
      const lead = createLead(org, {
        lead: { ...row, ownerId: undefined },
        sourceName: row.source || 'CSV import', sourceKind: 'csv',
        createdBy: c.get('user').id, originLabel: 'CSV import',
      });
      created.push(lead.id);
    }
    const summary = { ...parseJson(job.summary, {}), committedRows: created.length, committedAt: nowIso() };
    run("UPDATE csv_import_jobs SET status = 'committed', committed_at = ?, summary = ? WHERE id = ?",
      [nowIso(), JSON.stringify(summary), id]);
    previews.delete(id);
    audit(c, 'import.committed', 'csv_import', id, { committedRows: created.length });
    return ok(c, { jobId: id, status: 'committed', summary, leadIds: created });
  });
}

/* ------------------------------------------------------- capture forms (auth) */
export function registerCaptureRoutes(app) {
  app.get('/api/v1/capture-forms', requireAuth, async (c) => {
    const { org } = resolveTenant(c);
    const form = one('SELECT * FROM capture_forms WHERE organization_id = ?', [org.id]);
    const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    return ok(c, {
      form: {
        ...form, fields: parseJson(form.fields, []),
        publicUrl: `${base}/form/${form.public_id}`,
      },
      canConfigure: c.get('role') === 'workspace_owner' || c.get('role') === 'workspace_admin',
    });
  });

  app.patch('/api/v1/capture-forms', requireAuth, requirePermission('capture:configure'), async (c) => {
    const body = await parseBody(c, captureConfigSchema);
    const { org } = resolveTenant(c);
    const sets = []; const args = [];
    const map = { title: 'title', intro: 'intro', consentNotice: 'consent_notice' };
    for (const [key, col] of Object.entries(map)) {
      if (body[key] !== undefined) { sets.push(`${col} = ?`); args.push(body[key]); }
    }
    if (body.fields !== undefined) { sets.push('fields = ?'); args.push(JSON.stringify(body.fields)); }
    if (body.active !== undefined) { sets.push('active = ?'); args.push(body.active ? 1 : 0); }
    if (!sets.length) fail(400, 'NO_CHANGES', 'No supported fields were provided.');
    sets.push('updated_at = ?'); args.push(nowIso(), org.id);
    run(`UPDATE capture_forms SET ${sets.join(', ')} WHERE organization_id = ?`, args);
    audit(c, 'capture.updated', 'capture_form', org.id, { fields: Object.keys(body) });
    return ok(c, { form: one('SELECT * FROM capture_forms WHERE organization_id = ?', [org.id]) });
  });

  app.post('/api/v1/capture-forms/rotate', requireAuth, requirePermission('capture:configure'), async (c) => {
    const { org } = resolveTenant(c);
    const publicId = `form_${randomToken(18)}`;
    run('UPDATE capture_forms SET public_id = ?, updated_at = ? WHERE organization_id = ?',
      [publicId, nowIso(), org.id]);
    audit(c, 'capture.rotated', 'capture_form', org.id);
    return ok(c, { publicId, note: 'The previous public link no longer works.' });
  });
}

/* -------------------------------------------------------- public capture form */
export function registerPublicRoutes(app) {
  app.get('/api/v1/public/forms/:publicId', rateLimit({ limit: 60, windowMs: 60000, scope: 'public-form-read' }), async (c) => {
    const form = one(
      `SELECT public_id, title, intro, consent_notice, fields, active FROM capture_forms WHERE public_id = ?`,
      [c.req.param('publicId')],
    );
    // Deliberately no workspace name, internal ids, owner info or admin settings.
    if (!form || !form.active) fail(404, 'FORM_UNAVAILABLE', 'This enquiry form is not available.');
    return ok(c, { form: { title: form.title, intro: form.intro, consentNotice: form.consent_notice, fields: parseJson(form.fields, []) } });
  });

  app.post('/api/v1/public/forms/:publicId',
    rateLimit({ limit: 5, windowMs: 60000, scope: 'public-form-submit' }), async (c) => {
      const body = await parseBody(c, captureSubmitSchema);
      if (body.website) fail(400, 'REJECTED', 'Submission could not be processed.');
      if (!body.consent) fail(400, 'CONSENT_REQUIRED', 'Please accept the consent notice.');
      const form = one(
        `SELECT f.*, o.id AS organization_id, o.timezone FROM capture_forms f
         JOIN organizations o ON o.id = f.organization_id WHERE f.public_id = ? AND f.active = 1`,
        [c.req.param('publicId')],
      );
      if (!form) fail(404, 'FORM_UNAVAILABLE', 'This enquiry form is not available.');
      const org = one('SELECT * FROM organizations WHERE id = ?', [form.organization_id]);
      const lead = createLead(org, {
        lead: {
          name: body.name, email: body.email, phone: body.phone, company: body.company,
          notes: body.message, consent: 'granted', priority: 'high',
        },
        sourceName: 'Website form', sourceKind: 'form',
        createdBy: null, allowOwner: false, originLabel: 'public capture form',
      });
      return ok(c, { received: true, reference: lead.id, note: 'Your enquiry was recorded. No automated message was sent.' }, 201);
    });
}

/* ------------------------------------------------------------------ webhooks */
export function registerWebhookRoutes(app) {
  app.get('/api/v1/webhooks/endpoints', requireAuth, requirePermission('webhooks:manage'), async (c) => {
    const { org } = resolveTenant(c);
    const items = all(
      `SELECT id, name, active, created_at, revoked_at FROM webhook_endpoints
       WHERE organization_id = ? ORDER BY created_at DESC`, [org.id],
    );
    return ok(c, { items, note: 'Secrets are never returned after creation.' });
  });

  app.post('/api/v1/webhooks/endpoints', requireAuth, requirePermission('webhooks:manage'), async (c) => {
    const body = await parseBody(c, webhookCreateSchema);
    const { org } = resolveTenant(c);
    const id = uid('whk'); const ts = nowIso();
    const secret = `whsec_${randomToken(32)}`;
    run(
      `INSERT INTO webhook_endpoints(id, organization_id, name, secret_hash, secret_enc, active, created_at)
       VALUES(?, ?, ?, ?, ?, 1, ?)`,
      [id, org.id, body.name, sha256(secret), encryptSecret(secret), ts],
    );
    audit(c, 'webhook.created', 'webhook_endpoint', id);
    return ok(c, {
      endpoint: { id, name: body.name, createdAt: ts },
      secret,
      note: 'Copy this secret now. It is stored encrypted and cannot be shown again. Sign the raw request body as HMAC-SHA256 over "<timestamp>.<body>".',
    }, 201);
  });

  app.delete('/api/v1/webhooks/endpoints/:id', requireAuth, requirePermission('webhooks:manage'), async (c) => {
    const { org } = resolveTenant(c);
    const row = one('SELECT id FROM webhook_endpoints WHERE id = ? AND organization_id = ?', [c.req.param('id'), org.id]);
    if (!row) fail(404, 'NOT_FOUND', 'Endpoint not found.');
    run('UPDATE webhook_endpoints SET active = 0, revoked_at = ? WHERE id = ?', [nowIso(), row.id]);
    audit(c, 'webhook.revoked', 'webhook_endpoint', row.id);
    return ok(c, { revoked: true });
  });

  app.post('/api/v1/webhooks/inbound/:endpointId',
    rateLimit({ limit: 120, windowMs: 60000, scope: 'webhook-inbound' }), async (c) => {
      const endpointId = c.req.param('endpointId');
      const endpoint = one('SELECT * FROM webhook_endpoints WHERE id = ? AND active = 1', [endpointId]);
      if (!endpoint) fail(404, 'ENDPOINT_UNAVAILABLE', 'Webhook endpoint is unavailable.');
      const timestamp = c.req.header('x-leadpulse-timestamp') || '';
      const signature = c.req.header('x-leadpulse-signature') || '';
      const eventId = c.req.header('x-leadpulse-event-id') || '';
      const raw = await c.req.text();
      const ts = nowIso();
      // Rejected deliveries use a shadow id so a failed attempt does not consume
      // the caller's real event id (a valid retry must still be accepted).
      const record = (status, reason, leadId = null, consumeEventId = true) => {
        const storedId = consumeEventId
          ? (eventId || `missing-${sha256(raw).slice(0, 12)}`)
          : `${eventId || 'missing'}:rejected-${sha256(raw + reason).slice(0, 10)}`;
        try {
          run(
            `INSERT INTO webhook_deliveries(id, organization_id, endpoint_id, event_id, status, reason, lead_id, received_at)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
            [uid('del'), endpoint.organization_id, endpointId, text(storedId, 120),
              status, reason, leadId, ts],
          );
        } catch { /* duplicate event id: handled below */ }
      };

      if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
        record('rejected', 'invalid_or_expired_timestamp', null, false);
        fail(401, 'REPLAY_REJECTED', 'Timestamp is missing or outside the 5-minute replay window.');
      }
      if (!eventId || !/^[\w-]{1,120}$/.test(eventId)) {
        record('rejected', 'missing_event_id', null, false);
        fail(400, 'EVENT_ID_REQUIRED', 'A unique X-LeadPulse-Event-Id header is required.');
      }
      const prior = one('SELECT * FROM webhook_deliveries WHERE endpoint_id = ? AND event_id = ?', [endpointId, eventId]);
      if (prior) {
        return ok(c, { duplicate: true, status: prior.status, leadId: prior.lead_id, note: 'Event was already processed; no new lead was created.' });
      }
      let secret;
      try { secret = decryptSecret(endpoint.secret_enc); }
      catch { record('rejected', 'secret_unavailable', null, false); fail(500, 'CONFIG_ERROR', 'Endpoint secret could not be read.'); }
      const expected = hmacHex(secret, `${timestamp}.${raw}`);
      if (!safeEqual(expected, signature)) {
        record('rejected', 'invalid_signature', null, false);
        fail(401, 'INVALID_SIGNATURE', 'HMAC signature did not match.');
      }
      let payload;
      try { payload = JSON.parse(raw); }
      catch { record('rejected', 'invalid_json', null, false); fail(400, 'INVALID_JSON', 'Request body must be valid JSON.'); }
      const parsed = webhookPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        record('rejected', 'schema_validation', null, false);
        fail(400, 'VALIDATION_ERROR', 'Webhook payload failed validation.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
      }
      const org = one('SELECT * FROM organizations WHERE id = ?', [endpoint.organization_id]);
      const lead = createLead(org, {
        lead: { ...parsed.data, notes: parsed.data.message || '' },
        sourceName: parsed.data.source || 'Webhook', sourceKind: 'webhook',
        createdBy: null, allowOwner: false, originLabel: 'signed inbound webhook',
      });
      record('accepted', '', lead.id);
      return ok(c, { accepted: true, leadId: lead.id }, 201);
    });
}

export function registerDataRoutes(app) {
  registerReportRoutes(app);
  registerImportRoutes(app);
  registerCaptureRoutes(app);
  registerPublicRoutes(app);
  registerWebhookRoutes(app);
}
