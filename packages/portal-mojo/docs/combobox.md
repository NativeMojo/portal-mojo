# ComboBox — the house autocomplete

```ts
import { ComboBox, type ComboOption, type ComboValue } from 'portal-mojo/ui';
```

One editable select: a text input over a filtered suggestion list. Ported
from web-mojo's `ComboInput.js` (the feature spec — descriptions, meta,
highlight, ARIA, relevance ranking) plus `ComboBox.js`'s open-on-focus.
This is the base for TimezoneSelect (#1274) and rule-builder field pickers;
there is exactly ONE combobox in this toolkit.

## API

```ts
type ComboValue = string | number;

interface ComboOption {
    value: ComboValue;
    label: string;          // what the input displays
    description?: string;   // muted second line in the list
    meta?: Record<string, unknown>;  // opaque; returned via onSelect
}

<ComboBox
    value={v}                        // committed value (string | number | null)
    options={opts}                   // ComboOption[] — bare strings normalize to {value:s,label:s}
    onChange={(value, option?) => …} // COMMIT only, and only when the value changed
    onSelect={(option) => …}         // any commit that resolves to an option — carries meta
    allowCustom     // default true: unmatched text commits as-is
    showDescription // default true
    minChars={0}    // typing auto-opens the list only at ≥ N chars
    maxSuggestions={10}  // caps the rendered list AND keyboard wraparound
    placeholder disabled readOnly required id className
/>
```

## The commit pipeline (the invariant)

The input's text is a private **draft**; the committed value lives in the
`value` prop. `onChange` fires ONLY on:

| Gesture | Result |
|---|---|
| Click option / Enter on highlighted | commit that option |
| Enter on typed text (`allowCustom`) | resolve → option, else commit text as custom |
| Blur / outside click / Tab / chevron-close | **settle**: exact label or `String(value)` match → that option; else custom when allowed (`''` commits a clear); else **revert** — the display falls back to the committed label |
| Escape | revert, keep focus — never commits |

Never per keystroke — web-mojo's ComboBox emitted per keystroke and
FormView's 300ms autosave saved partial text. Typed text equal to an
option's **label** commits the option's **value** (display shows labels;
labels must never leak into state). `onChange` is skipped when the resolved
value equals the current `value`; `onSelect` still fires on an explicit
option commit (rule builders may want the meta again).

## Filtering

Case-insensitive substring across label + value + description; ranked exact
label match, then label starts-with, then input order (stable). `minChars`
gates only the auto-open while typing (below it the list closes); explicit
opens — focus, ArrowDown, chevron — always show the full (capped) list.
The chevron reopens with the filter cleared and the input text selected, so
the next keystroke starts a fresh query. Empty states (verbatim):
with `allowCustom` — "No matches found. Press Enter to use custom value." /
"Start typing to see suggestions..."; without — "No matching options found."

## Keyboard + ARIA

ArrowDown opens, then moves next; ArrowUp previous; both wrap over the
*visible* (maxSuggestions-capped) list. Enter selects the highlighted
option, else commits custom text. Escape reverts (and is passed through to
e.g. a parent `<dialog>` only when there is nothing to escape). Tab settles
and passes through. The highlighted option scrolls into view
(`block:'nearest'`). Full combobox pattern: `role=combobox`,
`aria-expanded`, `aria-autocomplete=list`, `aria-controls`,
`aria-activedescendant`, `role=listbox/option`, `aria-selected` + check
icon on the selected option. Match highlighting renders as split React
nodes around `<mark class="combo-mark">` — regex-escaped query, no HTML
strings.

## Invariants / fixed web-mojo bugs (do not reintroduce)

- **Commit-only `onChange`** — the draft/value split is the fix; there is no
  code path that emits while typing.
- **`allowCustom:false` reverts for real** — web-mojo overwrote its
  committed value per keystroke, so its revert restored the typed text.
- **Numeric values survive** — selection passes option objects in closures;
  web-mojo strict-equalled stringified `data-value` DOM attributes.
- **No listener leak** — the outside-mousedown listener attaches only while
  open and is removed on close/unmount.
- Unknown `value` under `allowCustom:false` warns once and displays
  verbatim — never renders nothing (rule 4).

## Pitfalls

- Value matching is strict `===`: `5` and `'5'` are different values. Keep
  option values and the `value` prop the same type (URL params are strings —
  convert before binding).
- `description` renders only when provided (web-mojo silently defaulted it
  to the label, duplicating every row — not carried).
- The dropdown is locally positioned (`absolute` in the component's own
  stacking context, 300px scroll) — inside `overflow:hidden` containers it
  clips. MERGE-WIRE: revisit against the Popover primitive (#1271).
- Styles live in `apps/portal/src/theme/combobox.css` (tokens only, both
  themes); consuming apps must include it.
