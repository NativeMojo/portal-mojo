# ModelTable — the server-driven table

```ts
import { ModelTable, ExpandingSearch, type Column, type Preset, type BatchAction } from 'portal-mojo/ui';
```

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
    selectable batchActions={BATCH}
    columnChooser persistState persistKey="users"
    exportFormats={['csv', 'json']}
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

## Filters (see also forms.md dialog types)

`FilterDef` types: `text` (`__icontains`), `select`, `multiselect`
(collapses to `field__in`), `boolean` (`trueLabel`/`falseLabel`), `number`
(`__gte`), `daterange` (the `dr_*` triple). Applied filters render as
editable pills; presets are param bundles with DERIVED active state.

## Selection + batch

`selectable` renders checkboxes independently of `batchActions` (decoupled
by design). Select-all covers the current page, with an indeterminate
state. Selection clears when the wire params change (page/sort/filter).

`BatchAction<T> = { key, label, icon?, danger?, confirm?: string | false,
prepare?, run }`. Runner semantics (TablePage.batchAction port): confirm →
optional once-per-batch `prepare()` (resolve null to cancel; its value is
passed to every run — e.g. collect ONE disable reason) →
`Promise.allSettled(rows.map(run))` → toasts `"Label: N item(s) updated"`
/ `"N succeeded, M failed"` (warning) / `"failed for all N"` → always
clear selection + invalidate.

## Column chooser + persistState

`columnChooser` adds the Columns dropdown; hidden set is view state, never
a mutation of your `columns` array. `persistState` remembers sort / size /
search / filters / hidden columns per table (`persistKey`, else
route+endpoint) — precedence URL > saved > defaults, saved `size` wins; the
first fetch waits for the restore so it queries the restored view.
"Reset to defaults" in the chooser clears the whole saved view.

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

## Loading states

Uncached loads (cold, page/sort/filter changes — `isPlaceholderData`)
render the column-matched skeleton silhouette; cached pages render
instantly; background refetches never blank the table. Errors render the
server's message with a Retry. Empty-with-filters offers Clear filters.

## Search

`ExpandingSearch` (exported for reuse): icon at rest → input on focus →
pinned open while holding text; `/` focuses globally; Escape blurs; 300ms
debounce, Enter commits immediately.
