# MultiSelectDropdown — static-options checkbox dropdown

```tsx
import {
    MultiSelectDropdown,
    type MultiSelectOption,
    type MultiSelectValue,
} from 'portal-mojo/ui';
```

A trigger that summarizes the picks over a checkbox menu that **stays open
while you tick**; `Done` closes it. The static-options sibling of
[`CollectionMultiSelect`](collection-multiselect.md) (same selection
contract, but over an `options` array instead of live model data, and folded
into a dropdown instead of an always-visible panel). Ported from web-mojo
`src/core/forms/inputs/MultiSelectDropdown.js`.

```tsx
const [statuses, setStatuses] = useState<MultiSelectValue[]>(['open']);

<MultiSelectDropdown
    options={[
        { value: 'new', label: 'New' },
        { value: 'open', label: 'Open' },
        { value: 'closed', label: 'Closed', disabled: true },
    ]}
    value={statuses}
    onChange={setStatuses}
    label="Status"
    required
/>
```

## Props

| Prop | Behavior |
|---|---|
| `options` | `Array<string \| MultiSelectOption>`. Bare strings normalize to `{ value: s, label: s }`. Option shape: `{ value: string \| number, label?, text?, disabled? }` — `label` wins, `text` is the source's alias (accepted, don't reach for it), else `String(value)`. An option with no `value` warns and is dropped. |
| `value` / `onChange` | **Controlled.** `value` takes an array, a bare scalar (coerced to one pick), or `null`/`undefined` (none). `onChange` always receives the full next **array**; every toggle is a commit. Values keep their caller-side types (a numeric `2` comes back as `2`); comparisons are normalized. |
| `label` / `required` / `help` / `error` | House field chrome (`.field-label` / `.field-help` / `.field-error`; `error` replaces `help`). The label is a `<div id>` the trigger points at with `aria-labelledby` — a `<label htmlFor>` cannot target a button. The trigger references **both** that id and its own, so the accessible name keeps the summary (`"Status, New, Open"`). |
| `placeholder` | Trigger text while nothing is selected, rendered muted. Default `'Select...'`. |
| `maxHeight` | px before the option list scrolls. Default 300. |
| `showSelectedLabels` | Summarize with labels (default true). `false` → always `"N selected"`. |
| `maxLabelsToShow` | Picks above this switch the trigger to `"N selected"`. Default 3. |
| `disabled` | Locks the trigger and every row. |
| `placement` | Menu placement against the trigger — `Popover`'s `PopoverPlacement`. Default `'bottom-start'`. |
| `id` / `className` | `id` lands on the trigger button; `className` on the field wrapper. |

Not ported: `name` (served only the legacy change-event payload and per-row
DOM id generation — React callers close over their own field), `getValue` /
`setValue` / `setOptions` / `clear` / `getFormValue` / `setFormValue` (the
whole imperative surface is the `value`/`onChange` pair), and `placeHolder`
(the source accepted both casings; one spelling survives).

## Trigger summarization

```
0 picks                                     → placeholder, muted
≤ maxLabelsToShow and showSelectedLabels    → labels, comma-joined
otherwise                                   → "N selected"
```

Labels list in **selection order**, not option order (source parity) — the
summary reads back what the user did. A selected value matching no option
falls back to its own `String()` form **with a one-time `console.warn`**
(unknown-value rule) — the trigger never renders a blank slot.

## Menu

- Mounts in the shared [`Popover`](popover.md): portalled to the top layer,
  so it escapes overflow containers and stacks above open native-`<dialog>`
  modals. The menu width is measured from the trigger (the source's `w-100`)
  at open and kept in sync by a `ResizeObserver` while open.
- The **whole row** is the click target. Toggling never closes the menu —
  `Done`, Escape, and an outside click do.
- Per-option `disabled` refuses the toggle by click **and** by keyboard, and
  arrow navigation skips the row.
- No options → a single `"No options available"` line and **no Done footer**
  (source parity); close with Escape or an outside click.

## Keyboard

| Key | Effect |
|---|---|
| `Enter` / `Space` / `ArrowDown` on the trigger | Open. Focus moves to the first enabled row — the menu is portalled to the end of `<body>`, so Tab from the trigger could never reach it. |
| `Tab` | Walks the rows in order, then the `Done` button (every enabled row is `tabIndex=0`, matching `CollectionMultiSelect`). |
| `ArrowDown` / `ArrowUp` | Move between **enabled** rows, wrapping. |
| `Home` / `End` | First / last enabled row. |
| `Space` / `Enter` on a row | Toggle (`preventDefault` — no page scroll). |
| `Escape` | Closes and returns focus to the trigger. Inside a modal the first Escape closes only the menu (`Popover`'s capture-phase handler). |

`Done` and Escape always hand focus back to the trigger. An outside click
only does when focus is still parked inside the menu — never fight the
element the user just clicked.

## Invariants

1. **One value pipeline.** The ROW is the checkbox widget
   (`role="checkbox"` + `aria-checked`); the `<input type="checkbox">` is
   display-only — `pointer-events: none`, `readOnly`, `aria-hidden`,
   `tabIndex={-1}` — and renders straight from `value`. A row click and a
   keyboard `Space` call the identical `toggle()`. There is no second event
   source that could move the DOM without moving state.
2. **Identity never round-trips through DOM attributes.** Toggles close over
   the option object; every comparison goes through one `String()`
   normalization (`keyOf`). String and number values, and mixes, work by
   construction.
3. `null`/`undefined` are the only "nothing selected" — `0` and `''` are
   selections.
4. Both themes, tokens only: `apps/portal/src/theme/multiselect-dropdown.css`
   (reuses `.tbl-check`, `.btn`, `.field-*`; the popover shell supplies the
   surface/border/shadow).

## The bug this port kills

web-mojo tracked selection in a private `item.selected` flag driven **only by
row-click delegation**, then wrote `checkbox.checked` by hand — while each row
also contained a real focusable `<input type="checkbox">` and a row-wide
`<label for>`. Any toggle the delegation didn't originate (keyboard `Space`
on the focused checkbox; the label's synthesized click) moved the DOM without
moving the tracked selection, or moved it twice. The rendered boxes and the
value drifted apart, and the drift survived — the view re-rendered from the
same desynced flags.

Two smaller ones die with it:

- **Numeric values were emitted as strings.** The source read
  `element.getAttribute('data-value')` (always a string) and pushed *that*
  into `selectedValues`, then rebuilt rows with
  `selectedValues.includes(optionValue)` against the raw numbers — so a
  numeric option ticked once could never be seen as selected again.
- **Falsy scalars vanished.** The constructor dropped a non-array `value`
  outright, and `setValue` coerced with a truthy test, so `0` and `''` were
  silently discarded.

## Pitfalls

- The menu is `position: fixed` in the top layer. Don't try to clip, cover
  or z-index it from an ancestor — see [popover.md](popover.md).
- `maxLabelsToShow={0}` is honored (always the count). The source's `|| 3`
  quietly rewrote a 0.
- Duplicate values in `value` collapse on the next toggle of that row (the
  removal filters every copy). Pass a de-duplicated array.
- Options are static and rendered in the order given — there is no search and
  no client-side filtering. Reach for `CollectionMultiSelect` once the list is
  server data or long enough to need search.
- **Cousin, not yet reconciled:** `FilterBar`'s `multiselect` filter type
  renders its own checkbox list (`.check-list` / `.check-row`) inside the
  filter modal, with the same job and a different implementation — see
  `FilterForm` in `packages/portal-mojo/src/ui/FilterBar.tsx`. Collapsing the
  two onto this component is a follow-up **decision** (the filter dialog
  commits on submit, this one commits per toggle), deliberately not attempted
  here. Change one, look at the other.
