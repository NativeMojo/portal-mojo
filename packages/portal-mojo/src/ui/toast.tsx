// Toast manager — the ToastService API shape (success/error/info/warning) on
// a small external store, plus the two maestro idioms ported from
// workspaces/js/dom.js:
//   · toast.undo / undoToast (dom.js:84-103) — act IMMEDIATELY, offer Undo
//     for a grace window (replaces confirm() for reversible actions). Undo
//     dismisses at once and runs the handler; otherwise auto-dismisses.
//   · toast.progress / progressToast (dom.js:41-79) — persistent card with a
//     bar. Handle: update(0..100) / finalizing(msg?) / done(msg?) /
//     fail(msg?) / remove();
//     optional onCancel renders a ✕ that ABORTS the caller's operation (the
//     caller then calls fail/remove — cancel itself never dismisses).
//
// Basic toasts keep the original behavior byte-for-byte: 3.5s life, newest
// last, capped at 5. The cap deliberately does NOT count undo/progress cards
// — evicting a live progress bar because five saves toasted would orphan an
// in-flight operation's only indicator.
//
// Visual spec from web-mojo's toast.css (left accent bar, compact card,
// bottom-right); idiom styles live in the app's theme/idioms.css — tokens
// only, both themes.
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

type Level = 'success' | 'error' | 'info' | 'warning';

interface BasicToast { id: number; kind: 'basic'; level: Level; message: string }
interface UndoToastItem { id: number; kind: 'undo'; message: string; onUndo?: () => void }
interface ProgressToastItem {
    id: number;
    kind: 'progress';
    label: string;
    pct: number;
    state: 'active' | 'finalizing' | 'done' | 'error';
    onCancel?: () => void;
}
type ToastItem = BasicToast | UndoToastItem | ProgressToastItem;

let nextId = 1;
let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

function remove(id: number) {
    if (!toasts.some((t) => t.id === id)) return;
    toasts = toasts.filter((t) => t.id !== id);
    emit();
}

/** Immutable in-place update — the store array is replaced so React sees it. */
function patch(id: number, changes: Partial<ProgressToastItem>) {
    toasts = toasts.map((t) => (t.id === id ? ({ ...t, ...changes } as ToastItem) : t));
    emit();
}

function push(level: Level, message: string) {
    const id = nextId++;
    const basics = toasts.filter((t) => t.kind === 'basic');
    // Cap BASIC toasts at 5 (original behavior); persistent cards are exempt.
    const evict = basics.length >= 5 ? basics[0]!.id : null;
    toasts = [...toasts.filter((t) => t.id !== evict), { id, kind: 'basic', level, message }];
    emit();
    setTimeout(() => remove(id), 3500);
}

export interface UndoToastHandle { dismiss: () => void }

/**
 * Act-then-offer-Undo (dom.js undoToast port). The ACTION HAS ALREADY
 * HAPPENED when this shows — clicking Undo dismisses and calls `onUndo`;
 * otherwise the card auto-dismisses after `timeout` ms and the action
 * stands. Returns { dismiss } for callers that resolve the ambiguity early.
 */
export function undoToast(message: string, onUndo?: () => void, opts: { timeout?: number } = {}): UndoToastHandle {
    const id = nextId++;
    toasts = [...toasts, { id, kind: 'undo', message, onUndo }];
    emit();
    const timer = setTimeout(() => remove(id), opts.timeout ?? 6000);
    return {
        dismiss: () => { clearTimeout(timer); remove(id); },
    };
}

export interface ProgressToastHandle {
    /** Set the bar, clamped+rounded to 0–100. */
    update: (pct: number) => void;
    /** 100% + non-cancellable finalization state; the operation is not settled yet. */
    finalizing: (message?: string) => void;
    /** 100% + ✓, optional label swap, auto-removes after 1.4s. */
    done: (message?: string) => void;
    /** Error styling + ✕, optional label swap, auto-removes after 5s. */
    fail: (message?: string) => void;
    /** Immediate removal (e.g. after the caller aborted on cancel). */
    remove: () => void;
}

/**
 * Persistent progress card (dom.js progressToast port). Never auto-dismisses
 * while active — the caller drives it to done()/fail()/remove(). Pass
 * `onCancel` to render a ✕ that calls it; cancel ABORTS the operation on the
 * caller's side and the caller then settles the toast.
 */
export function progressToast(label: string, opts: { onCancel?: () => void } = {}): ProgressToastHandle {
    const id = nextId++;
    toasts = [...toasts, { id, kind: 'progress', label, pct: 0, state: 'active', onCancel: opts.onCancel }];
    emit();
    let settled = false;
    return {
        update: (pct: number) => {
            if (settled) return;
            patch(id, { pct: Math.max(0, Math.min(100, Math.round(pct || 0))) });
        },
        finalizing: (message?: string) => {
            if (settled) return;
            patch(id, { pct: 100, state: 'finalizing', ...(message ? { label: message } : {}), onCancel: undefined });
        },
        done: (message?: string) => {
            if (settled) return;
            settled = true;
            patch(id, { pct: 100, state: 'done', ...(message ? { label: message } : {}), onCancel: undefined });
            setTimeout(() => remove(id), 1400);
        },
        fail: (message?: string) => {
            if (settled) return;
            settled = true;
            patch(id, { state: 'error', ...(message ? { label: message } : {}), onCancel: undefined });
            setTimeout(() => remove(id), 5000);
        },
        remove: () => { settled = true; remove(id); },
    };
}

export const toast = {
    success: (m: string) => push('success', m),
    error: (m: string) => push('error', m),
    info: (m: string) => push('info', m),
    /** Partial outcomes (batch "N succeeded, M failed"). */
    warning: (m: string) => push('warning', m),
    /** Act immediately, offer a grace-window Undo. See undoToast(). */
    undo: undoToast,
    /** Persistent progress card with a bar. See progressToast(). */
    progress: progressToast,
};

const ICONS: Record<Level, string> = {
    success: 'bi-check-circle-fill',
    error: 'bi-x-circle-fill',
    info: 'bi-info-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
};

function ProgressCard({ t }: { t: ProgressToastItem }) {
    return (
        <div className={`toast-card toast-progress${t.state === 'finalizing' ? ' is-finalizing' : ''}${t.state === 'done' ? ' is-done' : ''}${t.state === 'error' ? ' toast-error is-failed' : ''}`}>
            <div className="progress-head">
                <div className="progress-name" title={t.label}>{t.label}</div>
                {t.onCancel && t.state === 'active' && (
                    <button
                        type="button"
                        className="progress-cancel"
                        title="Cancel"
                        aria-label="Cancel"
                        onClick={() => t.onCancel?.()}
                    >
                        <i className="bi bi-x-lg" />
                    </button>
                )}
            </div>
            <div className="progress-row">
                <div
                    className="progress-bar"
                    role="progressbar"
                    aria-valuenow={t.pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                >
                    <div className="progress-fill" style={{ width: `${t.pct}%` }} />
                </div>
                <span className="progress-pct">
                    {t.state === 'done' ? <i className="bi bi-check-lg" /> : t.state === 'error' ? <i className="bi bi-x-lg" /> : t.state === 'finalizing' ? <i className="bi bi-arrow-repeat spin" /> : `${t.pct}%`}
                </span>
            </div>
        </div>
    );
}

export function ToastHost() {
    const items = useSyncExternalStore(
        (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
        () => toasts,
    );
    // Keep one portal target so moving above a new modal preserves live cards.
    const [host] = useState(() => typeof document === 'undefined' ? null : document.createElement('div'));
    const visible = useRef(false);
    visible.current = items.length > 0;
    const syncHost = useRef<() => void>(() => {});
    useLayoutEffect(() => {
        if (!host) return;
        host.className = 'toast-host';
        host.setAttribute('role', 'status');
        host.setAttribute('aria-live', 'polite');
        const supportsPopover = typeof host.showPopover === 'function';
        if (supportsPopover) host.setAttribute('popover', 'manual');
        let dialogs: HTMLDialogElement[] = [];
        const sync = (records: MutationRecord[] = []) => {
            const open = Array.from(document.querySelectorAll('dialog')).filter(dialog => dialog.matches(':modal'));
            dialogs = dialogs.filter(dialog => open.includes(dialog));
            for (const dialog of open) if (!dialogs.includes(dialog)) dialogs.push(dialog);
            // Opening order, not DOM order, determines the active native modal.
            for (const record of records) {
                if (record.type !== 'attributes' || record.oldValue !== null || !(record.target instanceof HTMLDialogElement) || !open.includes(record.target)) continue;
                dialogs = [...dialogs.filter(dialog => dialog !== record.target), record.target];
            }
            const parent = dialogs.at(-1) ?? document.body;
            const moved = host.parentElement !== parent;
            if (supportsPopover && host.matches(':popover-open') && (moved || !visible.current)) host.hidePopover();
            // A body-level popover paints above dialogs but remains inert.
            // Modal-local ancestry is required for Undo/Cancel and keyboard use.
            if (moved) parent.appendChild(host);
            if (supportsPopover && visible.current && !host.matches(':popover-open')) host.showPopover();
        };
        syncHost.current = sync;
        const observer = new MutationObserver(sync);
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'], attributeOldValue: true });
        sync();
        return () => {
            observer.disconnect();
            syncHost.current = () => {};
            if (supportsPopover && host.matches(':popover-open')) host.hidePopover();
            host.remove();
        };
    }, [host]);
    useLayoutEffect(() => { syncHost.current(); }, [items.length > 0]);
    return host ? createPortal(
        <>
            {items.map((t) => {
                if (t.kind === 'basic') {
                    return (
                        <div key={t.id} className={`toast-card toast-${t.level}`}>
                            <i className={`bi ${ICONS[t.level]}`} />
                            <span>{t.message}</span>
                        </div>
                    );
                }
                if (t.kind === 'undo') {
                    return (
                        <div key={t.id} className="toast-card toast-undo">
                            <span className="undo-msg">{t.message}</span>
                            <button
                                type="button"
                                className="undo-btn"
                                onClick={() => { remove(t.id); t.onUndo?.(); }}
                            >
                                Undo
                            </button>
                        </div>
                    );
                }
                return <ProgressCard key={t.id} t={t} />;
            })}
        </>, host,
    ) : null;
}
