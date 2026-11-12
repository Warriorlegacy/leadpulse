# LeadPulse — API Reference

All paths are relative to `/api/v1`. This document describes the **implemented** routes in `server/routes/*.js`. Verified by `tests/api.test.ts` and an HTTP smoke test.

## 1. Conventions

- JSON bodies unless noted. Timestamps are UTC ISO-8601 strings.
- Envelope: success `{ "data": ..., "requestId": "..." }`; error `{ "error": { "code", "message", "details?" }, "requestId" }`.
- `X-Request-Id` is set on every response. Every mutation on a session-protected route requires `X-CSRF-Token`, equal to the `csrfToken` returned by signup/login/`GET /auth/me`.
- Error codes are UPPER_SNAKE (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `CSRF_FAILED`, `RATE_LIMITED`, `PLAN_LIMIT`, `INVALID_TRANSITION`, `INVALID_SIGNATURE`, `REPLAY_REJECTED`, `CONFIRMATION_MISMATCH`, `ROLE_ESCALATION`, ...). Cross-tenant ids return 404.
- **Tenancy is server-derived**: `resolveTenant()` looks up the session's membership and an optional `lp_org` cookie. Any `organizationId` in a body is ignored except `/auth/switch`, which verifies membership. Public capture resolves the org from `public_id`; inbound webhooks resolve it from `endpointId`.
- List endpoints return `{ items, total, page, pageSize }`. `pageSize` defaults to 25, max 100. Sort keys are allowlisted.
- Security headers on all responses: CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, HSTS when HTTPS.

## 2. Auth (`server/routes/auth-workspace.js`)

| Method | Path | Auth | Request | Response `data` |
| --- | --- | --- | --- | --- |
| POST | `/auth/signup` | public, rate 8/5m | `{name,email,password,workspaceName}` | `{user,organizations,currentOrganization,csrfToken}` — creates org + 6 default stages + capture form |
| POST | `/auth/login` | public, rate 12/5m | `{email,password}` | same shape |
| POST | `/auth/logout` | session | — | `{signedOut:true}` |
| GET | `/auth/me` | session | — | same shape (session-based `csrfToken`) |
| POST | `/auth/switch` | session | `{organizationId}` | `{currentOrganization,role}` |

Passwords: scrypt (N=16384, salted). Session token is random, stored as SHA-256 hash; cookie `lp_session` is HttpOnly, SameSite=Lax, Secure behind HTTPS, 30-day expiry.

## 3. Workspace, members, invitations

| Method | Path | Auth | Request | Response `data` |
| --- | --- | --- | --- | --- |
| GET | `/workspace` | session | — | `{organization,role,counts:{leads,members,stages}}` |
| PATCH | `/workspace` | workspace:update | any of `name,timezone,industry,currency,workingHoursStart,workingHoursEnd,workingDays[],slaTargetMinutes,slaBusinessHoursOnly` | `{organization}` |
| GET | `/workspace/export` | workspace:update | — | JSON backup of 18 tables, scoped to the workspace |
| DELETE | `/workspace` | workspace:delete (owner) | `{confirmation}` — must equal the workspace slug | `{deleted:true}` — **hard** delete with FK cascade; export first |
| GET | `/workspace/members` | session | — | `{items:[{id,user_id,name,email,role,can_view_unassigned,created_at}]}` |
| PATCH | `/workspace/members/:id` | members:manage | `{role,canViewUnassigned?}` | `{member}` |
| DELETE | `/workspace/members/:id` | members:manage | — | `{removed:true}` |
| GET | `/workspace/invitations` | invites:manage | — | `{items}` (never includes tokens) |
| POST | `/workspace/invitations` | invites:manage, rate 20/h | `{email,role}` | `{invitation,token,note}` — **plain token returned once**; stored as SHA-256 |
| DELETE | `/workspace/invitations/:id` | invites:manage | — | `{revoked:true}` |
| POST | `/invitations/:token/accept` | session | `{}` (optionally name/password, unused) | `{organization,role}` — requires session email to match; single-use, 72h expiry, no role escalation |
| GET | `/audit` | audit:view | `page,pageSize` | `{items,total,page,pageSize}` |
| GET | `/notifications` | session | — | `{items,unread}` |
| POST | `/notifications/:id/read` | session | — | `{read:true}` |
| GET | `/integrations` | session | — | `{items:[{key,label,configured,state,reason}]}` — all `configured:false` |
| GET | `/admin/overview` | platform:overview | — | aggregate counts only; requires `users.is_platform_admin` |

## 4. Leads (`server/routes/leads.js`)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/leads/export` | leads:export | `text/csv`; honours the same filters; formula-neutralised; BOM prefixed |
| GET | `/leads` | session | Query: `search,stage,owner,source,tag,overdue,archived,sort,dir,page,pageSize`. Returns `{items,total,page,pageSize,facets:{stages,sources,members,tags},permissions}` |
| POST | `/leads` | leads:create | `{name,company?,email?,phone?,source?,campaign?,stageId?,ownerId?,priority?,consent?,notes?,amount?,tags[]?,nextFollowUpAt?}`. At least one of email/phone is required. Returns `{lead}` |
| GET | `/leads/:id` | session + row scope | `{lead,activities,tasks,stageEvents,candidates,permissions}` |
| PATCH | `/leads/:id` | leads:edit + row scope | Partial lead fields. `ownerId` requires leads:assign; `stageId` is intentionally ignored — use the transition endpoint |
| POST | `/leads/:id/archive` | leads:archive | `{lead}` — sets `archived_at` |
| POST | `/leads/:id/restore` | leads:archive | `{lead}` — clears it |
| GET | `/leads/:id/duplicates` | session + row scope | `{items:[{...lead,reasons[],score}],note}` — **propose only** |
| POST | `/leads/:id/merge` | leads:assign, rate 30/h | `{sourceLeadId}` — explicit merge; moves activities/tasks/stage_events/tags, archives source, writes a system activity |

## 5. Pipeline, activities, tasks (`server/routes/workflow.js`)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/pipeline` | session | `{columns:[{stage,leads,count}],canConfigure,canAssign}` — agent-scoped |
| PATCH | `/pipeline/stages` | pipeline:configure | `{stages:[{id?,name,kind,color?}]}` — updates by id, inserts new ones; no deletion (history integrity) |
| POST | `/leads/:id/transition` | pipeline:transition + row scope | `{stageId,reason?}` — writes `stage_events` + system activity; rejects closed→closed |
| GET | `/leads/:id/activities` | session + row scope | `{items}` |
| POST | `/leads/:id/activities` | activities:create + row scope | `{type:'call'\|'email'\|'meeting'\|'note',body}` — first human type sets `first_response_at` once. Returns a note that no message was sent |
| GET | `/leads/:id/stage-events` | session + row scope | `{items}` |
| GET | `/tasks` | session | `bucket=all\|overdue\|today\|upcoming`; returns `{items,counts,timezone,bucket}`; due-today computed in workspace timezone |
| POST | `/tasks` | tasks:create | `{title,leadId?,ownerId?,dueAt,priority?,reminder?}` |
| PATCH | `/tasks/:id` | tasks:edit + row scope | `{title?,dueAt?,priority?,completed?,ownerId?}` |
| GET | `/tags` | session | `{items}` |

## 6. Reports (`server/routes/data.js`)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/reports/summary` | reports:view | `from,to` (ISO). Returns `{window,metrics,sourceBreakdown,stageBreakdown,teamActivity,leadsByDay,note}`. Empty denominators produce `null`, never invented numbers. See [METRIC_DEFINITIONS.md](METRIC_DEFINITIONS.md) |

## 7. Capture forms and public POST

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/capture-forms` | session | `{form:{...,fields[],publicUrl},canConfigure}` |
| PATCH | `/capture-forms` | capture:configure | `{title?,intro?,consentNotice?,fields[]?,active?}` |
| POST | `/capture-forms/rotate` | capture:configure | `{publicId,note}` — old link stops working |
| GET | `/public/forms/:publicId` | public, rate 60/m | `{form:{title,intro,consentNotice,fields}}` — **no** workspace name, internal ids or owner info |
| POST | `/public/forms/:publicId` | public, rate 5/m | `{name,email?,phone?,company?,message?,consent,website?}` — `website` is a honeypot; consent required. Returns `{received,reference,note}` |

## 8. CSV import

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/imports/preview` | leads:import, rate 20/h | `{filename?,csv,idempotencyKey,columnMap?}`. Max 2 MB / 5000 rows. Returns `{job:{id,status,summary,header,mapping},invalid[],preview[],idempotent}`. **Parsed rows are held in memory for 15 minutes, not written to disk** |
| GET | `/imports/:id` | leads:import | `{job}` |
| POST | `/imports/:id/commit` | leads:import | `{confirm:true}` — explicit confirmation; idempotent (a second commit reports `alreadyCommitted`) |

## 9. Inbound webhooks

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/webhooks/endpoints` | webhooks:manage | `{items,note}` — secrets never returned |
| POST | `/webhooks/endpoints` | webhooks:manage | `{name}` → `{endpoint,secret,note}`. Secret shown once; stored AES-256-GCM encrypted plus a SHA-256 hash |
| DELETE | `/webhooks/endpoints/:id` | webhooks:manage | `{revoked:true}` |
| POST | `/webhooks/inbound/:endpointId` | signature, rate 120/m | Raw body + headers below → `{accepted,leadId}` |

Required headers: `X-LeadPulse-Timestamp` (unix seconds, 10 digits), `X-LeadPulse-Signature` (hex HMAC-SHA256 of `"<timestamp>.<rawBody>"`), `X-LeadPulse-Event-Id` (unique, `[\w-]{1,120}`).

Rules: 5-minute replay window; constant-time signature comparison; duplicate `event_id` returns `{duplicate:true,status,leadId}` without creating a second lead; invalid signature 401; stale timestamp 401 `REPLAY_REJECTED`; invalid JSON/schema 400. Rejected attempts are recorded under a shadow event id so a valid retry is not consumed. `webhook_deliveries` stores metadata only — never secrets or raw PII.

## 10. Health

`GET /health` → `{status,version,database:{driver,file,durable,migrations},demoEnabled,time}`. No PII or secrets.

## 11. Not implemented

No email delivery, AI, Meta/WhatsApp messaging, billing, OAuth, R2 file storage, password reset, or push notifications. `GET /integrations` reports each as disabled with a reason. There is no `DELETE /leads/:id`; use archive instead.

## 12. Related

[ARCHITECTURE.md](ARCHITECTURE.md) · [DATA_DICTIONARY.md](DATA_DICTIONARY.md) · [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [METRIC_DEFINITIONS.md](METRIC_DEFINITIONS.md) · [TEST_PLAN.md](TEST_PLAN.md)
