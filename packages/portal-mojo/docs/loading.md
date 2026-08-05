# Loaders — spinner · busy overlay · view loader · inline · Busy

```ts
import {
    Spinner, ViewLoader, LoadingState, InlineLoader, Busy, LoadingOverlay,
    busy, busyWhile, closeAllBusy, useDelayedFlag,
    LOADING_DELAY_MS, BUSY_MIN_VISIBLE_MS, BUSY_TIMEOUT_MS,
} from 'portal-mojo/ui';
// LoadingState === ViewLoader (alias — reads better in a route's early return)
```

The "we're fetching / working" family. It **complements the skeleton
silhouette**, which stays the default for anything whose shape is already
known (see the decision table below). Live demo: portal → Develop →
Components → **Loaders**. Styling: `apps/portal/src/theme/loading.css` —
tokens only, both themes.

Ported from web-mojo `src/core/views/feedback/BusyIndicator.js` (its only
loading UI: a singleton frosted overlay behind `Modal.loading()` /
`app.showLoading()`, used by ~30 admin call sites). Reference counting, the
newest-message-wins label and the 30s watchdog are kept; the z-index
arithmetic, the hardcoded light-theme palette and the show-on-the-same-tick
behavior are not.

## The anti-flash rule (the design idea)

> **An indicator that appears for 80ms is worse than none.** It reads as a
> glitch, and it makes fast software look broken.

Every loader here is gated by `useDelayedFlag`:

- nothing renders until the work has run **`LOADING_DELAY_MS` (200ms)** —
  work that finishes inside that window produces no indicator at all;
- the overlay, once up, stays at least **`BUSY_MIN_VISIBLE_MS` (400ms)**, so
  it can't blink out either.

Both are per-call overridable (`delay`, `minVisible`). `delay: 0` opts out —
correct for demos and for a route that is *known* to be slow.

```ts
const show = useDelayedFlag(query.isFetching);              // 200ms default
const show = useDelayedFlag(save.isPending, 400);           // number = delay
const show = useDelayedFlag(active, { delay: 150, minVisible: 500 });
```

## Skeleton vs loader — which one

| Situation | Use |
|---|---|
| Table rows, detail grids, card lists — **shape known** | **Skeleton** (`.skel` silhouette: `skel-avatar`, `skel-stack`, `skel-w-60`, `skel-pill`) |
| A panel or route with nothing to show yet, shape unknown | `<ViewLoader label="Loading members…" />` |
| One row / cell / field resolving on its own | `<InlineLoader />` |
| A form or card whose own mutation is in flight | `<Busy active={save.isPending}>` |
| Work the user must wait out (export, long save, batch) | `busy()` / `<LoadingOverlay>` |
| Long work with a real percentage | `toast.progress` — see [idioms.md](./idioms.md) |
| Background refresh of data already on screen | **Nothing** (or the toolbar refresh spin) |

Rules of thumb: a skeleton **promises a shape**, so never render one for
data whose shape you can't predict (a report, an export, a search that may
return nothing). A loader **says work is happening**, so never render one
over content that is already on screen and still valid — dim it (`<Busy>`)
or leave it alone.

ModelTable, CollectionMultiSelect and DetailView already use skeletons and
should keep doing so. Nothing in this family replaces them.

## Spinner

```tsx
<Spinner />                       {/* md, decorative */}
<Spinner size="xs" />             {/* xs | sm | md | lg, or a pixel number */}
<Spinner size={44} />
<Spinner size="sm" label="Refreshing" />   {/* the ONLY indication → named */}
```

| Prop | Type | Notes |
|---|---|---|
| `size?` | `'xs' \| 'sm' \| 'md' \| 'lg' \| number` | 12 / 15 / 20 / 30px, or an explicit diameter. Unknown value → `'md'` **with a `console.warn`** (once per bad value). |
| `label?` | `string` | Omit when visible text sits beside it (then it renders `aria-hidden`). Pass it only for an icon-only affordance. |
| `className?` | `string` | Appended after `mojo-spinner …`. |

The ring is drawn in `currentColor`, so it inherits its context: white inside
`.btn-primary`, `--accent` inside a loader card, `--mute` in a table cell. No
color prop, and none needed.

## busy() — the blocking full-screen overlay

```ts
const b = busy('Rebuilding index…');
try { await rebuild(); } finally { b.close(); }

// Preferred — a throw can never strand the overlay:
await busyWhile('Preparing export…', () => mojoDownload(endpoint, params, 'csv'));
```

| API | Signature |
|---|---|
| `busy` | `(label?: string, opts?: BusyOptions) => BusyHandle` |
| `busyWhile` | `<T>(label: string, run: () => Promise<T> \| T, opts?: BusyOptions) => Promise<T>` |
| `closeAllBusy` | `() => void` — escape hatch for an error boundary / hard reset |
| `BusyOptions` | `{ delay?: number; minVisible?: number; timeout?: number }` |
| `BusyHandle` | `{ close(): void; setLabel(label: string): void; isActive(): boolean }` |

- **Imperative on purpose**, matching `modal.*` / `toast.*`: call it from any
  handler, or from non-component code (client interceptors, route guards).
  There is **no host component to mount** — nothing to wire into `App.tsx`.
- **Reference-counted by ticket.** Nested calls compose; the newest live
  ticket's label is displayed, and closing it falls back to the previous
  label rather than leaving stale text. `close()` is idempotent.
- **Watchdog:** a ticket left open longer than `timeout` (default 30s)
  force-closes with a `console.error` naming the label. A caller that throws
  outside a `finally` can never wedge the app behind an overlay nobody can
  dismiss. `timeout: 0` disables it for a legitimately unbounded operation.
- `<LoadingOverlay active label />` is the declarative binding to the same
  overlay (renders nothing into the React tree). Changing `label` swaps the
  text **without restarting the delay**.

### Why a `<dialog>`, and what "blocking" means

The overlay is a native `<dialog>` opened with `showModal()` — a member of
the browser **top layer**, exactly the reasoning behind
[Popover](./popover.md):

- it paints **above open modals and drawers** with no z-index arithmetic
  (web-mojo needed `ModalView.getFullscreenAwareZIndex().modal + 1000`);
- the rest of the document goes **inert** — pointer *and* keyboard. A
  `pointer-events: none` scrim leaves <kbd>Tab</kbd> working, which is not
  blocking, it just looks like it;
- **Escape is swallowed** (`cancel` → `preventDefault`): dismissible only by
  the caller, because the operation keeps running either way;
- focus returns to the pre-open element on close (native `<dialog>`
  behavior), so a save started from a toolbar button lands you back on it.

A modal opened *after* the overlay stacks above it (top-layer promotion
order) — that is deliberate: an error modal raised mid-operation must be
readable.

## ViewLoader / LoadingState

```tsx
if (query.isPending) return <ViewLoader label="Loading members…" />;

<ViewLoader size="lg" label="Loading dashboard…" hint="First load builds the cache." />
```

| Prop | Type | Notes |
|---|---|---|
| `label?` | `string` | Default `'Loading…'`. Say **what** — "Loading members…" beats "Loading…". |
| `hint?` | `ReactNode` | Second line for the honestly slow. |
| `size?` | `'sm' \| 'md' \| 'lg'` | Reserved height 88 / 168 / 280px + spinner size. Unknown → `'md'` with a `console.warn`. |
| `delay?` | `number` | Default 200ms. |
| `className?` | `string` | |

Before the delay elapses it renders an **empty box of the same height**
(`aria-hidden`), not `null`: a fast panel pops in with no layout jump, and a
slow one doesn't shove content down when the spinner appears.

## InlineLoader

```tsx
<InlineLoader />                          {/* "Loading…" */}
<InlineLoader label="checking sessions…" />
<InlineLoader label="" />                 {/* bare spinner, still announced */}
```

Small inline row: `label?`, `delay?`, `className?`. Renders `null` before the
delay (inline text needs no reserved height).

## Busy — dim + disable a region

```tsx
<Busy active={save.isPending} label="Saving…">
    <SchemaForm … />
</Busy>
```

| Prop | Type | Notes |
|---|---|---|
| `active` | `boolean` | A mutation's `isPending`. |
| `label?` | `string` | Caption under the veil spinner. |
| `delay?` | `number` | Anti-flash for the **dim only**. |
| `spinner?` | `boolean` | Default true; false = bare dim. |
| `className?` | `string` | Appended after `mojo-dim`. |

**Blocking is immediate, dimming is delayed.** The content wrapper gets the
native `inert` attribute the instant `active` goes true — no double-submits,
no tabbing into a form mid-save — while the visual dim waits out the
anti-flash window so a 60ms save doesn't strobe the panel. That split is the
whole reason this wrapper exists; `pointer-events: none` alone would leave
the keyboard path open.

**Focus survives it.** Going inert blurs whatever was focused inside (the
field the user was in when they hit save), so `Busy` remembers that element
and restores focus when `active` goes false — but only if focus is still
parked on `<body>`, i.e. nothing else claimed it. If the user deliberately
clicked away mid-save, they keep where they went.

## Accessibility contract

- `Spinner` is `role="img"` + `aria-label` when named, `aria-hidden`
  otherwise — **never** a live region. Nesting live regions double-announces.
- The overlay dialog carries `aria-busy="true"` and an `aria-label` mirroring
  the label; the label element inside is `role="status"`, so a mid-flight
  `setLabel('Finalizing…')` is announced politely.
- `ViewLoader` and `InlineLoader` are `role="status"`; `ViewLoader` adds
  `aria-busy="true"`. Its pre-delay placeholder is `aria-hidden` (nothing to
  announce yet).
- `Busy` sets `aria-busy` on the wrapper and `inert` on the content, which
  also removes it from the accessibility tree while the mutation runs — and
  restores focus to the element the inert switch blurred (see above). Its
  veil is `pointer-events: none`: `inert` already stopped the clicks, and a
  veil that swallowed them would break text selection after release.
- **Reduced motion:** the spinner does not spin. `theme.css` kills every
  animation with a universal `!important` rule — right for a skeleton
  (shimmer stops), wrong for a spinner (the ring would freeze mid-rotation
  with one colored quarter and read as a stuck control). `loading.css`
  therefore **substitutes** a uniform ring on a slow opacity pulse, with
  `!important` so it out-ranks that universal rule (among important
  declarations the more specific selector wins).

## Pitfalls

- **Don't overlay a background refresh.** The blocking overlay is for work
  the user must wait out. Data already on screen stays interactive; use
  `<Busy>`, a skeleton, or the toolbar refresh spin.
- **Don't hand-roll `busy()` without a `finally`.** Use `busyWhile` — the
  watchdog exists because that mistake was made in web-mojo, not
  hypothetically.
- **Don't nest a `<LoadingOverlay>` per component.** One overlay serves the
  app; several tickets are fine, several *hosts* are not a thing (there is no
  host).
- **Don't use a loader where a progress toast belongs.** If you have real
  percentages (uploads, multi-file exports), `toast.progress` keeps the app
  usable; a blocking overlay for 40 seconds is hostile.
- **Don't add `delay={0}` to make it "feel responsive."** It does the
  opposite — you get the flash the delay exists to remove. `delay: 0` is for
  demos and known-slow routes.
- **The overlay is `dialog[open]`.** ModelTable's `autoRefresh` skips ticks
  while any `dialog[open]` exists, so auto-refresh politely pauses during a
  busy operation. That is intended; don't "fix" it.
- **Toasts render under the overlay** (`.toast-host` is z-index 60, the
  overlay is in the top layer). Toast *after* closing the handle, not during.
