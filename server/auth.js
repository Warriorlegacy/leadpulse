import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { one, run, all } from './context.js';
import { ApiError, fail } from './security.js';
import {
  uid, sha256, randomToken, safeEqual, hashPassword, verifyPassword,
  nowIso, addMinutes, validEmail, text,
} from './util.js';

const SESSION_COOKIE = 'lp_session';
const ORG_COOKIE = 'lp_org';
const SESSION_DAYS = 30;

export { ORG_COOKIE };

function isSecure(c) {
  return c.req.header('x-forwarded-proto') === 'https' || c.req.url.startsWith('https://');
}

function cookieBase(c) {
  return { path: '/', httpOnly: true, secure: isSecure(c), sameSite: 'Lax' };
}

export function createSession(c, userId) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const ts = nowIso();
  run(
    `INSERT INTO sessions(id, user_id, token_hash, csrf_token, expires_at, created_at, last_seen_at)
     VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [uid('ses'), userId, sha256(token), csrf, addMinutes(ts, SESSION_DAYS * 1440), ts, ts],
  );
  setCookie(c, SESSION_COOKIE, token, { ...cookieBase(c), maxAge: SESSION_DAYS * 86400 });
  return { token, csrfToken: csrf };
}

export function clearSession(c) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
  deleteCookie(c, SESSION_COOKIE, cookieBase(c));
  deleteCookie(c, ORG_COOKIE, cookieBase(c));
}

export function readSession(c) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const row = one(
    `SELECT s.*, u.id AS uid, u.email, u.name, u.is_platform_admin
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    [sha256(token)],
  );
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  return row;
}

export async function requireAuth(c, next) {
  const session = readSession(c);
  if (!session) fail(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  c.set('session', session);
  c.set('user', {
    id: session.uid,
    email: session.email,
    name: session.name,
    isPlatformAdmin: Boolean(session.is_platform_admin),
  });
  await next();
}

/** Double-submit CSRF token bound to the server-side session. Public endpoints exempt. */
const CSRF_EXEMPT = [
  /^\/api\/v1\/auth\/(signup|login|logout)$/,
  /^\/api\/v1\/public\//,
  /^\/api\/v1\/webhooks\/inbound\//,
  /^\/api\/v1\/billing\/webhook\//,
  /^\/api\/v1\/health$/,
];

export async function csrfGuard(c, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) return next();
  const path = new URL(c.req.url).pathname;
  if (CSRF_EXEMPT.some((re) => re.test(path))) return next();
  const session = c.get('session') || readSession(c);
  if (!session) return next(); // requireAuth will produce the 401
  const provided = c.req.header('x-csrf-token');
  if (!provided || !safeEqual(provided, session.csrf_token)) {
    fail(403, 'CSRF_FAILED', 'The security token is missing or invalid. Refresh the page and retry.');
  }
  return next();
}

export function publicUser(row) {
  return { id: row.id, email: row.email, name: row.name, isPlatformAdmin: Boolean(row.is_platform_admin) };
}

export function validateCredentials(email, password, name) {
  const cleanEmail = normalizeEmailSafe(email);
  if (!validEmail(cleanEmail)) fail(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  if (String(password ?? '').length < 8) fail(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters.');
  if (name !== undefined && text(name, 120).length < 1) fail(400, 'INVALID_NAME', 'Enter your name.');
  return cleanEmail;
}

const normalizeEmailSafe = (v) => String(v ?? '').trim().toLowerCase();

export function passwordMatches(password, stored) {
  return verifyPassword(password, stored);
}

export function makePasswordHash(password) {
  return hashPassword(password);
}

export function userOrganizations(userId) {
  return all(
    `SELECT o.id, o.name, o.slug, o.is_demo, m.role, m.can_view_unassigned
     FROM memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = ? ORDER BY m.created_at`,
    [userId],
  );
}

export function activeOrgId(c, userId) {
  const requested = getCookie(c, ORG_COOKIE);
  if (requested) {
    const hit = one('SELECT organization_id FROM memberships WHERE user_id = ? AND organization_id = ?', [userId, requested]);
    if (hit) return hit.organization_id;
  }
  const first = one('SELECT organization_id FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1', [userId]);
  return first?.organization_id ?? null;
}

export function setActiveOrg(c, orgId) {
  setCookie(c, ORG_COOKIE, orgId, { ...cookieBase(c), maxAge: SESSION_DAYS * 86400 });
}

/** Used by tests and the local smoke script without going through HTTP cookies. */
export function sessionCount(userId) {
  return one('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?', [userId, nowIso()])?.n ?? 0;
}

export { ApiError };
