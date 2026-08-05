# TimezoneSelect — the IANA zone picker

```ts
import {
    TimezoneSelect, localTimezone, resolveTimezone, FALLBACK_TIMEZONES,
    type TimezoneChangeEvent, type TimezoneSelectProps,
} from 'portal-mojo/ui';
```

A searchable timezone field: the house [`ComboBox`](combobox.md) with
`allowCustom: false`, options built from the engine's IANA zone list, each
label annotated with the zone's **current** UTC offset. Ported from
web-mojo `src/core/forms/inputs/TimezoneSelect.js`. Used standalone and
embedded by the time pickers (#1269 TimePicker, DateTimePicker).

## API

```ts
<TimezoneSelect
    value={zone}                       // committed IANA string | null
    onChange={({value, oldValue}) => …} // COMMIT only, real changes only
    timezones={['UTC', 'Europe/London']} // fixed list overrides the engine
    defaultToLocal                     // default true — empty displays the local zone
    name="timezone"                    // renders a hidden input (native form posts)
    placeholder disabled required maxSuggestions id className
/>

interface TimezoneChangeEvent { value: string; oldValue: string | null }

localTimezone(): string                                  // 'UTC' when the engine can't say
resolveTimezone(value, { timezones?, defaultToLocal? })  // → the EFFECTIVE zone (getFormValue)
FALLBACK_TIMEZONES: readonly string[]                    // the curated 48
```

`maxSuggestions` defaults to the **whole list** (source parity — web-mojo's
combobox scrolled every zone and never capped); pass a number to trim.

## The zone list

1. `timezones` prop, in the order given, when it is a non-empty array.
2. else `Intl.supportedValuesOf('timeZone')` — ~418 zones, resolved once per
   session and cached. `UTC` is prepended when absent: V8 omits it, and a
   django-mojo portal whose picker cannot choose UTC is broken (a deliberate
   one-line deviation from source; the curated list leads with UTC too).
3. else `FALLBACK_TIMEZONES` (the curated 48, verbatim from web-mojo) with
   ONE module-level `console.warn` — once per page load, not per instance.

**The committed zone is always in the list**, prepended when the resolved
list lacks it. This is not a nicety — V8 reports ICU-canonical ids
(`Asia/Calcutta`, `Europe/Kiev`, `Asia/Saigon`, `America/Godthab`,
`Asia/Rangoon`, `America/Buenos_Aires`) while Python/`zoneinfo` — and
therefore django-mojo — stores the modern IANA primaries (`Asia/Kolkata`,
`Europe/Kyiv`, …). Without the prepend, a stored `Asia/Kolkata` rendered
unlabelled and could not be re-selected: the user had to change the zone to
save the record. Engines accept the aliases as *input*, so those entries get
a proper offset label.

## Labels: offset annotation

`America/New_York (UTC−05:00)` — `dateFns.ianaOffset` does the
`formatToParts` / `timeZoneName: 'shortOffset'` work (`GMT`/`UTC` → `+00:00`,
hours zero-padded, minutes defaulted), and the sign is rewritten to a
**Unicode minus** (U+2212) for negatives. A zone the engine rejects labels as
its bare name — never nothing.

**Labels recompute on open.** web-mojo built them once at mount, so a
long-lived picker kept showing pre-DST offsets. Here every gesture that can
open the list (focus, pointer-down, ArrowDown on the wrapper) stamps a new
reference instant, keyed into the label `useMemo`; the stamp coalesces to one
update per second, because a single open is several DOM events and a second
is far finer than any DST transition. Full relabel of ~420 zones is ~10ms,
paid on open only.

## Values: commit-only, and the local default

`onChange` fires on a **commit** — clicking an option, Enter on the
highlighted one, or blurring onto an exact zone name — and only when the zone
actually changed. `allowCustom` is `false`, so typed filter text is a draft
that reverts: it can never become a value. This is the bug that mattered —
web-mojo's ComboBox emitted per keystroke, so fragments like `"Amer"` reached
the picker's value and FormView's 300ms autosave saved them.

The field is **fully controlled** (one pipeline, no internal value state).
The default is a *display* resolution, not a commit:

```
effective = value || (defaultToLocal ? defaultZone : null)
defaultZone = localTimezone(), except: a caller-supplied `timezones` list
              that lacks the local zone falls back to its FIRST entry
```

- `getFormValue` semantics = `resolveTimezone(value, {timezones, defaultToLocal})`
  → a plain IANA string, or `null` (never the offset label). The `name` prop's
  hidden input posts exactly that.
- An empty `value` therefore *displays* the local zone while the owner's state
  is still `null`. That is deliberate: emitting a commit on mount would mark a
  form dirty and trip inline autosave for a zone the user never chose. Seed
  state with `localTimezone()` when you need state and display identical from
  the first paint.
- `oldValue` is the previously **displayed** (effective) zone, so a default
  that was never committed still reports honestly.

## Embedding (TimePicker / DateTimePicker)

The mount seam is `{ value, onChange, timezones?, disabled?, name?, placeholder? }`
— exactly what web-mojo's TimePicker/DateTimePicker passed
(`timezone: true | string[]` collapses to `timezones` at the call site; a
`timezone` prop of `true` means "show the picker", the array form means "show
it with this fixed list"). Hosts render the offset-annotated field inline
under their time strip.

Until the field-type registry (#1278) wires this in, the time-picker port may
be rendering a plain `<select>` fallback in that slot; swapping it for
`<TimezoneSelect>` is a drop-in — value in, value out, same IANA string.

## Invariants / fixed web-mojo bugs (do not reintroduce)

- **Commit-only value** — inherited by construction from ComboBox plus
  `allowCustom: false`; there is no per-keystroke path to `onChange`.
- **Offsets are recomputed, not frozen at mount** (DST correctness).
- **One warn, once** — the no-Intl fallback warns at module level, not per
  instance and never per render.
- The value is always a plain IANA string; the offset lives only in the
  label. Never post or store the label.

## Pitfalls

- `Intl.supportedValuesOf('timeZone')` does **not** contain `GMT`, and (in
  V8) not `UTC` either — hence the prepend. Other aliases (`US/Eastern`,
  `Etc/GMT+5`) are not browsable either: they work as a *value* (prepended,
  labelled) but a user cannot discover them. Pass `timezones` if a deployment
  needs them listed.
- A zone the engine cannot resolve **at all** (`ianaOffset` → null, e.g. the
  fallback list's bogus `America/Honolulu`) warns once per instance/value and
  is displayed verbatim, unlabelled — house rule 4's signal that stored data
  is wrong. An alias the engine *accepts* never warns.
- `FALLBACK_TIMEZONES` is verbatim from source, warts included:
  `America/Honolulu` is not a real IANA zone (`Pacific/Honolulu` is, and is
  also in the list). It labels bare instead of throwing. The list is only
  reachable on engines without `Intl.supportedValuesOf`.
- An empty `timezones={[]}` means "no override" (source parity), not "no
  zones".
- No stylesheet ships: the wrapper `.tz-select` is an unstyled hook and every
  pixel comes from `apps/portal/src/theme/combobox.css`, which consuming apps
  must include.
- The dropdown is ComboBox's locally-positioned list — inside
  `overflow:hidden` containers it clips (MERGE-WIRE: Popover primitive #1271).
