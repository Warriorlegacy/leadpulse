# LeadPulse — Security and Privacy

Describes controls actually implemented in `server/*.js`. This is **not** a compliance certification or a penetration-test result. Verified behaviours are covered in [TEST_RESULTS.md](TEST_RESULTS.md).

## 1. Threat model and implemented mitigations

| Threat | Mitigation in code |
| --- | --- |
| Cross-tenant IDOR | `resolveTenant()` derives `organization_id` from the session + membership. All tenant reads/writes filter on it; `visibleLead()`/`visibleTask()` add `AND organization_id = ?` and return 404 for foreign ids. `tests/api.test.ts` asserts this for detail, list, export, activities and workspace backup |
| Privilege escalation | `requirePermission()` checked server-side on every protected mutation. Invitation rank checks prevent inviting at/above the issuer's role; the accept endpoint re-checks the stored `issuer_role`. Owner role cannot be changed or removed |
| Session theft | Random 32-byte token stored as SHA-256 hash; `HttpOnly`, `SameSite=Lax`, `Secure` behind HTTPS, 30-day expiry; logout deletes the server row. No session token in URLs or client bundles |
| CSRF | Double-submit token bound to the server-side session, required via `X-CSRF-Token` on all session-protected mutations. Exempt only for auth endpoints, public capture and signed webhooks |
| XSS | React escapes by default; no `dangerouslySetInnerHTML`; CSP `default-src 'self'; script-src 'self'; frame-ancestors 'none'; object-src 'none'`; `X-Content-Type-Options: nosniff` |
| Brute force / abuse | In-memory sliding-window rate limits: signup 8/5m, login 12/5m, invites 20/h, imports 20/h, merge 30/h, webhook inbound 120/m, public form read 60/m and submit 5/m. 429 includes `Retry-After` |
| Invite token theft | SHA-256 hash at rest, single-use, 72h expiry, revocable, bound to the invited email. Plain token returned once and never logged |
| Public-form spam | Honeypot field, consent requirement, Zod validation, per-IP rate limit, and a single response that reveals no internal data. `GET /public/forms/:publicId` returns only title/intro/consent/fields |
| Webhook replay | `X-LeadPulse-Timestamp` (unix seconds) within ±5 minutes; `X-LeadPulse-Signature` = hex HMAC-SHA256 of `"<timestamp>.<rawBody>"`, constant-time compared; unique `X-LeadPulse-Event-Id` with a UNIQUE(endpoint_id,event_id) delivery row. Rejected attempts use a shadow id so a valid retry is not consumed |
| CSV formula injection | `csvCell()` prefixes cells starting with `= + - @ tab CR` with `'` and RFC-4180 quotes them; `parseCsv()` bounds input at 2 MB / 5000 rows / 40 columns and flags malformed and ragged rows |
| SQL injection | All values are bound parameters. Only allowlisted identifiers reach SQL: sort columns from `SORT_COLUMNS`, table names from fixed arrays. No string concatenation of user input into SQL |
| PII in logs | `errorHandler` logs only `requestId` + error message. `audit_events.metadata` stores ids/field names, not bodies. `webhook_deliveries` stores status/reason only — no raw payload, no secret. Import previews hold parsed rows in process memory (15 min), never on disk |
| Secret exposure | Password hashes scrypt; session/invite tokens SHA-256; webhook secrets AES-256-GCM with a local key file or `WEBHOOK_ENCRYPTION_KEY`. `.env.example` has placeholders only, `data/*` gitignored |
| Unsafe deletes | Leads archive/restore. Workspace deletion requires `workspace:delete` (owner), a JSON backup route, and a typed slug confirmation; the deletion is audit-logged |

## 2. Data classification

| Class | Examples | Handling |
| --- | --- | --- |
| Public | `capture_forms.public_id`, form title/intro/consent text | No auth; no internal ids, owner names or lead data |
| Internal PII | Lead name/email/phone/company/notes, CSV rows, invitation email | Tenant-scoped, excluded from logs, bulk export gated by `leads:export` |
| Credentials | Password hashes, session/invite token hashes, encrypted webhook secrets, CSRF tokens | Never logged, never returned after creation |
| Operational | Audit events, request ids, delivery metadata, aggregate metrics | No raw PII |

## 3. Retention and deletion

- Leads: soft archive (`archived_at`), restorable; merged duplicates retain all history on the survivor.
- Workspace: hard delete with FK cascade after explicit confirmation. Export a JSON backup first (`GET /workspace/export`).
- `stage_events`, `activities`, `audit_events`, `webhook_deliveries`, `schema_migrations`: insert-only in application code.
- Sessions expire after 30 days; **expired rows, old notifications, expired invitations and idempotency keys are not automatically purged** — there is no cleanup job yet.
- No at-rest encryption beyond filesystem permissions and the encrypted webhook secrets. No backup job or restore drill is claimed.

## 4. Known limitations and outstanding risks

1. **Single-process SQLite.** One Node process, one file. No replication, no multi-writer concurrency, no failover. The `sql.js` fallback uses write-through export; a read-only sandbox falls back to in-memory storage — `GET /health` reports `durable:false` in that case.
2. **Public demo credentials.** `demo@leadpulse.example` / `agent@leadpulse.example` / `demo12345` are seeded when `ALLOW_DEMO` is not `false` and are printed on the sign-in page. On any shared deployment this is an open account for a workspace containing synthetic data only. Set `ALLOW_DEMO=false` and remove the demo accounts before handling real data.
3. **No email provider, password reset, MFA or SSO.** Invitation links must be shared manually. An attacker with a session cookie is not challenged again.
4. **No email verification on signup.** The "verify email before accepting an invitation" rule is implemented as an exact session-email match, not a verified-email flag.
5. **In-process rate limiting.** Counters reset on restart and are not shared across instances.
6. **`X-Forwarded-For` is trusted for client IP.** Behind an untrusted proxy a client could spoof it to bypass per-IP limits. Deploy behind a trusted reverse proxy that overwrites the header.
7. **No legal/privacy review.** No GDPR/DPDP/CCPA certification, DPA, data-residency commitment, consent-management workflow or breach procedure. Do not load real customer PII until reviewed.
8. **Free-tier quotas change.** Re-verify before making any hosting claim ([FREE_STACK_AUDIT.md](FREE_STACK_AUDIT.md)).
9. **No automated browser/accessibility audit yet.** Keyboard operability is implemented (kanban arrow buttons, focus-visible, labels, table view) but not verified by Playwright/axe. See [TEST_RESULTS.md](TEST_RESULTS.md).
10. **Hosting proxy weakens clickjacking protection (verified 2026-11-13).** The app sets `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`; on the WorkBuddy hosted URL the proxy removes `X-Frame-Options` and rewrites CSP to `frame-ancestors 'none' *`. Other security headers pass through. Use a domain/proxy that preserves these headers for any customer-facing deployment. See [DEPLOYMENT.md](DEPLOYMENT.md).

## 5. Related

[API.md](API.md) · [DATA_DICTIONARY.md](DATA_DICTIONARY.md) · [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md) · [TEST_RESULTS.md](TEST_RESULTS.md) · [DEPLOYMENT.md](DEPLOYMENT.md) · [ASSUMPTIONS.md](ASSUMPTIONS.md)
