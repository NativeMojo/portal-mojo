# TimePicker

The stepper time input, ported from web-mojo `forms/inputs/TimePicker.js`
(648 lines) — the source's locked **variant B**: per unit a column of
▲ / value input / ▼ / label, with direct numeric typing on the value. Built
on the shared [`Popover`](popover.md) and the `parseTime`/`formatTime`/
`compareTime`/`ianaOffset` half of [`dateFns`](calendar.md). No wheels (the
source deferred those to a future mobile mode), no library.

```ts
import { TimePicker } from 'portal-mojo/ui';
import type { TimeValue, TimeChangeEvent, TimeOutputFormat } from 'portal-mojo/ui';
```

## Value shapes (the contract)

Storage is **always canonical 24h `HH:MM` internally** — `format` only
decides what the panel and trigger render. `outputFormat` decides what
leaves:

| `outputFormat` | with a zone | without a zone | empty |
|---|---|---|---|
| `'iso'` (default) | `'14:30-07:00'` | `'14:30'` | `''` |
| `'iana'` (legacy) | `'14:30 America/Los_Angeles'` | `'14:30'` | `''` |
| `'object'` | `{time: '14:30', timezone: 'America/Los_Angeles'}` | `'14:30'` (string!) | `null` |

`'object'` only produces an object when the zone picker is enabled —
otherwise it degrades to the `'iso'` string, exactly as the source did.

**Everything above parses back in**, plus two more shapes the source
accepted (`_parseInitial`, ported line for line):

- 12h text — `'2:30 PM'` (an AM/PM tail belongs to the time, not the zone)
- ISO offsets in every spelling — `'14:30Z'` → zone `+00:00`,
  `'14:30+0530'` → `+05:30`, `'14:30-07:00'` → `-07:00`
- IANA tails — `'14:30 America/New_York'`
- bare `'14:30'` / `'9:05'`

Invalid text parses to `null` (empty picker) — `parseTime` never throws.

## API

| Prop | Notes |
|---|---|
| `value` | `string \| {time, timezone} \| null` — see above. Omit entirely for an uncontrolled picker. |
| `onChange` | `({value, formatted, oldValue})` — fires on **commit only**, and only when the serialized string actually changed |
| `format` | `'24h'` (default) \| `'12h'`. Unknown values warn + fall back |
| `step` | minute stepping increment, ≥1 (default 1). Hours always step by 1 |
| `min` / `max` | time strings (`"09:00"`, `"5:30 pm"` — `parseTime` parses them); clamped on **every** commit path |
| `placeholder` | default `'HH:MM'` / `'h:mm AM/PM'` |
| `disabled` / `readOnly` / `required` / `invalid` | trigger states; `required` and `readOnly` also suppress the clear ✕ |
| `inline` | render the panel in place — no trigger, no popover |
| `showFooter` | `false` → the embeddable footerless panel (DateTimePicker's time column) |
| `timezone` | `true` enables the zone picker; a `string[]` enables it **and is the zone list** |
| `timezones` | zone list when `timezone` is `true` (default: Intl's full list) |
| `outputFormat` | `'iso'` \| `'iana'` \| `'object'`. Unknown values warn + fall back |
| `renderTimezoneSelect` | the zone-picker slot — see below |
| `name` | renders a hidden input carrying the serialized string (native-form use) |
| `className` | appended to the root |

`TimeChangeEvent.oldValue` is always the **previous canonical serialized
string** (`''` when empty), never the object form — it is the diffing key,
not a mirror of `value`.

## The timezone seam

`TimePicker` owns every bit of the zone's value and serialization logic but
renders the picker itself through a slot:

```tsx
<TimePicker
  timezone
  renderTimezoneSelect={({ value, onChange, timezones, disabled }) => (
    <TimezoneSelect value={value} onChange={onChange} timezones={timezones} disabled={disabled} />
  )}
/>
```

Without the prop it falls back to a plain token-styled `<select>` built from
`Intl.supportedValuesOf('timeZone')` (curated ~50-zone list + a `console.warn`
when Intl can't supply one), so the feature is complete standalone. Swapping
in the real `TimezoneSelect` changes nothing about the value pipeline — the
slot only renders. A zone the list doesn't contain still renders as its own
option (never "render nothing") with a warn.

## Behavior invariants (from source, keep them true)

- **Commit-only pipeline.** Typing into a column writes a *draft*, which can
  never be read as the value. `onChange` fires on: stepper click, ArrowUp/
  Down, Enter (which commits by blurring), blur, AM/PM, Now, Set-on-empty,
  clear, zone pick. Re-committing the same value is silent.
- **Column typing.** Digits only (the keydown blocks the rest; ⌘/^/⌥
  shortcuts pass through — a fix over source, which ate ⌘A/⌘V). Focus
  selects the whole field; `maxLength` is 2; a blur clamps — 12h hours
  1–12, 24h hours 0–23, minutes 0–59 — and an empty field reverts to the
  displayed value.
- **12h hour math** is the fiddly part: **12 AM = 0**, **12 PM = 12**, and a
  typed hour maps through the *current* AM/PM state (PM + `3` → `15:00`).
  AM/PM on an empty picker seeds `00:00` / `12:00`.
- **Minute stepping honors `step`** via total-minutes math and wraps across
  midnight in BOTH directions (`23:45` +15 → `00:00`; `00:00` −15 →
  `23:45`). Hours wrap 0–23. Typing is not constrained to `step`.
- **`min`/`max` clamp is a snap, not a block** — the stepper still moves, it
  just lands on the bound.
- **Now** takes the local wall clock; **Set** fills `00:00` if the picker is
  empty and closes the popover.
- The trigger is bi-clock icon + formatted text + a clear ✕ that appears on
  hover/focus (suppressed by `required`/`disabled`/`readOnly`). Clicking it
  on an empty picker is a no-op.

## Deviations from source (deliberate)

1. **A zone change emits.** web-mojo updated its hidden input but never fired
   `change` on a zone pick (`_syncOutputs()` called with no `oldStored`).
   `onChange` is the only channel here — staying silent would strand the
   owner's value.
2. **`Now` and the AM/PM-on-empty seed are clamped** like every other commit
   path. The source skipped `_clampToBounds` on both, so `Now` outside
   business hours produced an out-of-bounds value.
3. **An already-offset zone passes through** `'iso'` serialization
   (`'14:30-07:00'` re-saves as `'14:30-07:00'`). `ianaOffset('-07:00')`
   returns `null`, so the source silently dropped the offset on re-save.
4. **The clear ✕ is a sibling of the trigger**, not nested inside it (the
   source produced a `<button>` inside a `<button>`). The wrapper carries the
   hover reveal, so the pointer sitting on the ✕ keeps it visible.
5. `disabled`/`readOnly` are enforced at the commit boundary, so a locked
   `inline` panel is inert (the source only guarded the popover, which a
   locked picker could never open anyway).
6. The dead `autoApply` option (destructured, never read in source) is not
   carried. There is no `hasError()` stub either — pass `invalid` instead.

## State ownership (read this before wiring a form)

The picker holds its **own committed state**, seeded from `value` and
re-seeded whenever the `value` prop changes to something that is not an echo
of its own last emit — the same shape [`Calendar`](calendar.md) uses. Write
`event.value` straight back into `value` and the two stay in lockstep; omit
`value` entirely and it behaves as an uncontrolled picker.

Why not derive purely from props: `'iso'` output carries only the **offset**,
so re-parsing our own echo would silently degrade
`'America/Los_Angeles'` → `'-07:00'`. The zone therefore lives in component
state, and the echo guard is what protects it. Corollary: **a rejected write
does not revert the panel** — if you need to refuse a value, write the value
you *do* want (a second prop change re-seeds).

One more source-parity quirk: enabling `timezone` seeds the browser's local
zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`, `'UTC'` on failure)
**without emitting**. The owner learns the zone on the first real commit.

## Styling

`apps/portal/src/theme/timepicker.css` — `mojo-time-*` anatomy only
(`trigger` / `trigger-text` / `trigger-clear` / `popover-inner` /
`picker-inline` / `stepper*` / `ampm*` / `tz-host` / `foot`), tokens only,
both themes. The trigger wears the house `.input` look so it lines up in a
form grid; the popover shell (`.mojo-popover`) supplies background, border
and shadow, and `.mojo-time-popover-inner` brings the padding
(`.has-tz` widens it to 300px for IANA labels).

## Pitfalls

- Don't read the column inputs to get the value — they may hold an
  uncommitted draft. `onChange`/`value` is the only value channel.
- `'object'` output is `null` when empty, `''` for every other
  `outputFormat`. Check for both if you switch formats at runtime.
- `min`/`max` are wall-clock times, not datetimes: a range that crosses
  midnight (`22:00`–`02:00`) is not expressible — `compareTime` is linear.
- `ianaOffset` is evaluated at **serialization time against `new Date()`**,
  so a DST-straddling value serializes with today's offset. Store the IANA
  name (`'iana'` / `'object'`) when the date matters.
- django-mojo datetimes are epoch **seconds** — that is a DateTimePicker
  concern; this component only speaks wall-clock time strings.
