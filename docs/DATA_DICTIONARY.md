# LeadPulse — Data Dictionary

Authoritative source: `server/schema.sql`, applied idempotently on boot (`schema_migrations` version 1). All timestamps are UTC ISO-8601 text. `PRAGMA foreign_keys = ON` is enabled for both database drivers.

## 1. Tables

| Table | Purpose | Key columns | Tenancy | Retention / deletion |
| --- | --- | --- | --- | --- |
| `schema_migrations` | Applied migration log | `version` PK, `name`, `applied_at` | n/a | Append-only |
| `users` | Accounts | `id`, `email` UNIQUE, `name`, `password_hash` (scrypt), `is_platform_admin`, `created_at`, `updated_at` | Global | Retained while account exists. `platform_admin` is a **user flag**, not a membership role |
| `sessions` | Server-side sessions | `id`, `user_id` FK, `token_hash` UNIQUE, `csrf_token`, `expires_at`, `created_at`, `last_seen_at` | via `user_id` | Deleted on logout; expired rows are not automatically purged (see limitations) |
| `organizations` | Tenant root | `id`, `name`, `slug` UNIQUE, `timezone`, `industry`, `currency`, `working_hours_start`, `working_hours_end`, `working_days` (e.g. `1,2,3,4,5`), `sla_target_minutes`, `sla_business_hours_only`, `is_demo`, timestamps | Tenant root | **Hard** delete with FK cascade, owner-only, slug confirmation required |
| `memberships` | User↔org role | `id`, `organization_id`, `user_id`, `role` CHECK (`workspace_owner`/`workspace_admin`/`manager`/`agent`), `can_view_unassigned`, `created_at`; UNIQUE(org,user) | `organization_id` | Deleted on member removal |
| `invitations` | Single-use invites | `id`, `organization_id`, `email`, `role`, `token_hash` UNIQUE, `invited_by`, `issuer_role`, `expires_at`, `accepted_at`, `revoked_at`, `created_at` | `organization_id` | Token hashed at rest; 72h TTL; rows retained for audit |
| `lead_sources` | Attribution | `id`, `organization_id`, `name`, `kind` CHECK, `created_at`; UNIQUE(org,name) | `organization_id` | Created on demand; retained for historical reports |
| `pipeline_stages` | Ordered columns | `id`, `organization_id`, `name`, `position`, `kind` CHECK (`open`/`won`/`lost`), `color`, `created_at`; UNIQUE(org,name) | `organization_id` | Never deleted by the API (stage history must remain valid) |
| `leads` | Core record | `id`, `organization_id`, `name`, `company`, `email`, `email_norm`, `phone`, `phone_norm`, `source_id`, `campaign`, `stage_id`, `owner_id`, `priority`, `consent`, `notes`, `amount_cents`, `next_follow_up_at`, `first_response_at`, `created_by`, timestamps, `archived_at`, `merged_into_id` | `organization_id` | **Soft** delete via `archived_at`; restore clears it. Merge archives the source and sets `merged_into_id` |
| `stage_events` | Immutable transition log | `id`, `organization_id`, `lead_id`, `from_stage_id`, `to_stage_id`, `reason`, `actor_id`, `created_at` | `organization_id` | Insert-only. Drives conversion metrics |
| `tags` / `lead_tags` | Labels and join | `tags(id,organization_id,name,color)` UNIQUE(org,name); `lead_tags(lead_id,tag_id)` composite PK | `tags` has `organization_id`; `lead_tags` derives it from the lead | Cascade on lead/tag delete |
| `activities` | Timeline | `id`, `organization_id`, `lead_id`, `type` CHECK (`call`/`email`/`meeting`/`note`/`system`), `body`, `actor_id`, `created_at` | `organization_id` | Insert-only. First `call`/`email`/`meeting` sets `leads.first_response_at` exactly once |
| `tasks` | Follow-up actions | `id`, `organization_id`, `lead_id`, `title`, `owner_id`, `due_at`, `priority`, `reminder`, `completed_at`, `created_by`, timestamps | `organization_id` | Completed rows retained for overdue history |
| `capture_forms` | Public form config | `id`, `organization_id` UNIQUE, `public_id` UNIQUE, `title`, `intro`, `consent_notice`, `fields` (JSON array), `active`, `default_source_id`, timestamps | `organization_id` | `public_id` can be rotated; one form per workspace |
| `webhook_endpoints` | Inbound endpoints | `id`, `organization_id`, `name`, `secret_hash`, `secret_enc` (AES-256-GCM), `active`, `created_at`, `revoked_at` | `organization_id` | Revocation sets `active=0`; secret never logged or returned twice |
| `webhook_deliveries` | Delivery metadata | `id`, `organization_id`, `endpoint_id`, `event_id`, `status` CHECK, `reason`, `lead_id`, `received_at`; UNIQUE(endpoint_id,event_id) | `organization_id` | Metadata only — no raw payload, no secret |
| `csv_import_jobs` | Import state | `id`, `organization_id`, `idempotency_key` UNIQUE, `filename`, `column_map`, `summary` (JSON), `status`, `created_by`, `created_at`, `committed_at` | `organization_id` | Parsed row data is **process memory only** (15-min TTL), never persisted as PII |
| `audit_events` | Sensitive actions | `id`, `organization_id`, `actor_id`, `action`, `entity_type`, `entity_id`, `metadata` (JSON of ids/field names), `ip`, `created_at` | `organization_id` | Insert-only; no PII, secrets or bodies |
| `notifications` | In-app alerts | `id`, `organization_id`, `user_id`, `kind`, `message`, `lead_id`, `read_at`, `created_at` | `organization_id` + `user_id` | Retained; no automatic purge job |
| `notification_preferences` | Channel opt-outs | `user_id`, `organization_id`, `in_app`, `email`; composite PK | both | Cascades with membership |
| `plan_limits` | Pilot quotas | `organization_id` PK, `plan`, `max_leads` (5000), `max_members` (25), `max_import_rows` (500), `updated_at` | `organization_id` | One row per workspace; quotas are product limits, not verified provider quotas |
| `idempotency_keys` | Retry protection | `key` PK, `scope`, `result` (JSON), `created_at` | n/a | Used by CSV import previews; no automatic purge |

## 2. Indexes

`leads` has composite indexes on `(organization_id, created_at DESC)`, `(organization_id, stage_id)`, `(organization_id, owner_id)`, `(organization_id, next_follow_up_at)`, `(organization_id, email_norm)`, `(organization_id, phone_norm)`. Additional indexes: `sessions(user_id)`, `memberships(user_id)`, `invitations(organization_id)`, `pipeline_stages(organization_id,position)`, `stage_events(lead_id,created_at)`, `activities(lead_id,created_at)`, `tasks(organization_id,due_at)`, `tasks(owner_id,completed_at)`, `webhook_endpoints(organization_id)`, `audit_events(organization_id,created_at DESC)`, `notifications(user_id,read_at)`.

## 3. Conventions

- **Soft deletion** applies to `leads` (`archived_at`) and merged duplicates. Workspace deletion is a hard cascade — the API requires a JSON backup first and a typed slug confirmation.
- **UTC everywhere**; the workspace `timezone` is used only for due-today boundaries, display and the optional business-hours SLA clock.
- **Server-derived tenancy**: `organization_id` comes from the session's membership. A client-supplied org id is never trusted.
- **Append-only in practice**: `stage_events`, `activities`, `audit_events`, `webhook_deliveries`, `schema_migrations` receive inserts only. `mergeLeads` re-parents activities/tasks/stage_events to preserve history.
- **Secrets**: password hashes (scrypt), session/invite token hashes (SHA-256), webhook secrets (AES-256-GCM with a local key file or `WEBHOOK_ENCRYPTION_KEY`). None is logged or returned after creation.
- **Drivers**: built-in `node:sqlite` (durable file, WAL) with a pure-WASM `sql.js` write-through fallback, and an in-memory fallback for read-only sandboxes. `GET /health` reports `durable`.

## 4. Known schema limitations

- No `lead_contacts` table; MVP stores one email and one phone per lead.
- No soft-delete column on `organizations`; deletion is immediate after confirmation.
- No automatic purge jobs for expired sessions, notifications, import previews or idempotency keys.
- No database-level row encryption; filesystem permissions are the only at-rest control.

## 5. Related

[ARCHITECTURE.md](ARCHITECTURE.md) · [API.md](API.md) · [METRIC_DEFINITIONS.md](METRIC_DEFINITIONS.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md)
