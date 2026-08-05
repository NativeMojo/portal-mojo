// Loaders — the "we're fetching / working" family: one spinner atom, a
// blocking full-screen overlay, a section loader, an inline loader, and a
// dim-while-mutating wrapper. Companion to (never a replacement for) the
// skeleton silhouette: skeletons stand in for CONTENT SHAPE that is about to
// arrive; loaders say WORK IS HAPPENING when there is no shape to promise.
// See packages/portal-mojo/docs/loading.md for the decision table.
//
// MERGE-WIRE: index.ts — add `export * from './loading';`
//
// Ported from web-mojo `src/core/views/feedback/BusyIndicator.js` (the only
// loading UI it had: a singleton frosted overlay, reference-counted, message
// swappable, z-index recomputed per show to clear open modals, 30s watchdog).
// Everything that survives is listed here; everything that changed is why:
//
//   KEPT   reference counting — nested call sites compose (show/show/hide/hide)
//   KEPT   newest message wins while the overlay is up
//   KEPT   the 30s watchdog: a caller that throws without closing must not
//          wedge the app behind an overlay nobody can dismiss (console.error)
//   FIXED  z-index arithmetic (`modal.z + 1000`) → a native <dialog> +
//          showModal(): the browser TOP LAYER paints above the whole document,
//          so the overlay clears any open modal with no numbers involved —
//          the same reasoning Popover.tsx uses, and the native inertness of a
//          modal dialog is what makes this actually block input
//   FIXED  hardcoded #fff/#0d6efd/#e9ecef (light-theme only, unreadable in
//          dark) → tokens in apps/portal/src/theme/loading.css, both themes
//   NEW    the anti-flash `delay` + `minVisible` hold. web-mojo showed the
//          overlay on the same tick as the call, so every sub-100ms action
//          strobed. A spinner that appears for 80ms is worse than none.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** Nothing renders before an operation has run this long (ms). */
export const LOADING_DELAY_MS = 200;
/** Once the overlay IS up it stays at least this long — no blink-out (ms). */
export const BUSY_MIN_VISIBLE_MS = 400;
/** Watchdog: a busy ticket never left open longer than this (ms). */
export const BUSY_TIMEOUT_MS = 30_000;

const DEFAULT_BUSY_LABEL = 'Working…';
const isBrowser = typeof document !== 'undefined';

// ── The anti-flash rule ──────────────────────────────────────────────────
// Every loader in this file is gated by this hook. Two thresholds, both
// perceptual: work that finishes inside `delay` produces NO indicator at all
// (the eye reads it as instant), and an indicator that does appear stays for
// at least `minVisible` (a 20ms flash reads as a glitch, not as progress).

export interface DelayOptions {
    /** Suppress the indicator until the work has run this long. Default 200ms. */
    delay?: number;
    /** Once shown, keep it up at least this long. Default 0 (off). */
    minVisible?: number;
}

/**
 * `active` with the flash filed off: true only after `active` has held for
 * `delay`, and (with `minVisible`) never true for less than that once shown.
 *
 * ```ts
 * const show = useDelayedFlag(query.isFetching);            // 200ms default
 * const show = useDelayedFlag(save.isPending, 400);         // number = delay
 * const show = useDelayedFlag(busyish, { delay: 150, minVisible: 500 });
 * ```
 */
export function useDelayedFlag(active: boolean, opts: number | DelayOptions = LOADING_DELAY_MS): boolean {
    const delay = typeof opts === 'number' ? opts : opts.delay ?? LOADING_DELAY_MS;
    const minVisible = typeof opts === 'number' ? 0 : opts.minVisible ?? 0;

    const [on, setOn] = useState(() => active && delay <= 0);
    // When the flag went true, so the hide side can honor minVisible without
    // making `on` an effect dependency (that would restart the timers).
    const shownAt = useRef(0);

    useEffect(() => {
        if (active) {
            if (delay <= 0) {
                shownAt.current = Date.now();
                setOn(true);
                return;
            }
            const timer = window.setTimeout(() => {
                shownAt.current = Date.now();
                setOn(true);
            }, delay);
            return () => window.clearTimeout(timer);
        }

        // Inactive. Never shown (or already hidden) → nothing to hold.
        if (shownAt.current === 0) {
            setOn(false);
            return;
        }
        const held = Date.now() - shownAt.current;
        if (held >= minVisible) {
            shownAt.current = 0;
            setOn(false);
            return;
        }
        const timer = window.setTimeout(() => {
            shownAt.current = 0;
            setOn(false);
        }, minVisible - held);
        return () => window.clearTimeout(timer);
    }, [active, delay, minVisible]);

    return on;
}

// ── Spinner: the atom ────────────────────────────────────────────────────

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

const SPINNER_SIZES: readonly SpinnerSize[] = ['xs', 'sm', 'md', 'lg'];
const warned = new Set<string>();

/** Unknown values fall back to a default WITH a console.warn (house rule),
 *  once per distinct bad value so a render loop can't flood the console. */
function normalizeSize(size: SpinnerSize | number | undefined, where: string): SpinnerSize | number {
    if (size === undefined) return 'md';
    if (typeof size === 'number') {
        if (Number.isFinite(size) && size > 0) return size;
    } else if (SPINNER_SIZES.includes(size)) {
        return size;
    }
    const key = `${where}:${String(size)}`;
    if (!warned.has(key)) {
        warned.add(key);
        console.warn(`${where}: unknown size ${JSON.stringify(size)} — falling back to "md"`);
    }
    return 'md';
}

export interface SpinnerProps {
    /** 'xs' | 'sm' | 'md' | 'lg', or an explicit pixel diameter. Default 'md'. */
    size?: SpinnerSize | number;
    /**
     * Accessible name. OMIT IT when visible text sits beside the spinner —
     * the spinner is then decorative and renders `aria-hidden`. Pass it only
     * when the spinner is the ONLY indication (an icon-only button).
     */
    label?: string;
    className?: string;
}

/**
 * The ring. Colored by `currentColor`, so it inherits its context (white in
 * a primary button, accent in a loader, muted in a table cell).
 */
export function Spinner({ size, label, className }: SpinnerProps) {
    const s = normalizeSize(size, 'Spinner');
    const cls = typeof s === 'number' ? 'mojo-spinner' : `mojo-spinner mojo-spinner-${s}`;
    // React's CSSProperties has no index signature for custom properties.
    const style = typeof s === 'number' ? ({ '--spinner-size': `${s}px` } as CSSProperties) : undefined;
    return (
        <span
            className={`${cls}${className ? ` ${className}` : ''}`}
            style={style}
            // role="img" + a name, never role="status": the atom must not be a
            // live region — its containers (overlay / ViewLoader / InlineLoader)
            // own the announcement, and nesting live regions double-announces.
            {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
        />
    );
}

// ── busy(): the blocking full-screen overlay ─────────────────────────────
// Imperative, like modal.* and toast.* — call it from any handler, close the
// handle when the work settles. Implementation notes:
//
//  · ONE <dialog> element, created on demand, `showModal()`d. Top layer, so
//    it paints above open modals/drawers without a z-index in sight; the rest
//    of the document goes inert, which is what "blocking" has to mean for
//    keyboard users too (pointer-events alone leaves Tab working).
//  · Escape is swallowed (`cancel` → preventDefault): dismissible only by the
//    caller. Focus returns to the pre-open element when it closes (native).
//  · Reference-counted by TICKET, not by an integer: each caller owns its own
//    handle, the newest live ticket's label is the one displayed, and closing
//    the newest reveals the previous label instead of leaving stale text.
//  · Not React-hosted on purpose: no <BusyHost/> to mount, nothing to wire
//    into App.tsx, and it works from non-component code (client interceptors,
//    route guards). <LoadingOverlay> below is the declarative binding.

export interface BusyOptions extends DelayOptions {
    /**
     * Force-close after this long with a console.error (web-mojo parity).
     * Default 30s; pass 0 to disable for a legitimately unbounded operation.
     */
    timeout?: number;
}

export interface BusyHandle {
    /** Take this operation's ticket down. Idempotent. */
    close: () => void;
    /** Swap the label mid-flight ('Saving…' → 'Finalizing…'). */
    setLabel: (label: string) => void;
    /** False once closed (by the caller or the watchdog). */
    isActive: () => boolean;
}

interface BusyTicket {
    label: string;
    minVisible: number;
    mature: boolean;
    delayTimer: number | null;
    watchdog: number | null;
}

let tickets: BusyTicket[] = [];
let el: HTMLDialogElement | null = null;
let labelEl: HTMLParagraphElement | null = null;
let shownAt = 0;
let holdMs = 0;
let hideTimer: number | null = null;

function ensureEl(): HTMLDialogElement | null {
    if (!isBrowser) return null;
    if (el) return el;
    const dlg = document.createElement('dialog');
    dlg.className = 'mojo-busy';
    dlg.setAttribute('aria-busy', 'true');
    // The ONLY way out is the caller's close(). Escape must not strand an
    // operation still running behind a dismissed overlay.
    dlg.addEventListener('cancel', (event) => event.preventDefault());

    const card = document.createElement('div');
    card.className = 'mojo-busy-card';
    const ring = document.createElement('span');
    ring.className = 'mojo-spinner mojo-spinner-md';
    ring.setAttribute('aria-hidden', 'true');
    const text = document.createElement('p');
    text.className = 'mojo-busy-label';
    // Polite live region: a mid-flight label swap is announced, the spinner is not.
    text.setAttribute('role', 'status');
    card.append(ring, text);
    dlg.append(card);
    document.body.appendChild(dlg);

    el = dlg;
    labelEl = text;
    return dlg;
}

function currentLabel(): string {
    return tickets.length > 0 ? tickets[tickets.length - 1]!.label : DEFAULT_BUSY_LABEL;
}

function show() {
    const dlg = ensureEl();
    if (!dlg) return;
    if (!dlg.open) {
        if (typeof dlg.showModal === 'function') {
            try {
                dlg.showModal();
            } catch {
                // Already open in some other stack — the attribute path below
                // still paints (z-index fallback in loading.css).
                dlg.setAttribute('open', '');
            }
        } else {
            dlg.setAttribute('open', '');
        }
        shownAt = Date.now();
        holdMs = tickets.find((t) => t.mature)?.minVisible ?? BUSY_MIN_VISIBLE_MS;
    }
    const text = currentLabel();
    if (labelEl) labelEl.textContent = text;
    dlg.setAttribute('aria-label', text);
}

function hide() {
    if (!el) return;
    if (el.open) el.close();
    el.remove();
    el = null;
    labelEl = null;
    shownAt = 0;
    holdMs = 0;
}

function cancelHide() {
    if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
    }
}

function scheduleHide() {
    if (!el || !el.open) {
        hide();
        return;
    }
    if (hideTimer !== null) return;
    const held = Date.now() - shownAt;
    if (held >= holdMs) {
        hide();
        return;
    }
    hideTimer = window.setTimeout(() => {
        hideTimer = null;
        if (tickets.length === 0) hide();
    }, holdMs - held);
}

function sync() {
    if (!isBrowser) return;
    const isOpen = el?.open === true;
    // Visible once ANY ticket matures — and it stays visible while ANY ticket
    // is still live, mature or not (a follow-up operation started under a live
    // overlay must not blink it out while its own delay runs down).
    if (tickets.some((t) => t.mature) || (isOpen && tickets.length > 0)) {
        cancelHide();
        show();
        return;
    }
    scheduleHide();
}

function drop(ticket: BusyTicket) {
    if (ticket.delayTimer !== null) {
        window.clearTimeout(ticket.delayTimer);
        ticket.delayTimer = null;
    }
    if (ticket.watchdog !== null) {
        window.clearTimeout(ticket.watchdog);
        ticket.watchdog = null;
    }
    if (!tickets.includes(ticket)) return false;
    tickets = tickets.filter((t) => t !== ticket);
    sync();
    return true;
}

/**
 * Show the blocking full-screen overlay. Returns a handle; the caller MUST
 * close it (use `busyWhile` to make that structural).
 *
 * ```ts
 * const b = busy('Rebuilding index…');
 * try { await rebuild(); } finally { b.close(); }
 * ```
 *
 * Use it only for work the user genuinely must wait out — a long save, an
 * export, a destructive batch. Background refreshes get a `ViewLoader`, a
 * skeleton, or nothing at all.
 */
export function busy(label: string = DEFAULT_BUSY_LABEL, opts: BusyOptions = {}): BusyHandle {
    const delay = opts.delay ?? LOADING_DELAY_MS;
    const timeout = opts.timeout ?? BUSY_TIMEOUT_MS;
    const ticket: BusyTicket = {
        label,
        minVisible: opts.minVisible ?? BUSY_MIN_VISIBLE_MS,
        mature: delay <= 0,
        delayTimer: null,
        watchdog: null,
    };
    tickets = [...tickets, ticket];

    if (isBrowser) {
        if (!ticket.mature) {
            ticket.delayTimer = window.setTimeout(() => {
                ticket.delayTimer = null;
                ticket.mature = true;
                sync();
            }, delay);
        }
        if (timeout > 0) {
            ticket.watchdog = window.setTimeout(() => {
                ticket.watchdog = null;
                console.error(`busy(${JSON.stringify(ticket.label)}) ran past ${timeout}ms — force-closing. A caller is not closing its handle.`);
                drop(ticket);
            }, timeout);
        }
    }
    sync();

    return {
        close: () => { drop(ticket); },
        setLabel: (next: string) => {
            ticket.label = next;
            sync();
        },
        isActive: () => tickets.includes(ticket),
    };
}

/**
 * `busy()` with the close built in — the form to reach for, because a throw
 * can never strand the overlay.
 *
 * ```ts
 * await busyWhile('Preparing export…', () => mojoDownload(endpoint, params, 'csv'));
 * ```
 */
export async function busyWhile<T>(label: string, run: () => Promise<T> | T, opts?: BusyOptions): Promise<T> {
    const handle = busy(label, opts);
    try {
        return await run();
    } finally {
        handle.close();
    }
}

/** Escape hatch: drop every overlay ticket (error boundary / hard reset). */
export function closeAllBusy(): void {
    for (const ticket of [...tickets]) drop(ticket);
}

export interface LoadingOverlayProps extends BusyOptions {
    /** While true, the overlay is up (subject to `delay`). */
    active: boolean;
    /** Message on the card. Changing it swaps the text without restarting the delay. */
    label?: string;
}

/**
 * Declarative binding for `busy()` — same overlay, driven by a boolean:
 *
 * ```tsx
 * <LoadingOverlay active={save.isPending} label="Saving changes…" />
 * ```
 *
 * Renders nothing into the React tree (the overlay lives in the top layer).
 */
export function LoadingOverlay({ active, label = DEFAULT_BUSY_LABEL, delay, minVisible, timeout }: LoadingOverlayProps) {
    const handleRef = useRef<BusyHandle | null>(null);
    const labelRef = useRef(label);

    // Declared FIRST so the ref is current before the ticket effect reads it.
    useEffect(() => {
        labelRef.current = label;
        handleRef.current?.setLabel(label);
    }, [label]);

    // `label` is deliberately NOT a dependency here: re-running this effect on
    // a text change would close and re-open the ticket, restarting the delay.
    // The effect above pushes label changes through the live handle instead.
    useEffect(() => {
        if (!active) return;
        const handle = busy(labelRef.current, { delay, minVisible, timeout });
        handleRef.current = handle;
        return () => {
            handle.close();
            handleRef.current = null;
        };
    }, [active, delay, minVisible, timeout]);

    return null;
}

// ── ViewLoader: the section / route loader ───────────────────────────────

export type ViewLoaderSize = 'sm' | 'md' | 'lg';

const VIEW_SIZES: readonly ViewLoaderSize[] = ['sm', 'md', 'lg'];
const VIEW_SPINNER: Record<ViewLoaderSize, SpinnerSize> = { sm: 'sm', md: 'md', lg: 'lg' };

/** Unknown size → 'md' WITH a console.warn (once per bad value). */
function normalizeViewSize(size: ViewLoaderSize | undefined): ViewLoaderSize {
    if (size === undefined || VIEW_SIZES.includes(size)) return size ?? 'md';
    const key = `ViewLoader:${String(size)}`;
    if (!warned.has(key)) {
        warned.add(key);
        console.warn(`ViewLoader: unknown size ${JSON.stringify(size)} — falling back to "md"`);
    }
    return 'md';
}

export interface ViewLoaderProps {
    /** Say what is loading — "Loading members…" beats "Loading…". */
    label?: string;
    /** Second line for the honestly slow ("Large exports can take a minute"). */
    hint?: ReactNode;
    /** Reserved height + spinner size: 'sm' (panel row) | 'md' | 'lg' (route). */
    size?: ViewLoaderSize;
    /** Anti-flash threshold, default 200ms. */
    delay?: number;
    className?: string;
}

/**
 * The panel/route loader: a centered spinner + label for a surface that has
 * NOTHING to show yet and no shape to promise.
 *
 * ```tsx
 * if (query.isPending) return <ViewLoader label="Loading members…" />;
 * ```
 *
 * If you know the shape of what's coming (rows, a detail grid, a card list),
 * use the skeleton silhouette instead — see docs/loading.md.
 */
export function ViewLoader({ label = 'Loading…', hint, size, delay = LOADING_DELAY_MS, className }: ViewLoaderProps) {
    const show = useDelayedFlag(true, delay);
    const s = normalizeViewSize(size);
    const base = `mojo-viewloader mojo-viewloader-${s}${className ? ` ${className}` : ''}`;

    // Pre-delay it still occupies its height — a fast panel that pops in has
    // no layout jump, and a slow one doesn't push content down on arrival.
    if (!show) return <div className={`${base} is-waiting`} aria-hidden="true" />;

    return (
        <div className={base} role="status" aria-busy="true">
            <Spinner size={VIEW_SPINNER[s]} />
            <span className="mojo-viewloader-label">{label}</span>
            {hint != null && <span className="mojo-viewloader-hint">{hint}</span>}
        </div>
    );
}

/** Alias — `LoadingState` reads better inside a route's early return. */
export const LoadingState = ViewLoader;

// ── InlineLoader: a row / field / cell ───────────────────────────────────

export interface InlineLoaderProps {
    /** Default 'Loading…'. Pass '' for a bare spinner (still announced). */
    label?: string;
    /** Anti-flash threshold, default 200ms. */
    delay?: number;
    className?: string;
}

/**
 * Small inline "…loading" for one row, cell, or field — never centered, never
 * reserving space. Renders nothing before `delay`.
 */
export function InlineLoader({ label = 'Loading…', delay = LOADING_DELAY_MS, className }: InlineLoaderProps) {
    const show = useDelayedFlag(true, delay);
    if (!show) return null;
    return (
        <span
            className={`mojo-inline-loader${className ? ` ${className}` : ''}`}
            role="status"
            // Empty label = bare spinner, which is decorative — the status
            // region would otherwise announce nothing at all.
            {...(label === '' ? { 'aria-label': 'Loading' } : {})}
        >
            <Spinner size="xs" />
            {label !== '' && <span className="mojo-inline-loader-label">{label}</span>}
        </span>
    );
}

// ── Busy: dim + disable a region while a mutation is in flight ───────────

export interface BusyProps {
    /** In-flight flag (a mutation's `isPending`). */
    active: boolean;
    /** Optional caption under the veil spinner. */
    label?: string;
    /** Anti-flash threshold for the DIM only — blocking is immediate. */
    delay?: number;
    /** Set false for a bare dim with no spinner (dense rows). */
    spinner?: boolean;
    className?: string;
    children: ReactNode;
}

/**
 * Wrap a form/card whose own submit is in flight: input is blocked THE INSTANT
 * `active` goes true (no double-submits), while the dim + spinner wait out the
 * anti-flash delay so a 60ms save doesn't strobe the panel.
 *
 * ```tsx
 * <Busy active={save.isPending} label="Saving…">
 *     <SchemaForm … />
 * </Busy>
 * ```
 *
 * Blocking is the native `inert` attribute — pointer AND keyboard AND the
 * accessibility tree, which `pointer-events: none` alone never covers.
 */
export function Busy({ active, label, delay = LOADING_DELAY_MS, spinner = true, className, children }: BusyProps) {
    const dim = useDelayedFlag(active, delay);
    const contentRef = useRef<HTMLDivElement>(null);
    const restoreRef = useRef<HTMLElement | null>(null);

    // Going inert BLURS whatever was focused inside — the field the user was
    // typing in when they hit save. Remember it, and put focus back when the
    // mutation settles, but only if nothing else claimed it meanwhile (the
    // user may have deliberately clicked away; yanking focus back is worse
    // than losing it).
    useEffect(() => {
        if (active) {
            const el = document.activeElement;
            restoreRef.current = el instanceof HTMLElement && contentRef.current?.contains(el) ? el : null;
            return;
        }
        const target = restoreRef.current;
        restoreRef.current = null;
        const parked = document.activeElement === null || document.activeElement === document.body;
        if (target?.isConnected && parked) target.focus({ preventScroll: true });
    }, [active]);

    return (
        <div className={`mojo-dim${dim ? ' is-busy' : ''}${className ? ` ${className}` : ''}`} aria-busy={active}>
            <div className="mojo-dim-content" ref={contentRef} inert={active}>{children}</div>
            {dim && spinner && (
                <div className="mojo-dim-veil" role="status">
                    <Spinner size="sm" />
                    {label != null && label !== '' && <span className="mojo-dim-veil-label">{label}</span>}
                </div>
            )}
        </div>
    );
}
