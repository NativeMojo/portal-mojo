# DateRangePicker + PresetRail

```ts
import { DateRangePicker, PresetRail } from 'portal-mojo/ui';
import type { DateRangeChangeEvent, PresetEntry, PresetsOption } from 'portal-mojo/ui';
```

The range picker built on the [Calendar engine](calendar.md) and the shared
[Popover](popover.md), with the "Quick range" preset rail. Ported from
web-mojo's `DateRangePicker.js` + `calendar/PresetSidebar.js`. One
component, three precisions: `'day'` (default, two side-by-side panes),
`'month'`, `'year'` — each with its own default preset list, display
format, and placeholder.

```tsx
const [start, setStart] = useState('');
const [end, setEnd] = useState('');

<DateRangePicker
    start={start}
    end={end}
    onChange={(e) => { setStart(e.start); setEnd(e.end); }}
/>
```

## Value contract

**Controlled, canonical strings.** `start`/`end` are the engine's canonical
strings at precision — `YYYY-MM-DD` / `YYYY-MM` / `YYYY` — with `''`/null
as empty. Every commit (completed calendar range, preset pick, clear ✕)
emits `onChange` and paints only once the owner writes the props back:

```ts
interface DateRangeChangeEvent {
    start: string;      // canonical at precision ('' when cleared)
    end: string;
    formatted: string;  // display text of the NEW range (what the trigger shows)
    oldStart: string;   // the props at emit time
    oldEnd: string;
}
```

`onChange` fires only when the pair actually changes (re-picking the current
range emits nothing). There is no per-keystroke path — commits only.

## `<DateRangePicker>` API

| Prop | Notes |
|---|---|
| `start` / `end` | Controlled canonical strings (or `''`/null). |
| `onChange` | `(DateRangeChangeEvent) => void` — see above. |
| `precision` | `'day' \| 'month' \| 'year'` (default `day`). Unknown values warn + fall back to `day`. |
| `months` | Day-view panes `1 \| 2`. Default **2 for day precision, 1 for month/year** (source rule). Clamped like the engine. |
| `presets` | `'default' \| true` → the precision's built-in list; `PresetEntry[]` → custom; absent/`false`/`[]` → no rail. |
| `displayFormat` | Display tokens (`YYYY YY MMMM MMM MM M DD D`). Defaults: day `MMM DD, YYYY`, month `MMM YYYY`, year `YYYY`. Tokens the precision can't honor are stripped (the source's `_stripIncompatibleTokens`, ported verbatim — trailing separator debris swept). |
| `separator` | Between the formatted ends. Default `' – '` (spaced en dash). |
| `placeholder` | Default per precision: `Select date range...` / `Select month range...` / `Select year range...`. |
| `min` / `max` | Canonical strings, passed straight to the Calendar (compared at the pane precision being painted). |
| `disabled` | Trigger disabled; popover can't open. |
| `readOnly` | Trigger shows the value but won't open; no clear ✕. |
| `required` | Hides the clear ✕ (the field can't be emptied from the trigger). |
| `inline` | Render rail + calendar in place — no trigger, no popover. |
| `autoApply` | Default `true`. See semantics below. |
| `className` / `id` | Root class / trigger button id. |

**`autoApply` means auto-CLOSE, not staged apply** (source semantics carried
exactly): values apply on every commit either way; `autoApply` only decides
whether completing a range or picking a preset also closes the popover.
For an explicit Apply step, mount `inline` inside a dialog and stage the
values in the dialog's own state — that is precisely what FilterBar does.

## Trigger anatomy

`bi-calendar3-range` icon + formatted text (`start – end`, tabular-nums,
ellipsized) or muted placeholder + clear ✕. The ✕ renders whenever the
picker is not `required`/`disabled`/`readOnly` and clears both ends in one
commit. It is an absolutely-positioned **sibling** button of the trigger —
web-mojo nested `<button>` inside `<button>`, invalid HTML; do not
reintroduce. A half-set range displays just the one formatted end
(deep-linked one-sided `dr_*` filters still render).

## Presets

```ts
type PresetsOption = 'default' | true | PresetEntry[];
type PresetEntry =
    | { label: string; range: () => { start: ParsedDate | string; end: ParsedDate | string } }
    | { divider: true };
```

`range()` is resolved at click time (so "Today" is always today) and may
return parsed shapes (`{y,m,d}` / `{y,m}` / `{y}`) or canonical strings.
Default lists (verbatim from source; builders exported as
`dayPresets()` / `monthPresets()` / `yearPresets()` / `defaultPresets(p)`):

| Precision | List |
|---|---|
| day | Today · Yesterday · Last 7 days · Last 30 days · Last 90 days · ─ · This month · Last month · This year |
| month | This month · Last month · Last 3 months · Last 6 months · YTD · Last 12 months |
| year | This year · Last year · Last 3 years · Last 5 years · Last 10 years |

Rail behavior: "Quick range" eyebrow (`eyebrow` prop on `PresetRail`; `''`
hides it); the picked preset highlights and stays highlighted until a
**manual calendar anchor starts** (`onRangeStart` → highlight cleared —
source parity). Dividers consume an index, so `activeIndex` lines up with
the flat entry list. `<PresetRail>` is exported standalone (controlled
`activeIndex`, `onSelect` emits `{index, label, start, end, range}` with
canonical strings); the C2 custom-range dialog can reuse it.

## FilterBar integration (the dr_* wire triple)

FilterBar's daterange dialog mounts `<DateRangePicker inline months={1}
presets="default">` and stages `e.start`/`e.end` in dialog state; its
**Apply** button writes `params.setDateRange(field, start, end)` — the
`dr_field`/`dr_start`/`dr_end` triple — exactly as the old native date
inputs did. Same canonical `YYYY-MM-DD` values on the wire, same pills,
same deep links; only the dialog body changed. The params store remains the
single source of truth; the picker never touches it directly.

## Form-registry aliases (for the #1278 field registry)

Source `inputs/index.js` registers three aliases over this one component —
carry them when the registry lands:

| Field type | Component | `precision` |
|---|---|---|
| `daterange` | DateRangePicker | `day` |
| `monthrange` | DateRangePicker | `month` |
| `yearrange` | DateRangePicker | `year` |

(Explicit `precision` in the field options beats the alias, per source's
`createInput`.)

## Deviations from source (deliberate)

- **Controlled props replace the form-DOM bridge**: no hidden `<input>`s,
  no `name`/`startName`/`endName`/`fieldName`, no `outputFormat`
  (`combined` was `start + separator + end` — derive it if needed), no
  `getFormValue`/`setFormValue`. The #1278 registry adapter owns form
  wiring.
- **A half-picked anchor does not survive popover close/reopen.** The
  anchor is Calendar-internal state and the popover unmounts its content on
  close; web-mojo kept one live calendar element across opens. The
  load-bearing behavior — the anchor surviving paging/zooming
  mid-selection — is engine-owned and fully preserved; reopening shows the
  committed range. Revisit only if the engine grows a controlled `anchor`
  prop.
- **Escape closes the popover first** (Popover owns Escape in the capture
  phase — one press, popover only; a second reaches an enclosing modal).
  The engine's Escape-cancels-anchor applies in `inline` mode.
- `is-invalid` styling was not carried — source's `hasError()` was a stub
  that always returned false.

## Pitfalls

- **Do not write `start`/`end` back from anything but `onChange`.** A range
  prop write is `setRange` semantics to the engine — it cancels an
  in-progress anchor (that is also why preset picks repaint correctly:
  owner writes back, engine syncs).
- Presets are **not min/max-clamped** (source parity): a custom preset can
  commit out-of-bounds values even though the grid cells paint disabled.
  Clamp inside your `range()` if bounds matter.
- The popover body sizes itself (`180px` rail + fixed calendar width);
  `inline` is fluid to its host. Two panes + rail ≈ 850px — don't mount
  two-pane popovers inside narrow scroll containers, and keep dialogs on
  `months={1}`.
- Styling lives in `apps/portal/src/theme/daterange.css` (trigger
  `.mojo-daterange-*`, rail `.mojo-calendar-preset*`), tokens only, both
  themes; the calendar grid ships in `calendar.css`, the popover shell in
  `popover.css`.
