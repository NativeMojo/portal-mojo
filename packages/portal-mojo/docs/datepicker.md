# DatePicker — the single-value picker shell

```ts
import { DatePicker, type DatePickerChangeEvent } from 'portal-mojo/ui';
```

The trigger-and-popover shell over the [Calendar engine](calendar.md), ported
from web-mojo's `forms/inputs/DatePicker.js`. One component covers all three
precisions — day, month-only, year-only — and renders either as a form
control that opens a [Popover](popover.md), or `inline` as a bare calendar.

It owns exactly three things the engine does not: the display text, the
open/closed popover, and the clear affordance. Everything else is
pass-through.

```tsx
const [due, setDue] = useState<string | null>(null);

<DatePicker
    value={due}
    min="2026-01-01"
    disabledDates={['2026-03-12']}
    onChange={(e) => setDue(e.value)}
/>
```

## Value shape (the contract)

- `value` is the **canonical string at precision** — `YYYY-MM-DD` /
  `YYYY-MM` / `YYYY` — or `null` for empty. Same strings the engine speaks;
  no `Date` objects, no epochs. (django-mojo datetime *fields* are epoch
  seconds — convert at the model/form boundary, not here.)
- **Controlled.** A commit fires `onChange`; the trigger repaints only once
  the owner writes the value back. The picker holds no shadow copy.
- A loose-but-valid prop is canonicalized before anything reads it
  (`"2026-3-4"` → `"2026-03-04"`), so `onChange().oldValue` and the calendar
  always see the same normal form.

```ts
interface DatePickerChangeEvent {
    value: string | null;      // canonical, or null when cleared
    formatted: string;         // the trigger's display text ('' when null)
    oldValue: string | null;   // canonical value being replaced
}
```

`onChange` fires on **commit only** — a calendar pick or the clear ✕ — and
only when the canonical value actually changes. Re-picking the selected day
closes the popover without an event.

## API

| Prop | Notes |
|---|---|
| `value` | controlled canonical string, or `null` |
| `precision` | `'day' \| 'month' \| 'year'` (default `day`). Unknown values warn + fall back to `day` |
| `onChange` | `(e: DatePickerChangeEvent) => void` — commit only |
| `displayFormat` | trigger text format (`formatForDisplay` tokens). Default per precision: `MMM DD, YYYY` / `MMM YYYY` / `YYYY` |
| `placeholder` | empty-state text. Default `Select date/month/year...` |
| `min` / `max` | pass-through bounds (compared at the pane precision being painted) |
| `disabledDates` | `YYYY-MM-DD[]`, day grids only |
| `firstDay` | 0=Sun … default 1=Mon |
| `locale` | BCP-47 for month/weekday names, default `en-US` |
| `autoApply` | close the popover on commit. Default `true`; `false` commits and stays open |
| `inline` | render the calendar in place — no trigger, no popover, no ✕ |
| `disabled` / `readOnly` | both make the picker inert (no open, no commits); both hide the ✕ |
| `required` | hides the ✕ — a required field cannot return to empty |
| `invalid` | paints the error border (`is-invalid`) |
| `name` | renders a hidden input with the canonical value (native form posts only) |
| `id` / `className` | trigger id (for a label's `htmlFor`) / extra class on the root |

The popover is the shared `Popover` at `bottom-start`: outside-mousedown and
Escape close it, it repositions on scroll/resize, and it joins the top layer
so a picker inside a `<dialog>` modal paints above it.

## Display formatting

`displayFormat` is filtered to the tokens the precision can actually fill,
then trailing separators are trimmed (ported verbatim as
`_stripIncompatibleTokens`):

| precision | behavior |
|---|---|
| `day` | passes through untouched |
| `month` | `\bDD\b` / `\bD\b` removed |
| `year` | all month + day tokens removed; empties fall back to `'YYYY'` |

```
month  "D MMMM YYYY"  → "MMMM YYYY"  → "August 2026"
month  "YYYY-MM-DD"   → "YYYY-MM"    → "2026-08"
year   "MMM DD"       → "YYYY"       → "2026"
month  "MMM DD, YYYY" → "MMM , YYYY" → "Aug , 2026"   ← the wart
year   "DD/MM/YYYY"   → "//YYYY"     → "//2026"       ← the wart
```

The strip removes the **token**, not the punctuation around it, and only
trailing separators are cleaned. Pass a format that suits the precision, or
lean on the per-precision default.

## Invariants (keep them true)

- **One value pipeline.** The prop is parsed + re-formatted once into
  `canonical`; the trigger text, the calendar's `value`, the hidden input and
  every emitted event read that single derivation. The control can never
  display something the owner's state does not hold.
- **A value that does not parse renders as empty and logs one
  `console.warn`** naming the expected shape — once per distinct bad value,
  from an effect (never during render), never silently blank.
- **The clear ✕ is hidden when `required || disabled || readOnly`.** It is a
  SIBLING of the trigger button, absolutely positioned over it — clicking it
  can never open the popover.
- **`disabled`/`readOnly` are inert in both modes** — the trigger opens
  nothing and, inline, the calendar takes no commits.
- The ✕ shows whenever clearing is allowed, even with nothing selected
  (source parity); clicking it then is a no-op — no `onChange`.
- The trigger is a real `<button>`: Enter/Space open it, Escape closes.

## Deviations from web-mojo (deliberate)

| Source | Here | Why |
|---|---|---|
| clear `<button>` nested inside the trigger `<button>` | sibling, absolutely positioned | button-in-button is invalid DOM; React logs a `validateDOMNesting` error |
| `_setValue` patched `textContent` + a hidden input in place | value is a controlled prop | one pipeline; no shadow state to drift |
| `change` emitted `value: ''` when cleared | `value: null` | matches the `string \| null` prop type end to end |
| calendar instance persisted across opens (page position too) | popover content unmounts on close | React idiom; reopening always re-pages to the value, else today |
| inline mode ignored `disabled` | inline honors `disabled`/`readOnly` | the props have to mean something |
| imperative `setValue/getValue/clear/setMin/setMax/show/hide/focus` | props | nothing to call — the owner holds the value |

## Pitfalls

- The ✕ is `tabIndex={-1}` (source parity — a second tab stop per date field
  was not wanted). Keyboard users clear the field through the owning form,
  not the trigger.
- `min`/`max` gate at the **pane's** precision: with `min="2026-03-15"` the
  March tile and the 2026 tile stay enabled, only out-of-bounds days
  disable. Day-level rules belong in `disabledDates`.
- `inline` fills its container — give it a sized wrapper (~280px), same as a
  bare `<Calendar>`.
- Don't feed it `new Date().toISOString().slice(0,10)` if you care about the
  local day — that's UTC. Build canonical strings with `dateFns.formatYmd`.
- `autoApply={false}` keeps the popover open after a commit; there is no
  Apply button (there wasn't one in the source either) — the user closes it
  by clicking out, pressing Escape, or clicking the trigger.

## Styling

`apps/portal/src/theme/datepicker.css` — trigger, clear ✕, popover content
box, inline host. The grid itself is `theme/calendar.css` and the floating
surface is `theme/popover.css`; this file adds nothing they already cover.
Trigger metrics follow the house control (`.input`): `--surface2` fill,
`--line` border, 8px radius, accent focus ring. Tokens only, both themes.
