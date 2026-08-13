# ModelTable — the server-driven table

```ts
import { ModelTable, ExpandingSearch, type Column, type Preset, type BatchAction, type RowId } from 'portal-mojo/ui';
```

## Row identity

The row constraint is `T extends { id: RowId }` where `RowId = number | string`.
Most django-mojo models use an integer pk, but some declare a 32-char uuid-hex
`CharField` primary key (`jobs.Job`, `jobs.ScheduledTask`) — so selection,
expansion, React keys and `BatchAction` targets are all keyed on the union. An
integer-id table is unaffected; nothing narrows an id back to `number`.

Every sort, filter, search and page is a **wire param the server answers**
— there is no client-side row work (rule #1). Table state lives in the
URL-synced params store. All features below are opt-in props; a bare
`<ModelTable model={M} title columns />` renders the base table.

```tsx
<ModelTable<User>
    model={UserModel}                 // or endpoint="/api/user"
    title="Users" eyebrow="Account"
    columns={COLUMNS} filters={FILTERS} presets={PRESETS}
    defaultSort="-last_activity"
    defaultParams={{ status__in: 'new,open' }}
    selectable batchActions={BATCH}
    columnChooser persistState persistKey="users"
    exportFormats={['csv', 'json']}
    exporter={safeExporter}
    rowTone={(row) => row.priority >= 8 ? 'danger' : null}
    autoRefresh={30}
    rowExpand={(u) => <UserExpand u={u} />}
    {...groupByRecency<User>('last_activity')}
    onRowClick={(u) => openDetail(u.id)}
    addLabel="Add User" onAdd={addUser}
/>
```

## Columns

`Column<T> = { key, label, sortable?, align?: 'start'|'center'|'end',
hideable?, render?: (row) => ReactNode }`. `key` is the server field and
drives the sort param. `render` is the ONE cell prop (no formatter/template
aliases). `hideable: false` locks a column in the chooser (identity
columns).

**Cells never crash the page.** django-mojo graphs expand FK fields
per-graph, so a cell value can flip from `"GC"` to `{id, code, name, …}`
without a frontend change. The default (no-`render`) leg degrades an object
to `fmt.code(value)` or a visible `[object]` marker plus one `console.warn`
naming the column. A custom `render` runs inside `RenderGuard` — a per-cell
error boundary — so a callback that throws on the new shape, or returns an
element with the raw object nested inside, degrades to a dim `[render
error]` marker instead of white-screening. `rowExpand` and
`groupHeaderLabel` are guarded the same way. Render FK-ish fields through
`fmt.code()` (see grouping-and-fmt.md) so the cell shows the code instead
of a marker.

## fixedParams — locked scope

`fixedParams?: Params | null` is table IDENTITY, not table state: tenant /
group / graph scope merged into every wire request (list, export, exporter
callback) AFTER filter state and model normalization. It never renders a
pill, survives Clear all, is excluded from view persistence and the URL —
a bookmarked `?group=9` or a persisted view saved before the page was
scope-migrated is silently dropped rather than resurrected as a removable
filter.

- **Scope belongs in `fixedParams`; user-editable filter DEFAULTS belong
  in `defaultParams`.** A tenant key in `defaultParams` is one click from
  an un-scoped table — the bug class this prop closes. Passing the same
  key in both warns once (the `defaultParams` copy is dead).
- **The merge runs after `normalizeListParams`** — positive-projection
  normalizers would otherwise silently strip an un-allowlisted scope key
  and the request would go out unscoped. Consequence: `fixedParams.graph`
  overrides a normalizer-pinned graph (that's the documented
  `graph: 'full'` use).
- **`null` means "scope pending"**: the table renders its skeleton and
  fetches nothing until scope resolves — an async-scoped table must never
  fire (and cache) an unscoped first request. `undefined` means the table
  is unscoped by design and fetches normally.
- **Reserved keys can't be locked** (`start`/`size`/`page`/`sort`/
  `search`) — they'd fight the pager/sort/search UI; ignored with one
  console.warn.
- **A scope flip is a filter change to the user**: changing `fixedParams`
  resets to page 1 and clears row selection (a batch action must never
  fire against ids selected under the previous scope).
- **Presets must not carry fixed keys** — their writes are scrubbed from
  filter state, so such a preset never matches as active.

## Filters (see also forms.md dialog types)

`FilterDef` types: `text` (`__icontains`), `select`, `multiselect`
(collapses to `field__in`), `boolean` (`trueLabel`/`falseLabel`), `number`
(`__gte`), `daterange` (the `dr_*` triple). Applied filters render as
editable pills; presets are param bundles with DERIVED active state.

## Selection + batch

`selectable` renders checkboxes independently of `batchActions` (decoupled
by design). Select-all covers the current page, with an indeterminate
state. Selection clears when the wire params change (page/sort/filter).

`BatchAction<T>` accepts either `run(row, prepared)` or the mutually exclusive
`runBatch(rows, prepared)`. Runner semantics: confirm → optional once-per-batch
`prepare(rows)` (resolve null to cancel; its value is
passed to every run — e.g. collect ONE disable reason) →
`Promise.allSettled(rows.map(run))` → toasts `"Label: N item(s) updated"`
/ `"N succeeded, M failed"` (warning) / `"failed for all N"` → always
clear selection + invalidate.

`runBatch` executes exactly once for selection-wide operations such as incident
merge. A rejection produces one actionable error; cancellation mutates
nothing. Selection clears and the endpoint invalidates after a non-cancelled
attempt. `rowTone(row)` emits semantic danger/warning queue classes.

## Column chooser + persistState

`columnChooser` adds the Columns dropdown; hidden set is view state, never
a mutation of your `columns` array. `persistState` remembers sort / size /
search / filters / hidden columns per table (`persistKey`, else
route+endpoint) — precedence URL > saved > defaults, saved `size` wins; the
first fetch waits for the restore so it queries the restored view.
"Reset to defaults" in the chooser clears the whole saved view.

`defaultParams` supplies route defaults for any query key, including Django
lookups such as `status__in`. They are part of the same params store as URL and
persisted values. Precedence is URL > persisted > defaults; `defaultSort`
remains the backwards-compatible sort shorthand and wins over
`defaultParams.sort` when both are present.

## autoRefresh

Seconds (5s floor). A plain interval whose tick SKIPS while: tab hidden,
window blurred, any `<dialog>` open, or a selection is active. No focus
listeners — `refetchOnWindowFocus` is globally off; the next interval tick
catches up. The refresh button spins on any fetch and its tooltip shows
the cadence.

## Row expand / groupBy

`rowExpand(row) => ReactNode` adds the chevron column and a full-width
detail row; single-open unless `rowExpandMultiple`; page changes collapse
rows that left the page. `groupBy(row) => string | null` interleaves
full-width header rows on key change — falsy = ungrouped tail (prior
section continues); labels via `groupHeaderLabel`; styles
`banner|mark|band|rule` (unknown → warn + banner). Labels are sticky so
they stay visible on horizontally-scrolled tables. Use the
`grouping-and-fmt.md` helpers; align the group field with `defaultSort` or
headers repeat (that repetition is the defined behavior, not a bug).

## Export

`exportFormats={['csv','json']}` → server-side export of the WHOLE
filtered set via `download_format` + `filename` (paging stripped).
`exporter(format, normalizedParams)` overrides that path. It receives the same
model-normalized params as the visible query, allowing sensitive domains to use
bounded, immediately sanitized, allowlisted client exports.

## Loading states

Uncached loads (cold, page/sort/filter changes — `isPlaceholderData`)
render the column-matched skeleton silhouette; cached pages render
instantly; background refetches never blank the table. Errors render the
server's message with a Retry. Empty-with-filters offers Clear filters.

## Search

`ExpandingSearch` (exported for reuse): icon at rest → input on focus →
pinned open while holding text; `/` focuses globally; Escape blurs; 300ms
debounce, Enter commits immediately.
