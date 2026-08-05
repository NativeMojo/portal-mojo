# DataView — the inferred record grid

```tsx
import { DataView, JsonBlock, inferFieldType, type DataViewField } from 'portal-mojo/ui';

<DataView data={user} />                              // schemaless: infer everything
<DataView data={user} fields={SCHEMA} />              // explicit schema
```

Point it at any record and get a sensible detail grid. Field **names** and
**values** together pick the renderer, nested objects become nested grids,
and anything that isn't a scalar lands in a JSON block with copy and
collapse. Port of web-mojo `src/core/views/data/DataView.js` (1,153 lines).
Styles: `apps/portal/src/theme/dataview.css`. Demo: **Develop → Components →
DataView**.

## DataView vs KnownFieldsCard

They look similar and solve opposite problems. Both often appear on the
same page.

| | Input | Which keys | Unknown keys |
|---|---|---|---|
| **`DataView`** | a whole **record** (`user`, `job`, `incident`) | **all of them**, inferred | inferred too — that is the point |
| **`KnownFieldsCard`** | one **blob** column (`metadata`, `ip_info`, `payload`) | only the **curated** `known` list you pass | left in the raw `<details>` below |

Rule of thumb: `DataView` when you don't know (or don't want to enumerate)
the shape; `KnownFieldsCard` when you know exactly which few keys matter
and the rest is an open bag. `<DataView data={record} />` +
`<KnownFieldsCard data={record.metadata} known={…} />` is a normal pairing.

## Props

| Prop | Default | Effect |
|---|---|---|
| `data` | — | the record. `null`/`undefined` is safe (renders `emptyText`) |
| `fields` | inferred | explicit schema; omit for full inference over `Object.keys(data)` |
| `exclude` | `[]` | keys to drop. Applies in **both** modes |
| `columns` | `2` | grid columns at full width |
| `showEmptyValues` | `true` | `false` restores the source behavior: an empty value drops its row |
| `emptyValueText` | `'—'` | rendered for an empty value |
| `emptyText` | `'No data.'` | shown when nothing is renderable |
| `maxDepth` | `2` | levels of **nested** DataView below this one; deeper → JSON block |
| `depth` | `0` | internal recursion counter — callers leave it alone |

**Ordering is stable**: the schema's order, or the record's own key order
(`Object.keys`, i.e. insertion order).

### `DataViewField`

```tsx
const SCHEMA: DataViewField[] = [
    { name: 'display_name', label: 'Name' },
    { name: 'settings.theme', label: 'Theme' },                    // dotted path
    { name: 'plan_amount', label: 'Plan', type: 'currency' },      // declared renderer
    { name: 'trust_score', format: (v) => <b>{Number(v).toFixed(1)} / 10</b> },
    { name: 'bio', span: 'full' },
    { name: 'last_error', hideEmpty: true },
];
```

- `name` — a **dotted path** (`settings.theme`); an own property of that
  literal name wins over traversal (KnownFieldsCard's rule).
- `label` — defaults to the humanized last path segment (`created_at` →
  `Created At`, `lastLogin` → `Last Login`).
- `type` — names a built-in renderer, skipping inference. An unknown value
  **warns and infers** — never renders nothing (rule 4).
- `format(value, name, data)` — replaces the renderer entirely; returns any
  `ReactNode`. Same signature as `KnownFieldsCard`'s.
- `span` — `'full'` spans the grid; `'auto'` (default) is full only for
  arrays / objects / nested grids.
- `hideEmpty` — drop the row instead of showing `—`.

## Inference — the heuristics

Two exported pure functions carry it, usable on their own:
`inferFieldType(value, key)` and `shouldUseDataView(value, keyLower)`.

**Order matters** — the first match wins:

| # | Test | Type |
|---|---|---|
| 1 | `value == null` | `text` |
| 2 | `typeof value === 'boolean'` | `boolean` |
| 3 | key starts `is_`/`has_`/`can_`/`should_` **and** value is boolean-ish (`0`/`1`/`"true"`/`"yes"`…) | `boolean` |
| 4 | key contains `date`, `time`, `created`, `updated`, `modified`, `last_login`, `expires`, `last_activity`, or **ends in `_at`** | `datetime` |
| 5 | key contains `email` / `mail` | `email` |
| 6 | key contains `url` / `website` / `homepage`, or has the word `link` | `url` |
| 7 | key contains `phone` / `mobile`, or has the word `tel` / `cell` | `phone` |
| 8 | key contains `price` / `amount` / `salary` / `revenue`, or has the word `cost` / `fee` | `currency` |
| 9 | key has the word `size` / `bytes` / `filesize` | `filesize` |
| 10 | (key contains `percent` or has the word `rate` / `ratio`) **and** value is a number | `percent` |
| 11 | `typeof value === 'number'` | `number` |
| 12 | array | `array` |
| 13 | object with `renditions` | `file` |
| 14 | object passing `shouldUseDataView` | `dataview` |
| 15 | any other object | `object` |
| 16 | string `"…@….…"` / `^\d{4}-\d{2}-\d{2}` / `^https?://` / phone-shaped **with ≥7 digits** | `email` / `date` / `url` / `phone` |
| 17 | anything else | `text` |

"contains" is a substring test (the source's); "has the word X" is an exact
**token** match after splitting the key on `_`, `-` and camelCase humps —
see *Deviations* for why.

### `shouldUseDataView` — nested grid or JSON?

An object gets a nested `DataView` when **either**:

1. it carries an `id` — it's a related record; or
2. its key contains one of `permissions perms access rights settings config
   configuration options profile info details data metadata meta attributes
   props preferences prefs user_data contact address location stats
   statistics metrics counts`, **and** it has 2–20 keys, **and** no child of
   it is an object with more than 3 keys.

Everything else is a JSON block. That last clause is the source's: one
deep child disqualifies the whole object, on the theory that a grid of
grids stops being readable.

### What each type renders

| Type | Rendering |
|---|---|
| `datetime` | `fmt.relative` for `last_*`/`*ago*`/`*relative*`; `fmt.datetime` for a `time`-not-`date` key; else `fmt.date` |
| `date` | `fmt.date` |
| `email` | `<a href="mailto:…">` |
| `url` / `file` | `<a target="_blank" rel="noopener noreferrer">` + external-link icon |
| `phone` | `<a href="tel:…">` around `fmt.phone` (digits + `+` only in the href) |
| `currency` | `fmt.currency`; `EUR`/`GBP` from the key, else `USD`. **Integer → cents, fractional → major units** |
| `filesize` | `fmt.filesize` (decimal KB/MB/GB) |
| `percent` | `fmt.percent`; **`\|v\| ≤ 1` is scaled ×100**, anything larger is already a percentage |
| `number` | `count`/`total`/`followers`/`views` → `fmt.compact` at ≥1000 else `fmt.number`; `score`/`rating` → `fmt.number(v, 1)` when fractional; `version` / the word `id` → verbatim; else `fmt.number` |
| `boolean` | `<Badge tone="success\|muted">Yes/No</Badge>` — the house treatment, via `fmt.yesNo` |
| `text` | `description`/`content`/`body` → truncate 200/100; `summary`/`excerpt` → 150; `username`/`slug`/`handle`/`login` → verbatim monospace; `name`/`title`/`label` → `.cap` + truncate 50; `code`/`token`/`key`/`secret` → monospace, `fmt.mask` over 20 chars; else truncate 100 |
| `array` | scalars join with `, `; objects → `Array · N items` in a collapsed `JsonBlock` |
| `object` | `JsonBlock` |
| `dataview` | nested `<DataView>` (tinted inset) until `maxDepth`, then `JsonBlock` |

Truncated text keeps the full value on a `title` attribute.

## JsonBlock

```tsx
<JsonBlock value={payload} />                                    // auto
<JsonBlock value={payload} label="Request trace" collapsible defaultOpen />
```

| Prop | Default | Effect |
|---|---|---|
| `value` | — | anything JSON-serializable |
| `label` | `Object` / `Array · N lines` | caption override |
| `collapsible` | `>10 lines \|\| >500 chars` (source rule) | force the Show/Hide affordance |
| `defaultOpen` | `false` | start expanded when collapsible |

- **Syntax highlighting is real tokenization**, not regex-over-HTML:
  `tokenizeJson()` walks the string emitting `key` / `string` / `number` /
  `boolean` / `null` / `plain` tokens, rendered as React `<span>`s. **No
  `dangerouslySetInnerHTML`.** The token stream reassembles to the exact
  input, so a value like `"has a colon: and \"q\""` colors correctly (the
  source's five regexes did not).
- Copy writes with the async Clipboard API, toasts on success, flips the
  icon to a check for 1.2s, and toasts an error if the write rejects.
  Outside a secure context `navigator.clipboard` is absent — it says so
  rather than silently no-op'ing through `document.execCommand`.
- A circular payload renders a muted `[Object] — cannot display as JSON`.
  Nothing here throws.

## Invariants

1. **A renderer is the last thing allowed to take a record down.** Every
   per-field render is wrapped: a throw becomes a `console.warn` plus the
   plain `String(value)`. `fmt.*` never throws either.
2. **Empty is `—`, not absent** (`emptyValueText`). `null`, `''`, `[]` and
   `{}` all read empty. `showEmptyValues={false}` or `hideEmpty` opt out.
3. **Unknown `type` warns and infers** (rule 4) — never renders nothing.
4. **`ReactNode` in, `ReactNode` out.** No HTML strings anywhere (rule 6).
5. **Epoch SECONDS** are handled by `fmt.*`; don't pre-convert.
6. **Depth is capped.** `maxDepth` (default 2) bounds nesting, so a
   pathological payload degrades to JSON instead of recursing.

## Pitfalls

- **Money is CENTS when it's an integer.** django-mojo stores minor units,
  so `plan_amount: 129900` → `$1,299.00` while `overage_price: 4.75` →
  `$4.75`. A record that breaks that convention needs an explicit
  `format`.
- **Percent auto-scales below 1.** `error_rate: 0.0182` → `2%`;
  `error_rate: 12` → `12%`. A ratio that legitimately exceeds 1 needs an
  explicit `format`.
- **The name wins over the value.** `contact_email: 1234` still renders a
  `mailto:` link — that is the source's contract, and it is what makes
  schemaless inference useful on sparse rows. Declare a `type` (or a
  `format`) on any field whose name lies.
- **No pipe strings.** `format: "date('MMM D')|capitalize"` does not exist
  here (do-not-recreate); nor does the source's inline `name: 'is_tor|
  status_text'` syntax. Use `type` or a function.
- **`fmt.capitalize` doesn't exist**, so `name`-ish fields get the `.cap`
  class — CSS capitalization, which leaves the stored value intact.
- Container queries do the reflow off the grid's **own** width, so a
  DataView inside a modal or a detail rail stacks correctly without
  knowing the viewport.

## Deviations from web-mojo

Beyond the pipe engine and trusted HTML (both architecture rules), these
are behavior changes, each a source bug:

| Source | Here |
|---|---|
| `percent \|\| rate \|\| ratio && number` — `&&` binds tighter, so `rate` matched any type, and `includes()` matched **inside words**: `duration` contains "ratio" (8040 → `804,000%`), `generated` contains "rate" | short needles (`rate` `ratio` `size` `bytes` `tel` `cell` `cost` `fee` `id` `key` `code` `link` `label` `body`) match on **word boundaries**, and the number guard covers the whole percent branch |
| `typeof value === 'boolean'` tested **after** the name chain, so `is_email_verified: true` → `mailto:true` | booleans are typed first, before any name pattern |
| `/^\+?[\d\s\-()]+$/` made `"42"` and `"2024"` tel: links | a phone string needs ≥7 digits |
| `username` contains `name`, so it hit the capitalize branch and the `slug` branch below was unreachable for it — and `slug` rewrote `ian.starnes` to `ianstarnes` | identifiers are checked first and render **verbatim** in monospace |
| an empty value **dropped its row**, so a record's shape changed with its data | `showEmptyValues` defaults `true`; `—` is the house empty |
| `shouldUseDataView`'s `id` rule was gated on `window.utils`, a global absent in half of web-mojo's entry points | the rule always applies |
| no `file` renderer — `{renditions}` objects stringified to `[object Object]` | anchor to `url` with `name`/`filename`, else a JSON block |
| unbounded nesting | `maxDepth`, then JSON |
| JSON "highlighting" = 5 regexes over escaped HTML with hardcoded light-mode hexes (`#0969da`, `#0a3069`, …) injected as `innerHTML` | a real tokenizer → React spans over theme tokens, correct in both themes |

Not ported (deliberately): `model` binding and the `change` re-render
listener (TanStack Query owns reactivity — pass `data` from a hook),
`updateData`/`updateFields`/`updateConfig`/`refresh` (props, not
imperative setters), `setFieldFormat`/`addFormatPipe`/`clearFieldFormat`/
`getFieldFormats` (the fluent pipe-string API), `{{key}}` template
strings, and the `field:click` event (`data-field` is still on each item
for tests and CSS).
