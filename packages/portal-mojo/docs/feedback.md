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
| `modal.drawer<T>({title, content\|render, …})` | `T \| null` — right slide-over (below) |
| `formModal({title, fields, initial?, submitText?, intro?})` | `FormData \| null` (see forms.md) |

Patterns:
- Danger confirms: `danger: true` styles the confirm button destructively.
- Batch prepare: open a `formModal` INSIDE a flow to collect once-per-batch
  input; resolve null to cancel the whole thing.
- Stacked dialogs are fine (disable-reason form over a detail modal).

## modal.drawer

```ts
const picked = await modal.drawer<string>({
    eyebrow: 'Source IP', title: '198.51.100.24',
    meta: [{ icon: 'bi-clock', text: 'Last 30 days' }, '412 events'],
    width: 'wide',
    render: (close) => <button onClick={() => close('approved')}>Approve</button>,
});
```

Right-anchored slide-over on the SAME `<dialog showModal>` substrate as the
rest of the manager — backdrop, Escape and stacking are native, so a drawer
opened from an open modal simply takes the top layer. Header shape (eyebrow ·
title · meta) is web-mojo's `Modal.drawer()` carried over.

| Option | Meaning |
|---|---|
| `title` / `eyebrow` / `meta` | Header: big line, uppercase tag above it, subtitle row (`string` or `{icon, text}`) |
| `content` | Static body ReactNode — ignored when `render` is given |
| `render(close)` | Body that owns the result; `close(value)` resolves the await |
| `width` | `480px` default · `'wide'` → `720px` · a number → px (min 280). Always clamped to the viewport (`min(w, 100%)`); full-bleed under 560px |
| `dismissable` | Default `true`. Governs Escape + backdrop + the header X together — no half-states |

- **Resolution:** `close(value)` → `value`; Escape / backdrop / X → `null`.
  The promise settles AFTER the slide-out (~200ms), so `await` then toast
  reads in the right order. First close wins; later ones are ignored.
- **Exit animation:** close adds `.mojo-drawer-closing`, the manager waits out
  the keyframes, THEN drops the item (unmount calls `dialog.close()`). Under
  `prefers-reduced-motion: reduce` the wait is 0 and the keyframes are off.
- **`dismissable: false` requires a `render`** that can close the drawer —
  otherwise there is no exit at all, so it falls back to dismissable with a
  `console.warn` (house rule: degenerate input → default + warn).
- An unknown `width` warns and falls back to 480px.
- Styles: `apps/portal/src/theme/drawer.css` (`.mojo-drawer`, `.drawer-panel`,
  `.drawer-head/-eyebrow/-title/-meta`, `.drawer-body`) — tokens only, both
  themes. `DRAWER_EXIT_MS` in `modal.tsx` must match the closing keyframes.

**Boundary — this drawer is TRANSIENT.** It is a modal, top-layer, awaitable
surface for drill-downs and one-off flows: it blocks the page, it resolves,
it is gone. The persistent shell right-panel slot (tickets / assistant) is a
different thing — a non-modal layout region that lives alongside content and
holds state across navigation. Do not build that with `modal.drawer`, and do
not grow `modal.drawer` toward it.

## toast

`toast.success(msg)` / `.error(msg)` / `.info(msg)` / `.warning(msg)` —
bottom-right cards, max 5, 3.5s. Conventions:
- Server failures: toast the server's message verbatim
  (`err instanceof Error ? err.message : 'Fallback'`).
- Batch partial results use `warning` (`"Disable: 3 succeeded, 2 failed"`).
- `response: 'payload'` actions toast the SERVER's payload message
  (`outcome.body.message`), not client copy.

`ToastHost` uses a manual native popover above dialog backdrops. Its stable
portal target follows the most recently opened modal (including nested dialogs
and drawers), then returns to the page when the last modal closes. Modal-local
ancestry keeps Undo and progress Cancel usable despite native dialog inertness.
Moving the host preserves card state and timers and does not focus the toast.
Mount it once; do not add per-dialog toast hosts or solve this with `z-index`.
Custom app themes must include the updated toast CSS from
`apps/portal/src/theme.css`: reset the popover's UA inset/margin/border/padding
and background, hide closed popovers, and keep only the cards pointer-active.
Updating the TypeScript package alone does not update a consumer's own theme.
The showcase's **Toasts inside modal** demo covers errors, Undo, progress,
and nested opening/closing. `node scripts/verify-toast-modal.mjs` checks the
mounted lifecycle; native visibility and interaction require browser checks.

## Pitfall

An open `<dialog>` pauses ModelTable's autoRefresh by design — don't build
alternative modal systems that bypass `<dialog>` or that interlock breaks.

## Admin focused dialogs

Use `modal-pad`, `modal-title`, `modal-message` and `modal-actions`; Cancel
precedes the primary action. Keep long form bodies scrollable and actions
reachable in short/narrow viewports. A pending mutation needs both disabled
buttons and a live `canDismiss` gate for Escape/backdrop. Content records use
DetailView header actions; never teach routine record deletion in a danger rail.
See [Admin modal policy](admin-modals.md) for supported lifecycle semantics,
permission checks and the complete retained-removal contract.
