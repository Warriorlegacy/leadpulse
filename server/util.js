import crypto from 'node:crypto';

/* ---------------------------------------------------------------- identifiers */
export const uid = (prefix = 'id') => `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/* ---------------------------------------------------------------- passwords */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
    return safeEqualBytes(expected, actual);
  } catch { return false; }
}

function safeEqualBytes(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------------------------------------------------------- text + PII */
export function text(value, max = 2000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

export const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v ?? '').trim());
export const normalizeEmail = (v) => String(v ?? '').trim().toLowerCase();
export const normalizePhone = (v) => String(v ?? '').replace(/\D/g, '');
export const phoneTail = (v) => {
  const digits = normalizePhone(v);
  return digits.length > 10 ? digits.slice(-10) : digits;
};
export const validPhone = (v) => {
  const d = normalizePhone(v);
  return d.length >= 7 && d.length <= 15;
};

/** Dice coefficient over character bigrams; 0..1, used only to PROPOSE duplicates. */
export function similarity(a, b) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const x = norm(a); const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s) => {
    const out = new Map();
    const t = s.replace(/\s+/g, ' ');
    for (let i = 0; i < t.length - 1; i += 1) {
      const g = t.slice(i, i + 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  };
  const gx = grams(x); const gy = grams(y);
  let overlap = 0; let total = 0;
  for (const [g, n] of gx) { total += n; overlap += Math.min(n, gy.get(g) || 0); }
  for (const n of gy.values()) total += n;
  return total ? (2 * overlap) / total : 0;
}

/* ---------------------------------------------------------------- time + SLA */
export const nowIso = () => new Date().toISOString();
export const addMinutes = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60000).toISOString();
export const validIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function tzParts(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return { p, wallAsUtc: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) };
}

export function tzOffsetMs(utcMs, timeZone) {
  return tzParts(utcMs, timeZone).wallAsUtc - utcMs;
}

export function dateInTz(utcMs, timeZone) {
  const { p } = tzParts(utcMs, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Convert a wall-clock time in `timeZone` on `day` (YYYY-MM-DD) into a UTC instant. */
export function zonedToUtc(day, hhmm, timeZone) {
  const guess = Date.parse(`${day}T${hhmm}:00Z`);
  let utc = guess - tzOffsetMs(guess, timeZone);
  utc = guess - tzOffsetMs(utc, timeZone); // second pass for DST boundaries
  return utc;
}

/**
 * Elapsed minutes between two instants. With `sla_business_hours_only`, only
 * minutes inside configured working days/hours (workspace timezone) count.
 * All inputs/outputs are UTC-based; no historical metric is rewritten.
 */
export function elapsedMinutes(startIso, endIso, org, businessOnly = false) {
  const start = Date.parse(startIso); const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  if (!businessOnly) return Math.round((end - start) / 60000);
  const tz = org?.timezone || 'Asia/Kolkata';
  const days = new Set(String(org?.working_days || '1,2,3,4,5').split(',').map(Number));
  const startDay = dateInTz(start, tz);
  const endDay = dateInTz(end, tz);
  let total = 0;
  let cursor = Date.parse(`${startDay}T00:00:00Z`);
  const last = Date.parse(`${endDay}T00:00:00Z`);
  let guard = 0;
  while (cursor <= last && guard < 400) {
    guard += 1;
    const day = new Date(cursor).toISOString().slice(0, 10);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // weekday of the local calendar date
    if (days.has(dow === 0 ? 7 : dow)) {
      const ws = zonedToUtc(day, org?.working_hours_start || '09:00', tz);
      const we = zonedToUtc(day, org?.working_hours_end || '18:00', tz);
      const lo = Math.max(start, ws);
      const hi = Math.min(end, we);
      if (hi > lo) total += (hi - lo) / 60000;
    }
    cursor += 86400000;
  }
  return Math.round(total);
}

/* ---------------------------------------------------------------- CSV safety */
/**
 * Small, strict CSV parser. Handles quoted fields, embedded newlines and escaped
 * quotes; rejects oversized input and records ragged/unterminated rows.
 */
export function parseCsv(input, { maxRows = 5000, maxCols = 40, maxBytes = 2 * 1024 * 1024 } = {}) {
  const errors = [];
  if (typeof input !== 'string') return { rows: [], errors: ['CSV input is not text'], truncated: false };
  if (Buffer.byteLength(input, 'utf8') > maxBytes) {
    return { rows: [], errors: [`CSV exceeds ${Math.round(maxBytes / 1024)} KB limit`], truncated: true };
  }
  const src = input.replace(/^\uFEFF/, '');
  const rows = [];
  let row = []; let field = ''; let quoted = false; let i = 0; let truncated = false;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"' && field.length === 0) { quoted = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = ''; i += 1;
      if (rows.length >= maxRows) {
        truncated = true; errors.push(`CSV truncated at ${maxRows} rows`);
        return { rows, errors, truncated };
      }
      continue;
    }
    field += ch; i += 1;
  }
  if (quoted) errors.push('Malformed CSV: unterminated quoted field');
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const width = rows[0]?.length ?? 0;
  if (width > maxCols) errors.push(`CSV has ${width} columns; maximum is ${maxCols}`);
  rows.forEach((r, idx) => {
    if (r.length !== width) errors.push(`Row ${idx + 1} has ${r.length} columns; expected ${width}`);
  });
  return { rows, errors, truncated };
}

/** Neutralise spreadsheet formula payloads, then RFC-4180 quote the value. */
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const toCsv = (headers, rows) => [
  headers.map(csvCell).join(','),
  ...rows.map((r) => r.map(csvCell).join(',')),
].join('\r\n');

/* ---------------------------------------------------------------- misc */
export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}
