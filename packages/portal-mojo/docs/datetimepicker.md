# DateTimePicker

The combined date **and** time field, ported from web-mojo
`forms/inputs/DateTimePicker.js` (523 lines) — the source's locked **variant
A**: one popover with the day [`Calendar`](calendar.md) on the left, the
embedded [`TimePicker`](timepicker.md) steppers on the right under a "Time"
heading, a full-width [`TimezoneSelect`](timezone-select.md) row below the
pair, and a Now/Done footer. **One field, one value** — the timezone belongs
to this picker, it is never a second field.

```ts
import { DateTimePicker } from 'portal-mojo/ui';
import type {
    DateTimeValue, DateTimeInput, DateTimeChangeEvent,
    DateTimeObjectValue, DateTimeOutputFormat,
} from 'portal-mojo/ui';
```

## Value shapes (the contract)

Storage is **always canonical**: `YYYY-MM-DD` + 24h `HH:MM` + an optional IANA
zone. `displayFormat`/`timeFormat` only decide what the trigger renders;
`outputFormat` decides what leaves:

| `outputFormat` | with a zone | without a zone | empty |
|---|---|---|---|
| `'iso'` (default) | `'2026-07-04T14:30:00-07:00'` | `'2026-07-04T14:30:00'` | `''` |
| `'iana'` (legacy) | `'2026-07-04 14:30 America/Los_Angeles'` | `'2026-07-04 14:30'` | `''` |
| `'object'` | `{date:'2026-07-04', time:'14:30', timezone:'America/Los_Angeles'}` | `{date, time}` (no `timezone` key) | `null` |

`'object'` always yields an object when a date is set — unlike TimePicker, it
never degrades to a string. The `timezone` key exists (possibly `null`) exactly
when the zone row is enabled.

**The ISO offset is DST-correct at the value's own date.** It is computed with
`dateFns.ianaOffset(zone, <the selected instant>)`, so `America/Los_Angeles`
serializes `-07:00` on July 4 and `-08:00` on January 4. (`TimePicker` cannot
do this — a wall-clock time has no date, so it must resolve against
`new Date()`.)

**Everything above parses back in**, plus the looser shapes the source
accepted:

- date only — `'2026-05-04'` (time reads as `00:00`)
- 12h text — `'2026-05-04 2:30 PM'`, with or without an IANA tail
- ISO offsets in every spelling — `Z` → `+00:00`, `+0530` → `+05:30`
- `T` or a space between date and time
- loose numbers — `'2026-5-4 14:30'`

Two coverage **extensions over `dateFns.parseDateTime`**, both implemented in
`DateTimePicker.tsx` because the shared parser would otherwise drop data the
caller supplied:

1. an object with **no date keeps its `timezone`** (`parseDateTime` returns
   `null` for the whole thing);
2. an offset separated from the time by a **space** —
   `'2026-05-04 14:30 -07:00'` (`parseDateTime` reads an offset only when it is
   glued to the time, and a zone *name* only after a space).

Anything else parses to empty **with one `console.warn` per distinct value**
(house rule 4) — never a silent blank.

## API

| Prop | Notes |
|---|---|
| `value` | `string \| {date?, time?, timezone?} \| null` — see above. Omit entirely for an uncontrolled picker |
| `onChange` | `({value, formatted, oldValue})` — fires on **commit only**, and only when the serialized string actually changed |
| `displayFormat` | date half of the trigger text (`formatForDisplay` tokens). Default `'MMM DD, YYYY'` |
| `timeFormat` | `'24h'` (default) \| `'12h'`. Unknown values warn + fall back |
| `timeStep` | minute stepping increment for the time column, ≥1 (default 1) |
| `min` / `max` | a date (`'2026-05-04'`) **or** a datetime (`'2026-05-04 09:00'`) — see bounds below |
| `placeholder` | default `'Pick date & time...'` |
| `disabled` / `readOnly` / `required` / `invalid` | trigger states; `required`, `disabled` and `readOnly` each suppress the clear ✕ |
| `inline` | render the panel in place — no trigger, no popover, no Done |
| `disabledDates` | individually blocked days, `"YYYY-MM-DD"` |
| `firstDay` / `locale` | passed to the Calendar. Default `1` (Mon) / `'en-US'` |
| `timezone` | `true` enables the zone row; a `string[]` enables it **and is the zone list** |
| `timezones` | zone list when `timezone` is `true` (default: the engine's own list) |
| `outputFormat` | `'iso'` \| `'iana'` \| `'object'`. Unknown values warn + fall back |
| `renderTimezoneSelect` | the zone-picker slot — see below |
| `name` | renders a hidden input carrying the serialized string (native-form use) |
| `id` | trigger id, for a label's `htmlFor` |
| `className` | appended to the root |

`DateTimeChangeEvent.oldValue` is always the **previous canonical serialized
string** (`''` when empty), in every `outputFormat` — it is the diffing key,
not a mirror of `value`.

Types split in/out on purpose: `value` takes `DateTimeInput` (every part
optional), `onChange` hands back `DateTimeValue` (parts guaranteed). Writing
`event.value` straight back into `value` type-checks.

## Layout (the locked variant)

```
┌──────────────────────────────┬──────────────────┐
│  Calendar precision="day"    │  TIME            │
│  mode="single" months={1}    │  ▲   ▲   [AM]    │
│                              │  09 : 30  [PM]   │
│                              │  ▼   ▼           │
├──────────────────────────────┴──────────────────┤
│  TIMEZONE                                       │
│  [ America/Los_Angeles (UTC−07:00)          ▾ ] │
├─────────────────────────────────────────────────┤
│  Now                                     [Done] │
└─────────────────────────────────────────────────┘
```

The time column embeds `TimePicker inline showFooter={false} timezone={false}`
— the footerless variant that exists for exactly this. The zone row sits below
the pair, full width, so the IANA combobox has room for its labels. **Done only
closes the popover**; every edit committed the moment it was made.

## Behavior invariants (from source, keep them true)

- **Commit-only pipeline.** `onChange` fires on: a calendar pick, any
  TimePicker commit (stepper, typed + Enter/blur, AM/PM), a zone pick, **Now**,
  and the clear ✕. Typing in a time column changes nothing until it commits.
  Re-committing the same value is silent.
- **Defaults that make one field out of two.** Picking a date with no time yet
  → time `00:00`. Committing a time with no date → date **today**, and the
  calendar follows (it reads the same state). **Now** sets both.
- **min/max**: the DATE part bounds the calendar (out-of-range days are
  disabled). Where the bound also spelled a TIME, that time clamps **on the
  boundary day only** — `min="2026-05-04 09:00"` forbids 08:00 on May 4 and
  nothing at all on May 5. `Now` is clamped through the same rule, so it can
  never escape the window.
- **The clamp lives in two places on purpose.** The picker clamps every commit,
  *and* hands the embedded TimePicker a day-scoped `min`/`max` so it clamps
  itself. Without the second, the steppers would keep showing the pre-clamp
  value the parent just rejected.
- **A cleared field keeps its zone** — the zone is a picker setting, not data
  (source `clear()`).
- The trigger is `bi-calendar3` + `MMM DD, YYYY HH:MM [Zone]` + a clear ✕ that
  appears on hover/focus (suppressed by `required`/`disabled`/`readOnly`).

## The timezone seam

The picker owns every bit of the zone's value and serialization logic but
renders the picker itself through a slot. Its **default tenant is the real
`<TimezoneSelect>`**, so `timezone` alone gives you the full searchable,
offset-labelled zone list:

```tsx
<DateTimePicker timezone value={value} onChange={(e) => setValue(e.value)} />
```

Override only to change the rendering (a shorter list, a different control):

```tsx
<DateTimePicker
  timezone
  renderTimezoneSelect={({ value, onChange, timezones, disabled }) => (
    <TimezoneSelect value={value} timezones={timezones ?? null} disabled={disabled}
                    onChange={(e) => onChange(e.value)} />
  )}
/>
```

The slot contract is `TimezoneSelectSlotProps` — the same one `TimePicker`
uses, so a slot written for one drops into the other. Enabling `timezone`
seeds the browser's local zone **without emitting** (source parity); the owner
learns it on the first real commit.

## State ownership (read this before wiring a form)

The picker holds its **own committed state**, seeded from `value` and re-seeded
whenever `value` changes to something that is not an echo of its own last emit
— the same shape [`Calendar`](calendar.md) and [`TimePicker`](timepicker.md)
use. Write `event.value` straight back into `value` and the two stay in
lockstep; omit `value` entirely and it behaves as an uncontrolled picker.

Why not derive purely from props: `'iso'` output carries only the **offset**,
so re-parsing our own echo would silently degrade `'America/Los_Angeles'` →
`'-07:00'`. The zone therefore lives in component state, and the echo guard is
what protects it. Corollary: **writing back the same value is a no-op, and
writing a different one re-seeds the panel** — to refuse a value, write the
value you *do* want.

## The wire reality (epoch seconds)

django-mojo model datetimes are **epoch SECONDS** on the wire — this component
never speaks them. Its contract is the string/object shapes above; the
**field-type registry (#1278) owns the save-boundary conversion** in both
directions:

```
wire (int seconds) ──▶ registry: seconds → 'YYYY-MM-DDTHH:MM:00±HH:MM' ──▶ value
value ──▶ registry: parse + Date.getTime()/1000 ──▶ wire (int seconds)
```

Passing an epoch number (or its digits as a string) as `value` parses to empty
with the usual warn — that is the registry's bug to catch, not a shape this
picker guesses at. When the zone matters to the *server*, prefer `'iana'` or
`'object'` output: an offset is a fact about one instant, an IANA name is a
fact about a place. And remember `fmt.*` accepts epoch seconds directly — do
not `new Date(epochSeconds)` without `× 1000`.

## Deviations from source (deliberate)

1. **No-op commits are silent, and `oldValue` is real.** web-mojo called
   `_syncOutputs()` with no argument on nearly every path, which emitted
   `change` *every time* with `oldValue: null` — even when nothing changed.
   Here `onChange` fires only on a real change and always carries the previous
   serialized string.
2. **Time clamping on the boundary day** (the source only date-bounded the
   calendar, so a `09:00`–`17:30` window was unenforceable on the first and
   last day). A date-only bound still clamps nothing but the date.
3. **`Now` is clamped** like every other commit path.
4. **An already-offset zone passes through** `'iso'` serialization
   (`'…-07:00'` re-saves as `'…-07:00'`). `ianaOffset('-07:00')` returns
   `null`, so the source dropped it on re-save.
5. **The clear ✕ is a sibling of the trigger**, not nested inside it (the
   source produced a `<button>` inside a `<button>`).
6. **`inline` omits Done** — it exists to dismiss the popover and there is
   none. The source rendered a dead button.
7. `disabled`/`readOnly` are enforced at the commit boundary, so a locked
   `inline` panel is inert (the source only guarded the popover).
8. The dead `format` and `autoApply` options (stored, never read in source)
   are not carried, and there is no `hasError()` stub — pass `invalid`.

## Styling

`apps/portal/src/theme/datetimepicker.css` — layout glue only
(`mojo-datetime-*`: `trigger` / `trigger-text` / `trigger-clear` /
`popover-inner` / `row` / `cal-col` / `time-col` / `time-head` / `tz-row` /
`tz-label` / `tz-host` / `foot`), tokens only, both themes. The grid, the
steppers, the combobox and the floating shell are already styled by
`calendar.css`, `timepicker.css`, `combobox.css` and `popover.css`; this file
adds the two-column popover (520px floor, stacked under 620px), strips the
embedded TimePicker's card chrome, and gives the trigger the house `.input`
look so it lines up with DatePicker/TimePicker in a form grid.

## Pitfalls

- Don't read the time columns to get the value — they may hold an uncommitted
  draft. `onChange`/`value` is the only value channel.
- `'object'` output is `null` when empty, `''` for every other `outputFormat`.
  Check both if you switch formats at runtime.
- `min`/`max` are **not** a general datetime window: the time half only applies
  on the boundary day (that is what the calendar can express). A window like
  "May 4 09:00 → May 8 17:30" is honored at both ends and unrestricted between
  them.
- With the zone row open, **Escape closes the whole picker**, not just the
  combobox dropdown — the shared Popover claims Escape in the capture phase.
- The zone row's dropdown is locally positioned and can extend past the
  popover's edge; that is intentional (`.mojo-popover` is `overflow: visible`)
  and matches web-mojo.
