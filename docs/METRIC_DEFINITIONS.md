# LeadPulse — Metric Definitions

Implemented by `GET /api/v1/reports/summary` in `server/routes/data.js`. Every value is derived from persisted rows. Empty denominators produce `null`, never a fabricated zero. The API returns a `note` stating this. The default window is the last 30 days; `from`/`to` are ISO-8601 UTC.

## 1. Time to first human response (TTFHR)

- For one lead: `elapsedMinutes(leads.created_at, leads.first_response_at, org, org.sla_business_hours_only)`, in **minutes**.
- `first_response_at` is set **exactly once**, by the first logged activity of type `call`, `email` or `meeting` (`server/leads-service.js` → `logActivity`). `note` and `system` activities never start the clock. Later edits, imports and merges never rewrite it. Logging an activity does **not** send anything.
- Default clock: wall-clock elapsed minutes. With `sla_business_hours_only = 1`, `server/util.js` → `elapsedMinutes` sums only minutes inside `working_hours_start`–`working_hours_end` on days listed in `working_days` (1=Mon … 7=Sun), converted using the workspace IANA timezone. Nights and non-working days are excluded. There is no per-lead pause state.

## 2. Response-time median

- Cohort: leads with `first_response_at IS NOT NULL` **and** `created_at` inside `[from,to]`.
- Value: median of their TTFHR values (average of the two middle values for even-sized samples). `responseSampleSize` is always returned alongside the median so a small sample is visible.
- `withinSlaPercent = 100 × count(TTFHR ≤ org.sla_target_minutes) / cohort size`. `slaTargetMinutes` is returned with the result. Leads with no response yet are **not** in this denominator.

## 3. Percentage of leads with an owner

- Numerator: `leads WHERE organization_id = ? AND archived_at IS NULL AND owner_id IS NOT NULL`.
- Denominator: all open (non-archived) leads in the workspace, **not** restricted to the date window. A point-in-time snapshot, not a cohort metric.
- Rounded to one decimal; `null` when the denominator is zero.

## 4. Overdue follow-up count

- `tasks WHERE organization_id = ? AND completed_at IS NULL AND due_at < now()`, across all leads regardless of date window. Also used by `GET /tasks?bucket=overdue`.
- "Due today" is local midnight → next local midnight in the workspace timezone (`dateInTz` / `zonedToUtc`).

## 5. Conversion metrics

- `leadToQualifiedPercent = 100 × distinct leads with a stage_event into a stage named 'Qualified' / leads created in window`.
- `qualifiedToWonPercent = 100 × distinct leads with a stage_event into a stage of kind 'won' / distinct leads that reached 'Qualified'`.
- **Known asymmetry**: the numerators count distinct leads across all time, while the first denominator is the date-window cohort. These are directional funnel indicators, not strict same-cohort conversion. A strict cohort funnel is a documented future milestone. Both are `null` when the denominator is zero.

## 6. Open pipeline value

- `SUM(leads.amount_cents) / 100` for non-archived leads whose current stage has `kind = 'open'` and whose `amount_cents IS NOT NULL`.
- `null` when no amounts are recorded (the UI shows "—", not `0`). Currency comes from `organizations.currency`.

## 7. Source-level conversion

- `sourceBreakdown` groups non-archived leads created in the window by `COALESCE(lead_sources.name,'Unknown')`, returning `leads`, `won` (current stage kind `won`) and `conversionPercent = won / leads`.
- Attribution is only the stored `source_id` plus free-text `campaign`; no multi-touch model. Sources with zero leads are omitted.

## 8. Stage and daily distributions

- `stageBreakdown` counts non-archived leads per configured stage using a LEFT JOIN, so empty stages show zero.
- `leadsByDay` groups `substr(created_at,1,10)` for leads created in the window — **UTC calendar days**.
- UI charts render only these arrays. No chart contains sample or estimated data.

## 9. Weekly active teammates

- `COUNT(DISTINCT activities.actor_id)` where `actor_id IS NOT NULL` and `created_at >= now() - 7 days`, scoped to the workspace. System-event actors with an id are included, so this measures "teammates whose actions were recorded", not human logins.
- `teamActivity` counts non-`system` activities per actor in the selected window, top 20.

## 10. Deliberate non-metrics

No lead scoring, predicted revenue, sentiment, AI summaries, fabricated testimonials or customer counts. Public pricing is labelled a hypothesis, not a metric.

## 11. Related

[API.md](API.md) · [DATA_DICTIONARY.md](DATA_DICTIONARY.md) · [TEST_PLAN.md](TEST_PLAN.md) · [ASSUMPTIONS.md](ASSUMPTIONS.md)
