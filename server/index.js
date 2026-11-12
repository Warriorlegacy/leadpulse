import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { initDb, dbInfo } from './db.js';
import { seedDemo } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const publicDir = path.join(root, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#12202f"/><path d="M8 34h12l6-14 9 26 6-12h15" fill="none" stroke="#f0a63a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function attachStatic(app) {
  app.get('*', (c) => {
    const url = new URL(c.req.url);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { return c.text('Bad request', 400); }

    if (pathname === '/favicon.svg') {
      c.header('Content-Type', 'image/svg+xml');
      c.header('Cache-Control', 'public, max-age=86400');
      return c.body(FAVICON);
    }
    if (pathname === '/robots.txt') {
      c.header('Content-Type', 'text/plain; charset=utf-8');
      return c.body('User-agent: *\nAllow: /$\nAllow: /pricing\nAllow: /privacy\nAllow: /terms\nDisallow: /app\nDisallow: /api/\nDisallow: /form/\n');
    }
    if (pathname.startsWith('/api/')) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'No API route matches this request.' } }, 404);
    }

    // Resolve strictly inside public/ to block path traversal.
    const candidate = path.resolve(publicDir, `.${pathname}`);
    if (candidate !== publicDir && !candidate.startsWith(publicDir + path.sep)) {
      return c.text('Forbidden', 403);
    }
    let filePath = candidate;
    if (pathname === '/' || !path.extname(pathname)) filePath = path.join(publicDir, 'index.html');
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      const index = path.join(publicDir, 'index.html');
      if (!fs.existsSync(index)) return c.text('Frontend build is missing. Run: npm run build', 503);
      filePath = index;
    }
    const ext = path.extname(filePath).toLowerCase();
    c.header('Content-Type', MIME[ext] || 'application/octet-stream');
    if (/\.(js|css|svg|woff2|png|ico)$/.test(ext)) c.header('Cache-Control', 'public, max-age=3600');
    else c.header('Cache-Control', 'no-cache');
    return c.body(fs.readFileSync(filePath));
  });
}

async function main() {
  await initDb();
  const seed = seedDemo();
  const app = createApp();
  attachStatic(app);

  const port = Number(process.env.PORT || 3000);
  serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
    console.log(`[leadpulse] listening on 0.0.0.0:${info.port}`);
    console.log(`[leadpulse] database: ${JSON.stringify(dbInfo())}`);
    console.log(`[leadpulse] demo seed: ${JSON.stringify(seed)}`);
  });
}

main().catch((err) => {
  console.error('[leadpulse] startup failed:', err);
  process.exitCode = 1;
});
