import { getDb } from './db.js';
import { uid, nowIso } from './util.js';
import { clientIp } from './security.js';

let inTransaction = false;

export const all = (sql, params = []) => getDb().all(sql, params);
export const one = (sql, params = []) => getDb().get(sql, params);

export function run(sql, params = []) {
  const result = getDb().run(sql, params);
  if (!inTransaction) getDb().persist();
  return result;
}

export function exec(sql) {
  getDb().exec(sql);
  if (!inTransaction) getDb().persist();
}

/** Synchronous transaction. Reentrant so services can compose safely. */
export function tx(fn) {
  if (inTransaction) return fn();
  const db = getDb();
  inTransaction = true;
  db.exec('BEGIN');
  try {
    const value = fn();
    db.exec('COMMIT');
    inTransaction = false;
    db.persist();
    return value;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    inTransaction = false;
    throw err;
  }
}

/** Best-effort audit trail. Never logs PII, payloads, tokens or secrets. */
export function audit(c, action, entityType = '', entityId = '', metadata = {}) {
  try {
    const orgId = c.get('orgId');
    if (!orgId) return;
    run(
      `INSERT INTO audit_events(id, organization_id, actor_id, action, entity_type, entity_id, metadata, ip, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uid('aud'), orgId, c.get('user')?.id ?? null, action, entityType, String(entityId),
        JSON.stringify(metadata), clientIp(c), nowIso(),
      ],
    );
  } catch (err) {
    console.warn('[leadpulse] audit write failed:', err.message);
  }
}
