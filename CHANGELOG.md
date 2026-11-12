# Changelog

All notable changes to LeadPulse. Dates are in IST (UTC+05:30).

## [Unreleased] — 2026-11-13

Browser acceptance coverage (T12) and the accessibility defects it exposed.

### Added
- Playwright test suite (`tests/e2e/`, `npm run test:e2e`) running the production build in Chromium: mobile 375 / tablet 768 / desktop 1280 layout, mobile drawer, keyboard focus visibility, keyboard kanban moves, a rejected transition (T06), the pipeline table selector, and a console-error sweep over every route.
- axe-core WCAG 2.1 A/AA scans with **zero violations** on `/`, `/pricing`, `/login` and eight authenticated routes, plus `/app`, `/app/leads` and `/app/pipeline` at 375 px.
- A `browser` CI job (Chromium install, e2e run, report artifact on failure).
- `docs/CLOUDFLARE_STACK.md`: verified free-tier audit and migration kit for Pages/Workers/D1/R2, including the `node:sqlite` stub and 10 ms CPU findings.

### Fixed
- Enter on a kanban move button bubbled into the card's handler and navigated away before the move ran; card navigation is now limited to the card itself and the card is no longer a `role="button"` wrapper around focusable controls.
- Kanban move buttons had accessible names that excluded their visible text; the Settings copy-link button had no accessible name.
- Lead cards overflowed the viewport by 7 px at 375/768 px because of `width: 100%` plus side margins.
- Four colour tokens missed WCAG AA contrast (eyebrow, muted body text, sidebar labels, accent links); `--accent-dark`, `--muted` and the sidebar label colour were darkened.
- Screen-reader-only kanban text could extend the root scroll width; lead cards now establish the containing block.

## [0.1.0] — 2026-11-13

First working build. Created from the LeadPulse production build brief and the Universal Autonomous SaaS Builder specification. **Status: pilot / demo — not validated with real buyers and not hardened for real customer PII.**

### Added

**Platform**
- Single-port Node 22 service (`@hono/node-server` + Hono) serving `/api/v1` and the built React SPA from `public/`.
- SQLite schema v1 (`server/schema.sql`, 22 tables) applied idempotently on boot, with foreign keys, CHECK constraints and composite tenant indexes.
- Three database drivers: built-in `node:sqlite` (durable file + WAL), pure-WASM `sql.js` write-through fallback, and in-memory fallback for read-only sandboxes. `GET /api/v1/health` reports the active driver and durability.
- Server-side sessions with scrypt password hashes, SHA-256-hashed session tokens, HttpOnly/SameSite/Secure cookies, 30-day expiry, and a session-bound CSRF double-submit token.
- Server-derived tenancy and a `PERMISSIONS` RBAC map for owner/admin/manager/agent, including row scoping for agents and a `platform_admin` user flag.
- Request ids, CSP/security headers, in-memory rate limiting, Zod validation, consistent error envelopes, and PII-free audit logging.

**Workflows**
- Signup/login/logout/workspace switching; invitation flow with single-use, 72-hour, revoked, email-bound tokens and role-escalation checks.
- Lead inbox with search, filters, sorting, pagination, facets, create/edit/archive/restore, tags, ownership, consent and priority.
- Duplicate detection that **proposes** candidates only; explicit side-by-side comparison and confirmed merge that preserves all history.
- Configurable pipeline with drag-and-drop, keyboard-operable move controls and a table alternative; validated transitions recorded in `stage_events`.
- Activity timeline where the first logged call/email/meeting sets `first_response_at` exactly once; follow-up tasks with overdue/today/upcoming buckets in the workspace timezone.
- Public capture form with a random `public_id`, honeypot, consent requirement, rate limiting and no internal data exposure; configurable fields and link rotation.
- CSV import with preview, column auto-mapping, row-level errors, duplicate suggestions, 2 MB / 5000-row bounds, 15-minute in-memory previews, idempotency and explicit commit confirmation. CSV export with spreadsheet-formula neutralisation and role gating.
- Signed inbound webhooks: HMAC-SHA256 over `"<timestamp>.<rawBody>"`, ±5-minute replay window, event-id idempotency, encrypted secret storage and metadata-only delivery logs.
- Reports computed from persisted leads/activities/stage events/tasks; documented metric definitions and no invented values.
- Full JSON workspace backup, audit log, in-app notifications, and a truthful disabled-integrations status endpoint.

**Frontend**
- React 18 + TypeScript + Vite SPA with 18 routes: landing, pricing, privacy, terms, 404, signup/login, invitation acceptance, public capture, dashboard, inbox, lead detail, pipeline, tasks, reports, data I/O, team, settings, audit.
- Custom responsive CSS design system (one neutral ramp + amber accent, serif display headings, 4px grid, no gradients/glows/emoji icons), keyboard focus states, labelled controls, mobile card views and a kanban table alternative.
- Explicit empty/loading/error/success states everywhere; no fake charts or invented statistics.

**Quality & docs**
- 33 automated tests (13 unit + 20 API integration) against a real SQLite DB via `app.request()`.
- Typecheck, production build, and a full local HTTP smoke test.
- Documentation set: PRD, architecture, data dictionary, API reference, security/privacy, permission matrix, metric definitions, free-stack audit, test plan/results, deployment runbook, assumptions, UI design system, market/competitor notes and roadmap.

### Fixed during verification

- Demo seed attempted a Won → Lost transition and aborted startup; seed path corrected and seeding made atomic ([#1 in TEST_RESULTS.md](docs/TEST_RESULTS.md)).
- `GET /workspace/export` returned 500 because `organizations` has no `organization_id` column; special-cased to `id` and covered by a regression test.
- Async capture-form settings used uncontrolled inputs that never refreshed; inputs keyed on the loaded form id.
- Replaced a dynamic import in `ui.tsx` that Vite warned about.
- Rewrote six technical documents that named routes/columns which do not exist in the implementation.

### Known limitations

No Playwright/axe browser automation, no load or penetration test, `sql.js`/in-memory drivers not exercised, public demo credentials on shared deployments, single-process SQLite with no managed backup, no email/password-reset/MFA/SSO, no legal privacy review. Cloudflare Workers/D1 deployment was **not** performed — no account credentials. See [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
