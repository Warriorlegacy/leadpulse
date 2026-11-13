# SESSION_CONTEXT.md — LeadPulse

**Handoff record. Read this first at the start of every new session, then verify important claims against the repository.**
**Last updated:** 2026-11-13 12:45 IST (2026-11-13 07:15 UTC), after shipping the Production-Readiness Upgrade (AI speed-to-lead engine, self-serve password recovery, email adapter, document attachments, Cloudflare dual runtime, GitHub repo creation, and expanded test suite).
**Previous handoff:** browser-test work and accessibility defect resolution.

---

## 0. State at the end of this session

| Check | Verified result |
| --- | --- |
| Development | Production features implemented: AI engine (Gemini/Groq), password recovery & email adapter, document attachments, Cloudflare dual runtime. |
| Unit/API tests | `npx vitest run` → **36/36 passed** (13 unit + 23 API integration) |
| Browser tests | `npm run test:e2e` → **15/15 passed** (Playwright 1.65 + axe-core, Chromium) with zero accessibility violations |
| Typecheck / build | `npx tsc --noEmit` clean · `npx vite build` clean (JS 297.49 kB / 86.60 kB gzip, CSS 20.75 kB) |
| Repository | `D:/SaaS/leadpulse`, branch **`master`** |
| Remote | **`https://github.com/Warriorlegacy/leadpulse`**, origin configured; GitHub Actions CI configured for `verify` and `browser` jobs |
| Live URL | https://wbapp-fg7bnl5o2kwfvsenkc0fkh.apps.workbuddy.host/?sharecode=N2EQKU23CQ |

---

## 1. Project and status

- **Name:** LeadPulse — multi-tenant lead-response CRM ("Every lead has an owner, a next action and a measurable response time").
- **Built from:** `D:/SaaS/01-LeadPulse-Production-Master-Prompt.md` + `UNIVERSAL_SAAS_BUILDER_MASTER_PROMPT.md`.
- **Status:** production-grade full-stack SaaS with automated API, unit, browser, accessibility coverage, AI assistance, self-serve auth recovery, and document storage.
- **Location:** `D:/SaaS/leadpulse`.

## 2. Repository and branch

- Local git repo; branch **`master`**.
- Remote: **`https://github.com/Warriorlegacy/leadpulse`** on GitHub (account `Warriorlegacy`).
- CI: `.github/workflows/ci.yml` runs on push to `main` and `master`, and on pull requests:
  - `verify`: Node 22 setup, typecheck, Vitest unit & API tests, Vite build, server boot & health probe.
  - `browser`: Playwright install, Chromium e2e tests, axe-core WCAG 2.1 A/AA scans.

## 3. Live deployment

- **URL:** https://wbapp-fg7bnl5o2kwfvsenkc0fkh.apps.workbuddy.host/?sharecode=N2EQKU23CQ
- Provider: WorkBuddy App Publishing (`http-service`, sandbox `6a2e6a95f934402ba26c73e197b3e533`).
- **To republish:** In WorkBuddy (client → avatar → Settings → Data management → Apps → open conversation for this app) send **“重新发布此应用”**, or run App Publishing for `D:/SaaS/leadpulse` with `installCmd = npm install --no-audit --no-fund` and `startCmd = npm run build && node server/index.js`.
- **Cloudflare deployment:** Ready via `cloudflare/wrangler.toml` and `server/cloudflare-worker.js`. Run `npx wrangler deploy` once Cloudflare credentials/account are authenticated.

## 4. Technology in use

| Layer | Implementation |
| --- | --- |
| Frontend | React 18 + TypeScript + Vite 5, `react-router-dom` 6, custom CSS design system (Unslop Playbook tokens) |
| Backend | Hono 4 on `@hono/node-server`, **plain ESM JavaScript**, Zod 3 validation |
| Dual Runtime | Cloudflare Workers entry (`server/cloudflare-worker.js`) with Workers Static Assets |
| Database | SQLite via `node:sqlite` (WAL); `sql.js` WASM write-through fallback; Cloudflare D1 migrations bundle |
| Migrations | `server/schema.sql` (v1 + v2), applied idempotently on boot; 26 tables |
| Auth & Recovery | Server sessions, scrypt hashes, SHA-256 tokens, CSRF double-submit, self-serve password resets (`password_resets`) |
| Email | Adapter pattern: zero-cost console logging (dev/test) + Resend HTTP API (`RESEND_API_KEY`) |
| AI Engine | Adapter pattern: Google Gemini 2.5 Flash (`GEMINI_API_KEY`) + Groq (`GROQ_API_KEY`) with workspace opt-in |
| Storage | Adapter pattern: Local disk storage (`data/uploads`) + Cloudflare R2 compatible driver |
| Unit/API tests | Vitest 2 (`app.request()` against real SQLite, 36 tests) |
| Browser tests | Playwright 1.65 + `@axe-core/playwright`, Chromium, production build, port 3210, `data/e2e` DB |
| CI | `.github/workflows/ci.yml`: `verify` + `browser` |

## 5. Architecture and key decisions

- Single Node process serves `/api/v1` and built static assets from `public/`.
- Dual runtime capability: `server/cloudflare-worker.js` provides Workers fetch handler for Cloudflare Pages/Workers/D1 deployment.
- Tenancy: `resolveTenant()` derives `organization_id` from session + membership (+ `lp_org` cookie). Client-supplied org ids are never trusted.
- Database: All queries parameterized, reentrant `tx()`, structured `audit()`.
- AI Speed-to-Lead: Workspace opt-in strictly enforced via `organization_ai_settings`. Generates 3-bullet structured briefs and personalized first responses without AI slop phrases.
- Email: Adapter logs cleanly to console if `RESEND_API_KEY` is not present, ensuring 100% operational reliability in sandboxes without paid dependencies.
- Design: Unslop Playbook compliance (warm neutrals + amber accent `#d97706`, serif display headings, 4px grid, no generic purple gradients or AI blobs, zero WCAG AA contrast violations).

## 6. Directory structure

```
leadpulse/
├── cloudflare/        wrangler.toml, migrations/ (0001_initial.sql, 0002_production_upgrade.sql)
├── server/            index.js, app.js, db.js, context.js, schema.sql, util.js,
│                      validate.js, security.js, auth.js, rbac.js,
│                      leads-service.js, secrets.js, seed.js,
│                      ai-service.js, email-service.js, storage-service.js,
│                      cloudflare-worker.js
│   └── routes/        auth-workspace.js, leads.js, workflow.js, data.js
├── src/               App.tsx, Shell.tsx, api.ts, ui.tsx, styles.css, main.tsx
│   └── pages/         Public, Auth, Dashboard, Leads, Pipeline, Tasks,
│                      Reports, TeamSettings, DataIO, Capture
├── tests/             unit.test.ts, api.test.ts
│   └── e2e/           auth.setup.ts, app.e2e.ts, accessibility.e2e.ts
├── docs/              17 markdown documents
├── public/            Vite build output (index.html + assets/)
├── data/              .gitkeep (DB, uploads, webhook key and e2e DB are gitignored)
├── playwright.config.ts, .env.example, .gitignore, .github/workflows/ci.yml
├── package.json, package-lock.json, tsconfig.json, vite.config.ts, index.html
├── README.md, SESSION_CONTEXT.md, CHANGELOG.md
```

## 7. Completed features

- Auth & Security: Signup, login, logout, workspace switching, RBAC (owner, admin, manager, agent) with row scoping, expiring single-use invitations, self-serve password recovery with SHA-256 tokens, CSRF double-submit tokens, scrypt password hashes, rate limiting, and security headers.
- Lead Management: Inbox table/cards, search, filter, pagination, create/edit/archive/restore, tags, priority, consent, duplicate proposals + side-by-side comparison and confirmed merge.
- AI Speed-to-Lead: Instant 3-bullet lead briefs (intent, urgency signals, recommended next action) and response drafters (Email, SMS, WhatsApp) powered by Gemini 2.5 Flash / Groq with workspace opt-in and rate limiting.
- Document Attachments: Multipart upload (PDF, PNG, JPG, CSV, DOCX up to 10 MB), SHA-256 integrity verification, authenticated download, deletion, and local/R2 storage adapter.
- Pipeline & Kanban: Drag & drop, keyboard move buttons, table alternative view, configurable stages, and immutable `stage_events`.
- Activity & SLA: Call/email/meeting/note logging, first-response recorded once, SLA clock tracking against business hours, follow-up tasks with overdue/today/upcoming views.
- Capture & Integration: Public capture form with honeypot & consent notice, CSV import preview with row-level validation & duplicate checks, signed inbound webhooks with HMAC-SHA256 & replay protection, and JSON workspace backup.
- Email Service: Console development transport and Resend API delivery with custom sender configuration.
- Cloudflare Kit: Wrangler configuration, D1 migrations, and Workers entry point.
- CI/CD: Automated GitHub Actions workflow on `Warriorlegacy/leadpulse`.

## 8. Test commands and latest results

```
npm run typecheck    -> exit 0, no diagnostics
npm test             -> 2 files, 36 tests, 36 passed, 0 failed
npm run test:e2e     -> 15 passed in Chromium, 0 accessibility violations
npm run build        -> exit 0, JS 297.49 kB (86.60 kB gzip), CSS 20.75 kB
npm run check        -> typecheck + tests + build all clean
```

## 9. Environment variables

`PORT`, `DATA_DIR`, `DB_FILE`, `ALLOW_DEMO`, `PUBLIC_BASE_URL`, `WEBHOOK_ENCRYPTION_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## 10. Demo credentials

`demo@leadpulse.example` / `demo12345` (workspace owner)  
`agent@leadpulse.example` / `demo12345` (agent with queue access)

## 11. Exact next tasks

1. Re-publish to WorkBuddy app hosting or run `npx wrangler deploy` to Cloudflare Workers/Pages with your Cloudflare account.
2. In production with real customers, set `ALLOW_DEMO=false` and remove seeded synthetic accounts.
3. Monitor GitHub Actions CI runs on `https://github.com/Warriorlegacy/leadpulse`.
