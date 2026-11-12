# LeadPulse — Free Stack Audit

Checked **12 November 2026**. Provider plans and quotas change; re-verify before any deployment or cost claim. Nothing in this document is a promise that a free tier is permanent, unlimited, or commercially permitted for every use.

## 1. What this build actually uses

| Provider / component | Purpose | Plan used | Cost | Verified? |
| --- | --- | --- | --- | --- |
| Node.js 22 (built-in `node:sqlite`) | Runtime + relational storage | Open source, local | ₹0 | Local runtime verified on this machine |
| `sql.js` (WASM SQLite) | Fallback driver for runtimes without `node:sqlite` | Open source (MIT) | ₹0 | Installed, **fallback path not exercised in tests** |
| Hono, `@hono/node-server`, React, Vite, Zod, Vitest, TypeScript | Framework / tooling | Open source npm packages | ₹0 | Installed and used; `npm install` succeeded |
| WorkBuddy App Publishing (sites) | Production-style hosting, single public port | Platform capability, no external account needed | ₹0 at time of use | Used for deployment — see [DEPLOYMENT.md](DEPLOYMENT.md) |
| Local filesystem | SQLite database file, webhook encryption key | Local | ₹0 | Verified locally; read-only sandbox falls back to in-memory SQLite |

**No external paid or free-tier service is required for the core product to work.** Email, AI, Meta, WhatsApp, billing, analytics and object storage are all behind adapters and are **disabled** (`GET /api/v1/integrations` reports `configured:false` with a reason for each).

## 2. Cloudflare baseline — re-verified from official docs

The prompt pack's figures were independently re-checked by a research subagent on 2026-11-12. All four were **confirmed**, with nuances added:

| Service | Official source | Verified free allowance | Nuance |
| --- | --- | --- | --- |
| Workers Free | https://developers.cloudflare.com/workers/platform/limits/ | 100,000 requests/day (resets midnight UTC); 10 ms CPU **per HTTP request**/Cron Trigger; 128 MB; 50 subrequests; 100 Workers | CPU excludes network wait. Page shows no last-updated date |
| Workers Static Assets | https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ (last updated 12 Nov 2026) | Static-asset requests free and unlimited; no storage charge | Worker-invoking (SSR) requests are billed as Worker requests. Free-tier `run_worker_first` requests return 429 rather than falling back to static |
| D1 Free | https://developers.cloudflare.com/d1/platform/limits/ (last updated 30 Oct 2026) | 10 databases, 500 MB/database, 5 GB/account, 7-day Time Travel, 50 queries/invocation | Query limits apply per invocation |
| R2 Standard | https://developers.cloudflare.com/r2/pricing/ (last updated 30 Oct 2026) | 10 GB-month storage, 1M Class A ops, 10M Class B ops monthly, free egress | Free allocation covers Standard storage only |

**This build is NOT deployed on Cloudflare.** There is no `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `wrangler` login or `~/.wrangler` config in the workspace. Deploying there would also require adapting the Node/Hono server to the Workers runtime and replacing the SQLite driver with D1 bindings. See [DEPLOYMENT.md](DEPLOYMENT.md) for the exact remaining work. Do not describe this app as a Cloudflare deployment.

## 3. Better Auth compatibility (checked, not adopted)

Official guide: https://better-auth.com/docs/guides/cloudflare (no published last-updated date). Verified notes:
- Node.js compatibility is default from `compatibility_date 2026-08-04`; earlier dates need the `nodejs_compat` flag.
- `process.env` access from 2025-04-01; earlier dates must read `env` from `cloudflare:workers`.
- Set `ipAddressHeaders: ["cf-connecting-ip"]` or rate limiting collapses into one shared bucket.
- Use `waitUntil` via `advanced.backgroundTasks.handler`.
- KV cannot serve as `secondaryStorage` (60s minimum expiry, no atomic ops) → Redis needed.
- **Unverified**: the guide does not mention D1, so Better Auth + D1 compatibility was not confirmed.

Better Auth was therefore not adopted. This build uses server-side sessions with scrypt-hashed passwords, hashed session tokens and a CSRF token — see [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

## 4. Optional providers — checked but NOT enabled

| Provider | Source checked | Status | Why disabled |
| --- | --- | --- | --- |
| Resend (email) | https://resend.com/pricing | Not verified in this session | No API key, no email adapter enabled; in-app notifications only. Invite links are copied manually |
| Gemini API | https://ai.google.dev/gemini-api/docs/pricing | Not re-verified | No AI feature is implemented and no customer data is sent to any AI endpoint. A `GEMINI_API_KEY` exists in the environment but is deliberately unused |
| Meta Marketing API | Not verified | Disabled | Requires app review, business verification, permissions and token lifecycle. CSV/manual/webhook capture is the usable default |
| WhatsApp Cloud API | Not verified | Disabled | No approved account/templates. Only a user-initiated click-to-chat link is offered |
| Razorpay / Stripe | Not verified | Disabled | Pricing is an unvalidated hypothesis; no billing is connected and no payments are simulated |

## 5. Resource directories reviewed

- `https://github.com/ripienaar/free-for-dev` — latest commit 12 Nov 2026. README explicitly warns that offerings change or get retired, and requires ≥1 year free (not a trial). **Verified relevant**: Cloudflare Workers 100k/day, Pages 500 builds/month, free DNS/SSL; Cloud Run 2M requests/month; CircleCI 6,000 min/month; GitHub Actions; DynamoDB 25 GB; Firestore 1 GB / 50k reads/day. The fetched README was truncated, so **Email/DNS/Domain/Crash-reporting sections were not verified**.
- `https://theaileverage.beehiiv.com/p/the-unslop-playbook` (3 Nov 2026) — craft rules applied to the UI: one neutral ramp + one accent, 4px grid, ≤2 font weights, no gradient text/glows/blobs/emoji icons, one bright moment per screen.
- `https://github.com/storytold/craft-anything` — "checked, not guessed": evidence records, clean-room default, verify before claiming. Applied to test reporting.
- `https://github.com/mattpocock/skills` — TDD and two-axis code-review workflow patterns.
- `https://tabworthy.pages.dev` — a curated directory of quirky sites, **not** a design or infrastructure source; no principles were taken from it.
- SkillHub (`https://lightmake.site/api/v1/search`) — searched for React/security/Cloudflare/SaaS/code-review skills. Top relevance scores were ≤0.10 and results were generic; **no skill was installed** because none materially improved this build.

## 6. Cost-control rules actually followed

1. No payment method was added, no paid plan enabled, no usage-based billing activated.
2. No external API key is required for the core journey; the one present in the environment is unused.
3. Hard application quotas: 5,000 leads/workspace, 25 members, 500 CSV rows per import, 2 MB CSV files, 5 public submissions/minute/IP.
4. `GET /health` reports `durable:false` when the sandbox has no writable storage, so a storage limitation is visible rather than hidden.
5. Quota-exhaustion behaviour: 429 with `Retry-After`; the core product continues to work with optional providers unconfigured.

## 7. Risks

- Free-tier limits can change or be retired; re-check before relying on them.
- A shared demo deployment has publicly documented demo credentials — see [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).
- File-backed SQLite has no managed backup, replication or failover. Export regularly via `GET /workspace/export`.

## 8. Related

[DEPLOYMENT.md](DEPLOYMENT.md) · [ASSUMPTIONS.md](ASSUMPTIONS.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)
