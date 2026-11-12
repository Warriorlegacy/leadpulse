# LeadPulse — Test Plan

Scenarios are mapped to the acceptance tests in the build brief. Executed results live in [TEST_RESULTS.md](TEST_RESULTS.md); this file describes intent and coverage only.

## 1. Commands

```
npm run typecheck     # tsc --noEmit (src/**/*.ts, tsx, vite.config.ts)
npm test              # vitest run (tests/unit.test.ts + tests/api.test.ts)
npm run build         # vite build -> public/
npm run check         # all three in sequence
npm start             # node server/index.js, then HTTP smoke test
```

`tests/api.test.ts` boots a fresh temporary SQLite file, calls `initDb()`, and exercises the real Hono app via `app.request()` with a cookie jar and CSRF token. `tests/unit.test.ts` covers pure utilities.

## 2. Acceptance scenarios and where they are covered

| ID | Brief acceptance test | Implementation | Automated? |
| --- | --- | --- | --- |
| T01 | User A cannot access org B's lead/task/export by guessed id | `api.test.ts` → "blocks user B from reading, listing or exporting user A data", "exports a complete workspace backup without leaking other tenants" | ✓ |
| T02 | Agent cannot change settings or export all records | `api.test.ts` → "invitation is single-use, expiring, email-bound and cannot escalate" (agent PATCH workspace + bulk export), "agent only sees assigned leads…" | ✓ |
| T03 | Invitation single-use, expires, cannot grant a higher role | Same test: second accept 410, expired 410, email mismatch 403, admin inviting admin 403 | ✓ |
| T04 | Lead create/update/archive/restore + stage history persist | `api.test.ts` → "persists create, update, archive, restore and stage history"; "rejects an impossible stage transition" | ✓ |
| T05 | Duplicate detector proposes but does not merge | `api.test.ts` → "proposes duplicates but never merges without explicit confirmation" | ✓ |
| T06 | Failed drag/drop rolls back UI state | `Pipeline.tsx` holds no optimistic state; `move()` reloads on both success and failure, so a rejected transition leaves the card in its original column | Manual / code review |
| T07 | CSV malformed, oversized, formula payloads | `api.test.ts` → "neutralises spreadsheet formulas on export and handles malformed CSV" (2 MB rejection, 5000-row truncation, unterminated quote, formula prefix); `unit.test.ts` → CSV suite | ✓ |
| T08 | Public capture rate-limited and only creates in correct workspace | `api.test.ts` → "public form creates a lead only in its own workspace, blocks bots and rate-limits" | ✓ |
| T09 | Webhook rejects invalid signatures/replays and is idempotent | `api.test.ts` → "webhook verifies HMAC, rejects replay and is idempotent per event id" | ✓ |
| T10 | SLA respects timezone/business-hour policy | `unit.test.ts` → "SLA clock and timezone handling" (wall clock, business hours, weekend exclusion, `Asia/Kolkata` conversion) | ✓ |
| T11 | Reports match independently queried fixture data | `api.test.ts` → "derives dashboard figures from persisted records only" (empty state, counts, pipeline value, source totals) | ✓ |
| T12 | Mobile and keyboard flows | Responsive CSS breakpoints at 1100/860/520 px, card views, focus-visible, labelled controls, keyboard kanban arrows and table alternative | **Not automated** — Playwright/axe not installed |
| T13 | CSRF, security headers, unauthenticated access | `api.test.ts` → "platform health and security headers" group | ✓ |
| T14 | Import idempotency + explicit confirmation | `api.test.ts` → "imports a preview idempotently and only after explicit confirmation" | ✓ |
| T15 | First human response written once, never rewritten | `api.test.ts` → "records first human response exactly once" | ✓ |

## 3. Test data

- All automated tests use a fresh temporary DB with `ALLOW_DEMO=false`; no demo accounts are used as fixtures.
- Each test signs up isolated organizations with distinct `X-Forwarded-For` values to keep rate-limit buckets independent.
- Only `example.org` / `example.com` addresses and `+1555` phone numbers are used. No real customer PII.
- Local HTTP smoke test uses the seeded synthetic demo workspace.

## 4. Known gaps

- No Playwright/browser E2E, no axe accessibility scan, no visual regression screenshots, no load testing, no penetration test.
- No cross-browser matrix verification.
- No test for the `sql.js` write-through fallback driver or the in-memory read-only-sandbox path.
- No test for concurrent writers or process-restart durability with WAL.
- No test for the `ALLOW_DEMO=false` deployment configuration against a live instance.

## 5. Related

[TEST_RESULTS.md](TEST_RESULTS.md) · [API.md](API.md) · [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md) · [METRIC_DEFINITIONS.md](METRIC_DEFINITIONS.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)
