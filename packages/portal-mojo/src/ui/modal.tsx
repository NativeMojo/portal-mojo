// ModalManager — ports web-mojo's imperative, awaitable Modal API onto
// native <dialog> + a portal-free host. `await modal.confirm(...)` from any
// event handler; no JSX modal state to hoist. The z-index/backdrop stack
// manager web-mojo needed does not exist here: <dialog> stacks natively.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

export type ModalSize = 'sm' | 'md' | 'lg';

interface ModalItem {
    id: number;
    size: ModalSize;
    flush: boolean; // no body padding (DetailView-style)
    render: (close: (value: unknown) => void) => ReactNode;
    resolve: (value: unknown) => void;
}

let nextId = 1;
let stack: ModalItem[] = [];
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
            size: opts.size ?? 'md',
            flush: opts.flush ?? false,
            render: render as (close: (value: unknown) => void) => ReactNode,
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

export function ModalHost() {
    const items = useSyncExternalStore(
        (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
        () => stack,
    );
    return <>{items.map((item) => <ModalDialog key={item.id} item={item} />)}</>;
}
