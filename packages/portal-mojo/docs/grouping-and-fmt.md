# grouping helpers + formatters

## groupBy* helpers

```ts
import { groupByDay, groupByField, groupByRecency, groupByBoolean } from 'portal-mojo/ui';
```

Each returns `{groupBy, groupHeaderLabel}` — spread straight into
ModelTable props: `{...groupByRecency<User>('last_activity')}`. Keys are
STABLE bucket ids (sort-ordered where it matters); labels format
separately. A null key = ungrouped tail (no header; the prior section
continues). All date helpers accept epoch seconds / ms / ISO / Date.

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

| Fn | Notes |
|---|---|
| `fmt.date(v)` / `fmt.datetime(v)` | `MM/DD/YYYY` / `Mon D, YYYY h:mm` — accepts **epoch seconds** (the django-mojo wire shape), ms, ISO, Date; `—` fallback |
| `fmt.relative(v, fallback='Never')` | "3 weeks ago" style |
| `fmt.initials(name)` | 1–2 letters; null-safe (`'?'` for empty — live rows carry `display_name: null`) |
| `fmt.inferTone(value)` | status text → Badge tone ('active'→success, 'banned'→danger, booleans, …) |

Formatters NEVER throw on bad input — they degrade (rule: a formatter is
the last thing allowed to take down a row).

`Badge`: `<Badge tone="success|warning|danger|info|muted|primary">` from
`portal-mojo/ui` — the standard status chip.
