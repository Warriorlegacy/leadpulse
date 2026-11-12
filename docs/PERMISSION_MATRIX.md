# LeadPulse — Permission Matrix

Normative source: `PERMISSIONS` in `server/rbac.js`. **Every check is enforced server-side** (`requirePermission` middleware); the UI hides controls only as a convenience. `platform_admin` is a flag on `users.is_platform_admin`, not a membership role — it grants only `platform:overview`.

## 1. Roles

| Role | Stored where | Scope |
| --- | --- | --- |
| `platform_admin` | `users.is_platform_admin = 1` | Aggregate counts via `/admin/overview` only. No tenant data access by default |
| `workspace_owner` | `memberships.role` | Full control, including hard workspace deletion |
| `workspace_admin` | `memberships.role` | Settings, members, invites, pipeline, capture, webhooks, exports. Cannot delete workspace |
| `manager` | `memberships.role` | All leads, assignment, reports, audit, import/export |
| `agent` | `memberships.role` | Own leads + unassigned queue **only when** `memberships.can_view_unassigned = 1` |

## 2. Capability matrix (verbatim from `server/rbac.js`)

| Capability key | owner | admin | manager | agent |
| --- | --- | --- | --- | --- |
| `workspace:update` | ✓ | ✓ | — | — |
| `workspace:delete` | ✓ | — | — | — |
| `workspace/export` (gated by `workspace:update`) | ✓ | ✓ | — | — |
| `members:manage` | ✓ | ✓ | — | — |
| `invites:manage` | ✓ | ✓ | — | — |
| `leads:view_all` | ✓ | ✓ | ✓ | — |
| `leads:view_assigned` | ✓ | ✓ | ✓ | ✓ |
| `leads:create` | ✓ | ✓ | ✓ | ✓ |
| `leads:edit` | ✓ | ✓ | ✓ | ✓ (row-scoped) |
| `leads:assign` | ✓ | ✓ | ✓ | — |
| `leads:archive` | ✓ | ✓ | ✓ | ✓ (row-scoped) |
| `leads:export` | ✓ | ✓ | ✓ | — |
| `leads:import` | ✓ | ✓ | ✓ | — |
| `pipeline:configure` | ✓ | ✓ | — | — |
| `pipeline:transition` | ✓ | ✓ | ✓ | ✓ (row-scoped) |
| `activities:create` | ✓ | ✓ | ✓ | ✓ (row-scoped) |
| `tasks:create` | ✓ | ✓ | ✓ | ✓ |
| `tasks:edit` | ✓ | ✓ | ✓ | ✓ (row-scoped) |
| `reports:view` | ✓ | ✓ | ✓ | — |
| `capture:configure` | ✓ | ✓ | — | — |
| `webhooks:manage` | ✓ | ✓ | — | — |
| `audit:view` | ✓ | ✓ | ✓ | — |
| `platform:overview` | — | — | — | — (platform_admin flag only) |

## 3. Row scoping

- `visibleLead()` loads the lead with `WHERE id = ? AND organization_id = ?`. A missing row returns **404**, so cross-tenant ids are not enumerable.
- For `agent`: allowed only when `owner_id = current user`, or `owner_id IS NULL` **and** the membership has `can_view_unassigned = 1`. Otherwise 403.
- `visibleTask()` applies the same org check; agents may only edit their own tasks.
- `/leads`, `/pipeline` and `/tasks` apply the equivalent scope in SQL, not just in the detail handlers.
- `PATCH /leads/:id` with `ownerId` additionally requires `leads:assign`. `POST /leads/:id/merge` requires `leads:assign`.

## 4. Invitation role rules

- The API accepts only `workspace_admin`, `manager`, `agent` (the schema forbids inviting an owner).
- `ROLE_RANK[invite.role] >= ROLE_RANK[issuer.role]` is rejected with `ROLE_ESCALATION`, so an admin cannot invite an admin.
- The stored `issuer_role` is re-checked at acceptance. Acceptance requires a session whose email exactly matches the invitation email; the role is **never** read from the accept body.
- Tokens are SHA-256 hashed at rest, single-use, 72-hour expiry, revocable.

## 5. Enforcement notes

- `resolveTenant()` derives `organization_id` from the session + membership + optional `lp_org` cookie. A body/query `organizationId` is never trusted (except membership-verified `/auth/switch`).
- Public capture and inbound webhooks are sessionless by design; they derive the org from `public_id` / `endpointId`, and CSRF/permission middleware is bypassed only for those explicit paths.
- `platform_admin` has no membership role in this build; granting it requires a direct database change and is not exposed in the UI.

## 6. Related

[API.md](API.md) · [DATA_DICTIONARY.md](DATA_DICTIONARY.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [TEST_PLAN.md](TEST_PLAN.md)
