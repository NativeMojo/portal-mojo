# feedback — awaitable modals + toasts

```ts
import { modal, formModal, toast, ModalHost, ToastHost } from 'portal-mojo/ui';
```

Mount `<ModalHost />` and `<ToastHost />` once in the app shell. Modals are
native `<dialog>` — stacking, backdrop and Escape come free; every opener
is a Promise that resolves when its dialog closes.

## modal

| Call | Resolves |
|---|---|
| `modal.confirm({title, message, confirmText, danger?})` | `boolean` |
| `modal.open<T>((close) => <JSX/>)` | `T \| null` — generic surface; call `close(value)` |
| `modal.detail((close) => <DetailView …/>)` | detail-sized shell for record views |
| `formModal({title, fields, initial?, submitText?, intro?})` | `FormData \| null` (see forms.md) |

Patterns:
- Danger confirms: `danger: true` styles the confirm button destructively.
- Batch prepare: open a `formModal` INSIDE a flow to collect once-per-batch
  input; resolve null to cancel the whole thing.
- Stacked dialogs are fine (disable-reason form over a detail modal).

## toast

`toast.success(msg)` / `.error(msg)` / `.info(msg)` / `.warning(msg)` —
bottom-right cards, max 5, 3.5s. Conventions:
- Server failures: toast the server's message verbatim
  (`err instanceof Error ? err.message : 'Fallback'`).
- Batch partial results use `warning` (`"Disable: 3 succeeded, 2 failed"`).
- `response: 'payload'` actions toast the SERVER's payload message
  (`outcome.body.message`), not client copy.

## Pitfall

An open `<dialog>` pauses ModelTable's autoRefresh by design — don't build
alternative modal systems that bypass `<dialog>` or that interlock breaks.
