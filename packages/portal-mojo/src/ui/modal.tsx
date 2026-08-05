// ModalManager — ports web-mojo's imperative, awaitable Modal API onto
// native <dialog> + a portal-free host. `await modal.confirm(...)` from any
// event handler; no JSX modal state to hoist. The z-index/backdrop stack
// manager web-mojo needed does not exist here: <dialog> stacks natively.
import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';

export type ModalSize = 'sm' | 'md' | 'lg';

/** Drawer width: the 'wide' preset, or an explicit pixel number. */
export type DrawerWidth = number | 'wide';

/** One entry of the drawer's "context · title · meta" subtitle row. */
export type DrawerMeta = string | { icon?: string; text: ReactNode };

export interface DrawerOptions<T> {
    /** Big header line. */
    title?: ReactNode;
    /** Small uppercase tag above the title. */
    eyebrow?: ReactNode;
    /** Subtitle row under the title: bare strings or `{icon, text}`. */
    meta?: DrawerMeta[];
    /** Static body. Ignored when `render` is given. */
    content?: ReactNode;
    /** Body that owns the result: call `close(value)` to resolve the await. */
    render?: (close: (value: T | null) => void) => ReactNode;
    /** Default 480px; 'wide' → 720px; or an explicit pixel number. */
    width?: DrawerWidth;
    /** Escape / backdrop / header-X dismissal (resolves null). Default true. */
    dismissable?: boolean;
}

interface BaseItem {
    id: number;
    render: (close: (value: unknown) => void) => ReactNode;
    resolve: (value: unknown) => void;
}

interface ModalItem extends BaseItem {
    variant: 'modal';
    size: ModalSize;
    flush: boolean; // no body padding (DetailView-style)
}

interface DrawerItem extends BaseItem {
    variant: 'drawer';
    title?: ReactNode;
    eyebrow?: ReactNode;
    meta?: DrawerMeta[];
    width: number;
    dismissable: boolean;
    closing: boolean; // exit animation in flight — see drawer()'s two-phase close
}

type StackItem = ModalItem | DrawerItem;

let nextId = 1;
let stack: StackItem[] = [];
const listeners = new Set<() => void>();

function emit() {
    listeners.forEach((fn) => fn());
}

function open<T>(render: (close: (value: T) => void) => ReactNode, opts: { size?: ModalSize; flush?: boolean } = {}): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
        const id = nextId++;
        const close = (value: unknown) => {
            stack = stack.filter((m) => m.id !== id);
            emit();
            resolve(value as T | null);
        };
        stack = [...stack, {
            id,
            variant: 'modal',
            size: opts.size ?? 'md',
            flush: opts.flush ?? false,
            render: render as (close: (value: unknown) => void) => ReactNode,
            resolve: close,
        }];
        emit();
    });
}

// ── Drawer ────────────────────────────────────────────────────────────
// Right slide-over. Same <dialog> substrate as every other modal (backdrop,
// Escape and stacking come free), so a drawer opened from a modal simply
// takes the top layer. web-mojo's Modal.drawer() header shape — eyebrow /
// title / meta row — is carried over verbatim; the right-anchored panel and
// the awaitable close are the parts it never had.

const DRAWER_W_DEFAULT = 480;
const DRAWER_W_WIDE = 720;
const DRAWER_W_MIN = 280;
/** Must match the .mojo-drawer-closing animation in the app's drawer.css. */
const DRAWER_EXIT_MS = 200;

function reducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function drawerWidthPx(width: DrawerWidth | undefined): number {
    if (width === undefined) return DRAWER_W_DEFAULT;
    if (width === 'wide') return DRAWER_W_WIDE;
    if (typeof width === 'number' && Number.isFinite(width) && width > 0) return Math.max(DRAWER_W_MIN, width);
    console.warn(`modal.drawer: unknown width ${JSON.stringify(width)} — falling back to ${DRAWER_W_DEFAULT}px`);
    return DRAWER_W_DEFAULT;
}

function drawer<T = unknown>(opts: DrawerOptions<T>): Promise<T | null> {
    const body = opts.render ?? (() => opts.content ?? null);
    let dismissable = opts.dismissable ?? true;
    if (!dismissable && !opts.render) {
        // Nothing else can close it: no X, no Escape, no backdrop, and a static
        // `content` has no close() to call. Fall back rather than trap the user.
        console.warn('modal.drawer: dismissable:false needs a render() that can close the drawer — falling back to dismissable');
        dismissable = true;
    }

    return new Promise<T | null>((resolve) => {
        const id = nextId++;
        let settled = false;

        // Two-phase close so the slide-out actually plays: flip `closing` (CSS
        // transforms the panel off-screen), wait out the animation, THEN drop
        // the item — unmounting calls dialog.close() — and settle the promise.
        const close = (value: unknown) => {
            if (settled) return; // Escape + backdrop + a body button can race
            settled = true;
            stack = stack.map((m) => (m.id === id && m.variant === 'drawer' ? { ...m, closing: true } : m));
            emit();
            const drop = () => {
                stack = stack.filter((m) => m.id !== id);
                emit();
                resolve(value as T | null);
            };
            if (reducedMotion()) drop();
            else window.setTimeout(drop, DRAWER_EXIT_MS);
        };

        stack = [...stack, {
            id,
            variant: 'drawer',
            title: opts.title,
            eyebrow: opts.eyebrow,
            meta: opts.meta,
            width: drawerWidthPx(opts.width),
            dismissable,
            closing: false,
            render: body as (close: (value: unknown) => void) => ReactNode,
            resolve: close,
        }];
        emit();
    });
}

export const modal = {
    open,

    /** Detail modal: large, flush body — the Modal.detail() envelope. */
    detail(render: (close: (value: unknown) => void) => ReactNode): Promise<unknown> {
        return open(render, { size: 'lg', flush: true });
    },

    /**
     * Right slide-over drawer. Awaitable like every other static: resolves
     * whatever `render`'s `close(value)` passes, or `null` on dismiss.
     * TRANSIENT and modal — not the persistent shell right-panel slot.
     */
    drawer,

    confirm(opts: { title?: string; message: ReactNode; confirmText?: string; cancelText?: string; danger?: boolean }): Promise<boolean> {
        return open<boolean>((close) => (
            <div className="modal-pad">
                {opts.title && <h2 className="modal-title">{opts.title}</h2>}
                <div className="modal-message">{opts.message}</div>
                <div className="modal-actions">
                    <button className="btn" onClick={() => close(false)}>{opts.cancelText ?? 'Cancel'}</button>
                    <button className={opts.danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => close(true)}>
                        {opts.confirmText ?? 'Confirm'}
                    </button>
                </div>
            </div>
        ), { size: 'sm' }).then((v) => v === true);
    },
};

function ModalDialog({ item }: { item: ModalItem }) {
    const ref = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        ref.current?.showModal();
    }, []);

    return (
        <dialog
            ref={ref}
            className={`mojo-modal mojo-modal-${item.size}${item.flush ? ' mojo-modal-flush' : ''}`}
            onCancel={(e) => { e.preventDefault(); item.resolve(null); }}
            onMouseDown={(e) => { if (e.target === ref.current) item.resolve(null); }}
        >
            {item.render(item.resolve)}
        </dialog>
    );
}

function DrawerDialog({ item }: { item: DrawerItem }) {
    const ref = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const el = ref.current;
        el?.showModal();
        // Unmount is the END of the exit animation (the manager holds the item
        // until then), so this is the "closing class, animate, then close()"
        // order — and it fires the native close event / restores focus.
        return () => { if (el?.open) el.close(); };
    }, []);

    const dismiss = () => { if (item.dismissable) item.resolve(null); };
    const hasHead = item.dismissable || item.eyebrow != null || item.title != null || (item.meta?.length ?? 0) > 0;

    return (
        <dialog
            ref={ref}
            className={`mojo-drawer${item.closing ? ' mojo-drawer-closing' : ''}`}
            // React's CSSProperties has no index signature for custom props.
            style={{ '--drawer-w': `${item.width}px` } as CSSProperties}
            onCancel={(e) => { e.preventDefault(); dismiss(); }}
            onMouseDown={(e) => { if (e.target === ref.current) dismiss(); }}
        >
            {/* The panel fills the dialog, so the dialog element is only ever
                the event target for ::backdrop clicks — that is the dismiss. */}
            <div className="drawer-panel">
                {hasHead && (
                    <header className="drawer-head">
                        <div className="drawer-head-text">
                            {item.eyebrow != null && <span className="drawer-eyebrow">{item.eyebrow}</span>}
                            {item.title != null && <h2 className="drawer-title">{item.title}</h2>}
                            {!!item.meta?.length && (
                                <div className="drawer-meta">
                                    {item.meta.map((m, i) => {
                                        const entry = typeof m === 'string' ? { icon: undefined, text: m } : m;
                                        return (
                                            <span key={i}>
                                                {entry.icon && <i className={`bi ${entry.icon}`} />}
                                                {entry.text}
                                            </span>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        {item.dismissable && (
                            <button className="btn-icon" onClick={dismiss} title="Close" aria-label="Close">
                                <i className="bi bi-x-lg" />
                            </button>
                        )}
                    </header>
                )}
                <div className="drawer-body">{item.render(item.resolve)}</div>
            </div>
        </dialog>
    );
}

export function ModalHost() {
    const items = useSyncExternalStore(
        (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
        () => stack,
    );
    return (
        <>
            {items.map((item) => (
                item.variant === 'drawer'
                    ? <DrawerDialog key={item.id} item={item} />
                    : <ModalDialog key={item.id} item={item} />
            ))}
        </>
    );
}
