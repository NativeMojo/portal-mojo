# CollectionMultiSelect — server-backed multi-pick dropdown

```tsx
import { CollectionMultiSelect } from 'portal-mojo/ui';
```

A checkbox list over live model data — server search, `SELECT (n)` /
`DESELECT (n)` with live counts, shift-click range selection — presented by
default as a **dropdown**: a summary trigger + `<Popover>` menu sharing
`MultiSelectDropdown`'s shell. The menu stays open while ticking; **Done**,
Escape or an outside click closes it. `variant="panel"` keeps the
always-visible box (web-mojo's shape) for settings-page contexts. The value
is a **controlled id array** in both directions. Ported from web-mojo
`CollectionMultiSelect.js`; sibling of `CollectionSelect` in the server-data
selects family (epic #1275).

```tsx
const [ids, setIds] = useState<Array<string | number>>([]);

<CollectionMultiSelect<GroupRow>
    model={GroupModel}            // or endpoint="/api/group"
    value={ids}
    onChange={setIds}
    label="Groups"
    required
/>
```

## Props

| Prop | Behavior |
|---|---|
| `model` / `endpoint` | One is required. `model` is a `defineModel` def (supplies endpoint + row type); `endpoint` is the bare path. |
| `value` / `onChange` | Controlled id array. Every toggle commits — `onChange` fires with the full next array. Ids keep their caller-side types; all comparisons are normalized (`String()`), so string vs number ids work by construction. |
| `variant` | `'dropdown'` (default): summary trigger + Popover menu — the form-embedded presentation. `'panel'`: the always-visible box. Internals (search, counts, ranges, states) are identical. |
| `placeholder` | Trigger text while nothing is selected (dropdown). Default `'Select...'`. |
| `showSelectedLabels` / `maxLabelsToShow` | Trigger summary: up to `maxLabelsToShow` (default 3) comma-joined labels **when every pick's label is known** (labels accumulate from rows the control has seen — across searches), else `"N selected"`. Hydrated initial ids the control has never seen summarize as `"N selected"` — no per-id fetches, no warn. |
| `placement` | Menu placement against the trigger. Default `'bottom-start'`. |
| `labelField` / `valueField` | Row fields for label and id, **dot notation** reaches nested fields (`'user.email'`). Defaults `'name'` / `'id'`. A missing field warns once and falls back (label → the id; missing id → row dropped) — never renders nothing silently. |
| `size` | VISIBLE rows before the list scrolls (max-height = `size × 42px`). Default 8. **Not the fetch size** — the wire page size defaults to 50; override it via `defaultParams: { size: 100 }`. |
| `maxHeight` | Explicit px override for the list height. |
| `enableSearch` | Search input above the list. **Defaults ON in the dropdown variant, OFF in the panel.** 400ms debounce (source parity — deliberately not ModelTable's 300) into the `search` wire param; trimmed; empty term drops the param. |
| `defaultParams` | Extra wire params — a dict, or a **callback re-evaluated per render** (each fetch uses the freshest result; a changed result is a new query key → refetch). Merge order: `{size: 50} → defaultParams → group → search` (later wins). |
| `requiresActiveGroup` | Folds the active group id in as `group`. With NO active group the fetch is **held** (empty state shows) — never an unscoped list where a scoped one was demanded. Needs a `<GroupProvider>` above; missing one warns. |
| `ignoreIds` | Ids hidden client-side — the "already added" pattern. Compared normalized. This is the documented exception to the no-client-filtering rule; it exists so a picker can subtract rows already chosen elsewhere without a server round-trip. |
| `renderItem` | `(row) => ReactNode` — replaces the label span; the checkbox stays component-owned. This replaces web-mojo's mustache `itemTemplate` (trusted-HTML slots end here). |
| `isRowDisabled` | `(row) => boolean` — per-row disabled: unclickable, skipped by SELECT and by shift-click ranges. |
| `showSelectAll` | The SELECT/DESELECT header row. Default true. |
| `label` / `required` / `help` / `error` | Field wrapper (house `.field-label` / `.field-help` / `.field-error`; `error` replaces `help`). |
| `disabled` | Whole control: trigger, search, buttons, every row. |
| `id` | id for the trigger button (a `<label for>` can point at it). |

## Selection semantics (the contract)

- **Selection is an id set, never row references** — it survives searches,
  refetches and paging of the visible list. Picking under one search term
  and then searching another keeps the first picks in `value`.
- **SELECT (n)**: n = visible rows that are enabled and not yet selected.
  Clicking it ADDS those ids to the value (**union** — deliberate fix over
  the source, which replaced the value and dropped off-screen selections).
  Disabled rows are skipped. Disabled at n = 0.
- **DESELECT (n)**: n = `value.length` — the WHOLE selection, including ids
  not on screen under the current search. Clicking it clears the entire
  value (source parity: it is the "empty the value" affordance). Disabled
  at 0.
- **Shift-click range**: anchor = the last clicked row's index; the clicked
  row's NEW state applies across the span; disabled rows skipped; the
  anchor moves to the clicked row afterwards. The anchor resets whenever
  the row set changes (new data / `ignoreIds` change) — stale indices into
  a replaced list are meaningless (the source kept them and could walk off
  the array).
- Counts render only when > 0 (`SELECT`, not `SELECT (0)`) — source parity.

## Wire contract

One GET to the list endpoint through `useModelList`, so the cache key is the
shared `[endpoint, params]` — this picker, `ModelTable` and model hooks read
one cache and one invalidation root (`[endpoint]`). There is no parallel
fetch path; `model.invalidate(qc)` refreshes open pickers too.

Params sent: `size: 50` (default page size) merged with `defaultParams`,
plus `group` (when `requiresActiveGroup`) and `search` (when searching).
Sorting is the server's default unless `defaultParams` carries `sort`.

## Invariants

1. Controlled value, one pipeline: the checkboxes can never display a state
   `value` doesn't hold (the visual checkbox is `pointer-events: none`; all
   interaction — including `shiftKey` — lands on the row element).
2. Every id comparison goes through one `String()` normalization. Never
   compare raw ids anywhere in or around this component.
3. Rows the server returns are shown as-is except the `ignoreIds` subtraction
   — every other narrowing (kind, group, search…) must be a wire param.
4. Loading shows skeleton rows (house silhouette) whenever the current key's
   rows aren't on screen yet — cold load AND search/param changes. Empty is
   `"No items available"`; fetch errors show the server's message + Retry.

## Pitfalls

- `size` is visible rows, not the fetch size. A list of 300 candidates with
  the default wire size shows only the first 50 — raise it via
  `defaultParams: { size: 300 }` (or make the user search; search is server-side).
- The legacy `excludeIds` option is **not ported**: despite its "server-side
  filtering" comment it was a second client-side filter identical to
  `ignoreIds` (web-mojo filtered both in `buildItems`). Use `ignoreIds`.
- DESELECT clears ids that are hidden by `ignoreIds` or the current search
  too — it empties the value, not the visible page.
- An inline `defaultParams` object/callback re-evaluates per render; that is
  fine (TanStack hashes keys structurally — equal content, same key). Only a
  changed RESULT refetches.
- `requiresActiveGroup` holds the fetch until a group is active; pair the
  control with `RequiresGroup` or group-scoped screens so users aren't shown
  a permanently empty picker in global context.
- The dropdown's trigger/footer classes (`.multiselect-trigger`,
  `.multiselect-footer`, `.multiselect-done`) live in
  `multiselect-dropdown.css` — consuming apps must import it alongside
  `collection-multiselect.css` (the reference `theme.css` imports both).
