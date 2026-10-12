# ModelTable — the server-driven table

```ts
import { ModelTable, ExpandingSearch, type Column, type Preset, type BatchAction, type RowId, type ModelTableQuery, type ModelTableQueryAdapterProps } from 'portal-mojo/ui';
```

## Row identity

The row constraint is `T extends { id: RowId }` where `RowId = number | string`.
Most django-mojo models use an integer pk, but some declare a 32-char uuid-hex
`CharField` primary key (`jobs.Job`, `jobs.ScheduledTask`) — so selection,
expansion, React keys and `BatchAction` targets are all keyed on the union. An
integer-id table is unaffected; nothing narrows an id back to `number`.

Every sort, filter, search and page is a **wire param the server answers**
— there is no client-side row work (rule #1). Table state lives in the
params store, synced to the URL by default. All features below are opt-in props; a bare
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

## Local params for dialogs and multiple tables

`paramsMode?: 'url' | 'local'` defaults to `'url'`. Use `'local'` for a table
inside a dialog or beside another table on the same route:

```tsx
<ModelTable model={ScheduleModel} title="Schedule" columns={columns}
    paramsMode="local" queryAdapter={ScopedRows}
    fixedParams={{ kiosk: kioskId }} defaultParams={{ size: 5 }} />
```

A local instance starts on page 1 using its own defaults. It does not inherit
the page's search, sort, filters or page size, and its controls never change
the URL or another table's state. It uses the same params store, normalization,
fixed-scope rules, controls and query adapter contract. No nested router is
needed; it remains inside the application's existing router. Choose the mode
at mount; unmount or change the table's React `key` to start fresh.

`persistState` remains **false by default** in both modes. If explicitly enabled
for a local table, saved state overrides its defaults without URL precedence
or URL writes. Its default storage key is `local::${endpoint}`; supply a distinct
`persistKey` for each independent saved view. Fixed params stay excluded from
saved state. A scope change resets that instance to page 1 and clears selection;
use a new React `key` when the entire local view should reset too. Local state
does not itself isolate private rows: the query adapter still owns actor/scope
checks and stale-data clearing.

Components → **Private table query** includes two independent local tables
beside the URL-backed table. Hide and reopen them to test fresh mounting.

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

## Controlled query adapter

`queryAdapter?: ComponentType<ModelTableQueryAdapterProps<T>>` replaces the
built-in list query **entirely**. The default `useModelList` is not mounted:
there is no generic query observer, fetch, or cache entry. Toolbar, filters,
params state, persistence, paging, selection and row rendering stay shared.

```tsx
// Define once, OUTSIDE the page's render; inline component identities remount.
function ScopedRows({ params, enabled, children }: ModelTableQueryAdapterProps<Row>) {
    const query = usePrivateRows(params, enabled); // your scoped request hook
    return children(query);
}
<ModelTable model={RowModel} columns={columns} title="Records"
    queryAdapter={ScopedRows} fixedParams={{ group: groupId }} />
```

The adapter receives:

- `params: Params`: the selected URL or local params, with model normalization applied and
  `fixedParams` merged **last**. Do not create a second table-state store.
- `enabled: boolean`: false until persisted state restores, or while
  `fixedParams === null`. The adapter must honor this gate.
- `children(query)`: render it with `{data?: {rows: T[], count: number},
  status: 'pending' | 'success' | 'error', isFetching: boolean,
  isPlaceholderData?: boolean, error?: unknown, refetch: () => unknown}`.

The adapter owns sanitization, actor/scope identity, cancellation, final-send
checks, cache choice and stale-response rejection. Media capability rows can
stay in component state. Clear `data` synchronously when scope is invalid or
changes; never return the previous actor's rows as current data. Keeping
`data` on an ordinary background error preserves its authorized rows and
shows a Retry alert. Clearing it removes those rows immediately. Pending
scope hides rows and disables Refresh even if a misbehaving adapter retains data.

Refresh and completed batches call the adapter's `refetch`. `autoRefresh`
remains opt-in; no timer is introduced by controlled mode. Controlled exports
require an explicit `exporter`; the generic download path is never used.
Avoid persisting sensitive URL filter values; `persistState` is an explicit
host choice. Live demo: Components → **Private table query**.

## Row activation

With `onRowClick`, the whole row is focusable and responds to click, Enter and
Space. Native nested links, buttons, inputs and other interactive controls
keep their own action; their click/key events do not also activate the row.
The table retains native row/cell semantics.

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

`confirm` is the permission step and takes three forms:

| `confirm` | Behaviour |
|---|---|
| `string` (default `"<label> N item(s)?"`) | `modal.confirm` with that copy; `danger` styles the button. |
| `false` | No prompt. |
| `(rows) => Promise<boolean>` | **Replaces** the built-in confirm — resolve `false` to cancel. `prepare` still runs after it. Open a `confirmGuardrail` here for a batch that takes a tenant dark or can't be undone. |

Ask permission in `confirm`, collect input in `prepare` — don't fold a
guardrail into `prepare` and return `null` to cancel; that conflates
"nothing collected" with "declined".

```tsx
{
    key: 'revoke', label: 'Remove access', danger: true,
    confirm: (rows) => confirmGuardrail({
        title: `Remove access for ${rows.length} members?`,
        effect: <>They lose all access the moment each call lands.</>,
        why: [<>Accounts stay; grants go — re-inviting restores a fresh preset, not the old unlocks.</>],
        confirmText: `Remove ${rows.length}`,
        typeToConfirm: rows.length >= 5 ? String(rows.length) : undefined,
    }),
    run: (row) => revoke(row),
}
```

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
server's message with a Retry and replace the rows for default callers. Only
a controlled adapter may retain authorized current data on a background error,
showing an alert alongside those rows; clearing its data shows the full error
state. Empty-with-filters offers Clear filters.

## Search

`ExpandingSearch` (exported for reuse): icon at rest → input on focus →
pinned open while holding text; `/` focuses globally; Escape blurs; 300ms
debounce, Enter commits immediately.
