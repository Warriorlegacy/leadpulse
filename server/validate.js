import { z } from 'zod';
import { fail } from './security.js';

export async function parseBody(c, schema) {
  let body;
  try { body = await c.req.json(); } catch { fail(400, 'INVALID_JSON', 'Request body must be valid JSON.'); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    fail(400, 'VALIDATION_ERROR', 'Some fields need attention.', parsed.error.issues.map((i) => ({
      path: i.path.join('.'), message: i.message,
    })));
  }
  return parsed.data;
}

export function parseQuery(c, schema) {
  const raw = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    fail(400, 'VALIDATION_ERROR', 'Invalid query parameters.', parsed.error.issues.map((i) => ({
      path: i.path.join('.'), message: i.message,
    })));
  }
  return parsed.data;
}

const short = (max) => z.string().trim().max(max);
const optionalShort = (max) => short(max).optional().default('');

export const signupSchema = z.object({
  name: short(120).min(1),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
  workspaceName: short(120).min(2),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

export const switchOrgSchema = z.object({ organizationId: short(80).min(1) });

export const workspaceUpdateSchema = z.object({
  name: short(120).min(2).optional(),
  timezone: short(64).min(1).optional(),
  industry: optionalShort(120),
  currency: short(8).min(1).optional(),
  workingHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  workingHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  slaTargetMinutes: z.number().int().min(1).max(10080).optional(),
  slaBusinessHoursOnly: z.boolean().optional(),
});

export const inviteSchema = z.object({
  email: z.string().trim().email().max(200),
  role: z.enum(['workspace_admin', 'manager', 'agent']),
});

export const acceptInviteSchema = z.object({
  name: short(120).min(1).optional(),
  password: z.string().min(8).max(200).optional(),
});

export const memberRoleSchema = z.object({
  role: z.enum(['workspace_admin', 'manager', 'agent']),
  canViewUnassigned: z.boolean().optional(),
});

export const leadCreateSchema = z.object({
  name: short(160).min(1),
  company: optionalShort(160),
  email: optionalShort(200),
  phone: optionalShort(40),
  source: optionalShort(120),
  campaign: optionalShort(160),
  stageId: optionalShort(80),
  ownerId: z.string().trim().max(80).nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  consent: z.enum(['unknown', 'granted', 'declined']).optional(),
  notes: optionalShort(4000),
  amount: z.number().nonnegative().max(1e9).nullable().optional(),
  tags: z.array(short(40)).max(20).optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
});

export const leadUpdateSchema = leadCreateSchema.partial().extend({
  archived: z.boolean().optional(),
});

export const leadQuerySchema = z.object({
  search: z.string().max(200).optional(),
  stage: z.string().max(80).optional(),
  owner: z.string().max(80).optional(),
  source: z.string().max(120).optional(),
  tag: z.string().max(40).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  archived: z.enum(['true', 'false']).optional(),
  sort: z.enum(['created_at', 'updated_at', 'name', 'next_follow_up_at', 'priority']).optional().default('created_at'),
  dir: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export const transitionSchema = z.object({
  stageId: short(80).min(1),
  reason: optionalShort(500),
});

export const stageConfigSchema = z.object({
  stages: z.array(z.object({
    id: short(80).optional(),
    name: short(60).min(1),
    kind: z.enum(['open', 'won', 'lost']),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })).min(2).max(12),
});

export const activitySchema = z.object({
  type: z.enum(['call', 'email', 'meeting', 'note']),
  body: short(4000).min(1),
});

export const taskSchema = z.object({
  title: short(200).min(1),
  leadId: optionalShort(80),
  ownerId: optionalShort(80),
  dueAt: z.string().datetime(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  reminder: z.enum(['none', 'in_app', 'email']).optional(),
});

export const taskUpdateSchema = z.object({
  title: short(200).min(1).optional(),
  dueAt: z.string().datetime().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  completed: z.boolean().optional(),
  ownerId: optionalShort(80),
});

export const captureConfigSchema = z.object({
  title: short(160).min(1).optional(),
  intro: optionalShort(500),
  consentNotice: short(400).min(1).optional(),
  fields: z.array(z.enum(['name', 'email', 'phone', 'company', 'message'])).min(1).max(5).optional(),
  active: z.boolean().optional(),
});

export const captureSubmitSchema = z.object({
  name: short(160).min(1),
  email: optionalShort(200),
  phone: optionalShort(40),
  company: optionalShort(160),
  message: optionalShort(2000),
  consent: z.boolean(),
  // Honeypot: bots fill this; humans never see it.
  website: optionalShort(200),
});

export const importPreviewSchema = z.object({
  filename: short(200).optional(),
  csv: z.string().max(2 * 1024 * 1024).min(1),
  columnMap: z.record(z.string(), z.string()).optional(),
  idempotencyKey: short(120).min(8).max(120),
});

export const commitSchema = z.object({ confirm: z.literal(true) });

export const webhookCreateSchema = z.object({ name: short(120).min(1) });

export const webhookPayloadSchema = z.object({
  name: short(160).min(1),
  email: optionalShort(200),
  phone: optionalShort(40),
  company: optionalShort(160),
  source: optionalShort(120),
  campaign: optionalShort(160),
  message: optionalShort(2000),
});

export const reportQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const exportQuerySchema = leadQuerySchema;

export const mergeSchema = z.object({ sourceLeadId: short(80).min(1) });
