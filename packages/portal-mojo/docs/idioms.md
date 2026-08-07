# UX idioms — armed button · undo toast · progress toast

```ts
import { ArmedButton } from 'portal-mojo/ui';          // component
import { toast, undoToast, progressToast } from 'portal-mojo/ui';
// toast.undo === undoToast · toast.progress === progressToast
```

Ported from maestro's workspaces portal (`workspaces/js/dom.js`), these three
are the house grammar for **action feedback by reversibility**:

| The action is… | Use | Never |
|---|---|---|
| Irreversible, no input needed | `<ArmedButton>` two-step | a confirm dialog |
| Irreversible, needs input (a reason) | `formModal` flow | armed button (it can't collect input) |
| Reversible | act IMMEDIATELY + `toast.undo` | a confirm dialog |
| Long-running | `toast.progress` handle | fire-and-forget with a success toast at the end |

Live demo: portal → Develop → Components → **UX idioms**. First real
consumers: ApiKeysPage (revoke = armed, disable = undo), UserDetail
(revoke-all-sessions = armed).

## ArmedButton

```tsx
<ArmedButton
    label="Revoke key"
    armedLabel="Click again — token dies now"
    onConfirm={() => revoke.mutateAsync({ id })}   // may be async
    icon="bi-trash"          // optional, resting state only
    className="btn-compact"  // appended to `btn armed-btn`
    disarmMs={6000}          // auto-disarm window (source parity: 6s)
    title="…"                // defaults to string labels
    disabled={false}
/>
```

Behavior contract (dom.js `armedButton` parity):

- First click **arms**: danger fill, warning icon, `armedLabel` shown. The
  armed label MUST name the blast radius ("Click again — signs out every
  device"), not repeat the verb.
- Second click disarms first, then awaits `onConfirm`. Re-clicks while the
  promise is pending are ignored (button disables).
- **Auto-disarm** after `disarmMs`; `Escape` disarms; unmount disarms (state
  dies with the node — a re-render that drops the button can never leave a
  live trigger). Fail-safe cost is one extra click, never an unintended fire.
- Clicks `stopPropagation()` — safe inside clickable rows / expand rows.

Styling: `apps/portal/src/theme/idioms.css` — `.armed-btn` (rest) /
`.armed-btn.is-armed` (armed, pulsing; static under
`prefers-reduced-motion`). Tokens only, both themes; the dark theme swaps
the armed text color for contrast against the light --bad.

## toast.undo / undoToast

```ts
const handle = toast.undo('Key disabled', () => reenable(), { timeout: 6000 });
handle.dismiss(); // optional early resolution
```

- **The action has already happened** when the toast shows — do the mutation
  first, then offer Undo. This replaces `confirm()` for reversible actions.
- Clicking **Undo** dismisses at once and calls `onUndo`. Otherwise the card
  auto-dismisses after `timeout` (default 6000ms) and the action stands.
- `onUndo` typically fires the inverse mutation; surface ITS failure with a
  normal `toast.error` — the undo toast itself is done by then.

## toast.progress / progressToast

```ts
const p = toast.progress('Uploading export.csv…', { onCancel: () => abort() });
p.update(42);          // clamped + rounded to 0–100
p.finalizing('Finishing upload'); // → 100% + spinner, cancel hidden; still unsettled
p.done('Uploaded');    // → 100% + ✓, auto-removes after 1.4s
p.fail('Cancelled');   // → red + ✕, auto-removes after 5s
p.remove();            // immediate removal
```

- **Persistent**: never auto-dismisses while active — the caller drives it to
  `done` / `fail` / `remove`. After the first of those, the handle is settled
  and later calls no-op.
- `onCancel` renders a ✕ **only while active**. Clicking it calls `onCancel`
  and nothing else — the CALLER aborts its operation and then settles the
  toast (usually `fail('Cancelled')`). Cancel is a request, not a dismissal.
- `finalizing()` is additive and non-settling: it shows a spinner at 100% and
  removes cancellation while an authoritative server read or consumer
  callback completes. The caller must still finish with `done` or `fail`.
- Basic toasts stay capped at 5; undo/progress cards are exempt from the cap
  (evicting a live progress bar would orphan the operation's only indicator).

## Invariants

- All three render through the one `<ToastHost />` / store — mount nothing
  new. Every existing `toast.success/error/info/warning` behavior (3.5s life,
  newest-last, cap of 5) is byte-for-byte unchanged.
- Handles are safe to call after settlement/dismissal — every method no-ops
  rather than throwing or resurrecting a card.
- `ArmedButton` is a plain `<button>` — no portal, no dialog; it composes
  with rows, expand panels and modals without z-index ceremony.

## Pitfalls

- Don't pair `ArmedButton` with a follow-up `modal.confirm` — the arming IS
  the confirmation; stacking both is the friction the idiom removes.
- Don't `toast.undo` an action you haven't performed yet ("undo" that
  actually means "cancel a pending thing" is a lie — use the progress
  toast's cancel for that).
- Don't reuse a settled progress handle for a second operation — mint a new
  one per run.
- The undo window is UX grace, not a transaction: if the inverse mutation
  can fail, handle its rejection (the demo and ApiKeysPage show the shape).
