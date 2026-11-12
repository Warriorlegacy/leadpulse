# Cloudflare Free Stack — Feasibility Audit & Migration Kit

**Checked 2026-11-13.** This document evaluates the requested stack for LeadPulse and records what was prepared. **No Cloudflare deployment was performed**: no `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `wrangler` login, or `~/.wrangler` config exists in this environment. The live app remains on WorkBuddy hosting ([DEPLOYMENT.md](DEPLOYMENT.md)).

## 1. Requested stack vs. reality

| Layer | Requested | Verified free allowance | Status for LeadPulse |
| --- | --- | --- | --- |
| Repository | GitHub | Free public **and private** repos; Actions minutes free with limits | **GitHub CLI is authenticated** (`Warriorlegacy`). A remote can be created; see §6 |
| Front-end | Cloudflare Pages | 500 builds/mo, 1 concurrent build, 20-min timeout, 100 custom domains/project, 20,000 files, 25 MiB/file. `/pages/platform/limits/` | Blocked on account access. Note: a Worker with Static Assets can serve the same SPA from one deployment |
| Back-end | Cloudflare Workers | 100,000 requests/day (reset 00:00 UTC), **10 ms CPU/request**, 100 Workers. `/workers/platform/limits/` | **Requires a full async rewrite** — see §2 |
| Static assets | Workers Static Assets | Requests to static assets are free and unlimited; 20,000 files/version, 25 MiB/file. `/workers/static-assets/` | Viable replacement for `node:fs` serving |
| Database | Cloudflare D1 | 10 DBs, 500 MB/DB, 5 GB total, **5M rows read/day, 100k rows written/day**, 50 queries/invocation, 7-day Time Travel. `/d1/platform/limits/` (Oct 30 2026) | Async-only API (`await env.DB.prepare(...).bind(...).all()`) |
| Storage | Cloudflare R2 | 10 GB-month, 1M Class A, 10M Class B ops/month, free egress (Standard only). `/r2/pricing/` (Oct 30 2026) | No file-upload feature exists in MVP, so R2 has no current workload |
| Domain & security | Cloudflare DNS | Authoritative DNS is **free on all plans**. Requires adding a zone and pointing nameservers; **no registrar transfer required**. You must already own a registered domain. `/dns/` (Aug 14 2026) | Blocked: no custom domain was supplied |
| AI models | Groq / Gemini / Workers AI | Workers AI: **10,000 Neurons/day free**, then $0.011/1,000 neurons; text-gen 300 req/min. `/workers-ai/platform/pricing/` (Nov 12 2026) | Disabled by design — see §4 |

**UNVERIFIED:** Pages "unlimited bandwidth" appears on Cloudflare marketing, not on the limits doc. Do not repeat it as a verified quota.

## 2. The hard technical blocker: `node:sqlite` is a stub

Official docs `developers.cloudflare.com/workers/runtime-apis/nodejs/` (updated 12 Aug 2026) list `node:sqlite` under **"Non-functional stub modules"**: it is importable but method calls throw `[unenv] ... is not implemented yet!`. The `enable_nodejs_sqlite_module` stub arrived with compatibility_date **2026-01-29**; there is no D1-backed `DatabaseSync`, and no `/workers/runtime-apis/nodejs/sqlite/` docs page exists.

LeadPulse's backend is entirely **synchronous**: `server/context.js` exposes `all/one/run/exec/tx`, every route calls them without `await`, and `server/db.js` uses `DatabaseSync`. D1 is promise-based. Therefore a real port requires:

1. Convert `server/context.js` and **every one of the ~250 query call sites** across `server/routes/*.js` and `server/leads-service.js` to `async`/`await`. This is the bulk of the work, not a driver swap.
2. Replace `server/index.js` (`@hono/node-server`, `node:fs`, `PORT`) with a Workers `export default { fetch }` handler plus `env.ASSETS.fetch(request)` for SPA fallback.
3. Replace `node:sqlite` with a D1 adapter; `schema.sql` itself is standard SQLite and is directly reusable as a D1 migration (provided as `cloudflare/migrations/0001_initial.sql`).
4. **Resolve password hashing vs 10 ms CPU.** `node:crypto` is documented as "fully supported" and `scryptSync` is not excluded, so it is technically callable — but scrypt is deliberately CPU/memory-hard, so normal parameters (our N=16384) will exceed the Workers Free CPU budget. No official Cloudflare guidance specifically recommends a replacement was found. Realistic options: PBKDF2 via Web Crypto with tuned iterations, an external auth provider (Better Auth), or Workers Paid. **This is an inference, not a verified Cloudflare statement.**
5. Replace in-process rate limiting (resets per isolate) with a Durable Object or D1-backed counter; replace `node:fs` webhook key storage with a Worker secret.

Attempting this rewrite without a Cloudflare account to run `wrangler dev` against local D1 would produce unverified code. Per the build contract ("do not claim production readiness until tests pass and deployment is verified"), **it was deliberately not shipped as a half-working port.**

## 3. What was prepared in this repository

| File | Purpose |
| --- | --- |
| `cloudflare/wrangler.toml.example` | Verified config shape: `main`, `compatibility_date`, `nodejs_compat`, `[assets]` with `not_found_handling = "single-page-application"` and `run_worker_first = ["/api/*"]`, `[[d1_databases]]`, `[[r2_buckets]]`, `[vars]`. **Template only** — `main` points at a Workers entry that does not exist yet |
| `cloudflare/migrations/0001_initial.sql` | D1-ready copy of `server/schema.sql` (22 tables, indexes, CHECK constraints) |
| `cloudflare/.dev.vars.example` | Local secret names, placeholders only |
| `.github/workflows/deploy-cloudflare.yml` | **Disabled-by-default** (`workflow_dispatch` only) deployment job using `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repository secrets. It will fail by design until the Workers entry exists |

None of these is active. `npm start`, the tests, and the live deployment are unchanged.

## 4. AI models — correction of the supplied list

Checked against the authoritative `@cf/` model table on `/workers-ai/platform/pricing/` (12 Nov 2026).

**Verified present in Workers AI:** Qwen 3.8 27B, Qwen 3 30B, Qwen 2.5 Coder 32B, QwQ 32B, GPT-OSS 120B / 20B, Llama 4 Scout, Llama 3.3 70B, Mistral Small 3.1 24B, NVIDIA Nemotron 3 120B, GLM 4.7 Flash, DeepSeek R1 Distill Qwen 32B, Gemma 4 26B A4B.

**Not in the catalog:**
- **Gemini Flash / Flash-Lite / Preview** — no `@cf/google/gemini*` model exists. Gemini is an *external* Google provider, not a native Workers AI model; reaching it needs an external API key and integration.
- **Groq** — likewise an external provider, not a Cloudflare product.
- **Gemma 4 31B** — not found (only `gemma-4-26b-a4b-it`, `gemma-3-12b-it`, `gemma-sea-lion-v4-27b-it`).

**Metering:** "free" means **10,000 Neurons/day**, not unlimited models or tokens. Cost varies per model (e.g. `gpt-oss-20b` ≈ 18,182 neurons per million input tokens). Some models (`kimi-k2.6/2.7`, `glm-5.x`, `deepseek-v4*`) require Workers Paid or AI Gateway credits; GLM 4.7 Flash does not.

**LeadPulse position:** `GEMINI_API_KEY` and `GROQ_API_KEY` exist in this machine's environment but are **deliberately unused**. No AI feature is implemented, no customer data is sent to any model endpoint, and no AI output is fabricated. Enabling an AI adapter requires explicit opt-in and a documented provider data policy before any confidential lead data is processed. `GET /api/v1/integrations` reports AI as `configured: false`.

## 5. Exact activation sequence (needs your account)

```bash
# 1. Authenticate (interactive — requires your Cloudflare account)
npx wrangler login
npx wrangler whoami

# 2. Create the D1 database and R2 bucket, then paste the ids into wrangler.toml
npx wrangler d1 create leadpulse
npx wrangler r2 bucket create leadpulse-documents

# 3. Apply the schema locally first, then remotely
npx wrangler d1 migrations apply leadpulse --local
npx wrangler d1 migrations apply leadpulse --remote

# 4. Set secrets (never in git)
npx wrangler secret put WEBHOOK_ENCRYPTION_KEY
npx wrangler secret put GEMINI_API_KEY   # only if an AI adapter is approved

# 5. Complete the async port described in §2, then verify locally
cp cloudflare/wrangler.toml.example wrangler.toml
npx wrangler dev                        # local D1 + Assets, no account needed

# 6. Only after the full test suite passes against local D1:
npx wrangler deploy
# Then repeat the smoke test in docs/TEST_RESULTS.md against the workers.dev URL.
```

For a custom domain: add the zone in Cloudflare DNS (free), point nameservers at Cloudflare (no registrar transfer), then attach the Workers custom domain. A domain registration itself still costs money at a registrar.

## 6. GitHub

`gh auth status` reports an authenticated `Warriorlegacy` account. Creating a remote and pushing is possible but is an **external action** — see the handoff note in `SESSION_CONTEXT.md` for what was actually done. No GitHub repository URL was supplied in the original brief.

## 7. Honest bottom line

The stack is viable on paper and the quotas are generous for a pilot, but "free" does not mean "no rewrite": D1's async API, the `node:sqlite` stub, the 10 ms CPU limit and in-process rate limiting make this a genuine backend re-architecture. The fastest truthful path is: keep the verified Node deployment live, complete the async D1 port and validate it with `wrangler dev --local`, then deploy once credentials and a domain exist.

## 8. Related

[DEPLOYMENT.md](DEPLOYMENT.md) · [FREE_STACK_AUDIT.md](FREE_STACK_AUDIT.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · `SESSION_CONTEXT.md`
