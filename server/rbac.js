import { getCookie } from 'hono/cookie';
import { one } from './context.js';
import { fail } from './security.js';
import { ORG_COOKIE } from './auth.js';

export const ROLES = ['platform_admin', 'workspace_owner', 'workspace_admin', 'manager', 'agent'];

/** Server-enforced capability matrix. See docs/PERMISSION_MATRIX.md. */
export const PERMISSIONS = {
  'workspace:update': ['workspace_owner', 'workspace_admin'],
  'workspace:delete': ['workspace_owner'],
  'members:manage': ['workspace_owner', 'workspace_admin'],
  'invites:manage': ['workspace_owner', 'workspace_admin'],
  'leads:view_all': ['workspace_owner', 'workspace_admin', 'manager'],
  'leads:view_assigned': ROLES,
  'leads:create': ROLES,
  'leads:edit': ROLES,
  'leads:assign': ['workspace_owner', 'workspace_admin', 'manager'],
  'leads:archive': ROLES,
  'leads:export': ['workspace_owner', 'workspace_admin', 'manager'],
  'leads:import': ['workspace_owner', 'workspace_admin', 'manager'],
  'pipeline:configure': ['workspace_owner', 'workspace_admin'],
  'pipeline:transition': ROLES,
  'activities:create': ROLES,
  'tasks:create': ROLES,
  'tasks:edit': ROLES,
  'reports:view': ['workspace_owner', 'workspace_admin', 'manager'],
  'capture:configure': ['workspace_owner', 'workspace_admin'],
  'webhooks:manage': ['workspace_owner', 'workspace_admin'],
  'audit:view': ['workspace_owner', 'workspace_admin', 'manager'],
  'platform:overview': [],
};

/** Never trust an organization id from the request body — derive it from membership. */
export function resolveTenant(c) {
  if (c.get('tenant')) return c.get('tenant');
  const user = c.get('user');
  if (!user) fail(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  const requested = getCookie(c, ORG_COOKIE);
  const byOrg = (orgId) => one(
    `SELECT m.* FROM memberships m WHERE m.user_id = ? AND m.organization_id = ?`,
    [user.id, orgId],
  );
  let membership = requested ? byOrg(requested) : null;
  if (!membership) {
    membership = one('SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1', [user.id]);
  }
  if (!membership) fail(403, 'NO_WORKSPACE', 'No workspace is available for this account.');
  const org = one('SELECT * FROM organizations WHERE id = ?', [membership.organization_id]);
  if (!org) fail(403, 'NO_WORKSPACE', 'Workspace not found.');
  const tenant = { org, role: membership.role, membership, user };
  c.set('tenant', tenant);
  c.set('org', org);
  c.set('orgId', org.id);
  c.set('role', membership.role);
  return tenant;
}

export function requirePermission(permission) {
  return async (c, next) => {
    const tenant = resolveTenant(c);
    const allowed = PERMISSIONS[permission] || [];
    const platformOnly = permission.startsWith('platform:');
    const isPlatform = Boolean(tenant.user?.isPlatformAdmin) && platformOnly;
    if (!allowed.includes(tenant.role) && !isPlatform) {
      fail(403, 'FORBIDDEN', `Your role (${tenant.role}) cannot perform this action.`);
    }
    await next();
  };
}

/** Agents only see leads assigned to them, plus the unassigned queue if permitted. */
export function visibleLead(c, leadId) {
  const tenant = resolveTenant(c);
  const lead = one('SELECT * FROM leads WHERE id = ? AND organization_id = ?', [leadId, tenant.org.id]);
  if (!lead) fail(404, 'NOT_FOUND', 'Lead not found.');
  if (tenant.role === 'agent') {
    const mine = lead.owner_id === tenant.user.id;
    const unassignedAllowed = Boolean(tenant.membership.can_view_unassigned) && !lead.owner_id;
    if (!mine && !unassignedAllowed) fail(403, 'FORBIDDEN', 'This lead is not assigned to you.');
  }
  return lead;
}

export function visibleTask(c, taskId) {
  const tenant = resolveTenant(c);
  const task = one('SELECT * FROM tasks WHERE id = ? AND organization_id = ?', [taskId, tenant.org.id]);
  if (!task) fail(404, 'NOT_FOUND', 'Task not found.');
  if (tenant.role === 'agent' && task.owner_id !== tenant.user.id) {
    fail(403, 'FORBIDDEN', 'This task is not assigned to you.');
  }
  return task;
}

export const can = (c, permission) => {
  const tenant = resolveTenant(c);
  return (PERMISSIONS[permission] || []).includes(tenant.role)
    || (permission.startsWith('platform:') && Boolean(tenant.user?.isPlatformAdmin));
};
