# LeadPulse — Test Results

Executed on **12–13 November 2026** on Windows (Node v22.22.2, npm 10.9.7). All figures below are from commands actually run; no result is inferred.

## 1. Automated suite

```
npx vitest run --reporter=verbose
```

Final run:

```
 ✓ tests/unit.test.ts (13 tests)
 ✓ tests/api.test.ts (20 tests)
 Test Files  2 passed (2)
      Tests  33 passed (33)
   Duration  7.02s
```

Coverage by group:

| Suite | Tests | What is exercised |
| --- | --- | --- |
| `tests/unit.test.ts` | 13 | CSV quoted fields/embedded newlines/escaped quotes, unterminated quotes, ragged rows, oversized input, formula neutralisation, email/phone normalisation, fuzzy name similarity, scrypt hashing/verification, HMAC helpers, wall-clock vs business-hours SLA, weekend exclusion, `Asia/Kolkata` conversion |
| `tests/api.test.ts` → health/security | 5 | Health + DB driver, security headers + request id, unauthenticated 401, CSRF 403, complete tenant-scoped workspace backup |
| `tests/api.test.ts` → auth/tenancy | 4 | Default stages on signup, uniform invalid-credential response, cross-tenant lead/detail/export denial, workspace-switch denial |
| `tests/api.test.ts` → roles | 2 | Invitation single-use/expiry/email-binding/no-escalation, agent settings + export denial, agent row scoping and unassigned queue |
| `tests/api.test.ts` → lifecycle | 4 | Create/update/archive/restore + stage history, first-response written once, duplicate propose-then-explicit-merge, impossible transition rejection |
| `tests/api.test.ts` → data safety | 5 | CSV formula/truncation/oversize/malformed, import idempotency + explicit confirm, public capture honeypot/rate-limit/correct workspace, webhook HMAC/replay/idempotency, report accuracy |
| **Total** | **33** | **0 failed** |

Integration tests use `app.request()` against the real Hono app with a real temporary SQLite database, cookie jar and CSRF token — not mocks.

## 2. Typecheck and build

```
npx tsc --noEmit       -> exit 0, no diagnostics
npx vite build         -> exit 0
public/index.html                   0.63 kB │ gzip:  0.36 kB
public/assets/index-*.css          20.52 kB │ gzip:  4.95 kB
public/assets/index-*.js          279.75 kB │ gzip: 82.64 kB
✓ 47 modules transformed, built in 2.20s
```

## 3. Local HTTP smoke test (built assets + live server)

Server started with `PORT=3100 ALLOW_DEMO=true PUBLIC_BASE_URL=http://localhost:3100 node server/index.js`; fresh SQLite DB seeded with 12 synthetic leads across 2 workspaces.

| Request | Status | Evidence |
| --- | --- | --- |
| `GET /` | 200 | Built `index.html` with `<div id="root">` |
| `GET /app/leads/abc` | 200 | SPA fallback returns the same shell |
| `GET /assets/index-*.js` | 200 | `text/javascript; charset=utf-8` |
| `GET /robots.txt` | 200 | Private routes disallowed |
| `GET /api/v1/health` | 200 | `{"driver":"node:sqlite","file":"leadpulse.db","durable":true,"migrations":[1]}` |
| `GET /api/v1/leads` (no session) | 401 | `UNAUTHENTICATED` |
| `POST /api/v1/auth/login` (demo) | 200 | `demo@leadpulse.example`, session + CSRF cookie |
| `GET /api/v1/leads` | 200 | `total=12` |
| `GET /api/v1/pipeline` | 200 | 6 columns |
| `GET /api/v1/reports/summary` | 200 | `leadsCreated=12`, `responseTimeMedian=45m` |
| `GET /api/v1/tasks?bucket=overdue` | 200 | 2 overdue tasks |
| `POST /api/v1/leads` | 201 | New lead persisted |
| `GET /api/v1/capture-forms` | 200 | `form_…` public id |
| `GET /api/v1/public/forms/:id` | 200 | No org id / owner data |
| `POST /api/v1/public/forms/:id` | 201 | Lead created in correct workspace |
| `GET /api/v1/leads/export` | 200 | 3,570 bytes `text/csv` |
| `GET /api/v1/audit` | 200 | Audit events present |
| `GET /api/v1/integrations` | 200 | `allDisabled=true` |
| `GET /api/v1/workspace/members` | 200 | 2 members |
| `GET /api/v1/workspace/export` | **500 on first run** | Fixed: `organizations` has no `organization_id` column. Added regression test; subsequent run 200 |

Security headers observed on the homepage: CSP present, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `X-Request-Id` present.

## 4. Production smoke test (live HTTPS deployment)

URL: `https://wbapp-fg7bnl5o2kwfvsenkc0fkh.apps.workbuddy.host/?sharecode=N2EQKU23CQ`. Verified **2026-11-13 01:33–01:35 IST** by repeating the HTTP smoke test against the public origin with a real cookie jar (full detail in [DEPLOYMENT.md](DEPLOYMENT.md)).

| Check | Result |
| --- | --- |
| `GET /` | 200, built SPA HTML |
| `GET /assets/index-*.js` | 200, `text/javascript` |
| `GET /api/v1/health` | 200, `{"driver":"node:sqlite","file":"leadpulse.db","durable":true,"migrations":[1]}` |
| Anonymous `GET /api/v1/leads` | 401 `UNAUTHENTICATED` |
| Demo login | 200, session cookie + CSRF token |
| `GET /leads` / `/pipeline` / `/reports/summary` | 200 / 200 / 200 (12 leads, 6 stages, 12 created) |
| `POST /api/v1/leads` | 201; subsequent list grew 12 → 13, proving a real DB write |
| `POST /public/forms/:publicId` | 201, lead created in the correct workspace |
| `GET /leads/export` | 200, 3,572 bytes `text/csv` |
| Headers | CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS, `X-Request-Id` present |

The two smoke-test leads were archived afterwards via the API, restoring the public demo to 12 active leads.

**Finding:** the hosting reverse proxy strips the application's `X-Frame-Options: DENY` and rewrites CSP to `frame-ancestors 'none' *`. Clickjacking protection is therefore weaker on this hosted preview than locally. Recorded in [DEPLOYMENT.md](DEPLOYMENT.md) and [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

## 5. Defects found and fixed during verification

| # | Defect | Fix | Verified |
| --- | --- | --- | --- |
| 1 | Demo seed attempted a Won → Lost transition, which the server correctly rejects; startup aborted and left partial data | Seed path now goes New → … → Lost directly, and the whole seed is wrapped in a reentrant transaction | Server boots; 12 leads seeded |
| 2 | `GET /workspace/export` returned 500 (`no such column: organization_id`) | Query `organizations` by `id`; added regression test | 20 API tests pass |
| 3 | Async-loaded capture-form settings used uncontrolled inputs that never refreshed | Inputs keyed on the loaded form id | Typecheck + build pass |
| 4 | Vite warned about a dynamic import of an already-static module in `ui.tsx` | Replaced with a static import | Build clean, 47 modules |
| 5 | Speculative technical docs named routes and columns that do not exist | Rewrote `API.md`, `DATA_DICTIONARY.md`, `METRIC_DEFINITIONS.md`, `PERMISSION_MATRIX.md`, `SECURITY_AND_PRIVACY.md`, `TEST_PLAN.md` against the code | Docs reviewed against `server/schema.sql` and `server/routes/*` |

## 6. Not verified / known gaps

- No Playwright or axe run: keyboard, mobile-width and accessibility behaviour are implemented but **not browser-automated**. No visual regression screenshots.
- No load testing, penetration test, or cross-browser matrix.
- The `sql.js` WASM fallback and the in-memory read-only-sandbox driver were not exercised end to end.
- No automated test of process-restart durability with WAL, nor of concurrent writers.
- Cloudflare Workers/D1 deployment not attempted: no account credentials (see [DEPLOYMENT.md](DEPLOYMENT.md)).
- GitHub Actions CI has never run (no remote repository). The workflow file is provided but unverified.
- The live deployment IS verified — see §4 above and [DEPLOYMENT.md](DEPLOYMENT.md).

## 7. Related

[TEST_PLAN.md](TEST_PLAN.md) · [API.md](API.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [DEPLOYMENT.md](DEPLOYMENT.md)
