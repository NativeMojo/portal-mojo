# forms — the Field language, SchemaForm, formModal, FormView (autosave)

```ts
import {
    SchemaForm, SchemaSelect, formModal,
    FormView, registerFormTabs, getFormTabs,
    type Field, type FormData, type FormTab,
} from 'portal-mojo/ui';
import { useFormAutosave, resolveShowWhen } from 'portal-mojo/ui'; // the machine, standalone
// Field/FormData/ModelForm/FieldValues/ShowWhen TYPES also export from
// 'portal-mojo/client' — model definitions carry form configs as plain data.
```

Two surfaces over ONE field language:

- **SchemaForm / formModal** — submit-style (create dialogs, action forms).
- **FormView** — the inline-autosave surface bound to a server row via
  `defineModel`. **No save buttons**; edits save themselves.

## The `Field` language (data, not JSX)

```ts
interface Field {
    name: string;              // wire key; DOTTED names read/write nested dicts
    type: FieldType;           // 6 builtins + every registry type (below) + (string & {})
    label: string;
    placeholder?: string;
    required?: boolean;        // SchemaForm submit validation
    help?: string;
    columns?: 6 | 12;          // grid halves / full row
    options?: FieldOption[];   // select/multiselect/combo: {value, label, description?, disabled?}
    showWhen?: ShowWhen;       // conditional visibility (both surfaces)
    schema?: ZodType;          // per-field zod validation (FormView commits)
    disabled?: boolean;        // registry types
    // …plus the registry-type props (precision, outputFormat, presets,
    // model/endpoint, timezone, maxTags, …) — see "Field-type registry".
}
type FormData    = Record<string, FieldValue>;               // SchemaForm values
type FieldValue  = string | number | boolean | null | Array<string | number>;
type FieldValues = Record<string, FieldValue>;               // FormView values
type ShowWhen    = { field; value; negate? } | ((values: FieldValues) => boolean);
```

**Builtins** — rendered inline by both surfaces, byte-for-byte the pre-B4
behavior: `text` `email` `tel` `select` `switch` `textarea`. Every other
type resolves through the **field-type registry** (below).

`ModelForm = { title, fields, submitText? }` — the shape `defineModel`
carries (`UserModel.forms.create`) and `formModal` renders.

### showWhen (both surfaces, one pipeline: `resolveShowWhen`)

Declarative rule = web-mojo FormBuilder semantics: the controlling field's
current value is `String()`-coerced and matched against `value`
(scalar or list); `negate` flips. Or pass a predicate over the live values.
**Hidden fields don't submit/save, and their pending edits + errors clear.**

### Per-field zod (`schema`)

Validated at COMMIT against the display value (string for text-ish types,
boolean for switch). A failing parse **blocks the save of that field only** —
the first issue's message shows in the field's error slot; other fields keep
saving. The server stays authoritative: values zod allows can still be
rejected server-side (and then revert — below).

## SchemaForm

`<SchemaForm fields initial? submitText? onSubmit onCancel? />` — fully
controlled; validates required + email format on visible fields; async
`onSubmit` gets a busy state and surfaces thrown errors as the form alert.
showWhen-hidden fields don't render, don't validate, and are stripped from
the submitted payload.

**Select semantics (the rule-4 fix):** display always equals state. While
the value is `''` (unset) the select shows a real disabled placeholder; an
initial value not among the options warns once and shows the placeholder.
`SchemaSelect` is exported — FormView renders selects through the same
component. One select implementation, one value pipeline.

## formModal

```ts
const data = await formModal({ ...UserModel.forms.create!, initial?, intro? });
if (!data) return;   // cancelled → null
```

## FormView — inline autosave

```tsx
<FormView
    model={UserModel}          // Pick<ModelDef, 'useSave'> — the batch POST
    row={user}                 // current server row (snapshot + revert target)
    fields={PROFILE_FIELDS}    // flat fields, and/or:
    tabs="user.permissions"    // registry name — or inline FormTab[]
    debounceMs={300}           // batch window (default 300)
    savedFlashMs={1500}        // saved-check duration (default 1500)
    onSaved={({ changes, fields, row }) => …}
    onSaveError={({ changes, fields, error }) => …}
/>
```

### The autosave lifecycle (the machine: `useFormAutosave`)

1. **Commit, never keystroke.** Text/textarea update the draft per keystroke
   (dirty dot) but COMMIT on blur — text also on Enter. Selects and switches
   commit on change. This is by construction: web-mojo's per-keystroke
   `input` autosave saved partial text (the ComboBox "Amer" leak).
2. **300ms batch.** Each accepted commit (re)arms one window; commits inside
   it coalesce. The batch POSTs **one save with only the changed fields**
   (change-detection against the server snapshot: trimmed-string compare,
   strict boolean for switches — `42` vs `'42'` and `null` vs `''` are not
   changes).
3. **Serialized.** While a POST is in flight, further commits queue the next
   batch; completion re-arms the window. Never two saves interleaved for one
   form. (web-mojo's `isSaving` guard silently dropped the queue — fixed.)
4. **Indicators** ride the label row: dirty dot → spinner (queued + in
   flight) → saved check (~1.5s) → idle. An **error pins** on the field with
   the zod/server message until that field's next successful save.
5. **Revert on fail.** A rejected batch restores every batch field to the
   **server snapshot** and toasts the server's message verbatim — a failed
   value never sticks (`Model.save` resolve-on-failure heritage ends here;
   `useSave` REJECTS).
6. **Reconcile.** The success row (and any `row` prop change — refetch,
   another form's save) becomes the new snapshot; untouched fields follow it.
   Server normalization is visible: save `555 010 0142`, the field comes back
   `+15550100142`.

All machine state lives in one reducer (draft, server snapshot, per-field
status, pending batch, in-flight flag); the two timers only dispatch.

### Dotted names — the nested-value wire contract

`name: 'permissions.manage_users'` reads `row.permissions.manage_users`
(loose truthy: `true` or `1`) and saves as a **partial dict**:
`{permissions: {manage_users: true}}`. django-mojo **merges** dict bodies
into JSONFields (`rest.py on_rest_update_jsonfield` → `objict.merge_dicts`)
— never send the whole dict, never fear clobbering sibling keys. The mock
mirrors the merge exactly.

### Permission tabsets — a registry, not mutated arrays

```ts
registerFormTabs('user.permissions', [
    { key: 'standard', label: 'Standard', fields: [...] },
    { key: 'users', label: 'Users', permissions: ['users', 'manage_users'], fields: [...] },
]);
```

- Registering the same name again **appends new keys / replaces same keys**
  (an app adds its tab beside the framework's — web-mojo
  `registerPermissions` semantics without `arr.length = 0; arr.push(…)`).
- `getFormTabs(name)` returns a snapshot copy; mounted FormViews re-render
  on registration (subscription).
- Tab `permissions` resolve **fail-closed like `<Guarded>`** against `me` +
  the active-group member (`hasPermission`): hidden while loading, while
  anonymous, and on failure. The active tab self-heals to the first visible.
- A tab whose field holds a pinned error shows a red dot.

The machine spans ALL tabs' fields — a batch may carry fields from several
tabs; switching tabs loses nothing.

## Field-type registry (board #1278)

```ts
import {
    registerFieldType, resolveFieldRenderer, registeredFieldTypes,
    warnUnknownFieldType,                       // the shared unknown-type warn
    fieldToWire, wireToField,                   // the epoch boundary (field-wire)
    emptyFieldValue, fieldPrecision,
    type RegistryFieldProps, type FieldTypeRenderer,
} from 'portal-mojo/ui';
```

`ui/field-registry` maps every non-builtin `Field.type` string to a renderer
that binds the Field def + the form's controlled value/commit pipeline to
the real component — web-mojo's `INPUT_TYPES`/`createInput` +
FormBuilder's field-type switch, carried as a registry (also the FormPlugins
replacement: apps extend with `registerFieldType`). **Both surfaces consult
it**: SchemaForm and FormView render any registered type from the same
schema, with the same commit semantics (every registry component fires on
COMMIT, so each change is one autosave gesture).

### The registry API

```ts
// Renderers are function components — they may hold hooks/state.
type FieldTypeRenderer = ComponentType<RegistryFieldProps>;
interface RegistryFieldProps {
    field: Field;
    value: FieldValue;              // form-state value (WIRE-shaped — below)
    invalid?: boolean;              // paint the error border (text is the surface's)
    disabled?: boolean;
    commit: (value: FieldValue) => void;   // THE change pipeline, once per commit
    commitPatch: (patch: FieldValues) => void; // one declared-field transaction
}
registerFieldType('rating', RatingField);       // add / replace (HMR-safe)
registerFieldType(['a', 'b'], SharedField);     // aliases share one renderer
resolveFieldRenderer('rating');                 // renderer | null
registeredFieldTypes();                         // names, registration order
```

Names match **exactly** (no case folding): a typo'd type must fall through
to the loud fallback, not silently half-match.

**Unknown-type rule** (house rule 4): a type with no renderer renders a
**text input** and `console.warn`s ONCE per (field, type) — never "render
nothing". Both surfaces enforce it (`warnUnknownFieldType` carries the
shared warn-once set).

### The value-shape table

**State holds the WIRE shape.** The registry renderer converts at its own
edge — render through `wireToField(field, value)`, commit through
`fieldToWire(field, value)` — so SchemaForm's submit payload and FormView's
autosave batches carry wire-ready values without either surface knowing
dates exist. This is the ONE conversion point.

| `Field.type` (aliases) | Component | Control (what the picker holds) | State = wire (what the save body carries) | Empty |
|---|---|---|---|---|
| `tag`, `tags` | TagInput | chip list | **CSV string** `'a,b'` (django-mojo models split it) | `''` |
| `multiselect` | MultiSelectDropdown | checked options | **array** of option values | `[]` |
| `collection` | CollectionSelect | one picked row | the row's **id** (`string \| number`); `null` clears | `null` |
| `collectionmultiselect`, `collection-multiselect` | CollectionMultiSelect | checked rows | **array of ids** | `[]` |
| `combo`, `combobox`, `autocomplete` | ComboBox | committed option/text | the committed value (`string \| number`; free text iff `allowCustom`) | `''` |
| `address` | AddressField | private draft + provider suggestions | raw committed address, or one atomic mapped details patch | `''` |
| `datepicker`, `monthpicker`, `yearpicker` | DatePicker | canonical `YYYY-MM-DD` / `YYYY-MM` / `YYYY` | the shape it read (see below); **epoch seconds** at UTC midnight by default; `outputFormat` overrides | `null` |
| `daterange`, `monthrange`, `yearrange` | DateRangePicker | canonical `[start, end]` pair | as above, per element — **`[startEpoch, endEpoch]`** by default | `null` |
| `timepicker` | TimePicker (+ the REAL TimezoneSelect in its slot) | HH:MM (+ zone) | serialized **string** — `'iso'` (default) `'14:30-07:00'`, `'iana'` `'14:30 America/…'`; times are never epochs | `''` |
| `datetimepicker` | DateTimePicker | `'YYYY-MM-DD HH:MM'` local | the shape it read; **epoch seconds** (exact instant) by default, ISO when the column spoke ISO | `null` |
| `timezone` | TimezoneSelect | IANA zone | the IANA **string** | `''` (picker displays the local zone; `resolveTimezone` computes that effective default when a form must post it) |

Alias precision mapping (web-mojo `PRECISION_ALIASES`): `monthpicker`/
`monthrange` → `'month'`, `yearpicker`/`yearrange` → `'year'`; an
**explicit `Field.precision` wins** over the alias (`createInput` parity).

Registry-type Field props (all optional, additive): `precision`,
`outputFormat`, `displayFormat`, `min`/`max`, `presets`, `months`,
`separator` (tag CSV joiner / daterange display), `timeFormat`, `step`,
`timezone`/`timezones`, `model`/`endpoint`, `labelField`/`valueField`,
`maxItems`, `emptyFetch`, `debounceMs`, `requiresActiveGroup`,
`defaultParams`, `enableSearch`, `maxTags`, `allowDuplicates`,
`allowCustom`, `showDescription`, `maxSuggestions`, `addressFields`,
`country`, `minChars`, `disabled`. Component
knobs a Field doesn't carry (locale, firstDay, disabledDates, …) are
reachable only by using the component directly.

### The epoch-seconds save boundary (`ui/field-wire`)

The measured django-mojo contract (serializer.py:380-389 +
rest.py:1888-1892 / `dates.parse_datetime`): **DateTimeField serializes OUT
as epoch seconds** and the save path parses epochs back in; DateField
serializes OUT as `'YYYY-MM-DD'` but its save path ALSO accepts epochs
(naive/UTC-parsed — a UTC-midnight epoch lands on the same day). Hence:

- `wireToField(field, raw)` — accepts **every** shape django-mojo emits
  (epoch seconds, epoch **milliseconds**, either of those as numeric
  strings, `'YYYY-MM-DD'`, full ISO, `Date`), so rows mixing `last_login`
  epochs and `dob` strings flow through one path. Detection is
  `date/fns detectTemporal`; unparseable stored values warn once and read
  as empty.
- `fieldToWire(field, control)` — **answers in the shape the field last
  read**. A column that arrived as `'YYYY-MM-DD'` saves back as
  `'YYYY-MM-DD'`; one that arrived as ISO saves ISO; one that arrived as
  epoch milliseconds saves milliseconds; everything else (and any field
  never read — a fresh record) saves **epoch seconds**, the DateTimeField
  contract. Canonical strings become UTC midnight for date-only
  precisions; datetimes honor an explicit offset/IANA zone, else the
  browser's local wall time.

  This auto-detection exists because the wire shape is per-COLUMN, not
  global: emitting epochs for everything silently rewrote a DateField's
  type on every save and turned ISO metadata values into numbers.
  `Field.outputFormat` (`'epoch' | 'date' | 'iso'`) remains the explicit
  override and always wins — set it when a column's shape must not be
  inferred. The remembered shape is keyed by the Field **object**, so
  module-level schema constants (the normal case) carry it correctly and
  two forms sharing a field name never collide.
- **`dr_field/dr_start/dr_end` filter params are NOT this boundary** — they
  stay `YYYY-MM-DD` strings and belong to FilterBar/params (rest.py parses
  dr_* itself). Untouched.

Every other type passes through both functions unchanged — its control
shape IS its wire shape, per the table.

### Kitchen sink

The playground's **Field registry kitchen sink** section renders EVERY
registered type (all aliases) from one schema on both surfaces — FormView
autosave against the mock user (saves land in `metadata.*`, live
control-vs-wire panel per field) and SchemaForm submit (exact payload
shown) — plus the explicit-precision override, `outputFormat:'date'`, the
#1273 seam, and the deliberate unknown type.
(`apps/portal/src/pages/components/demos-kitchen-sink.tsx`)

## Pitfalls

`SchemaForm` and `FormWizard` share one controlled submit-state/rendering core. SchemaForm intentionally keeps its original lazy initialization and required/email-only submit contract; FormWizard adds cross-section validation, focus, reset, and roster reconciliation. `FormView` does **not** use that submit store: it retains the one autosave reducer across flat fields and all tabs. See [tabs-and-form-wizard.md](tabs-and-form-wizard.md).

- Never uncontrolled inputs, never a second value pipeline — the
  buttongroup/checklistdropdown bug class stays impossible only while this
  holds.
- Phone fields: django-mojo runs `set_phone_number` on save and wants E.164
  (`+15555550142`); pretty/short formats REJECT with
  `Invalid phone number: <value>` — surface it verbatim (FormView does).
  The mock enforces the same rule.
- Keep the client `schema` **looser or equal** to the server: client zod is
  UX, the reject/revert path is the safety net — don't try to out-validate
  the backend.
- FormView needs a LOADED row — gate on `useOne`'s `isPending` first.
- The rich field set (collection pickers, tags, dates, …) lives in the
  field-type registry above — extend THIS language via `registerFieldType`;
  don't fork it. New renderers must fire on COMMIT only and keep state
  wire-shaped (convert in the renderer, like the date bindings do).
- `commitPatch` is for one provider-driven gesture, such as address details.
  Both form surfaces filter it to declared field names. FormView validates
  and queues the whole accepted patch as one batch, so server failure rolls
  every member back together.
- `daterange` here is ONE field name whose value is a `[start, end]` pair —
  NOT web-mojo's `startName`/`endName` twin wire keys. A model with two
  separate date COLUMNS should use two `datepicker` fields.
- `timepicker`'s `outputFormat:'object'` (component-level) is not a form
  shape — form state is JSON-scalar/array; the registry always serializes
  to the string forms.

## Simple-types parity audit

Every `case` in web-mojo `FormBuilder.js`'s field-type switch (the ~45-type
FieldTypes list), vs this package. **Gaps are recorded, not built** — the
orchestrator files follow-ups.

| FormBuilder case | SchemaForm/FormView | Registry | Status / note |
|---|---|---|---|
| `text` | builtin | — | OK |
| `email` | builtin (+ format validation) | — | OK |
| `password` | — | — | **GAP** — C3 auth pages own password UX (strength/generator, board #1259) |
| `number` | — | — | **GAP** — obvious next builtin (min/max/step props already exist on Field) |
| `tel` | builtin | — | OK |
| `url` | — | — | **GAP** — trivial builtin (text + `type="url"`) |
| `search` | — | — | **GAP** as a FORM field; the live-search UX exists as the params-store search (ModelTable) |
| `hex` | — | — | **GAP** — pattern-validated text; zod `schema` covers it today |
| `textarea` | builtin | — | OK |
| `htmlpreview` | — | — | **GAP** — sweep verdict: PATTERN (iframe preview), rebuild small when needed |
| `json` | — | — | **GAP** — textarea + zod covers today; DataView/JSON viewer (#1303) is the read side |
| `select` | builtin (SchemaSelect) | — | OK (placeholder + unknown-value warn beat source) |
| `multiselect` | — | MultiSelectDropdown | OK |
| `checkbox` | — | — | **GAP** — portal has `switch` only; plain-checkbox look absent (use `switch`) |
| `toggle` / `switch` | builtin `switch` | — | OK |
| `radio` | — | — | **GAP** — use `select`; radio-group component unfiled |
| `date` (native input) | — | — | superseded by `datepicker` (registry) — native input not carried |
| `datetime` (native) | — | — | superseded by `datetimepicker` |
| `time` (native) | — | — | superseded by `timepicker` |
| `file` | — | — | **GAP** — 3-stage fileman uploads are board #1264; FileView #1298 |
| `image` | — | — | **GAP** — same upload dependency (#1264); renditions ride the avatar pattern |
| `color` | — | — | **GAP** — native `<input type=color>` wrapper unfiled |
| `range` | — | — | **GAP** — native `<input type=range>` wrapper unfiled |
| `hidden` | — | — | N/A by design — controlled forms post state, not hidden DOM inputs |
| `button` | — | — | N/A by design — SchemaForm owns submit/cancel; FormView has no buttons |
| `divider` | — | — | **GAP** — layout-only field (FormWizard/Tabs #1305 is the structure story) |
| `html` | — | — | N/A by design — trusted-HTML slots became ReactNode (architecture rule 6) |
| `heading` / `header` | — | — | **GAP** — layout-only field, same #1305 story |
| `tag` / `tags` | — | TagInput | OK (CSV wire shape) |
| `collection` | — | CollectionSelect | OK |
| `collectionmultiselect` / `collection-multiselect` | — | CollectionMultiSelect | OK |
| `datepicker` | — | DatePicker | OK (epoch wire; `outputFormat:'date'` opt-out) |
| `monthpicker` | — | DatePicker | OK (alias → precision `month`; explicit `precision` wins) |
| `yearpicker` | — | DatePicker | OK (alias → precision `year`) |
| `daterange` | — | DateRangePicker | OK — deviation: ONE name, `[start, end]` value; no `startName`/`endName` twin keys (use two datepickers for split columns) |
| `monthrange` | — | DateRangePicker | OK (alias → precision `month`) |
| `yearrange` | — | DateRangePicker | OK (alias → precision `year`) |
| `timepicker` | — | TimePicker | OK (real TimezoneSelect in the slot; string wire) |
| `datetimepicker` | — | seam → DateTimePicker | OK once #1273 merges (alias + epoch boundary live now; interim text input) |
| `checklistdropdown` | — | — | folded into `multiselect` (sweep: ONE implementation) — alias deliberately NOT registered |
| `buttongroup` | — | — | **GAP** — segmented control; source was the split-pipeline bug family (do-not-recreate), needs a fresh build |
| `combo` / `combobox` / `autocomplete` | — | ComboBox | OK (ComboInput feature spec, commit-only) |
| `address` | — | AddressField | OK (private session token, details → atomic declared-field patch) |
| `tabset` | FormView `tabs` prop | — | OK — tabsets are FORM STRUCTURE here (registry-of-tabs + permissions), not a field type |
