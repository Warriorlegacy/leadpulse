# SESSION_CONTEXT.md — LeadPulse

**Handoff record. Read this first at the start of every new session, then verify important claims against the repository.**
**Last updated:** 2026-11-13 04:45 IST (2026-11-12 23:15 UTC), after the browser-test work, the accessibility fixes, and a live-URL check.
**Previous handoff:** the app was already built and deployed; this session continued from its "exact next tasks" list.

---

## 0. State at the end of this session

| Check | Verified result |
| --- | --- |
| Development | T12 browser automation is now implemented. No code work in progress. |
| Unit/API tests | `npx vitest run` → **33/33 passed** (13 unit + 20 API integration) |
| Browser tests | `npm run test:e2e` → **15/15 passed in 26.0 s** (Playwright 1.5x + axe-core, Chromium) |
| Typecheck / build | `npx tsc --noEmit` clean · `npx vite build` clean (JS 280.06 kB / 82.68 kB gzip, CSS 20.75 kB) |
| Repository | `D:/SaaS/leadpulse`, branch **`master`** (not `main`), clean working tree, 69 tracked files |
| Remote | **None.** Nothing was pushed; GitHub Actions has still never run. |
| Live URL | Reachable: homepage `200` and `/api/v1/health` `200`, but it serves the **pre-change build** (`assets/index-B9OqksUm.js`). This session had no App Publishing tool or credentials, so the new build was **not republished**. See §3. |

---

## 1. Project and status

- **Name:** LeadPulse — multi-tenant lead-response CRM ("Every lead has an owner, a next action and a measurable response time").
- **Built from:** `D:/SaaS/01-LeadPulse-Production-Master-Prompt.md` + `UNIVERSAL_SAAS_BUILDER_MASTER_PROMPT.md`. The other seven briefs in the pack were not built.
- **Status:** working full-stack pilot with automated API, unit, browser and accessibility coverage. **Not** buyer-validated, **not** hardened for real customer PII, and the latest build is not yet on the public host.
- **Location:** `D:/SaaS/leadpulse` (the prompt pack above it is untouched).

## 2. Repository and branch

- Local git repo; branch **`master`**. First commit `0740ce2517065af935ef917b7a67ea35063e220e`; HEAD is the current tip (`git rev-parse HEAD`) — no hash is hardcoded here so this file cannot go stale.
- **Remote: none.** `.github/workflows/ci.yml` now triggers on push to `main` **or `master`** and on pull requests; it has never executed on GitHub.
- `.gitignore` already covered `test-results/` and `playwright-report/`; the throwaway browser-test database lives in `data/e2e/` and is ignored by `data/*`.

## 3. Live deployment

- **URL:** https://wbapp-fg7bnl5o2kwfvsenkc0fkh.apps.workbuddy.host/?sharecode=N2EQKU23CQ
- Provider: WorkBuddy App Publishing (`http-service`, sandbox `6a2e6a95f934402ba26c73e197b3e533`). The `?sharecode=` is mandatory; without it the host returns `403` with a "link incomplete" page.
- **Re-checked 2026-11-13 04:40 IST:** homepage `200`, 632 bytes, SPA root present, asset `assets/index-B9OqksUm.js`; `/api/v1/health` `200` → `{"status":"ok","version":"0.1.0","database":{"driver":"node:sqlite","file":"leadpulse.db","durable":true,"migrations":[1]},"demoEnabled":true}`.
- **The live build is stale.** `index-B9OqksUm.js` is the asset hash from *before* this session's changes. The current local build is `index-DU1C2JTF.js` (plus the fixed CSS). No redeploy was performed because no publishing tool/credential is available in this session.
- **To publish the current build:** in WorkBuddy (client → avatar → Settings → Data management → Apps → open the conversation for this app) send **“重新发布此应用”**, or re-run App Publishing for `D:/SaaS/leadpulse` with `installCmd = npm install --no-audit --no-fund` and `startCmd = npm run build && node server/index.js`. The share link stays the same. Then repeat the smoke test in `docs/DEPLOYMENT.md` §1.
- Known platform finding: the hosting proxy strips `X-Frame-Options` and appends `*` to CSP `frame-ancestors`. Documented in `docs/DEPLOYMENT.md` and `docs/SECURITY_AND_PRIVACY.md`.

## 4. Technology actually in use

| Layer | Implementation |
| --- | --- |
| Frontend | React 18 + TypeScript + Vite 5, `react-router-dom` 6, custom CSS design system (no Tailwind/shadcn) |
| Backend | Hono 4 on `@hono/node-server`, **plain ESM JavaScript** (no server build step), Zod 3 validation |
| Database | SQLite via `node:sqlite` (WAL); `sql.js` WASM write-through fallback; in-memory fallback for read-only sandboxes |
| Migrations | `server/schema.sql`, v1, applied idempotently on boot; 22 tables |
| Auth | Server-side sessions, scrypt hashes, SHA-256 hashed tokens, HttpOnly/SameSite=Lax/Secure cookies, CSRF double-submit |
| Secrets | Webhook secrets AES-256-GCM encrypted via `data/.webhook-key` or `WEBHOOK_ENCRYPTION_KEY` |
| Unit/API tests | Vitest 2 (`app.request()` against real SQLite) |
| Browser tests | Playwright 1.5x + `@axe-core/playwright`, Chromium only, production build, port 3210, `data/e2e` DB |
| CI | `.github/workflows/ci.yml`: `verify` (typecheck, test, build, boot health) + `browser` (Playwright + axe) |

## 5. Architecture and key decisions

- Single Node process, single `PORT`, serves `/api/v1` **and** built static assets from `public/`. No SSR, no separate API host.
- Tenancy: `resolveTenant()` derives `organization_id` from session + membership (+ `lp_org` cookie). Client-supplied org ids are never trusted.
- `server/context.js` provides parameterized `one/all/run/exec/tx` + `audit()`. SQL lives in route modules and `leads-service.js` — not behind an ORM.
- Vite outputs to `public/` so a deploy sandbox that strips `dist/` still receives a complete app. `startCmd` also rebuilds.
- Demo seed is atomic, idempotent, gated by `ALLOW_DEMO`; two demo workspaces prove tenant switching.
- Design follows the Unslop Playbook rules: one neutral ramp + one amber accent, 4px grid, ≤2 font weights, serif display headings, no gradients/glows/blobs/emoji icons. Contrast tokens were darkened this session to pass WCAG AA.
- Browser tests deliberately use a **separate `DATA_DIR`** so the demo database in `data/` is never mutated; they sign in once in a setup project and reuse the session cookie to stay under the 10/min login limit.

## 6. Directory structure

```
leadpulse/
├── server/            index.js, app.js, db.js, context.js, schema.sql, util.js,
│                      validate.js, security.js, auth.js, rbac.js,
│                      leads-service.js, secrets.js, seed.js
│   └── routes/        auth-workspace.js, leads.js, workflow.js, data.js
├── src/               App.tsx, Shell.tsx, api.ts, ui.tsx, styles.css, main.tsx
│   └── pages/         Public, Auth, Dashboard, Leads, Pipeline, Tasks,
│                      Reports, TeamSettings, DataIO, Capture
├── tests/             unit.test.ts, api.test.ts
│   └── e2e/           auth.setup.ts, app.e2e.ts, accessibility.e2e.ts
├── docs/              17 markdown documents (incl. CLOUDFLARE_STACK.md)
├── public/            Vite build output (index.html + assets/, assets ignored by git)
├── data/              .gitkeep only (generated DB, webhook key and e2e DB are gitignored)
├── playwright.config.ts, .env.example, .gitignore, .github/workflows/ci.yml
├── package.json, package-lock.json, tsconfig.json, vite.config.ts, index.html
├── README.md, SESSION_CONTEXT.md, CHANGELOG.md
```

## 7. Completed features

Everything in the previous handoff remains: auth/signup/login/logout/workspace switch; RBAC with agent row scoping; invitations; workspace settings/backup/delete; lead inbox; create/edit/archive/restore; tags/ownership/consent/priority; duplicate proposal + confirmed merge; pipeline board (drag/drop, **keyboard move buttons**, table view, configurable stages, immutable `stage_events`); activity timeline with first-response-once; tasks; SLA clock; public capture form; CSV import/export; signed webhooks; reports from persisted data; audit log; notifications; truthful disabled-integrations endpoint; 18 SPA routes; responsive design.

**Added this session**

- Playwright suite covering desktop/tablet/mobile layout, mobile drawer, public capture at 375 px, console/page-error hygiene on every route, visible keyboard focus, keyboard kanban moves, a server-rejected transition, and the pipeline table selector.
- axe-core WCAG 2.1 A/AA scans with **zero violations** on 11 routes desktop and 3 routes at 375 px.
- A `browser` CI job and `npm run test:e2e`.

## 8. Not implemented / unconfigured

Email delivery, AI features, Meta lead forms, WhatsApp automation, billing/payments, OAuth/SSO, MFA, password reset, R2/file uploads, lead scoring, custom fields, saved filters, assignment rules, automatic reminders, load/penetration tests, Firefox/WebKit tests, Cloudflare Workers/D1 deployment, managed backups, purge jobs. `GET /api/v1/integrations` reports optional providers as `configured:false`. **No fake integration is presented as live.**

## 9. Environment variables (names only, no values)

`PORT`, `DATA_DIR`, `DB_FILE`, `ALLOW_DEMO`, `PUBLIC_BASE_URL`, `WEBHOOK_ENCRYPTION_KEY`, plus unused placeholders `RESEND_API_KEY`, `EMAIL_FROM`, `GEMINI_API_KEY`, `META_ACCESS_TOKEN`, `WHATSAPP_CLOUD_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Browser tests inject `E2E_PORT` (default 3210). A `GEMINI_API_KEY` exists in the machine environment but is **deliberately unused**. No secret is tracked.

## 10. Test commands and latest results

```
npx vitest run --reporter=dot   -> 2 files, 33 tests, 33 passed, 0 failed
npm run test:e2e                -> 15 passed (26.0s); build is run first
npx tsc --noEmit                -> exit 0, no diagnostics (now includes tests/e2e + playwright.config.ts)
npx vite build                  -> exit 0; 47 modules; JS 280.06 kB (82.68 kB gzip), CSS 20.75 kB
npm run check                   -> typecheck + unit/API + build (does not run browser tests)
```

Defects found and fixed in this session (all now covered): Enter on a kanban move button bubbled into card navigation; move-button accessible names excluded visible text; Settings copy-link button had no name; mobile lead cards overflowed by 7 px; four colour tokens failed WCAG AA. Details in `docs/TEST_RESULTS.md` §5.

## 11. Known bugs, limitations and risks

1. **The public URL is running the previous build.** Republish explicitly before claiming the new accessibility fixes are live.
2. Public demo credentials (`demo@leadpulse.example` / `agent@leadpulse.example` / `demo12345`) are documented on the sign-in page and open on the shared deployment. Synthetic data only.
3. Single-process file-backed SQLite: no replication, managed backup or multi-writer concurrency. Read-only sandboxes fall back to in-memory (`/health` reports `durable:false`).
4. Hosting proxy strips `X-Frame-Options` and modifies CSP `frame-ancestors`.
5. `X-Forwarded-For` is trusted for rate limiting; requires a trusted proxy that overwrites it.
6. In-process rate limiting resets on restart and is not shared across instances.
7. No email verification, password reset, MFA, SSO, purge jobs or legal/privacy review.
8. Browser tests are **Chromium-only**; no Firefox/WebKit, no real-device or visual-regression run.
9. `sql.js` and in-memory fallback drivers are implemented but not exercised by tests.
10. `PUBLIC_BASE_URL` is unset on the live deployment, so Settings shows a relative capture-form link on the host.
11. Report conversion metrics use distinct leads across all time against a date-window cohort.
12. No `ALLOW_DEMO=false` live test, no process-restart WAL durability test, no concurrent-writer test.
13. CI workflow has never run (no remote repository).

## 12. Documentation map

Root-level doc names from the Universal prompt map to `docs/` as follows: `PRODUCT_REQUIREMENTS_DOCUMENT` → `docs/PRD.md`; `ARCHITECTURE`/`DATABASE_SCHEMA`/`API_DOCUMENTATION` → `docs/ARCHITECTURE.md`, `docs/DATA_DICTIONARY.md`, `docs/API.md`; `SECURITY`/`TESTING` → `docs/SECURITY_AND_PRIVACY.md`, `docs/TEST_PLAN.md`, `docs/TEST_RESULTS.md`; `DEPLOYMENT_GUIDE` → `docs/DEPLOYMENT.md`; `ENVIRONMENT_VARIABLES` → `.env.example` + `docs/DEPLOYMENT.md` §3; `UI_DESIGN_SYSTEM`/`FEATURE_SPECIFICATION`/`IMPLEMENTATION_ROADMAP` → `docs/UI_DESIGN_SYSTEM.md`, `docs/API.md`, `docs/ROADMAP.md`. Free-tier research lives in `docs/FREE_STACK_AUDIT.md` and `docs/CLOUDFLARE_STACK.md`. Duplicates were deliberately avoided.

## 13. Required user actions / approvals

- **Republish the app** (see §3) to put this build on the public URL, then re-run the live smoke test.
- Supply a GitHub repository URL and push access if remote version control and Actions CI are wanted.
- Supply Cloudflare account credentials + explicit approval before any Workers/D1 deployment or paid resource.
- Set `ALLOW_DEMO=false`, remove demo accounts, set `PUBLIC_BASE_URL`, and complete a privacy review before loading real customer data.
- Approve any paid provider, email adapter, domain/DNS change or billing integration.
- Run buyer interviews before treating the pricing hypothesis as an offer.

## 14. Exact next tasks

1. **Republish** and verify the new asset hash on the public URL (`assets/index-DU1C2JTF.js` or newer) plus the smoke test in `docs/DEPLOYMENT.md`.
2. Push to a GitHub remote so the two CI jobs actually run; fix anything only CI exposes.
3. Harden for a real pilot: disable demo accounts, managed/replicated DB with backups, purge jobs, trusted-proxy IP handling, email verification + password reset, and a proxy that preserves clickjacking headers.
4. Add Firefox/WebKit projects to `playwright.config.ts` (same specs, no rewrite needed) and a visual-regression baseline.
5. Validate with 5–10 buyers; only then consider the email adapter, official Meta lead forms, or billing.
6. Re-verify free-tier quotas before any new deployment claim.

## 15. Demo walkthrough quick reference

Sign in as `demo@leadpulse.example` / `demo12345` → Overview → Lead inbox → open a lead (log a call, add a task, change stage, compare duplicates) → Pipeline (drag, keyboard Prev/Next, table view) → Follow-ups → Import & export → Settings (capture link, stages, webhook secret, integrations, backup) → Team (invite) → sign in as `agent@leadpulse.example` to see restricted access. Switch between the two demo workspaces in the sidebar to demonstrate tenant isolation.

## 16. What changed in this session (short)

Playwright + axe installed and configured; `tests/e2e/` added; CI gained a browser job; five real UI/accessibility defects fixed (kanban keyboard navigation, accessible names, mobile overflow, contrast tokens, sr-only containing block); docs and changelog updated; `docs/CLOUDFLARE_STACK.md` committed. No redeploy was possible from this environment.
