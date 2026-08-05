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
    type: 'text' | 'email' | 'tel' | 'select' | 'switch' | 'textarea';
    label: string;
    placeholder?: string;
    required?: boolean;        // SchemaForm submit validation
    help?: string;
    columns?: 6 | 12;          // grid halves / full row
    options?: { value: string; label: string }[];   // select
    showWhen?: ShowWhen;       // conditional visibility (both surfaces)
    schema?: ZodType;          // per-field zod validation (FormView commits)
}
type FormData    = Record<string, string | boolean>;         // SchemaForm values
type FieldValue  = string | number | boolean | null;
type FieldValues = Record<string, FieldValue>;               // FormView values
type ShowWhen    = { field; value; negate? } | ((values: FieldValues) => boolean);
```

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

## Pitfalls

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
- The richer field set (~45 web-mojo types: collection pickers, tags,
  dates, …) arrives with B4 — extend THIS language; don't fork it.
