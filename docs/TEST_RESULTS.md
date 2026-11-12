# LeadPulse — Test Results

Executed on **12–13 November 2026** on Windows (Node v22.23.1, npm 10.9.8). All figures below are from commands actually run; no result is inferred.

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

### 1b. Browser acceptance suite (Playwright + axe)

```
npm run test:e2e        # vite build && playwright test
```

Runs the **production build** served by `server/index.js` on port 3210 against a throwaway `data/e2e` database. Chromium (Playwright 1.5x) is the only browser project; the demo owner session is created once in a setup project and reused.

Final run (2026-11-13):

```
Running 15 tests using 1 worker
  ✓ [setup] sign in as the demo owner
  ✓ public pages have no WCAG A/AA violations
  ✓ the authenticated app has no WCAG A/AA violations
  ✓ the app has no WCAG A/AA violations at 375px
  ✓ no console errors or page exceptions across every route
  ✓ mobile 375px / tablet 768px / desktop 1280px: no horizontal page overflow
  ✓ mobile navigation collapses into a toggle that opens the sidebar
  ✓ desktop shows the sidebar without the mobile toggle
  ✓ the public capture form is usable at 375px
  ✓ keyboard focus is always visible
  ✓ kanban cards move with the keyboard and persist
  ✓ a rejected transition leaves the card in its column
  ✓ the pipeline table alternative is keyboard navigable
  15 passed (26.0s)
```

What the suite actually asserts:

- **axe-core** (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) reports **zero violations** on `/`, `/pricing`, `/login`, and `/app`, `/app/leads`, `/app/pipeline`, `/app/tasks`, `/app/reports`, `/app/data`, `/app/team`, `/app/settings`, plus the three main app routes at 375 px.
- No `console.error` or uncaught page exception on any public or authenticated route.
- `documentElement.scrollWidth` never exceeds the viewport by more than 1 px at 375/768/1280 px, so tables and the kanban scroll inside their own containers.
- The mobile drawer opens, navigates and closes itself; at 1280 px the drawer toggle is hidden.
- Every one of the first eight Tab stops has a visible focus indicator (outline ≥ 2 px or box-shadow).
- A kanban card moves with Enter on its Next/Prev control, the success toast appears, and the move persists; an intercepted 409 leaves the card in its original column (this now covers **T06** in a browser, previously manual code review only).

## 2. Typecheck and build

```
npx tsc --noEmit       -> exit 0, no diagnostics
npx vite build         -> exit 0
public/index.html                   0.63 kB │ gzip:  0.36 kB
public/assets/index-*.css          20.75 kB │ gzip:  5.01 kB
public/assets/index-*.js          280.06 kB │ gzip: 82.68 kB
✓ 47 modules transformed, built in ~1.1s
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
| 6 | Pressing Enter on a kanban **move button** also bubbled to the card's Enter handler and navigated to the lead detail before the move could run | Card navigation only fires when the key event target is the card itself; the card is no longer a `role="button"` wrapper around focusable controls | Browser test: keyboard move persists and shows the toast |
| 7 | Lead cards on mobile were `width: 100%` **plus** 24 px of side margins, producing a 7 px horizontal page overflow at 375/768 px | Width changed to `calc(100% - 24px)` | 0 px page overflow at 375/768/1280 px |
| 8 | Three colour tokens failed WCAG AA: `.eyebrow` 3.37:1, muted body text 4.42:1, sidebar labels 4.38:1, accent links 3.67:1 | `--accent-dark` → `#8a5a10`, `--muted` → `#5f6873`, sidebar labels → `#7d8fa1` | axe reports zero contrast violations |
| 9 | Kanban move buttons had `aria-label` text that excluded their visible label; the Settings copy-link button had no accessible name at all | Move buttons use visually-hidden descriptive text; copy button gained `aria-label` | axe reports zero violations |

## 6. Not verified / known gaps

- Browser automation covers **Chromium only**. Firefox/WebKit and real iOS/Android devices are not exercised. No visual-regression screenshots.
- No load testing, penetration test, or cross-browser matrix.
- The Playwright job has not run on GitHub Actions (no remote repository); it passes locally with `npm run test:e2e`.
- The `sql.js` WASM fallback and the in-memory read-only-sandbox driver were not exercised end to end.
- No automated test of process-restart durability with WAL, nor of concurrent writers.
- Cloudflare Workers/D1 deployment not attempted: no account credentials (see [DEPLOYMENT.md](DEPLOYMENT.md)).
- GitHub Actions CI has never run (no remote repository). Both the `verify` and `browser` workflow jobs are provided but unverified in CI.
- The live deployment IS verified — see §4 above and [DEPLOYMENT.md](DEPLOYMENT.md).

## 7. Related

[TEST_PLAN.md](TEST_PLAN.md) · [API.md](API.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [DEPLOYMENT.md](DEPLOYMENT.md)
