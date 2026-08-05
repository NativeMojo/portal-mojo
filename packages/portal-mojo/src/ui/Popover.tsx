// Popover — the shared anchored-popover primitive every dropdown-style
// control mounts in (pickers, autocomplete, multi-selects). Ported from
// web-mojo CalendarPopover.js: portal-mounted, anchor-positioned, closes on
// outside-mousedown/Escape, repositions on scroll (capture) and resize.
//
// The dialog problem, and why this is not just a z-indexed div: portal-mojo
// modals are native `<dialog showModal>` — members of the browser TOP LAYER,
// which paints above the entire document regardless of z-index. A
// body-portaled div therefore renders UNDER an open modal. The popover joins
// the top layer itself via the HTML Popover API (`popover="manual"` +
// `showPopover()`): top-layer members paint in promotion order, so a popover
// opened from inside a modal stacks above it. `manual` (not `auto`) opts out
// of UA light-dismiss — close behavior stays ours, matching the source.
// Browsers without the API fall back to a plain portaled div; when the
// anchor sits inside an open <dialog> the portal target becomes that dialog
// (a descendant paints with its top-layer host, and position:fixed children
// are not clipped by ancestor overflow), so pickers-in-modals keep working.
//
// Coordinates: the element is position:fixed in BOTH paths, so all math is
// viewport-relative (a deliberate translation from the source's
// absolute+scrollX/Y — the top layer does not scroll with the page, so page
// coordinates would be wrong there). Scroll repositioning keeps it glued to
// the anchor.
//
// Focus: opening never moves focus — `showPopover()` only focuses content
// flagged autofocus, and we don't. Typing in an anchored input keeps
// working; per-option focus retention (e.g. preventDefault on option
// mousedown) belongs to the consuming control.
import { useEffect, useLayoutEffect, useRef, type HTMLAttributes, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export type PopoverPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

/** Why the popover asked to close — Escape lets pickers revert-vs-commit. */
export type PopoverCloseReason = 'outside' | 'escape';

export interface PopoverProps extends HTMLAttributes<HTMLDivElement> {
    /** The trigger element the popover positions against (re-read every
     *  reposition, so swapping `.current` re-points the popover). */
    anchorRef: RefObject<HTMLElement | null>;
    /** Controlled visibility — the popover never closes itself; it calls
     *  `onClose` and the owner flips `open`. */
    open: boolean;
    /** Outside-mousedown or Escape. Clicks on the anchor are deliberately
     *  NOT outside (the anchor's own handler owns its toggle semantics). */
    onClose: (reason: PopoverCloseReason) => void;
    /** Default 'bottom-start'. Unknown values warn + fall back. */
    placement?: PopoverPlacement;
    /** px between anchor and popover (default 6). */
    gap?: number;
}

const PLACEMENTS: readonly PopoverPlacement[] = ['bottom-start', 'bottom-end', 'top-start', 'top-end'];
const VIEWPORT_INSET = 8; // px breathing room at viewport edges (source parity)

const SUPPORTS_POPOVER =
    typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

export function Popover({
    anchorRef,
    open,
    onClose,
    placement = 'bottom-start',
    gap = 6,
    className,
    children,
    ...rest
}: PopoverProps) {
    const popRef = useRef<HTMLDivElement>(null);

    // Latest-callback ref so an inline `onClose` doesn't churn the document
    // listeners (and their deferred attach) on every parent render.
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; });

    // ── Show + position ──────────────────────────────────────────────
    // Layout effect: promote to the top layer and position BEFORE paint, so
    // the popover never flashes at a stale spot.
    useLayoutEffect(() => {
        if (!open) return;
        const el = popRef.current;
        if (!el) return;

        let place = placement;
        if (!PLACEMENTS.includes(place)) {
            console.warn(`Popover: unknown placement "${String(place)}" — falling back to "bottom-start"`);
            place = 'bottom-start';
        }

        if (SUPPORTS_POPOVER && !el.matches(':popover-open')) el.showPopover();

        const reposition = () => {
            const anchor = anchorRef.current;
            if (!anchor) return;
            const rect = anchor.getBoundingClientRect();
            const popRect = el.getBoundingClientRect();

            let top = rect.bottom + gap;
            let left = rect.left;
            if (place === 'bottom-end') {
                left = rect.right - popRect.width;
            } else if (place === 'top-start') {
                top = rect.top - popRect.height - gap;
            } else if (place === 'top-end') {
                top = rect.top - popRect.height - gap;
                left = rect.right - popRect.width;
            }

            // Keep within the viewport horizontally.
            const vw = document.documentElement.clientWidth || window.innerWidth;
            if (left + popRect.width > vw - VIEWPORT_INSET) left = vw - popRect.width - VIEWPORT_INSET;
            if (left < VIEWPORT_INSET) left = VIEWPORT_INSET;

            // Flip above when it would overflow the bottom AND there is room
            // above (any placement — the source's exact rule).
            const vh = document.documentElement.clientHeight || window.innerHeight;
            if (top + popRect.height > vh - VIEWPORT_INSET && rect.top - popRect.height - gap > VIEWPORT_INSET) {
                top = rect.top - popRect.height - gap;
            }

            el.style.top = `${top}px`;
            el.style.left = `${left}px`;
        };

        reposition();
        // Capture-phase scroll catches ANY scrolling ancestor, not just the
        // window; resize of the popover (async content) or the anchor
        // re-points without waiting for a scroll.
        const onScroll = () => reposition();
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        const ro = new ResizeObserver(reposition);
        ro.observe(el);
        if (anchorRef.current) ro.observe(anchorRef.current);

        return () => {
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
            ro.disconnect();
            if (SUPPORTS_POPOVER && el.matches(':popover-open')) el.hidePopover();
        };
    }, [open, placement, gap, anchorRef]);

    // ── Outside-mousedown + Escape ───────────────────────────────────
    useEffect(() => {
        if (!open) return;

        const onDocDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (popRef.current?.contains(target)) return;
            if (anchorRef.current?.contains(target)) return;
            // No stopPropagation: the click still activates whatever was
            // under it (normal dropdown UX — click a second trigger and it
            // both closes this popover and opens its own).
            onCloseRef.current('outside');
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            // Capture phase + preventDefault: when the anchor lives inside
            // an open <dialog>, the first Escape must close the popover
            // ONLY — preventing default stops the dialog's cancel/close
            // request. The next Escape then reaches the dialog.
            event.preventDefault();
            event.stopPropagation();
            onCloseRef.current('escape');
        };

        // Defer attach so the interaction that opened the popover can't
        // immediately close it (source parity).
        const timer = window.setTimeout(() => {
            document.addEventListener('mousedown', onDocDown, true);
            document.addEventListener('keydown', onKey, true);
        }, 0);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener('mousedown', onDocDown, true);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [open, anchorRef]);

    if (!open) return null;

    // Portal target is decided at render. With the Popover API the top layer
    // makes document.body universal; without it, an anchor inside an open
    // modal portals into that <dialog> so the popover paints with its
    // top-layer host. (Ref read during render is idempotent here — the
    // anchor mounts before any user-driven open.)
    const host = SUPPORTS_POPOVER
        ? document.body
        : anchorRef.current?.closest('dialog') ?? document.body;

    return createPortal(
        <div
            role="dialog"
            {...rest}
            ref={popRef}
            popover={SUPPORTS_POPOVER ? 'manual' : undefined}
            className={`mojo-popover${className ? ` ${className}` : ''}`}
        >
            {children}
        </div>,
        host,
    );
}
