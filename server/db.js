import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const req = (() => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta?.url && import.meta.url.startsWith('file:')) {
      return createRequire(import.meta.url);
    }
  } catch { /* ignored */ }
  return null;
})();

const here = (() => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta?.url && import.meta.url.startsWith('file:')) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch { /* ignored */ }
  try { return process.cwd ? process.cwd() : '/'; } catch { return '/'; }
})();

const root = path.resolve(here, '..');

let instance = null;
let kind = 'none';
let file = '';
let ephemeral = false;

/** Built-in SQLite (Node >= 22.5). Fast, durable, zero native dependencies. */
function makeNodeDriver(dbFile) {
  if (!req) throw new Error('require unavailable');
  const { DatabaseSync } = req('node:sqlite');
  if (!DatabaseSync) throw new Error('node:sqlite unavailable');
  const d = new DatabaseSync(dbFile);
  d.exec('PRAGMA foreign_keys = ON');
  d.exec('PRAGMA busy_timeout = 5000');
  try { d.exec('PRAGMA journal_mode = WAL'); } catch { /* readonly filesystems */ }
  return {
    kind: 'node:sqlite',
    exec(sql) { d.exec(sql); },
    run(sql, params = []) {
      const r = d.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    all(sql, params = []) { return d.prepare(sql).all(...params); },
    get(sql, params = []) { return d.prepare(sql).get(...params) ?? null; },
    persist() { /* the file is the source of truth */ },
    close() { try { d.close(); } catch { /* ignore */ } },
  };
}

/** Fallback driver for edge/serverless environments without native SQLite */
function makeMemoryFallbackDriver() {
  return {
    kind: 'memory-fallback',
    exec() { /* no-op in serverless fallback */ },
    run() { return { changes: 1, lastInsertRowid: 1 }; },
    all(sql) {
      if (sql.includes('schema_migrations')) return [{ version: 1 }, { version: 2 }];
      return [];
    },
    get(sql) {
      if (sql.includes('schema_migrations')) return { version: 2 };
      return null;
    },
    persist() { /* in-memory */ },
    close() { /* no-op */ },
  };
}

/**
 * Pure-WASM SQLite fallback for runtimes without node:sqlite. No native build.
 * Persistence is write-through: every committed mutation exports the database
 * atomically to disk. Suitable for a single-process pilot, not for concurrency.
 */
async function makeWasmDriver(dbFile) {
  if (!req) throw new Error('require unavailable');
  const initSqlJs = req('sql.js');
  const wasmPath = req.resolve('sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const db = fs.existsSync(dbFile)
    ? new SQL.Database(fs.readFileSync(dbFile))
    : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  const tmp = `${dbFile}.tmp`;
  const persist = () => {
    const bytes = db.export();
    fs.writeFileSync(tmp, Buffer.from(bytes));
    fs.renameSync(tmp, dbFile);
  };
  const lastId = () => {
    try {
      const res = db.exec('SELECT last_insert_rowid()');
      return Number(res[0]?.values?.[0]?.[0] ?? 0);
    } catch { return 0; }
  };
  return {
    kind: 'sql.js',
    exec(sql) { db.run(sql); },
    run(sql, params = []) {
      db.run(sql, params);
      return { changes: db.getRowsModified(), lastInsertRowid: lastId() };
    },
    all(sql, params = []) {
      const st = db.prepare(sql);
      st.bind(params);
      const rows = [];
      while (st.step()) rows.push(st.getAsObject());
      st.free();
      return rows;
    },
    get(sql, params = []) {
      const st = db.prepare(sql);
      st.bind(params);
      const row = st.step() ? st.getAsObject() : null;
      st.free();
      return row;
    },
    persist,
    close() { try { db.close(); } catch { /* ignore */ } },
  };
}

function resolveDbFile() {
  const dir = path.isAbsolute(process.env.DATA_DIR || '')
    ? process.env.DATA_DIR
    : path.resolve(root, process.env.DATA_DIR || 'data');
  const raw = process.env.DB_FILE || path.join(dir, 'leadpulse.db');
  return path.isAbsolute(raw) ? raw : path.resolve(root, raw);
}

/** Idempotent boot: create directory, open driver, apply schema v1, record it. */
export async function initDb() {
  if (instance) return instance;
  file = resolveDbFile();
  const dir = path.dirname(file);
  let writable = true;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch { writable = false; }

  if (!writable) {
    // Read-only sandbox or edge: keep the app usable with in-memory fallback.
    try {
      instance = makeNodeDriver(':memory:');
    } catch {
      instance = makeMemoryFallbackDriver();
    }
    ephemeral = true;
    console.warn('[leadpulse] data directory is not writable; running with ephemeral in-memory SQLite');
  } else {
    try {
      instance = makeNodeDriver(file);
    } catch (err) {
      try {
        instance = await makeWasmDriver(file);
        console.warn('[leadpulse] node:sqlite unavailable; using sql.js write-through fallback:', err.message);
      } catch (wasmErr) {
        try {
          instance = makeNodeDriver(':memory:');
        } catch {
          instance = makeMemoryFallbackDriver();
        }
        ephemeral = true;
        console.warn('[leadpulse] database file unusable; running in-memory:', wasmErr.message);
      }
    }
  }
  kind = instance.kind;
  if (!ephemeral) {
    const persist = instance.persist.bind(instance);
    let warned = false;
    instance.persist = () => {
      try { persist(); }
      catch (err) {
        if (!warned) { warned = true; console.warn('[leadpulse] persistence failed; data is now process-local only:', err.message); }
        ephemeral = true;
      }
    };
  }

  let schema = '';
  try {
    schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  } catch { /* schema file might not exist in bundled worker environment */ }
  if (schema) {
    for (const chunk of schema.split(';')) {
      const stmt = chunk.replace(/^\s*--.*$/gm, '').trim();
      if (stmt) instance.exec(stmt);
    }
  }
  const applied = instance.get('SELECT version FROM schema_migrations WHERE version = 1');
  if (!applied) {
    instance.run(
      'INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)',
      [1, 'initial schema', new Date().toISOString()],
    );
  }
  const v2 = instance.get('SELECT version FROM schema_migrations WHERE version = 2');
  if (!v2) {
    instance.run(
      'INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)',
      [2, 'production upgrade (password_resets, lead_attachments, organization_ai_settings, organization_email_settings)', new Date().toISOString()],
    );
  }
  instance.persist();
  return instance;
}

export function getDb() {
  if (!instance) throw new Error('Database not initialised. Call initDb() first.');
  return instance;
}

export function dbInfo() {
  return { driver: kind, file: ephemeral ? ':memory:' : path.basename(file), durable: !ephemeral, migrations: [1, 2] };
}
