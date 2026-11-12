# LeadPulse — Product Requirements Document (PRD)

Status: working draft. This document states product intent and hypotheses, not verified outcomes. **Buyer validation has not been performed**; see [ASSUMPTIONS.md](ASSUMPTIONS.md) and [MARKET_RESEARCH.md](MARKET_RESEARCH.md).

## 1. Target buyer (assumption, unvalidated)

- Small marketing agencies and local service businesses of roughly **2–25 people**.
- One shared pipeline, a handful of lead sources (forms, ads, calls, walk-ins, imports), no dedicated RevOps function.
- Buyer is likely the owner or an operations lead who is also a day-to-day user.
- This profile is a documented assumption. No buyer interviews, surveys, or paid market data were obtained. No competitor fact here is verified.

## 2. Problem

1. **Speed-to-lead**: enquiries arrive and sit unanswered; nobody can say how long a lead waited.
2. **Unclear ownership**: a lead has no named owner, so "someone will handle it" means nobody does.
3. **Missed follow-ups**: next actions live in heads, chats, or spreadsheets; tasks expire without visibility.

Consequence: paid-for leads go cold and the team cannot tell which source or which rep is responsible.

## 3. Core promise

> Every lead has an owner, a next action and a measurable response time.

Everything in the MVP serves one of the three nouns: **owner**, **next action**, **response time**.

## 4. MVP scope

- Multi-tenant workspaces with membership roles, invitations and server-enforced permissions ([PERMISSION_MATRIX.md](PERMISSION_MATRIX.md)).
- Lead capture: manual entry, public capture forms, CSV import, signed inbound webhooks.
- Lead record with a single owner, pipeline stage, tags, activity timeline and tasks (the "next action").
- Duplicate **proposal** (never a silent auto-merge) and an explicit, audited merge.
- Stage transitions with an immutable event history.
- Reports for response time, ownership, overdue follow-ups and conversion ([METRIC_DEFINITIONS.md](METRIC_DEFINITIONS.md)).
- Audit log, in-app notifications and per-user notification preferences.
- Soft-delete archive/restore for leads.

## 5. Explicit non-goals (MVP)

- No outbound email/SMS sending, dialer, or marketing automation sequences (no providers configured).
- No AI scoring, enrichment, chatbots, or generative content.
- No billing, subscriptions, invoicing, or payment collection.
- No native mobile app; responsive web only.
- No multi-region deployment, SSO/SAML, or SCIM provisioning.
- No custom report builder; a fixed report set only.
- No legal/compliance certification (GDPR, DPDP, HIPAA).
- No third-party CRM migration tooling beyond CSV import.

## 6. Success metrics

Definitions and denominators are normative in [METRIC_DEFINITIONS.md](METRIC_DEFINITIONS.md); this PRD only names which ones matter and why.

| Metric | Why it is a success signal | Direction |
| --- | --- | --- |
| Time-to-first-human-response (median, p90) | Direct measure of speed-to-lead | Lower |
| % leads with owner | Direct measure of ownership | Higher |
| Overdue follow-up count | Direct measure of missed follow-ups | Lower |
| Lead-to-qualified conversion | Whether faster response changes outcomes | Higher |
| Qualified-to-won conversion | Downstream effect | Higher |
| Source-level conversion | Whether spend can be attributed | Informative |
| Weekly active teammates | Whether the system is actually used | Informative |

No target values are asserted. Targets are hypotheses (default SLA 60 minutes, see [ASSUMPTIONS.md](ASSUMPTIONS.md)) and must be set after buyer validation. No baseline or current values exist yet; no chart may display invented numbers ([UI_DESIGN_SYSTEM.md](UI_DESIGN_SYSTEM.md)).

## 7. Open questions

- Do buyers actually measure response time today, or only complain about it anecdotally?
- Is a single owner per lead acceptable, or is co-ownership expected?
- Which lead sources must be attributed in the first release?
- Is the 60-minute default SLA meaningful for this segment?
- Will buyers pay for response-time reporting on its own, or only as part of a broader CRM?

## 8. Related

[ARCHITECTURE.md](ARCHITECTURE.md) · [API.md](API.md) · [DATA_DICTIONARY.md](DATA_DICTIONARY.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [ROADMAP.md](ROADMAP.md) · [TEST_PLAN.md](TEST_PLAN.md)
