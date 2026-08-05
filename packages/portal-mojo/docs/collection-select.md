# CollectionSelect — the single-record server picker

```tsx
import { CollectionSelect, type CollectionSelectValue } from 'portal-mojo/ui';
```

Search-as-you-type against any model or endpoint, pick ONE row, and hydrate
a bare stored id into its display label. The value is **controlled** in both
directions. Ported from web-mojo `CollectionSelect.js`; sibling of
`CollectionMultiSelect` in the server-data selects family (epic #1275) —
the two share the model-binding prop contract.

```tsx
const [ownerId, setOwnerId] = useState<string | number | null>(42);

<CollectionSelect<User>
    model={UserModel}             // or endpoint="/api/user"
    labelField="display_name"
    value={ownerId}               // bare id → renders "#42", then the label
    onChange={(id, row) => setOwnerId(id)}
    label="Owner"
    required
/>
```

## Props

| Prop | Behavior |
|---|---|
| `model` / `endpoint` | One is required. `model` is a `defineModel` def (supplies endpoint + row type); `endpoint` is the bare path. |
| `value` | Controlled: `string \| number \| null`, **or a row-like object** (a record with the relation expanded) — id and label extract via the `valueField`/`labelField` dot paths, no fetch. `0`/`'0'` (web-mojo's no-selection sentinel) and `''` normalize to "no selection" on the way IN and never leak OUT. |
| `onChange` | `(id \| null, row?)` — fires on **commit only**: picking a row → `(id, row)`; clearing (✕, or typing away from the committed label) → `(null)`. Re-picking the already-committed row does not re-fire. Never fires per keystroke; never emits `'0'` — `null` is the empty value. |
| `labelField` / `valueField` | Row fields for label and id, **dot notation** reaches nested fields (`'user.email'`). Defaults `'name'` / `'id'`. A missing field warns once and falls back (label → the id; missing id → row dropped / object value → no selection) — never renders nothing silently. |
| `maxItems` | Rows fetched per search — the `size` wire param. Default 10. |
| `placeholder` | Input placeholder. Default `'Search…'`. |
| `debounceMs` | Keystroke → `search` wire param delay. Default 400 (source parity — deliberately not ModelTable's 300). |
| `emptyFetch` | Default true: opening the dropdown (focus/click) fetches the initial unsearched page so options exist before typing. `false`: nothing is fetched until a term exists — the dropdown shows "Start typing to search…". |
| `defaultParams` | Extra wire params — a dict, or a **callback re-evaluated per render** (each fetch uses the freshest result; a changed result is a new query key → refetch). Merge order: `{size: maxItems} → defaultParams → group → search` (later wins). |
| `requiresActiveGroup` | Folds the active group id in as `group`. With NO active group the fetch is **held** (the dropdown says "Select an active group first") — never an unscoped list where a scoped one was demanded. Needs a `<GroupProvider>` above; missing one warns. |
| `label` / `required` / `help` / `error` | Field wrapper (house `.field-label` / `.field-help` / `.field-error`; `error` replaces `help` and paints the input `.input-invalid`). |
| `disabled` / `readOnly` | Both freeze the pipeline (no open, no typing, no ✕). `readOnly` still shows the committed label at input contrast. |

## Selection semantics (the contract)

- **Picking commits**: the input fills with the row's label, the dropdown
  closes, `onChange(id, row)` fires (only when the id actually changed).
- **Typing that diverges from the committed label clears the selection** —
  `onChange(null)` fires ONCE and the typed text becomes the live search
  (web-mojo re-emitted the clear on every keystroke; fixed here).
- **Clear ✕** shows while a selection exists: resets to empty, fires
  `onChange(null)`, refocuses the input — which reopens the dropdown on
  the base page (the source's emergent behavior, kept on purpose).
- **Escape** closes the dropdown and restores the committed label (the
  in-progress search text is dropped). Inside a native-`<dialog>` modal the
  first Escape closes only the dropdown, the second the modal (Popover's
  capture-phase handling). **Outside click and Tab-away do the same
  revert** — deliberate deviation from the source, which left typed text
  visible in the input while its hidden value said "no selection" (the
  display-diverges-from-state bug class ends here).
- **Keyboard**: ArrowDown/ArrowUp walk the options (clamped at the ends, no
  wrap — source parity; ArrowDown also reopens a closed dropdown), Enter
  commits the focused option (and never submits an enclosing form while the
  dropdown is open). Focus never leaves the input — options are
  `tabIndex={-1}` and mousedown-prevented, and the input is never
  remounted, so it stays focus-stable across result updates.

## id → label hydration

A `value` whose label is unknown renders `#<id>` immediately, then resolves
in this order:

1. **Object value** — label extracted via the dot path, no fetch.
2. **Label learned at pick time** (kept per instance — survives list-cache
   garbage collection).
3. **Any cached LIST row** under `[endpoint, …]` — ModelTable pages, other
   pickers and this picker's own fetches all share those keys.
4. **Fetch the one record** through the generic `[endpoint, 'one', id]` key
   — the same cache `useOne`/DetailView read, so the fetch dedupes with
   them. Numeric-string ids fetch under the **numeric** key (django-mojo
   pks are ints; uuid/slug ids pass through).

A failed hydration keeps `#<id>` on screen and warns once per id (mojo 4xx
errors never retry, per `mojoQueryDefaults`).

## Wire contract

GETs to the list endpoint through `useModelList` — cache key
`[endpoint, params]`, `placeholderData: keepPreviousData`. Params sent:
`size: maxItems`, merged with `defaultParams`, plus `group` (when
`requiresActiveGroup`) and `search` (trimmed; **dropped entirely when
empty** — an empty search is the plain first page, not `search=`).
Fetches run only while the dropdown is open; with `emptyFetch: false`,
only once a term exists. `model.invalidate(qc)` refreshes an open picker
too — there is no parallel fetch path.

## Invariants

1. Controlled value, one pipeline: the input displays either the committed
   label (or `#<id>` while resolving) or the live draft — never a mix, and
   never text the state doesn't hold. Commit fires on selection/clear only.
2. Every id comparison goes through one `String()` normalization; `'0'`/`0`
   normalize to null at the boundary and `null` is the only empty value on
   the way out.
3. Rows the server returns are shown as-is — every narrowing (kind, group,
   search…) is a wire param, never a client-side filter.
4. Dropdown states: spinner row while the current key's rows aren't on
   screen; "No results found" (searched) vs "Start typing to search…"
   (no term); fetch errors show the server's message + Retry; a held
   group-scoped fetch says "Select an active group first".
5. The dropdown lives in the shared `<Popover>` (top layer): it stacks
   above native-`<dialog>` modals, escapes overflow containers, and
   matches the field's width.

## Pitfalls

- `maxItems` is the fetch size — there is no paging in the dropdown. If the
  target row isn't in the first page, the user searches; search is
  server-side, so it can find anything.
- The picker never invents rows: a `value` id that doesn't exist
  server-side stays `#<id>` (with one console warning). Feed it real ids
  or a row object.
- `labelField` must exist on the **list** graph rows for the dropdown to
  read well; hydration can additionally use one-record-graph fields (the
  detail graph is often wider), but options come from list rows.
- An inline `defaultParams` object/callback re-evaluates per render; that
  is fine (TanStack hashes keys structurally). Only a changed RESULT
  refetches.
- `requiresActiveGroup` holds the fetch until a group is active; pair the
  control with `RequiresGroup` or group-scoped screens so users aren't
  handed a picker that says to pick a group they can't pick there.
- Don't wire `onChange` to a per-keystroke autosave expectation — it fires
  on commit (that is the point; see the B3 autosave contract).
