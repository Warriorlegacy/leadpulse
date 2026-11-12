# LeadPulse

A fast, focused, **multi-tenant lead-response CRM** for small marketing agencies and local service businesses.

> Every lead has an owner, a next action and a measurable response time.

LeadPulse is deliberately narrow. It is not an attempt to replace HubSpot or Salesforce: it makes speed-to-lead, follow-up discipline and campaign-source visibility obvious for a 2–25 person team.

**This is a working application, not a mockup.** It has a real relational database, server-enforced authentication and tenancy, a validated API, automated tests, and a full responsive UI. Every dashboard number is computed from persisted records.

**Live demo:** https://wbapp-fg7bnl5o2kwfvsenkc0fkh.apps.workbuddy.host/?sharecode=N2EQKU23CQ — verified working on 2026-11-13. Full runbook: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Quick start

Requirements: Node.js 20+ (Node 22 recommended).

```bash
cd leadpulse
npm install
npm run build
npm start
```

Open <http://localhost:3000>. `npm start` reads the `PORT` environment variable and binds `0.0.0.0`. Migrations are applied and a clearly labelled synthetic demo workspace is created on first boot.

One-command verification: `npm run check` (typecheck → tests → production build).

### Demo accounts

| Email | Password | Role |
| --- | --- | --- |
| `demo@leadpulse.example` | `demo12345` | workspace owner (two demo workspaces) |
| `agent@leadpulse.example` | `demo12345` | agent, with unassigned-queue access |

All seeded names, `example.com/org/net` addresses and `+1555…` phone numbers are synthetic. The UI shows a persistent **Demo workspace** banner.

> **Security note:** these credentials are public by design on a shared demo deployment. Set `ALLOW_DEMO=false` and remove demo accounts before storing real customer data. See [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md).

### Demo walkthrough

1. Sign in as the demo owner → the Overview shows real computed metrics.
2. Open **Lead inbox** → filter by stage/owner/tag/overdue, create a lead, or export a CSV.
3. Open a lead → log a call (this starts the response clock once), add a follow-up task, change stage, compare proposed duplicates and explicitly merge them.
4. Open **Pipeline** → drag a card, use the keyboard-friendly Prev/Next buttons, or switch to the table view. Every move calls the same validated server transition.
5. Open **Follow-ups** → see overdue/due-today/upcoming buckets in the workspace timezone.
6. Open **Import & export** → paste a CSV, review row-level errors and duplicate suggestions, then confirm the import.
7. Open **Settings** → configure working hours/SLA, edit pipeline stages, copy the public capture link, create a signed webhook endpoint, review disabled integrations, and export a full JSON backup.
8. Open the public capture link in an incognito window → submit an enquiry and watch it appear in the workspace inbox.
9. Open **Team** → invite a teammate (single-use link), or sign in as the demo agent to see row-scoped access and restricted settings/export.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm start` / `npm run dev` | Run the production server (serves `/api/v1` + built SPA) |
| `npm run dev:web` | Vite dev server for frontend-only work |
| `npm run build` | Vite production build into `public/` |
| `npm run typecheck` | `tsc --noEmit` over `src/**/*.ts(x)` |
| `npm test` | Vitest unit + API integration suites |
| `npm run test:e2e` | Build, then Playwright + axe browser tests in Chromium |
| `npm run check` | Typecheck, tests, build |

## Architecture snapshot

```
Browser (React 18 + TS + Vite SPA)
        │  same origin, httpOnly session cookie, X-CSRF-Token
        ▼
Node 22 / @hono/node-server / Hono  ── single PORT ──► static assets from public/
        │  requestId · security headers · rate limit · CSRF · auth · RBAC · tenancy
        ▼
server/context.js (parameterized queries, tx, audit)
        ▼
SQLite file  ── node:sqlite ─┬─ sql.js WASM write-through fallback
                             └─ in-memory fallback for read-only sandboxes
```

- **Backend**: plain ESM JavaScript with Hono, Zod validation, scrypt password hashing, server-side sessions, and a server-derived `organization_id` on every tenant query. Plain JS (no compile step) was chosen deliberately for deployment reliability.
- **Frontend**: React + TypeScript + `react-router-dom`, custom CSS design system (one neutral ramp, one amber accent, serif display headings, 4px grid, no gradients or emoji icons).
- **Database**: 22 tables with foreign keys, CHECK constraints and composite tenant indexes, applied idempotently on boot from `server/schema.sql` (migration v1).
- **No vendor lock-in**: email, AI, Meta, WhatsApp and billing are adapter placeholders. All are reported as disabled by `GET /api/v1/integrations`; the core product works with every one of them unset.
- `GET /api/v1/health` reports the active DB driver and whether storage is durable.

Full docs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/API.md](docs/API.md) · [docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md) · [docs/PERMISSION_MATRIX.md](docs/PERMISSION_MATRIX.md) · [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md) · [docs/METRIC_DEFINITIONS.md](docs/METRIC_DEFINITIONS.md).

## Environment

Copy `.env.example` to `.env`. All values are placeholders; no real secret is committed. Key variables: `PORT`, `DATA_DIR`, `DB_FILE`, `ALLOW_DEMO`, `PUBLIC_BASE_URL`, `WEBHOOK_ENCRYPTION_KEY` (optional). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and `.env.example`.

## Verification

- `npx vitest run` → **33 passed / 0 failed** (13 unit + 20 API integration tests against a real SQLite DB).
- `npm run test:e2e` → **15 passed / 0 failed** (Playwright/Chromium against the production build: 375/768/1280 px layout, mobile drawer, keyboard kanban, rejected transition, focus visibility, console hygiene, and axe WCAG 2.1 A/AA with zero violations on 11 routes).
- `npx tsc --noEmit` → clean.
- `npx vite build` → clean; ~83 kB gzipped JS, ~5 kB gzipped CSS.
- Full local HTTP smoke test of built assets, auth, leads, pipeline, reports, capture, export, audit and security headers.

Details and **known gaps** (Chromium-only browser matrix, no load/penetration test, fallback DB drivers not exercised): [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).

## What is deliberately NOT in this build

- No automated email, SMS or WhatsApp sending. Logging a call/email is a **logged record**, not a sent message. WhatsApp is a user-initiated click-to-chat link only.
- No Meta lead-form ingestion, AI-generated content, billing or simulated payments.
- No password reset, MFA, SSO, file uploads/R2, or lead scoring.
- No buyer interviews or validated pricing. The pricing page is explicitly labelled a hypothesis.

## Limitations you should know before a pilot

Single-process file-backed SQLite (no replication or managed backup), in-process rate limiting, publicly known demo credentials on shared deployments, no legal/privacy review, and free-tier quotas that can change. **Do not load real customer PII until these are addressed** — see [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md) and [docs/FREE_STACK_AUDIT.md](docs/FREE_STACK_AUDIT.md).

## Continuity

`SESSION_CONTEXT.md` is the handoff record for the next agent/session. `CHANGELOG.md` records shipped changes. Product docs live in `docs/`.
