# LeadPulse — Assumptions

Status: this file records **assumptions, not verified facts**. None of the items below has been confirmed, deployed, purchased, or measured. Each is paired with how to invalidate it. The lead agent updates this file as facts become known.

| ID | Assumption | Why it matters | How to confirm / invalidate |
| --- | --- | --- | --- |
| A1 | No GitHub repo URL was supplied. The project exists locally as `D:\SaaS\leadpulse` and is untracked; there is no remote, CI, or PR workflow. | No remote collaboration, automated checks, or release tags exist. | Supply a repo URL, initialise git, and configure CI. |
| A2 | No Cloudflare credentials or `wrangler` configuration exist. | Drives the deviation from Workers/D1 in [ARCHITECTURE.md](ARCHITECTURE.md) to a portable single-port Node service. | Provide credentials and a `wrangler` config; re-evaluate the D1 driver. |
| A3 | No custom domain is configured. | Demo runs on localhost or a platform-assigned host; TLS is terminated externally. | Provide a domain and TLS configuration. |
| A4 | No email, AI, or payment providers are configured. | Invitations and notifications are in-app only; no automated outreach, no billing, no password-reset email. | Provide provider credentials and revisit [PRD.md](PRD.md) non-goals. |
| A5 | No buyer interviews were performed. | The target buyer in [PRD.md](PRD.md) and the differentiation in [MARKET_RESEARCH.md](MARKET_RESEARCH.md) are hypotheses. | Conduct and record buyer interviews. |
| A6 | Demo data is synthetic only; no real customer PII is present. | Charts must not display invented data in any non-demo deployment ([UI_DESIGN_SYSTEM.md](UI_DESIGN_SYSTEM.md)). | Audit seed data sources before any production use. |
| A7 | INR pricing is an unvalidated hypothesis; no price point is asserted. | No pricing page or quote should be generated from this assumption. | Validate willingness-to-pay with buyers; see [COMPETITOR_ANALYSIS.md](COMPETITOR_ANALYSIS.md). |
| A8 | Timezone default is `Asia/Kolkata` with all timestamps stored in UTC. | Affects display, business-hours calendars, and the SLA clock in [METRIC_DEFINITIONS.md](METRIC_DEFINITIONS.md). | Confirm target geography with buyers; change org default. |
| A9 | Default SLA target is 60 minutes. | Used for overdue/breach reporting; unvalidated as appropriate for this segment. | Set a per-org target after buyer validation. |
| A10 | All free-tier quotas must be re-verified. | No quota (hosting, storage, email, rate limits) has been verified in this documentation. | Re-check each provider's current limits before any deployment claim is made. |

## Consequences that follow from the above

- Because of A1 and A2, the architecture intentionally keeps SQL behind a data-access adapter so D1 or Postgres can be swapped in later without rewriting handlers ([ARCHITECTURE.md](ARCHITECTURE.md)).
- Because of A4, invitation tokens are surfaced in-app; there is no email delivery or deliverability guarantee ([SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)).
- Because of A5 and A6, no market size, pricing, customer count, or observed metric appears anywhere in [MARKET_RESEARCH.md](MARKET_RESEARCH.md), [COMPETITOR_ANALYSIS.md](COMPETITOR_ANALYSIS.md), or the docs.
- Because of A10, [ROADMAP.md](ROADMAP.md) treats quota re-verification as a planned task, not a completed one.

## Design decisions (not assumptions)

These are deliberate choices recorded elsewhere, not unvalidated hypotheses. Confusing the two would mislabel a decision as unverified.

| Decision | Documented in |
| --- | --- |
| One owner per lead; ownership is a core invariant | [PRD.md](PRD.md), [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md) |
| Soft deletion via `archived_at` | [DATA_DICTIONARY.md](DATA_DICTIONARY.md) |
| UTC storage with display conversion | [DATA_DICTIONARY.md](DATA_DICTIONARY.md), [METRIC_DEFINITIONS.md](METRIC_DEFINITIONS.md) |
| ESM JavaScript server with JSDoc, no server build step | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Data-access adapter isolating SQL | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Fixed report set, no custom builder | [PRD.md](PRD.md) |
| Duplicate proposal without auto-merge | [API.md](API.md), [PRD.md](PRD.md) |
| First response recorded once and never rewritten | [METRIC_DEFINITIONS.md](METRIC_DEFINITIONS.md) |

## Assumption-to-consumer map

| Assumption | Consumed by |
| --- | --- |
| A1, A2, A3 | [ARCHITECTURE.md](ARCHITECTURE.md), [ROADMAP.md](ROADMAP.md) |
| A4 | [PRD.md](PRD.md), [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), [API.md](API.md) |
| A5, A7 | [MARKET_RESEARCH.md](MARKET_RESEARCH.md), [COMPETITOR_ANALYSIS.md](COMPETITOR_ANALYSIS.md), [PRD.md](PRD.md) |
| A6 | [UI_DESIGN_SYSTEM.md](UI_DESIGN_SYSTEM.md), [TEST_PLAN.md](TEST_PLAN.md) |
| A8, A9 | [METRIC_DEFINITIONS.md](METRIC_DEFINITIONS.md), [DATA_DICTIONARY.md](DATA_DICTIONARY.md) |
| A10 | [ROADMAP.md](ROADMAP.md) |

## Change control

An assumption is promoted to a fact only when its "How to confirm / invalidate" cell is satisfied and the change is recorded by the lead agent. Until then, no document may treat it as verified. Adding a new assumption requires an ID, an impact statement, and an invalidation path. Assumptions that prove false must be updated here first, then in every consumer listed above.

## Validation priority

A5 (buyer interviews) and A10 (quota re-verification) are the highest-priority items: A5 because the entire [PRD.md](PRD.md) rests on it, A10 because no deployment claim is safe without it. A7 (pricing) can wait until A5 produces a buyer conversation. A2 and A3 are cheap to resolve but would trigger an [ARCHITECTURE.md](ARCHITECTURE.md) revision rather than a product change.

## Related

[PRD.md](PRD.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [METRIC_DEFINITIONS.md](METRIC_DEFINITIONS.md) · [MARKET_RESEARCH.md](MARKET_RESEARCH.md) · [ROADMAP.md](ROADMAP.md)
