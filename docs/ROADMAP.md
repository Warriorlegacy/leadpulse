# LeadPulse — Roadmap

Delivery phases A–L from the build brief, with status updated against the actual repository. "Complete" here means implemented and covered by the checks in [TEST_RESULTS.md](TEST_RESULTS.md) — it does **not** mean buyer-validated or legally approved.

## Phases A–L

| Phase | Scope | Status | Evidence |
| --- | --- | --- | --- |
| A | Repo scaffold, tooling, docs baseline | Complete | `package.json`, `vite.config.ts`, `tsconfig.json`, `docs/*`, `npm install` succeeded |
| B | Server foundation: Hono/Node entry, schema, boot migrations, SQL drivers | Complete | `server/index.js`, `server/db.js`, `server/schema.sql` v1; health reports `node:sqlite` durable |
| C | Auth, sessions, server-derived tenancy, orgs, memberships, invitations | Complete | `server/auth.js`, `server/rbac.js`; 7 passing auth/RBAC tests |
| D | Leads CRUD, archive/restore, ownership, tags, duplicate proposal | Complete | `server/routes/leads.js`, `leads-service.js`; 4 passing lifecycle tests |
| E | Pipeline stages, transitions, immutable stage events | Complete | `server/routes/workflow.js`; transition + impossible-transition tests |
| F | Activities, tasks, first-human-response capture, SLA clock | Complete | `logActivity`, `elapsedMinutes`; first-response-once test + 4 SLA unit tests |
| G | Capture forms and public POST with rate limiting | Complete | Public-form test (honeypot, rate limit, correct workspace) |
| H | CSV import preview/commit, bulk export, formula handling | Complete | CSV unit tests + import/export API tests |
| I | Inbound webhooks: HMAC, replay window, event-id idempotency | Complete | Webhook API test (bad signature, stale timestamp, duplicate event) |
| J | Reports, metrics, notifications, audit log | Complete | Report-accuracy test, `/integrations`, `/audit`, `/notifications` |
| K | React SPA, design system, kanban, responsive layout, accessibility basics | Complete | Typecheck + build clean; Playwright/axe suite passes 15/15 with zero WCAG A/AA violations |
| L | Demo data, deployment packaging, quota re-verification, docs close-out | Complete (buyer validation excluded) | Synthetic seed + docs + [FREE_STACK_AUDIT.md](FREE_STACK_AUDIT.md) + [CLOUDFLARE_STACK.md](CLOUDFLARE_STACK.md); live deployment verification recorded in [DEPLOYMENT.md](DEPLOYMENT.md) |

## Next three product milestones

1. **Buyer validation.** Interview 5–10 small agencies / local service businesses about speed-to-lead pain and willingness to pay. The ₹799 / ₹1,999 / ₹3,999 pricing is an unvalidated hypothesis ([MARKET_RESEARCH.md](MARKET_RESEARCH.md), [COMPETITOR_ANALYSIS.md](COMPETITOR_ANALYSIS.md)). No go-to-market claim should be made before this.
2. **Production hardening.** Remove/disable the public demo accounts, move to a managed replicated database (D1 or Postgres), add distributed rate limiting, email verification + password reset, session/notification purge jobs, backup/restore drill, and run the Playwright + axe job on CI. Resolve the `X-Forwarded-For` trust issue behind the deployment proxy.
3. **Narrow integrations, after approval.** Verified email adapter for invitations/reminders with quota caps; inbound webhook UI/documentation polish; optional official Meta lead-form ingestion only after app review and business verification. Keep CSV/manual/webhook as the default path. Re-check all provider quotas before enabling anything.

## Explicitly deferred

Custom fields, saved filters, assignment rules, predictive lead scoring, automatic WhatsApp messaging, social-inbox scraping, call recording, full marketing automation, and complex enterprise workflows.

## What this roadmap excludes

- Buyer interviews and pricing validation are product work, not engineering phases.
- Legal/compliance review and real customer PII are gated on human sign-off ([SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)).
- Cloudflare Workers/D1 migration is not scheduled until account credentials exist ([DEPLOYMENT.md](DEPLOYMENT.md), [FREE_STACK_AUDIT.md](FREE_STACK_AUDIT.md)).

## Related

[PRD.md](PRD.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [TEST_PLAN.md](TEST_PLAN.md) · [TEST_RESULTS.md](TEST_RESULTS.md) · [ASSUMPTIONS.md](ASSUMPTIONS.md)
