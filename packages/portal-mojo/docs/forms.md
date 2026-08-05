# forms — the Field language, SchemaForm, formModal

```ts
import { SchemaForm, formModal, type Field, type FormData } from 'portal-mojo/ui';
// Field/FormData/ModelForm TYPES also export from 'portal-mojo/client' —
// model definitions carry form configs as plain data (forms: {...}).
```

## The `Field` language (data, not JSX)

```ts
interface Field {
    name: string;
    type: 'text' | 'email' | 'tel' | 'select' | 'switch' | 'textarea';
    label: string;
    placeholder?: string;
    required?: boolean;
    help?: string;
    columns?: 6 | 12;          // grid halves / full row
    options?: { value: string; label: string }[];   // select
}
type FormData = Record<string, string | boolean>;   // switch → boolean
```

`ModelForm = { title, fields, submitText? }` — the shape `defineModel`
carries (`UserModel.forms.create`) and `formModal` renders.

## SchemaForm

`<SchemaForm fields initial? submitText? onSubmit onCancel? />` — fully
controlled; validates required + email format; async `onSubmit` gets a
busy state and surfaces thrown errors as the form-level alert.

**Select semantics (the rule-4 fix):** display always equals state. While
the value is `''` (unset) the select shows a real disabled placeholder
("Select…" or `field.placeholder`); it can never display an option the
submit won't carry. An initial value not among the options warns once and
shows the placeholder. Booleans in forms are `switch`; boolean FILTERS
render as True/False selects (URL-friendly).

## formModal

```ts
const data = await formModal({ ...UserModel.forms.create!, initial?, intro? });
if (!data) return;   // cancelled → null
```

Awaitable dialog over SchemaForm; resolves the submitted `FormData` or
null. Spreads cleanly with a `ModelForm` plus per-call `initial`/`intro`.
Strip empty-string optionals before saving if the backend derives defaults
(`Object.entries(data).filter(([,v]) => v !== '')`).

## Pitfalls

- Never uncontrolled inputs, never a second value pipeline — the
  buttongroup/checklistdropdown bug class is impossible only while this
  holds.
- Phone fields: django-mojo validates server-side and wants E.164
  (`+15555550142`); surface its rejection message verbatim.
- The richer field set (~45 web-mojo types: collection pickers, tags,
  dates, …) arrives with B3/B4 — extend THIS language; don't fork it.
