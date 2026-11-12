import { uid } from './util.js';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const fail = (status, code, message, details) => {
  throw new ApiError(status, code, message, details);
};

export function clientIp(c) {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim().slice(0, 64);
  return (c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'local').slice(0, 64);
}

export async function requestContext(c, next) {
  const incoming = c.req.header('x-request-id');
  const id = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : uid('req');
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  await next();
}

export async function securityHeaders(c, next) {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; " +
    "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self' data:; connect-src 'self'; object-src 'none'",
  );
  if (c.req.header('x-forwarded-proto') === 'https' || c.req.url.startsWith('https://')) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

const buckets = new Map();
let lastPrune = Date.now();

/** In-memory sliding-window limiter. Per-process; adequate for a single-instance pilot. */
export function rateLimit({ limit = 10, windowMs = 60000, scope = 'default', keyFn } = {}) {
  return async (c, next) => {
    const now = Date.now();
    if (now - lastPrune > 120000) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
      lastPrune = now;
    }
    const key = `${scope}:${keyFn ? keyFn(c) : clientIp(c)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);
    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    if (bucket.count > limit) {
      c.header('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      fail(429, 'RATE_LIMITED', 'Too many requests. Please wait and try again.');
    }
    await next();
  };
}

export function errorHandler(err, c) {
  const requestId = c.get('requestId') || uid('req');
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) }, requestId }, err.status);
  }
  // Never leak stack traces, SQL, secrets or PII to clients.
  console.error(`[leadpulse] ${requestId} unhandled:`, err?.message || 'unknown error');
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please retry.' }, requestId }, 500);
}

export const ok = (c, data, status = 200) => c.json({ data, requestId: c.get('requestId') }, status);
