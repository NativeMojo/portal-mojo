# params — the table-state store (single source of truth)

```ts
import {
    useTableParams, PAGE_SIZES, registerNonFilterParams,
    readTableState, writeTableState, clearTableState,
} from 'portal-mojo/client';
```

**THE architecture rule:** one flat params object owns search, sort,
filters and paging for a table. It is URL-synced by default (real search string,
hash router safe), drives the server query, the pills, preset matching, and
persistence. Components read it; nothing else holds table state.

## `useTableParams(defaults?, defaultFilters?, excludeKeys?, mode?) → TableParamsApi`

State: `search`, `sort` (`'field' | '-field' | ''`, default `'-created'`
unless `defaults.sort`), `page` (1-based), `size`.

`wire` — the params to hand to `mojoList`: `{start, size, sort?, search?,
...filters}` where `start = (page-1)*size`.

| Method | Semantics |
|---|---|
| `setSearch(term)` | writes `search`, resets page 1 |
| `cycleSort(field)` | asc → desc (`-field`) → off |
| `setFilter(key, value)` | string \| string[] \| null. Arrays collapse: 1 value → `field=`, 2+ → `field__in=a,b`. A field never carries both forms. null clears |
| `setDateRange(field, start, end)` | writes the `dr_field/dr_start/dr_end` triple — ONE active range by construction |
| `removeFilter(f)` / `clearFilters()` | pills & clear-all |
| `applyPreset(params)` / `presetActive(params)` | mutually-exclusive bundles; active state is DERIVED by matching, never stored |
| `setPage(n)` / `setSize(n)` | paging (`PAGE_SIZES = [5,10,25,50,100]`) |
| `applySaved(saved)` | one-shot rehydrate from a persistence blob (below) |

With the default `mode: 'url'`, every write goes through the URL (`replace`), so table state deep-links and
survives reloads by construction. A size equal to the caller's effective
`defaults.size` (10 when omitted) can be omitted from the URL; every other size
is explicit. Thus choosing or restoring 10 with a caller default of 25 writes
`size=10`, and the next render continues to show 10 rows.

`mode: 'local'` selects an empty per-instance `URLSearchParams` held in React
state. All state/filter/wire transformations above remain the same. Local
instances start on page 1 with the supplied defaults, ignore route params,
and never write the URL. Multiple instances on the same route are independent;
changing the outer URL cannot change them. Choose the mode at mount and remount
(or change the owner component's React `key`) to reset. The hook still runs
inside the application's existing router. `TableParamsMode` is exported from
both `portal-mojo/client` and `portal-mojo/client/runtime`.
Unknown runtime mode values fall back to `'url'` with one console warning per
mounted instance; valid and omitted modes do not warn.

## `excludeKeys` — the fixedParams scrub

`useTableParams(defaults, defaultFilters, excludeKeys?)`: keys in the set
never become filter state — dropped from the URL-derived filters memo, the
`defaultFilters` seed, and `applySaved`'s persisted filters. ModelTable
passes its `fixedParams` keys here so locked scope cannot re-enter as a
removable pill via a bookmark or a stale persisted view. This does not
bend the store's rule: the store remains the single source of truth for
table STATE (what the user did); `fixedParams` is table IDENTITY (what
the table is) and deliberately lives outside it, merged onto the wire
after normalization. Pass a render-stable Set — it is a memo dependency.

## `registerNonFilterParams(...keys)` — params the PAGE owns

Everything in the query string that isn't `search/sort/page/size` is treated
as a Django lookup. That is deliberate (any `field__lookup=` deep-links with
no client schema), but it means a **host page's own query param becomes a
filter**: `#/components?demo=filters` shipped `demo=filters` to
`/api/group` — zero rows on the mock, `FieldError` on a live backend — and
kept the "All" preset from ever matching.

Declare such keys once, at module load, before any table renders:

```ts
registerNonFilterParams('demo');   // the component playground's rail key
```

Registered keys are excluded from `filters`, `wire` and the pills, and are
**re-emitted on every write** (each write rebuilds the whole query string,
so without this they would silently vanish the first time a filter changed).
Do not register a name that is also a model field.

## Persistence blob (used by ModelTable's `persistState`)

`readTableState/writeTableState/clearTableState(key)` store
`{v: 2, sort?, size?, search?, filters?, hidden?}` at
`localStorage["mojo:tableview:" + key]`.

Precedence on restore: **URL > saved > defaults** per key — except `size`,
a per-user viewing preference the URL merely echoes, where **saved wins**.
Local instances start with no explicit params, so saved values override
defaults without reading or changing the route. Persistence is still opt-in
through ModelTable's `persistState` (default false); use distinct `persistKey`
values for independent saved views. Fixed keys are excluded in either mode.
Corrupt or other-version blobs are discarded AND cleared. `sort: ''`
(deliberately un-sorted) is not persisted — the default sort returns.

## Pitfalls

- Values are strings on the wire — booleans as `'true'/'false'`.
- Never mutate `wire`; it's derived.
- Don't create a second table-state store (component state, context, redux
  patterns) — that's the exact drift this store exists to prevent.
