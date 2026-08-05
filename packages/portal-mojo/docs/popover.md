# Popover — the anchored top-layer primitive

```ts
import { Popover, type PopoverPlacement, type PopoverCloseReason } from 'portal-mojo/ui';
```

The shared surface every dropdown-style control mounts in — date/time
pickers, autocomplete, multi-selects, kebab menus. Ported from web-mojo's
`CalendarPopover.js`. Portal-mounted so it escapes overflow/clipping
containers; anchor-positioned; closes on outside-mousedown and Escape;
repositions on any scroll (capture phase), resize, and anchor/content
size change.

```tsx
const btnRef = useRef<HTMLButtonElement>(null);
const [open, setOpen] = useState(false);

<button ref={btnRef} onClick={() => setOpen(v => !v)}>Pick…</button>
<Popover anchorRef={btnRef} open={open} onClose={() => setOpen(false)}>
    {/* content brings its own padding/width — the shell is bare */}
</Popover>
```

## API

| Prop | Type | Notes |
|---|---|---|
| `anchorRef` | `RefObject<HTMLElement \| null>` | Trigger element. Re-read on every reposition — swap `.current` to re-point the popover (one instance can serve many triggers). |
| `open` | `boolean` | Controlled. The popover never closes itself. |
| `onClose` | `(reason: 'outside' \| 'escape') => void` | Flip `open` false here. The reason lets pickers commit-on-outside vs revert-on-escape. |
| `placement?` | `'bottom-start' \| 'bottom-end' \| 'top-start' \| 'top-end'` | Default `bottom-start`. Unknown values fall back to the default WITH a `console.warn`. |
| `gap?` | `number` | px between anchor and popover, default 6. |
| …rest | `HTMLAttributes<HTMLDivElement>` | Spread onto the shell (`id`, `aria-*`, `style`, …). `role` defaults to `"dialog"`, overridable. `className` merges after `mojo-popover`. |

Children are `ReactNode` (never HTML strings — house rule). There is no
imperative reposition handle: layout effects + capture-phase scroll +
resize + `ResizeObserver` (on both popover and anchor) cover every
reposition trigger, including async content growth.

The source's `portal: false` inline mode is deliberately not an option:
in React, "inline" is just rendering the content where you want it (an
inline calendar renders `<Calendar/>` directly). `Popover` exists only
for the anchored, floating case.

## The dialog problem (why this is not a z-indexed div)

portal-mojo modals are native `<dialog showModal>` — members of the
browser **top layer**, which paints above the whole document regardless of
z-index. A body-portaled `z-index: 10000` div (web-mojo's approach)
renders UNDER an open modal, so a picker inside a modal form would be
invisible.

**Decision:** the popover joins the top layer itself via the HTML Popover
API — the shell carries `popover="manual"` and is shown with
`showPopover()`. Top-layer members paint in promotion order, so a popover
opened after the modal stacks above it. `manual` (never `auto`) opts out
of UA light-dismiss: close behavior stays this component's own
outside-mousedown + Escape, identical semantics to the web-mojo source.

**Fallback** (browsers without the API — pre-2024): a plain portaled div.
When the anchor sits inside an open `<dialog>`, the portal target becomes
that dialog instead of `document.body` — a descendant paints with its
top-layer host, and `position: fixed` children are not clipped by ancestor
overflow — so pickers-in-modals still work there too.

## Positioning contract

- The shell is `position: fixed` in both paths; all math is
  **viewport-relative** (deliberate translation from the source's
  `absolute` + `scrollX/Y` — the top layer does not scroll with the page,
  so page coordinates would be wrong there).
- Placement math, then a horizontal viewport clamp (8px inset), then a
  vertical flip: any placement that would overflow the bottom flips above
  the anchor when there is room — the source's exact rule.
- Reposition triggers: open, placement/gap change, any capture-phase
  scroll, window resize, popover or anchor resize.

## Focus

Opening NEVER moves focus — `showPopover()` only focuses `autofocus`
content, and the shell has none. Typing in an anchored input keeps
working (the autocomplete precondition). Keeping input focus while
clicking options (`preventDefault` on option `mousedown`) is the
consuming control's job, not the shell's.

## Escape layering

The Escape listener runs in the **capture phase** and calls
`preventDefault()` + `stopPropagation()`: with the anchor inside an open
modal, the first Escape closes only the popover (preventing the dialog's
cancel), the second closes the modal. (Deviation from source, which
predates native `<dialog>`: it neither prevented nor stopped — carrying
that here would close both layers on one keypress.)

Outside-mousedown does NOT stop propagation: the click still activates
whatever was under it (click a second trigger → this popover closes and
that one opens). Clicks on the anchor are never "outside" — the anchor's
own click handler owns its toggle. The listener attach is deferred one
tick so the interaction that opened the popover can't immediately close
it (source parity).

## Styling

`.mojo-popover` lives in `apps/portal/src/theme/popover.css` — tokens
only, both themes. It neutralizes the UA `[popover]` stylesheet
(`inset: 0` centering, `margin: auto`, border, padding, Canvas colors)
and restores the mission-control look (`.filter-menu` family: `--surface`
bg, `--line` border, radius 10, `--shadow-pop`).

The shell is **unpadded and unsized** (`width: max-content`): content
brings its own padding, width, and scrolling. (The web-mojo source shell
baked in 20px padding + 260px min-width for its one tenant, the calendar
— the calendar port carries those itself.)

## Pitfalls

- **Don't wrap the shell in `overflow: hidden` styling assumptions** —
  it's in the top layer; nothing ancestral clips or covers it. Anything
  that must paint ABOVE an open popover has to join the top layer later.
- **Toasts render under open modals** (`.toast-host` is z-index 60, not
  top layer). Don't signal from popover content inside a modal via toast;
  show it in the modal body.
- **One value pipeline:** the popover is presentation only. Commit
  semantics (`change` on select/Enter/blur, never per keystroke) belong
  to the consuming control.
- The opening interaction can be `click` or `mousedown`-driven; both are
  safe. But if you open programmatically and simultaneously flip other
  document state, remember listeners attach a tick later.
- Placement flips only bottom→top (per source). If content can be taller
  than the viewport, cap and scroll it in YOUR content styles.
