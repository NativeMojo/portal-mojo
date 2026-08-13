# grouping helpers + formatters

## groupBy* helpers

```ts
import { groupByDay, groupByField, groupByRecency, groupByBoolean } from 'portal-mojo/ui';
```

Each returns `{groupBy, groupHeaderLabel}` — spread straight into
ModelTable props: `{...groupByRecency<User>('last_activity')}`. Keys are
STABLE bucket ids (sort-ordered where it matters); labels format
separately. A null key = ungrouped tail (no header; the prior section
continues). All date helpers parse through `date/fns detectTemporal`, so
they accept **every** shape django-mojo emits: epoch seconds, epoch
milliseconds, either as a numeric string (JSONField metadata routinely
carries these), `'YYYY-MM-DD'`, `'YYYY-MM'`, `'YYYY'`, full ISO with `Z` or
an offset, IANA-tailed wall times, and `Date`. A 4-digit numeric string is
read as a **year**, never an epoch. Anything unrecognizable degrades to the
fallback — a formatter never throws.

| Helper | Buckets |
|---|---|
| `groupByDay(field \| accessor)` | local `YYYY-MM-DD`; labels Today / Yesterday / Apr 25 / Dec 19, 2025 |
| `groupByRecency(field)` | Today / Yesterday / This week / This month / Earlier this year / Older — keys sort so `-date` order reads top-down |
| `groupByField(field, {labels?, format?, fallback?})` | categorical on `String(raw)`; `labels` wins over `format`; `fallback` names the empty bucket (default: tail). `0`/`false` DO bucket |
| `groupByBoolean(field, {trueLabel?, falseLabel?})` | binary; string-false forms (`'false','0','no','off'`) coerce false; missing → tail |

Align the grouped field with the table's sort — grouping runs in render
order, so a mismatched sort repeats headers per key change (defined
behavior).

## fmt

```ts
import { fmt } from 'portal-mojo/ui';
```

The complete `DataFormatter.js` FUNCTION set, typed. Deliberately absent:
the **pipe-string parser** (`"filesize|muted"` — do-not-recreate: it defeats
the type checker and was the source's silent-failure vector) and the
**HTML-emitting** formatters (badge/avatar/linkify/clipboard/tooltip/status)
— those are components, not formatters.

### Dates

| Fn | Notes |
|---|---|
| `fmt.date(v, fallback='—')` / `fmt.datetime(v, fallback='—')` | `MM/DD/YYYY` / `Mon D, YYYY h:mm` — accepts **epoch seconds** (the django-mojo wire shape), ms, ISO, Date |
| `fmt.relative(v, fallback='Never')` | "3 weeks ago" style |
| `fmt.relativeShort(v, fallback='—')` | compact age for chips: `now` / `5h` / `3d` / `3w` / `2mo` / `1y`. **Magnitude only** — a future date reads the same as a past one (use `relative` when direction matters). Source boundaries kept (`>`, not `>=`): 7d is `7d`, 8d is `1w` |

### Numbers

| Fn | Notes |
|---|---|
| `fmt.number(v, decimals=0, fallback='—')` | thousands separators: `1234567` → `1,234,567`. *Deviation:* source defaulted to 2 decimals; portal columns are counts |
| `fmt.currency(v, code='USD', {unit, decimals, fallback})` | `129900` → `$1,299.00`. **Input is CENTS by default** — django-mojo stores money as integer minor units (`cents_to_currency`) so it never touches a float; pass `{unit:'major'}` for a dollars value or a zero-decimal currency (JPY). *Deviation:* arg 2 is an ISO **code**, not a symbol — the source's own callers passed `currency("EUR")` and got `EUR1,299.00`. An unknown code warns once and falls back to USD. **End-to-end rule: ALL money crosses the wire as integer minor units — format at the edge, never pre-convert.** Troubleshooting: amounts 100× small = you passed dollars; 100× large = you passed cents with `unit:'major'` |
| `fmt.percent(v, decimals=0, multiply=true, fallback='—')` | `0.856` → `86%`; `multiply=false` when the value is already a percentage |
| `fmt.compact(v, decimals=1, fallback='—')` | `1234` → `1.2K`, `3400000` → `3.4M`. Uppercase K/M/B (source casing); caps at B, so `1e12` reads `1000.0B`. Below 1,000 the raw number passes through unseparated |
| `fmt.filesize(v, binary=false, decimals=1, fallback='—')` | `1536` → `1.5 KB`; `binary` switches to 1024/`KiB`. Whole bytes stay integral (`999 B`); caps at TB. Negatives degrade readably (`-500 B`) |
| `fmt.ordinal(v, suffixOnly=false, fallback='—')` | `3` → `3rd`, `11` → `11th`. *Deviation:* the suffix is computed on the absolute value, so `-1` → `-1st` (source made every negative `th`) |

### Strings

| Fn | Notes |
|---|---|
| `fmt.truncate(v, length=50, suffix='...', fallback='—')` | cuts to `length` **then** appends the suffix, so the result runs longer than `length` (source behavior) |
| `fmt.truncateMiddle(v, size=8, replace='***', fallback='—')` | keeps both ends: `d41d***427e` — ids stay recognizable. `size` is the TOTAL kept, split in half |
| `fmt.truncateFront(v, length=8, prefix='...', fallback='—')` | keeps only the TAIL: `...2eZvKY` |
| `fmt.mask(v, char='*', showLast=4, fallback='—')` | all-but-last-4: `************1111`. Values no longer than `showLast` return intact. *Fixes a source bug:* `showLast:0` masked the string and re-appended it whole (`slice(-0)` is `slice(0)`) |
| `fmt.slug(v, separator='-')` | **fallback is `''`**, not `—` (a slug of nothing is nothing). *Deviations:* accents fold to ASCII (`Café` → `cafe`, matching django-mojo's `strip_accents`) instead of being dropped (`caf`); the separator is regex-escaped — the source interpolated it raw, so `slug(v,'.')` misbehaved and `slug(v,'')` threw on an empty quantifier |
| `fmt.code(v, fallback='')` | **FK-safe display for coded wire fields.** django-mojo graphs expand FK fields per-graph — the same field is `"GC"` on one graph, `{id, code, name, …}` on another, and the bare pk when the graph omits it. `code()` renders every shape: string → itself, expanded row → `.code` ?? `.name`, pk number → `"3"`. **Fallback is `''`** (like `slug`) so it composes into template strings; cells that want `—` pass it explicitly. An object with no usable code/name warns once and returns the fallback. *Deviation from the wmx-admin-v2 `codeOf` source:* a pk number renders as its digits, not `''` — an unexpanded FK is data |
| `fmt.phone(v, fallback='—')` | **DISPLAY ONLY.** E.164 (`+15555550142`) stays the wire shape — django-mojo REJECTS pretty formats on save, so never round-trip this into a field. US 10/11-digit → `(555) 555-0142` / `+1 (555) 555-0142`; anything else (a real international number) is returned trimmed and unchanged. *Deviation:* the source stripped the leading `+`, turning valid E.164 into digit soup. No `<a href="tel:">` — links are components |

### Duration + booleans

| Fn | Notes |
|---|---|
| `fmt.duration(v, unit='ms', {short, precision, fallback})` | `8040000` → `2h 14m`; `duration(8040,'s')` is the same. `unit` ∈ `ms\|s\|m\|h\|d` (unknown → `ms` + one `console.warn`). `precision` (default 2) caps the unit count; sub-second values report `500ms`. *Deviations:* short form is the DEFAULT (source: long — get it with `{short:false}` → `2 hours 14 minutes`) and its parts are space-separated (source: `2h14m`) |
| `fmt.yesNo(v, {yes, no, fallback})` | `Yes`/`No`; string-false forms (`'false','0','no','off'`) and empty arrays/objects read false — the same coercion table as `groupByBoolean`. **null/undefined/`''` → `—`**: unset is not the same answer as "No" |

### Tone

| Fn | Notes |
|---|---|
| `fmt.initials(name)` | 1–2 letters; null-safe (`'?'` for empty — live rows carry `display_name: null`) |
| `fmt.inferTone(value)` | status text → Badge tone ('active'→success, 'banned'→danger, booleans, …) |

### FK fields change shape per graph — render them through `fmt.code`

A raw object rendered as a React child crashes the page (`Objects are not
valid as a React child`), and django-mojo makes that a live hazard: the
backend controls graph definitions, so a field your column renders as a
string can start arriving as an expanded row object without any frontend
change. wmx-admin-v2 white-screened a production table exactly this way.
Any FK-ish field (`currency`, `group`, `owner`, …) rendered in JSX goes
through `fmt.code(value)` — or a `render` callback that handles both
shapes. The shared primitives (ModelTable cells, DetailView sections and
badges, the card formatter hooks) degrade to a readable value plus one
`console.warn` instead of crashing (see `safeNode`/`RenderGuard` in the
ModelTable doc), but app-composed JSX outside those paths is on its own —
use the formatter.

Formatters NEVER throw on bad input — they degrade (rule: a formatter is
the last thing allowed to take down a row). Every one is null/undefined-safe,
parses strictly (`"12 items"` is NOT 12 — it degrades, unlike the source's
`parseFloat`), and formats at a fixed `en-US` locale rather than the
browser's. The trailing `fallback` param (or `opts.fallback`) overrides the
`—`; pass `''` when composing strings rather than filling a cell.

Live gallery: **Develop → Components → Formatters**.

`Badge`: `<Badge tone="success|warning|danger|info|muted|primary">` from
`portal-mojo/ui` — the standard status chip.
