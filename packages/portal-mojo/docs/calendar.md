# Calendar engine + date fns

The picker core ported from web-mojo's dependency-free calendar
(`calendar/Calendar.js` + `utils/dateFns.js`): ONE engine covering
day/month/year precisions, single + range selection, drill-down zoom, and
1–2 day panes. Popover, trigger inputs, and preset rails are separate
components built ON this — the engine renders inline and owns no
positioning.

```ts
import { Calendar } from 'portal-mojo/ui';
import { dateFns } from 'portal-mojo/ui';   // namespace, like fmt
```

## Value shapes (the contract)

- Canonical strings at each precision: `YYYY-MM-DD` / `YYYY-MM` / `YYYY`.
  Everything the engine emits and accepts (`value`, `startValue`, `min`,
  `disabledDates`, callback payloads) speaks these.
- Parsed shapes are plain int objects — `{y}`, `{y,m}`, `{y,m,d}`
  (`ParsedYear/ParsedYm/ParsedYmd`, union `ParsedDate`). `Date` objects
  never leak out of the fns; all math is browser-local (DST-safe), never
  UTC.

## `<Calendar>` API

| Prop | Notes |
|---|---|
| `precision` | `'day' \| 'month' \| 'year'` (default `day`) — the grid that COMMITS. Unknown values warn + fall back to `day`. |
| `mode` | `'single' \| 'range'` (default `single`) |
| `months` | `1 \| 2` day-view panes (default 1; clamped) |
| `value` | single mode — controlled canonical string (or null) |
| `startValue` / `endValue` | range mode — controlled canonical strings |
| `min` / `max` | bounds, compared at the PANE precision being painted: with `min="2026-03-15"` the March-2026 month tile and 2026 year tile stay enabled; only cells wholly out of bounds disable |
| `disabledDates` | `YYYY-MM-DD[]`, day grids only |
| `firstDay` | 0=Sun … (default 1=Mon); reorders weekday header + grid offsets |
| `locale` | BCP-47 for month/weekday names (default `en-US`) |
| `year` / `month` | initial page override (otherwise the selection, else today) |
| `onSelect` | `{value, parsed}` — single-mode commit at precision |
| `onRangeSelect` | `{start, end}` — ordered (ends swap if picked backwards) |
| `onRangeStart` | `{anchor}` — first range click; nothing committed yet |
| `onRangeCancel` | Escape pressed with an anchor in progress |
| `onViewChange` | `{view}` — zoom changed (drill-down or header click) |
| `onNavigate` | `{delta}` — page changed (buttons or PageUp/PageDown) |

**Selection is controlled.** A commit fires the callback; the cell paints
selected only after the owner writes the prop back. Prop writes carry the
source's programmatic semantics: a new `value` re-pages the calendar to it;
a new `startValue`/`endValue` pair cancels any in-progress anchor
(`setRange`). View, page, anchor and hover are internal state — paging and
zooming never round-trip through the owner.

## Behavior invariants (from source, keep them true)

- **Drill-down zoom:** header label zooms out day→month→year (a `<button>`;
  inert at the year grid). A tile ABOVE precision drills down
  (year→month→day); a tile AT precision commits. Reaching day view is only
  possible when `precision='day'`, so range/selected tint on month/year
  grids paints only at matching precision.
- **Range machine:** first commit places the anchor (`onRangeStart`),
  second commits the ordered pair (`onRangeSelect`). The anchor SURVIVES
  paging/zooming — commit a start, page forward, commit the end elsewhere.
  Hover paints a live preview from anchor to cursor; preview cells use
  `-in-preview` classes, DISTINCT from committed `-in-range`, with
  `-anchor-start/-anchor-end/-anchor-solo` end caps (day grids add
  directional chevrons; solo hides them).
- While an anchor is active the committed range is suppressed from painting
  (source parity). **Deviation from source:** after Escape the committed
  props paint again — web-mojo left the calendar blank until the next
  commit (nothing consumed `range:cancel`). Corollary: do NOT write range
  props from `onRangeStart` — a range prop write means `setRange` and kills
  the anchor.
- **Keyboard:** every cell is a real `<button>` (focusable, Enter/Space
  commit). With focus anywhere inside: PageUp/PageDown page, Escape cancels
  an in-progress anchor. There is no roving arrow-key focus — that was not
  in the source engine either.
- **Today** wears `-today` (red, day grids only). `disabledDates` are
  unclickable and skipped by hover preview painting (the span still covers
  them — `excludeDisabledFromRange` was accepted-but-unused in source and
  is not carried).
- Blank leading cells are inert `<div>`s, not buttons.

## dateFns (`dateFns.*`)

Pure, framework-free, `Date`-free shapes. The tuned edge cases are the
point — do not "simplify":

| Group | Functions |
|---|---|
| parse/format | `parseYmd/parseYm/parseYear` (+`parseByPrecision`), `formatYmd/formatYm/formatYear` (+`formatByPrecision`), `formatForDisplay(parsed, 'MMM D, YYYY')` |
| calendar math | `daysInMonth(y,m)` (1-indexed), `weekdayWithFirstDay(y,m,d,firstDay)`, `addMonths/addYears` (shape-preserving, day CLAMPS: Jan 31 +1mo → Feb 28/29) |
| compare | `compareYmd/Ym/Year/ByPrecision` (−1/0/1; cross-precision compares shared parts — how min/max pane-gating works), `isSameDay/Month/Year` |
| counts | `daysBetweenInclusive` (1 for same day), `monthsBetweenInclusive`, `yearsBetweenInclusive`, `unitsBetweenInclusive` |
| time | `parseTime` ("14:30", "2:30 pm", seconds/TZ tails dropped; strict 12h: hour 1–12 with am/pm, else null), `formatTime(t, '24h'\|'12h')`, `compareTime`, `addMinutes` (wraps 24h) |
| datetime | `parseDateTime` (ISO±offset / "date time IANA" / date-only→00:00), `formatDateTime` ("YYYY-MM-DD HH:MM[ TZ]"), `formatDateTimeForDisplay`, `ianaOffset(zone, refDate)` (DST-aware "+05:30", null on bad zone) |
| names/now | `monthNames(locale, 'short'\|'long')`, `weekdayNames(locale, firstDay, len)` (Intl-backed, cached, static-English fast path), `today()`, `_setFrozenToday(p)` test hook |

Parse fns return `null` on invalid input, never throw; format fns return
`''` for null. `parseYmd` range-checks day 1–31 but not month length
(source behavior; the engine never emits an out-of-month day).

## Styling

`apps/portal/src/theme/calendar.css` — engine anatomy only
(`mojo-calendar-*`: pane/head/nav/grid/weekday/cell + state classes), all
colors via theme tokens; component tokens `--mojo-cal-anchor-fill`,
`--mojo-cal-range-fill`, `--mojo-cal-range-fill-hover` (accent tints:
10%/18% light, 18%/30% dark). The calendar fills its container's width —
give it a sized wrapper (~300px per pane; the popover shells do this for
you later).

## Pitfalls

- Don't parse engine output with `new Date('YYYY-MM-DD')` — that's UTC
  midnight and shifts a day in western zones. Use `dateFns.parseYmd`.
- `min`/`max` are compared at pane precision — a `min` mid-month still
  allows that month's tile; check day-level rules at day level.
- Escape/PageUp/PageDown require focus inside the calendar (click one cell
  first); the demo copy says so too.
- The wire's daterange triple (`dr_field/dr_start/dr_end`) and epoch-second
  datetimes are PICKER-shell concerns — the engine only speaks canonical
  local strings.
