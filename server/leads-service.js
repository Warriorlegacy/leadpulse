import { one, all, run, tx } from './context.js';
import {
  uid, nowIso, text, normalizeEmail, normalizePhone, phoneTail, randomToken,
  validEmail, validPhone, similarity, clampInt,
} from './util.js';
import { fail } from './security.js';

export const LEAD_SELECT = `
  SELECT l.*, s.name AS source_name, st.name AS stage_name, st.kind AS stage_kind,
         st.color AS stage_color, st.position AS stage_position, u.name AS owner_name
  FROM leads l
  LEFT JOIN lead_sources s ON s.id = l.source_id
  LEFT JOIN pipeline_stages st ON st.id = l.stage_id
  LEFT JOIN users u ON u.id = l.owner_id`;

export function ensureSource(orgId, name, kind = 'manual') {
  const fallback = { form: 'Website form', csv: 'CSV import', webhook: 'Webhook', phone: 'Phone', campaign: 'Campaign', referral: 'Referral' }[kind] || 'Manual';
  const clean = text(name, 120) || fallback;
  const existing = one('SELECT id FROM lead_sources WHERE organization_id = ? AND name = ?', [orgId, clean]);
  if (existing) return existing.id;
  const id = uid('src');
  run('INSERT INTO lead_sources(id, organization_id, name, kind, created_at) VALUES(?, ?, ?, ?, ?)',
    [id, orgId, clean, kind, nowIso()]);
  return id;
}

export function defaultStage(orgId) {
  return one("SELECT * FROM pipeline_stages WHERE organization_id = ? AND kind = 'open' ORDER BY position LIMIT 1", [orgId]);
}

export function stageById(orgId, stageId) {
  return stageId ? one('SELECT * FROM pipeline_stages WHERE id = ? AND organization_id = ?', [stageId, orgId]) : null;
}

export function ensureTag(orgId, name) {
  const clean = text(name, 40).toLowerCase();
  if (!clean) return null;
  let row = one('SELECT id FROM tags WHERE organization_id = ? AND name = ?', [orgId, clean]);
  if (!row) {
    row = { id: uid('tag') };
    run('INSERT INTO tags(id, organization_id, name, color, created_at) VALUES(?, ?, ?, ?, ?)',
      [row.id, orgId, clean, '#6B7280', nowIso()]);
  }
  return row.id;
}

export function setTags(orgId, leadId, names = []) {
  run('DELETE FROM lead_tags WHERE lead_id = ?', [leadId]);
  for (const name of [...new Set(names)].slice(0, 20)) {
    const tagId = ensureTag(orgId, name);
    if (tagId) run('INSERT OR IGNORE INTO lead_tags(lead_id, tag_id) VALUES(?, ?)', [leadId, tagId]);
  }
}

export function tagsFor(orgId, leadIds) {
  if (!leadIds.length) return new Map();
  const placeholders = leadIds.map(() => '?').join(',');
  const rows = all(
    `SELECT lt.lead_id, t.name FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
     WHERE lt.lead_id IN (${placeholders})`, leadIds,
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.lead_id)) map.set(r.lead_id, []);
    map.get(r.lead_id).push(r.name);
  }
  return map;
}

export function hydrate(orgId, rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const tags = tagsFor(orgId, list.map((r) => r.id));
  const shaped = list.map((r) => ({ ...r, tags: tags.get(r.id) || [], amount: r.amount_cents == null ? null : r.amount_cents / 100 }));
  return Array.isArray(rows) ? shaped : shaped[0];
}

/** Single entry point for manual, CSV, capture-form and webhook lead creation. */
export function createLead(org, opts) {
  const {
    lead = {}, sourceName = 'Manual', sourceKind = 'manual',
    createdBy = null, originLabel = 'manual entry', allowOwner = true,
  } = opts;

  const name = text(lead.name, 160);
  const email = text(lead.email, 200);
  const phone = text(lead.phone, 40);
  const company = text(lead.company, 160);
  if (!name) fail(400, 'VALIDATION_ERROR', 'Lead name is required.');
  if (email && !validEmail(email)) fail(400, 'VALIDATION_ERROR', 'Enter a valid email address.');
  if (phone && !validPhone(phone)) fail(400, 'VALIDATION_ERROR', 'Enter a valid phone number (7–15 digits).');
  if (!email && !phone) fail(400, 'CONTACT_REQUIRED', 'Provide at least one contact method (email or phone).');

  const limits = one('SELECT max_leads FROM plan_limits WHERE organization_id = ?', [org.id]);
  const used = one('SELECT COUNT(*) AS n FROM leads WHERE organization_id = ? AND archived_at IS NULL', [org.id])?.n ?? 0;
  if (used >= (limits?.max_leads ?? 5000)) {
    fail(429, 'PLAN_LIMIT', 'This workspace has reached its pilot lead limit. Export data before adding more.');
  }

  const stage = stageById(org.id, lead.stageId) || defaultStage(org.id);
  if (!stage) fail(409, 'NO_STAGE', 'Configure a pipeline stage before creating leads.');

  let ownerId = null;
  if (allowOwner && lead.ownerId) {
    const member = one('SELECT user_id FROM memberships WHERE organization_id = ? AND user_id = ?', [org.id, lead.ownerId]);
    if (!member) fail(400, 'INVALID_OWNER', 'The selected owner is not a member of this workspace.');
    ownerId = lead.ownerId;
  }

  const sourceId = ensureSource(org.id, sourceName, sourceKind);
  const id = uid('lead');
  const ts = nowIso();
  const amountCents = typeof lead.amount === 'number' && Number.isFinite(lead.amount)
    ? Math.round(lead.amount * 100) : null;

  tx(() => {
    run(
      `INSERT INTO leads(id, organization_id, name, company, email, email_norm, phone, phone_norm,
        source_id, campaign, stage_id, owner_id, priority, consent, notes, amount_cents,
        next_follow_up_at, first_response_at, created_by, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, org.id, name, company, email, normalizeEmail(email), phone, normalizePhone(phone),
        sourceId, text(lead.campaign, 160), stage.id, ownerId,
        lead.priority || 'normal', lead.consent || 'unknown',
        text(lead.notes ?? lead.message, 4000), amountCents,
        lead.nextFollowUpAt || null, null, createdBy, ts, ts,
      ],
    );
    run(
      `INSERT INTO stage_events(id, organization_id, lead_id, from_stage_id, to_stage_id, reason, actor_id, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid('ste'), org.id, id, null, stage.id, 'Lead created', createdBy, ts],
    );
    run(
      `INSERT INTO activities(id, organization_id, lead_id, type, body, actor_id, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [uid('act'), org.id, id, 'system', `Lead created via ${originLabel}. This is a logged record, not a sent message.`, createdBy, ts],
    );
    if (Array.isArray(lead.tags)) setTags(org.id, id, lead.tags);
    if (ownerId) {
      run(
        `INSERT INTO notifications(id, organization_id, user_id, kind, message, lead_id, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [uid('ntf'), org.id, ownerId, 'assignment', `A new lead was assigned to you: ${name}`, id, ts],
      );
    }
  });
  return one(`${LEAD_SELECT} WHERE l.id = ? AND l.organization_id = ?`, [id, org.id]);
}

export function updateLead(org, lead, patch, actorId = null) {
  const fields = [];
  const args = [];
  const map = {
    name: ['name', (v) => text(v, 160)],
    company: ['company', (v) => text(v, 160)],
    email: ['email', (v) => text(v, 200)],
    phone: ['phone', (v) => text(v, 40)],
    campaign: ['campaign', (v) => text(v, 160)],
    notes: ['notes', (v) => text(v, 4000)],
    priority: ['priority', (v) => v],
    consent: ['consent', (v) => v],
    nextFollowUpAt: ['next_follow_up_at', (v) => v || null],
  };
  for (const [key, [column, fn]] of Object.entries(map)) {
    if (patch[key] !== undefined) { fields.push(`${column} = ?`); args.push(fn(patch[key])); }
  }
  if (patch.email !== undefined) {
    const e = text(patch.email, 200);
    if (e && !validEmail(e)) fail(400, 'VALIDATION_ERROR', 'Enter a valid email address.');
    fields.push('email_norm = ?'); args.push(normalizeEmail(e));
  }
  if (patch.phone !== undefined) {
    const p = text(patch.phone, 40);
    if (p && !validPhone(p)) fail(400, 'VALIDATION_ERROR', 'Enter a valid phone number (7–15 digits).');
    fields.push('phone_norm = ?'); args.push(normalizePhone(p));
  }
  if (patch.amount !== undefined) {
    fields.push('amount_cents = ?');
    args.push(patch.amount === null ? null : Math.round(patch.amount * 100));
  }
  if (patch.ownerId !== undefined) {
    if (patch.ownerId) {
      const member = one('SELECT user_id FROM memberships WHERE organization_id = ? AND user_id = ?', [org.id, patch.ownerId]);
      if (!member) fail(400, 'INVALID_OWNER', 'The selected owner is not a member of this workspace.');
    }
    fields.push('owner_id = ?'); args.push(patch.ownerId || null);
  }
  if (patch.source !== undefined) {
    fields.push('source_id = ?'); args.push(ensureSource(org.id, patch.source, 'manual'));
  }
  if (patch.archived !== undefined) {
    fields.push('archived_at = ?'); args.push(patch.archived ? nowIso() : null);
  }
  if (!fields.length) return lead;
  fields.push('updated_at = ?'); args.push(nowIso());
  args.push(lead.id, org.id);
  run(`UPDATE leads SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`, args);
  if (patch.tags !== undefined) setTags(org.id, lead.id, patch.tags);
  if (patch.ownerId !== undefined && patch.ownerId && patch.ownerId !== lead.owner_id) {
    run(`INSERT INTO activities(id, organization_id, lead_id, type, body, actor_id, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [uid('act'), org.id, lead.id, 'system', 'Lead ownership changed (logged).', actorId, nowIso()]);
  }
  return one(`${LEAD_SELECT} WHERE l.id = ? AND l.organization_id = ?`, [lead.id, org.id]);
}

/** Human activity starts the response clock exactly once; history is never rewritten. */
export function logActivity(org, leadId, actorId, type, body) {
  const ts = nowIso();
  const activityId = uid('act');
  return tx(() => {
    run(
      `INSERT INTO activities(id, organization_id, lead_id, type, body, actor_id, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [activityId, org.id, leadId, type, text(body, 4000), actorId, ts],
    );
    const lead = one('SELECT first_response_at FROM leads WHERE id = ? AND organization_id = ?', [leadId, org.id]);
    if (['call', 'email', 'meeting'].includes(type) && !lead?.first_response_at) {
      run('UPDATE leads SET first_response_at = ?, updated_at = ? WHERE id = ? AND organization_id = ?',
        [ts, ts, leadId, org.id]);
    } else {
      run('UPDATE leads SET updated_at = ? WHERE id = ? AND organization_id = ?', [ts, leadId, org.id]);
    }
    return one('SELECT * FROM activities WHERE id = ?', [activityId]);
  });
}

export function transitionStage(orgId, lead, toStageId, actorId, reason = '') {
  const from = stageById(orgId, lead.stage_id);
  const to = stageById(orgId, toStageId);
  if (!to) fail(404, 'INVALID_STAGE', 'That pipeline stage does not exist in this workspace.');
  if (to.id === lead.stage_id) fail(400, 'NO_CHANGE', 'The lead is already in this stage.');
  if (from && from.kind !== 'open' && to.kind !== 'open') {
    fail(409, 'INVALID_TRANSITION', 'A closed (won/lost) lead must be reopened before moving to another closed stage.');
  }
  const ts = nowIso();
  tx(() => {
    run('UPDATE leads SET stage_id = ?, updated_at = ? WHERE id = ? AND organization_id = ?', [to.id, ts, lead.id, orgId]);
    run(
      `INSERT INTO stage_events(id, organization_id, lead_id, from_stage_id, to_stage_id, reason, actor_id, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid('ste'), orgId, lead.id, from?.id ?? null, to.id, text(reason, 500), actorId, ts],
    );
    run(
      `INSERT INTO activities(id, organization_id, lead_id, type, body, actor_id, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [uid('act'), orgId, lead.id, 'system', `Stage changed: ${from?.name ?? '—'} → ${to.name} (logged).`, actorId, ts],
    );
  });
  return one(`${LEAD_SELECT} WHERE l.id = ? AND l.organization_id = ?`, [lead.id, orgId]);
}

/** Propose candidates only. Never merges automatically. */
export function duplicateCandidates(orgId, lead) {
  const candidates = new Map();
  const base = one('SELECT * FROM leads WHERE id = ? AND organization_id = ?', [lead.id, orgId]);
  if (!base) return [];
  const pool = all(
    `SELECT l.id, l.name, l.company, l.email, l.phone, l.email_norm, l.phone_norm, l.created_at, l.stage_id
     FROM leads l WHERE l.organization_id = ? AND l.id != ? AND l.archived_at IS NULL LIMIT 2000`,
    [orgId, lead.id],
  );
  for (const other of pool) {
    const reasons = [];
    if (base.email_norm && base.email_norm === other.email_norm) reasons.push('same email');
    const baseTail = phoneTail(base.phone_norm); const otherTail = phoneTail(other.phone_norm);
    if (baseTail && baseTail.length >= 7 && baseTail === otherTail) reasons.push('same phone');
    const nameScore = similarity(base.name, other.name);
    const companyScore = similarity(base.company, other.company);
    if (nameScore >= 0.72 && companyScore >= 0.5) reasons.push('similar name and company');
    else if (nameScore >= 0.88) reasons.push('very similar name');
    if (reasons.length) {
      const row = one(`${LEAD_SELECT} WHERE l.id = ? AND l.organization_id = ?`, [other.id, orgId]);
      candidates.set(other.id, { ...row, reasons, score: Math.round((nameScore + companyScore) * 50) });
    }
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 10);
}

/** Explicit, confirmed merge. All history is retained on the surviving record. */
export function mergeLeads(orgId, target, source, actorId) {
  if (target.id === source.id) fail(400, 'INVALID_MERGE', 'A lead cannot be merged into itself.');
  const ts = nowIso();
  tx(() => {
    run('UPDATE activities SET lead_id = ? WHERE lead_id = ? AND organization_id = ?', [target.id, source.id, orgId]);
    run('UPDATE tasks SET lead_id = ? WHERE lead_id = ? AND organization_id = ?', [target.id, source.id, orgId]);
    run('UPDATE stage_events SET lead_id = ? WHERE lead_id = ? AND organization_id = ?', [target.id, source.id, orgId]);
    const sourceTags = all('SELECT tag_id FROM lead_tags WHERE lead_id = ?', [source.id]);
    for (const t of sourceTags) run('INSERT OR IGNORE INTO lead_tags(lead_id, tag_id) VALUES(?, ?)', [target.id, t.tag_id]);
    run('DELETE FROM lead_tags WHERE lead_id = ?', [source.id]);
    run('UPDATE leads SET merged_into_id = ?, archived_at = ?, updated_at = ? WHERE id = ? AND organization_id = ?',
      [target.id, ts, ts, source.id, orgId]);
    run(`INSERT INTO activities(id, organization_id, lead_id, type, body, actor_id, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [uid('act'), orgId, target.id, 'system', `Merged lead ${source.id} into this record. All activity history was preserved (logged).`, actorId, ts]);
  });
  return one(`${LEAD_SELECT} WHERE l.id = ? AND l.organization_id = ?`, [target.id, orgId]);
}

export const DEFAULT_STAGES = [
  { name: 'New', kind: 'open', color: '#3B6EA5' },
  { name: 'Contacted', kind: 'open', color: '#7A5AF8' },
  { name: 'Qualified', kind: 'open', color: '#0F766E' },
  { name: 'Proposal', kind: 'open', color: '#D97706' },
  { name: 'Won', kind: 'won', color: '#15803D' },
  { name: 'Lost', kind: 'lost', color: '#B91C1C' },
];

export function createWorkspaceForUser(userId, workspaceName, { isDemo = false, timezone = 'Asia/Kolkata' } = {}) {
  const orgId = uid('org');
  const ts = nowIso();
  const slugBase = String(workspaceName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workspace';
  const slug = `${slugBase}-${orgId.slice(-6)}`;
  tx(() => {
    run(
      `INSERT INTO organizations(id, name, slug, timezone, is_demo, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [orgId, text(workspaceName, 120), slug, timezone, isDemo ? 1 : 0, ts, ts],
    );
    run(
      `INSERT INTO memberships(id, organization_id, user_id, role, can_view_unassigned, created_at)
       VALUES(?, ?, ?, ?, ?, ?)`,
      [uid('mem'), orgId, userId, 'workspace_owner', 1, ts],
    );
    DEFAULT_STAGES.forEach((stage, i) => {
      run(
        `INSERT INTO pipeline_stages(id, organization_id, name, position, kind, color, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [uid('stg'), orgId, stage.name, i, stage.kind, stage.color, ts],
      );
    });
    run('INSERT INTO plan_limits(organization_id, plan, updated_at) VALUES(?, ?, ?)', [orgId, 'pilot', ts]);
    run(
      `INSERT INTO capture_forms(id, organization_id, public_id, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?)`,
      [uid('frm'), orgId, `form_${randomToken(18)}`, ts, ts],
    );
    run('INSERT INTO notification_preferences(user_id, organization_id, in_app, email) VALUES(?, ?, 1, 0)', [userId, orgId]);
  });
  return one('SELECT * FROM organizations WHERE id = ?', [orgId]);
}

export const pagination = (query) => ({
  page: clampInt(query.page, 1, 10000, 1),
  pageSize: clampInt(query.pageSize, 1, 100, 25),
});
