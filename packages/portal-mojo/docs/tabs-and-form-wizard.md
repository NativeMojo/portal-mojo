# Tabs and FormWizard

Import both from `portal-mojo/ui`:

```tsx
import { Tabs, FormWizard, formWizardModal } from 'portal-mojo/ui';
```

## Tabs

`Tabs` accepts `items: { key, label, panel, disabled?, ariaLabel? }[]`, optional controlled `activeKey`/`onActiveKeyChange`, uncontrolled `defaultActiveKey`, `variant`, `ariaLabel`, and `className`. Labels and panels are `ReactNode`.

The default variant is `underline-all`. Canonical variants are `minimal`, `traditional`, `underline`, `underline-all`, `pills`, `pills-solid`, `segmented`, and `btn-group`; `buttongroup` and `btngroup` alias `btn-group`. Unknown variants warn once and use the default.

In controlled mode, the caller owns the requested key. If it is missing or disabled, Tabs paints the first enabled key and notifies the caller once per requested-key/roster transition. Uncontrolled selection heals internally. Empty and duplicate keys are dropped with a warning; disabled tabs are never selected.

The tablist uses automatic activation: Left/Right wraps and skips disabled tabs; Home/End selects the first/last enabled tab. Stable `tab`/`tabpanel` IDs carry `aria-controls` and `aria-labelledby`, with one roving `tabIndex=0`. Every panel shell remains mounted, while only the active panel content mounts. Narrow tab lists scroll horizontally.

```tsx
<Tabs
  variant="segmented"
  defaultActiveKey="profile"
  items={[
    { key: 'profile', label: 'Profile', panel: <Profile /> },
    { key: 'audit', label: 'Audit', panel: <Audit />, disabled: !canAudit },
  ]}
/>
```

## FormWizard

Sections have `{ key, label, fields, description?, optional?, content?, eligible?, onNext?, terminal? }`. `content` may be a node or a render function over the shared draft/busy state. `eligible(data)` removes a step without destroying its draft. `onNext(data)` is an async single-flight transition after section validation. `terminal` renders an actionless receipt/status step. Section keys must be non-empty and unique, and field names must be globally unique. Later duplicates are warned and dropped.

Core props are `sections`, `initial`, `resetKey`, `mode: 'wizard' | 'tabs'`, `tabVariant`, button labels, `validateAllOnFinish`, `onStepChange`, `onCancel`, and `onFinish(data)`. Wizard mode has ordered Back/Next/Finish flow. Back does not validate; Next validates visible fields on the active step. Tabs mode provides non-linear navigation and one Save action. Finish validates all visible sections by default, opens the first invalid section, and focuses its first error. Set `validateAllOnFinish={false}` only when active-section validation is deliberately sufficient; the emitted payload still includes all visible fields.

Required/email checks run before an optional `Field.schema`. Hidden fields neither validate nor submit, but their draft remains available if shown again. `onFinish` is async and single-flight: navigation and actions disable while pending; rejection remains visible and retryable. A new `initial` object does not overwrite drafts. Change `resetKey` to intentionally reseed values/errors/active section. Roster changes preserve surviving values, seed additions, retire removals, and heal selection; pending finish defers reconciliation.

```tsx
const save = User.useSave();
<FormWizard
  mode="wizard"
  sections={sections}
  initial={row}
  resetKey={row.id}
  onFinish={(data) => save.mutateAsync({ id: row.id, changes: data })}
/>
```

`formWizardModal(options)` adds `title` and optional `size`, and returns the submitted `FormData` or `null` for idle cancellation. Its required `onFinish` runs before success closes. Next/Back/tabs/Cancel/Escape/backdrop are all locked during async transitions or finish. Reset/unmount generations make late completions stale, so they cannot advance, close, or rewrite a newer roster.

```tsx
const result = await formWizardModal({
  title: 'Create member',
  sections,
  mode: 'wizard',
  onFinish: (data) => create.mutateAsync(data),
});
```

`SchemaForm` shares the submit-state/rendering core but deliberately retains its lazy one-time initialization, flat payload, and required/email-only validation. `FormView` remains a separate autosave reducer; it uses Tabs only for presentation so permission filtering and one cross-tab autosave batch stay intact.
