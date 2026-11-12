# LeadPulse — UI Design System

Status: design specification for the React SPA ([ARCHITECTURE.md](ARCHITECTURE.md)). Implemented as custom CSS custom properties; no component library. Values below are design decisions, not measured results.

## 1. Design tokens

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#F7F3EC` | Warm paper page background |
| `--paper-raised` | `#FFFDF8` | Cards, sheets, inputs |
| `--ink` | `#16212B` | Deep ink sidebar and display text |
| `--ink-soft` | `#33424F` | Secondary text on paper |
| `--pulse` | `#E0A020` | Amber "pulse" accent: primary actions, active nav, focus ring |
| `--pulse-soft` | `#F6E6C4` | Accent tint for chips and highlights |
| `--overdue` | `#B23B32` | Semantic red: overdue tasks, breached SLA |
| `--healthy` | `#1E7F72` | Teal: healthy response time, completed, on-track |
| `--line` | `#D9D2C6` | Borders and dividers |
| `--muted` | `#6B7784` | Captions, disabled states |

Semantic colours always pair with text or an icon; colour alone never conveys status.

## 2. Typography

- Display headings: serif stack `ui-serif, "Iowan Old Style", Georgia, serif`.
- Body and UI: system sans `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- Numbers in metrics use tabular figures (`font-variant-numeric: tabular-nums`).

| Step | Size | Line height | Use |
| --- | --- | --- | --- |
| `display` | 2.25rem | 1.15 | Page title, report headline |
| `h1` | 1.75rem | 1.2 | Section title |
| `h2` | 1.375rem | 1.3 | Card group heading |
| `h3` | 1.125rem | 1.4 | Lead name, drawer title |
| `body` | 0.9375rem | 1.55 | Default text and table cells |
| `small` | 0.8125rem | 1.45 | Meta, timestamps, helper text |
| `caption` | 0.75rem | 1.4 | Labels, axis ticks, chips |

## 3. Spacing, borders, shadows, motion

- Spacing scale (4px base): `4, 8, 12, 16, 24, 32, 48, 64`. Layout padding uses `24` on desktop and `16` on mobile.
- Borders: `1px solid var(--line)`; radii `6px` (chips/inputs), `10px` (cards), `14px` (dialogs).
- Shadows: `e1` subtle card lift, `e2` dropdown/drawer, `e3` modal. Shadows are decorative only, never used to convey state.
- Motion: `120ms` for hover/press feedback, `200ms` for drawers and toasts, easing `ease-out`. `prefers-reduced-motion: reduce` disables all non-essential transitions. No animated or decorative motion on data visualizations.

## 4. Component inventory

`AppShell` (ink sidebar + topbar), `NavItem`, `KanbanBoard` / `KanbanColumn` / `LeadCard`, `LeadTable`, `LeadDrawer`, `ActivityTimeline`, `TaskList` / `TaskRow`, `MetricCard`, `ReportChart`, `SourceBreakdown`, `CaptureFormBuilder`, `InviteDialog`, `RoleBadge`, `StatusPill`, `FilterBar`, `Pagination`, `Modal` / `Dialog`, `Toast`, `EmptyState`, `Skeleton`, `ConfirmDialog`.

## 5. Accessibility rules

- Every input has an associated `<label>`; errors are linked with `aria-describedby` and announced.
- Visible `:focus-visible` ring: `2px solid var(--pulse)` with a 2px offset; never remove outlines without a replacement.
- Keyboard kanban: arrow keys move selection, `Enter`/`Space` picks up and drops a card, `Escape` cancels, and changes are announced via an `aria-live` region. A non-kanban list view is available as an equivalent alternative.
- Contrast: at least 4.5:1 for body text and 3:1 for large text and UI components against their backgrounds. Status is never colour-only (icon plus text).
- Dialogs trap focus, restore focus on close, and close on `Escape`. A skip link precedes the main content. Tables use proper header cells and scope.
- `prefers-reduced-motion` is honoured; no content flashes more than three times per second.

## 6. Responsive breakpoints

| Range | Layout |
| --- | --- |
| `< 640px` | Single column; sidebar becomes a drawer; kanban scrolls horizontally; stacked metric cards |
| `640–1024px` | Collapsed icon sidebar; two-column where space allows |
| `1024–1440px` | Full sidebar; standard kanban and table |
| `> 1440px` | Content capped at `1280px`, centred |

Test widths: `375px`, `768px`, `1280px` ([TEST_PLAN.md](TEST_PLAN.md)).

## 7. No invented data

**No chart, metric card, or report may display invented, seeded, or placeholder numbers in a non-demo deployment.** Charts render only aggregates returned by the reports endpoints ([API.md](API.md)) computed from real data per [METRIC_DEFINITIONS.md](METRIC_DEFINITIONS.md). When there is no data, show an `EmptyState` with explanatory copy; when a denominator is empty, the API returns `null` and the UI shows "not enough data", never `0`. Synthetic demo data is allowed only in the demo deployment and must be clearly labelled ([ASSUMPTIONS.md](ASSUMPTIONS.md)).

## 8. Related

[ARCHITECTURE.md](ARCHITECTURE.md) · [API.md](API.md) · [METRIC_DEFINITIONS.md](METRIC_DEFINITIONS.md) · [TEST_PLAN.md](TEST_PLAN.md) · [ASSUMPTIONS.md](ASSUMPTIONS.md) · [PRD.md](PRD.md)
