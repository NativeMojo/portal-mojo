import {
    createContext, useCallback, useContext, useEffect, useId, useLayoutEffect,
    useRef, useState, type ReactNode,
} from 'react';

export interface RightPanelRenderContext {
    close(): void;
}

export interface RightPanelDescriptor {
    /** Stable session identity. Opening the same key is idempotent. */
    key: string;
    /** Visible accessible heading for the complementary region. */
    title: ReactNode;
    render(context: RightPanelRenderContext): ReactNode;
}

export interface RightPanelContextValue {
    descriptor: RightPanelDescriptor | null;
    isOpen: boolean;
    open(descriptor: RightPanelDescriptor, launcher?: HTMLElement | null): void;
    close(): void;
}

const RightPanelContext = createContext<RightPanelContextValue | null>(null);

export function RightPanelProvider({ children }: { children: ReactNode }) {
    const [descriptor, setDescriptor] = useState<RightPanelDescriptor | null>(null);
    const launcherRef = useRef<HTMLElement | null>(null);
    const descriptorRef = useRef<RightPanelDescriptor | null>(null);
    descriptorRef.current = descriptor;

    const open = useCallback((next: RightPanelDescriptor, launcher?: HTMLElement | null) => {
        if (descriptorRef.current?.key === next.key) return;
        const active = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        launcherRef.current = launcher ?? active;
        descriptorRef.current = next;
        setDescriptor(next);
    }, []);

    const close = useCallback(() => {
        if (descriptorRef.current == null) return;
        descriptorRef.current = null;
        setDescriptor(null);
        const launcher = launcherRef.current;
        launcherRef.current = null;
        requestAnimationFrame(() => {
            if (launcher?.isConnected) launcher.focus();
        });
    }, []);

    useEffect(() => {
        if (!descriptor) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            // Native dialogs own Escape while they are in the top layer.
            if (document.querySelector('dialog[open]')) return;
            event.preventDefault();
            close();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [descriptor, close]);

    return (
        <RightPanelContext.Provider value={{ descriptor, isOpen: descriptor != null, open, close }}>
            {children}
        </RightPanelContext.Provider>
    );
}

export function useRightPanel(): RightPanelContextValue {
    const context = useContext(RightPanelContext);
    if (!context) throw new Error('useRightPanel must be used inside <RightPanelProvider>');
    return context;
}

export function RightPanelSlot({ className }: { className?: string }) {
    const { descriptor, close } = useRightPanel();
    const uid = useId();
    const headingId = `right-panel-heading-${uid}`;
    const closeRef = useRef<HTMLButtonElement>(null);

    useLayoutEffect(() => {
        if (!descriptor) return;
        closeRef.current?.focus();
    }, [descriptor?.key]);

    if (!descriptor) return null;
    return (
        <aside
            className={`right-panel${className ? ` ${className}` : ''}`}
            role="complementary"
            aria-labelledby={headingId}
        >
            <header className="right-panel-head">
                <h2 id={headingId} tabIndex={-1}>{descriptor.title}</h2>
                <button ref={closeRef} type="button" className="btn-icon" onClick={close} aria-label="Close panel" title="Close panel">
                    <i className="bi bi-x-lg" aria-hidden="true" />
                </button>
            </header>
            <div className="right-panel-body">{descriptor.render({ close })}</div>
        </aside>
    );
}
