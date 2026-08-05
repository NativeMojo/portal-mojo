// Minimal toast — the ToastService API shape (success/error/info) on a
// 60-line store. Visual spec from web-mojo's toast.css: left accent bar,
// compact two-line card, bottom-right.
import { useSyncExternalStore } from 'react';

type Level = 'success' | 'error' | 'info' | 'warning';
interface Toast { id: number; level: Level; message: string }

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

function push(level: Level, message: string) {
    const id = nextId++;
    toasts = [...toasts, { id, level, message }].slice(-5);
    emit();
    setTimeout(() => {
        toasts = toasts.filter((t) => t.id !== id);
        emit();
    }, 3500);
}

export const toast = {
    success: (m: string) => push('success', m),
    error: (m: string) => push('error', m),
    info: (m: string) => push('info', m),
    /** Partial outcomes (batch "N succeeded, M failed"). */
    warning: (m: string) => push('warning', m),
};

const ICONS: Record<Level, string> = {
    success: 'bi-check-circle-fill',
    error: 'bi-x-circle-fill',
    info: 'bi-info-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
};

export function ToastHost() {
    const items = useSyncExternalStore(
        (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
        () => toasts,
    );
    return (
        <div className="toast-host" role="status" aria-live="polite">
            {items.map((t) => (
                <div key={t.id} className={`toast-card toast-${t.level}`}>
                    <i className={`bi ${ICONS[t.level]}`} />
                    <span>{t.message}</span>
                </div>
            ))}
        </div>
    );
}
