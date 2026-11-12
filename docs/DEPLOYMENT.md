# LeadPulse — Deployment Guide & Runbook

## 1. Live deployment (verified)

| Item | Value |
| --- | --- |
| **Live URL** | https://wbapp-fg7bnl5o2kwfvsenkc0fkh.apps.workbuddy.host/?sharecode=N2EQKU23CQ |
| Provider | WorkBuddy App Publishing (sites) — deployed as an `http-service` |
| Sandbox id | `6a2e6a95f934402ba26c73e197b3e533` |
| Region / domain | Platform-assigned `*.apps.workbuddy.host` subdomain, HTTPS |
| Verification time | **2026-11-13 01:33–01:35 IST (2026-11-12 20:03–20:05 UTC)** |
| Deploy result | `verified: true`, `deployedAs: http-service` |
| Runtime reported by `/health` | `node:sqlite`, `leadpulse.db`, `durable: true`, migration v1 |
| Repository | Local git repo `D:/SaaS/leadpulse`, branch `master`; first commit `0740ce2517065af935ef917b7a67ea35063e220e`, HEAD = `git rev-parse HEAD` |
| Remote | **None** — no GitHub repository URL was supplied; nothing was pushed |

### Deployment parameters used

```
directory   = D:/SaaS/leadpulse
language    = node
port        = 3000
installCmd  = npm install --no-audit --no-fund
startCmd    = npm run build && node server/index.js
appName     = LeadPulse CRM
domainPrefix= leadpulse-crm
```

`server/index.js` reads `PORT` and binds `0.0.0.0`. Vite builds into `public/` (a conventional source directory name, so the uploader retains it); the Node server then serves both `/api/v1` and the SPA from the same port.

### Live smoke test (all executed against the public HTTPS URL)

| Request | Result |
| --- | --- |
| `GET /` | 200 — built SPA HTML with `<div id="root">` |
| `GET /assets/index-*.js` | 200 — `text/javascript; charset=utf-8` |
| `GET /api/v1/health` | 200 — `{"driver":"node:sqlite","file":"leadpulse.db","durable":true,"migrations":[1]}` |
| `GET /api/v1/leads` (anonymous) | 401 `UNAUTHENTICATED` |
| `POST /api/v1/auth/login` (demo owner) | 200 — session cookie + CSRF token |
| `GET /api/v1/leads` | 200 — 12 synthetic demo leads |
| `GET /api/v1/reports/summary` | 200 — `leadsCreated=12` |
| `GET /api/v1/pipeline` | 200 — 6 columns |
| `POST /api/v1/leads` | 201 — lead persisted (list grew 12 → 13) |
| `GET /api/v1/capture-forms` | 200 — public id returned |
| `POST /api/v1/public/forms/:publicId` | 201 — lead created in the correct workspace |
| `GET /api/v1/leads/export` | 200 — 3,572 bytes `text/csv` |
| Security headers | CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS, `X-Request-Id` present |

The two smoke-test leads were then archived via the API, returning the public demo to 12 active leads.

### Current build status (2026-11-13 04:40 IST)

The URL is still reachable (`200`, health OK, `durable: true`) but serves asset `assets/index-B9OqksUm.js`, i.e. the build from **before** the browser-test and accessibility fixes. The current local build is `assets/index-DU1C2JTF.js`. **It has not been republished** — no App Publishing tool or credential is available outside the WorkBuddy client. Republish before describing the accessibility fixes as live. The `?sharecode=` parameter is required; without it the host returns `403`.

### Deployment finding: clickjacking header is modified upstream

The application sets `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`. On the hosted URL the reverse proxy **removes `X-Frame-Options`** and rewrites CSP to `frame-ancestors 'none' *` (presumably to allow the platform preview panel to embed the app). The other security headers pass through unchanged. This weakens clickjacking protection on this particular hosted preview and is outside the application's control. For a customer-facing deployment, use a domain/proxy that preserves these headers. Tracked in [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

## 2. Local deployment

```bash
cd D:/SaaS/leadpulse
npm install
npm run build
npm start             # http://localhost:3000
```

Or one command with a specific port: `PORT=3100 npm start`. Boot sequence: `initDb()` → apply `server/schema.sql` → `seedDemo()` (if `ALLOW_DEMO !== false`) → `createApp()` → static handler → listen.

## 3. Environment variables

Copy `.env.example` to `.env`. Placeholders only — no real secret is committed or deployed.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `PORT` | no | `3000` | Injected by the hosting platform |
| `DATA_DIR` | no | `./data` | Must be writable for durable storage |
| `DB_FILE` | no | `./data/leadpulse.db` | Absolute path also accepted |
| `ALLOW_DEMO` | no | `true` | Set `false` to disable demo seeding |
| `PUBLIC_BASE_URL` | no | empty | Used to build shareable capture-form links; set to the live origin for a correct public URL |
| `WEBHOOK_ENCRYPTION_KEY` | no | generated file | AES-256-GCM key for webhook secrets; auto-generated at `data/.webhook-key` |
| `RESEND_API_KEY`, `GEMINI_API_KEY`, `META_ACCESS_TOKEN`, `WHATSAPP_CLOUD_API_TOKEN` | no | unset | **Adapter placeholders only — no integration is active** |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | no | unset | Required only for a future Cloudflare deployment |

**Not set on the live deployment:** `PUBLIC_BASE_URL` (capture-form links in Settings therefore render as a relative `/form/...` path, which still works when opened from the app), `ALLOW_DEMO` (defaults to `true` so the public demo is usable), and all optional provider keys. No secrets were transmitted or stored in the source package.

## 4. CI

`.github/workflows/ci.yml` runs on push/PR to `main` with `permissions: contents: read`: `npm ci` → `npm run typecheck` → `npm test` → `npm run build` → boot the server with `ALLOW_DEMO=false` and assert `/api/v1/health` responds. No deployment secrets are used. The workflow has **not** been executed on GitHub Actions (no remote repository exists); it is provided for when a remote is connected.

## 5. Redeploy, rollback, unpublish

- **Redeploy**: re-run the App Publishing deploy for `D:/SaaS/leadpulse` with the same parameters. Publishing is an overwrite — the share link stays the same and the live app is replaced. Re-consent is required for each republish.
- **Rollback**: there is no platform snapshot rollback configured. Roll back by checking out the previous commit (`git log`, `git checkout <sha>`) and redeploying. Because the SQLite file lives in the sandbox filesystem, redeploys may reset data — export via `GET /api/v1/workspace/export` before any redeploy that matters.
- **Unpublish**: use the App Publishing "unpublish" action for this directory; the share link stops working.
- **Backups**: `GET /api/v1/workspace/export` (owner/admin) returns a full JSON backup; `GET /api/v1/leads/export` returns a filtered CSV. There is no automated backup job or restore drill.

## 6. Cloudflare Workers + D1 path — NOT performed

The preferred stack was Cloudflare Workers + Hono + D1. It was **not** deployed because no Cloudflare credentials, account id, `wrangler` login, or `~/.wrangler` config exist. A `wrangler.toml` was deliberately not added: this Node/Hono service is not Workers-runtime compatible as written, so shipping a config that cannot work would be misleading.

Exact remaining work if credentials are supplied:
1. Verify current quotas again ([FREE_STACK_AUDIT.md](FREE_STACK_AUDIT.md)), create a D1 database, and record its binding id.
2. Add `wrangler.toml` with `compatibility_date >= 2026-08-04` (Node.js compat), `nodejs_compat` flag if older, and Workers Static Assets pointing at `public/`.
3. Replace `server/db.js` drivers with a D1 binding adapter implementing `exec/run/all/get/persist`; convert `server/context.js` `tx()` to D1 batch semantics. Node's synchronous `DatabaseSync` API does not exist in Workers, so async propagation is required through the route layer.
4. Move secrets to `wrangler secret put`; set `ipAddressHeaders: ["cf-connecting-ip"]` if Better Auth is adopted; re-verify Better Auth + D1 compatibility (unverified as of 2026-11-12).
5. Run `wrangler d1 migrations apply`, deploy, then repeat the full smoke test against the Workers URL before claiming production readiness.

## 7. Required human actions before handling real data

1. Set `ALLOW_DEMO=false`, delete the two demo accounts, and rotate/remove all seeded data.
2. Set `PUBLIC_BASE_URL` to the canonical origin.
3. Configure a trusted reverse proxy that overwrites `X-Forwarded-For` and preserves clickjacking headers.
4. Move to a managed replicated database with automated backups.
5. Complete a legal/privacy review; add email verification, password reset and MFA.
6. Validate pricing with real buyers before enabling billing.

## 8. Related

[TEST_RESULTS.md](TEST_RESULTS.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [FREE_STACK_AUDIT.md](FREE_STACK_AUDIT.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · `SESSION_CONTEXT.md`
