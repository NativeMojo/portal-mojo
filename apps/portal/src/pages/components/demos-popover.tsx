// Popover demos — the anchored top-layer primitive every dropdown-style
// control mounts in: basic toggle on a button (plus a focus-keeping input
// anchor, the autocomplete precondition), all four placements with live
// anchor re-pointing, one INSIDE a native-<dialog> modal (top-layer
// stacking is the point of the component), and repositioning inside a
// scrolling container.
import { useRef, useState, type MouseEvent } from 'react';
import { Popover, type PopoverPlacement } from '../../../../../packages/portal-mojo/src/ui/Popover'; // MERGE-WIRE: portal-mojo/ui
import { modal } from '../../../../../packages/portal-mojo/src/ui/modal'; // MERGE-WIRE: portal-mojo/ui
import { toast } from '../../../../../packages/portal-mojo/src/ui/toast'; // MERGE-WIRE: portal-mojo/ui

/** A menu-shaped filling so the shell reads as a real dropdown. */
function MenuContent({ onPick }: { onPick: (label: string) => void }) {
    const items = [
        { icon: 'bi-files', label: 'Duplicate' },
        { icon: 'bi-folder-symlink', label: 'Move to group' },
        { icon: 'bi-download', label: 'Export CSV' },
    ];
    return (
        <div style={{ padding: 5, minWidth: 190 }}>
            {items.map((it) => (
                <button key={it.label} className="filter-menu-item" onClick={() => onPick(it.label)}>
                    <i className={`bi ${it.icon}`} /> <span>{it.label}</span>
                </button>
            ))}
        </div>
    );
}

function BasicPanel() {
    const btnRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const [inputOpen, setInputOpen] = useState(false);
    const [typed, setTyped] = useState('');
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Basic</div>
            <div className="demo-row">
                <button ref={btnRef} className="btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                    <i className="bi bi-menu-button-wide" /> Toggle popover
                </button>
                <span className="dim">
                    Outside-mousedown and Escape close it; the opening click can't insta-close it
                    (deferred listener attach). Clicking the anchor is never "outside" — the
                    button's own handler owns the toggle.
                </span>
            </div>
            <Popover anchorRef={btnRef} open={open} onClose={() => setOpen(false)}>
                <MenuContent onPick={(label) => { setOpen(false); toast.info(`picked: ${label}`); }} />
            </Popover>

            <div className="demo-row" style={{ marginTop: 14 }}>
                <input
                    ref={inputRef}
                    className="input input-compact"
                    style={{ width: 240 }}
                    placeholder="Focus me, then keep typing…"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onFocus={() => setInputOpen(true)}
                />
                <span className="dim">Opening never steals focus — the autocomplete precondition.</span>
            </div>
            <Popover anchorRef={inputRef} open={inputOpen} onClose={() => setInputOpen(false)}>
                <div className="dim" style={{ padding: '10px 12px', maxWidth: 280 }}>
                    {typed
                        ? <>You typed <b style={{ color: 'var(--ink-strong)' }}>{typed}</b> with the popover open.</>
                        : 'Type in the input — focus stays there while I follow along.'}
                </div>
            </Popover>
        </div>
    );
}

function PlacementsPanel() {
    // ONE Popover instance: clicking a different trigger swaps
    // anchorRef.current — the anchor re-point path, not four popovers.
    const anchorRef = useRef<HTMLElement | null>(null);
    const [which, setWhich] = useState<PopoverPlacement | null>(null);
    const pick = (p: PopoverPlacement) => (e: MouseEvent<HTMLButtonElement>) => {
        anchorRef.current = e.currentTarget;
        setWhich((cur) => (cur === p ? null : p));
    };
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Placements</div>
            <div className="demo-row" style={{ justifyContent: 'center', gap: 14, padding: '52px 0' }}>
                {(['bottom-start', 'bottom-end', 'top-start', 'top-end'] as const).map((p) => (
                    <button key={p} className={`btn${which === p ? ' btn-has-filters' : ''}`} onClick={pick(p)}>
                        {p}
                    </button>
                ))}
            </div>
            <Popover
                anchorRef={anchorRef}
                open={which !== null}
                onClose={() => setWhich(null)}
                placement={which ?? 'bottom-start'}
                gap={8}
            >
                <div style={{ padding: '10px 14px' }}>
                    <span className="eyebrow" style={{ marginBottom: 0 }}>{which}</span>
                </div>
            </Popover>
            <p className="dim" style={{ margin: 0 }}>
                One Popover, four triggers — each click re-points <code>anchorRef.current</code>.
                Custom <code>gap=8</code> (default 6). bottom-* placements flip above when the
                viewport runs out of room below; every placement clamps horizontally.
            </p>
        </div>
    );
}

// ── Inside a native-<dialog> modal ───────────────────────────────────
// The whole reason the primitive exists: <dialog showModal> lives in the
// browser top layer, above ANY z-index. The popover joins the top layer
// after it via the HTML Popover API, so it paints above the modal.
function ModalPopoverContent({ close }: { close: (value: unknown) => void }) {
    const btnRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const [picked, setPicked] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const [inputOpen, setInputOpen] = useState(false);
    const [typed, setTyped] = useState('');
    return (
        <div className="modal-pad">
            <h2 className="modal-title">Popover above a top-layer modal</h2>
            <p className="modal-message">
                This dialog is native <code>showModal()</code> — a top-layer member that paints
                over any z-index. The popover joins the top layer after it, so it stacks above.
                Escape closes the popover first; a second Escape closes the modal.
            </p>
            <div className="demo-row">
                <button ref={btnRef} className="btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                    <i className="bi bi-menu-button-wide" /> Open popover
                </button>
                <input
                    ref={inputRef}
                    className="input input-compact"
                    style={{ width: 200 }}
                    placeholder="Or focus me and type…"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onFocus={() => setInputOpen(true)}
                />
                {picked && <span className="dim">picked: {picked}</span>}
            </div>
            <Popover anchorRef={btnRef} open={open} onClose={() => setOpen(false)}>
                <MenuContent onPick={(label) => { setOpen(false); setPicked(label); }} />
            </Popover>
            <Popover anchorRef={inputRef} open={inputOpen} onClose={() => setInputOpen(false)}>
                <div className="dim" style={{ padding: '10px 12px', maxWidth: 260 }}>
                    {typed ? <>Typing works: <b style={{ color: 'var(--ink-strong)' }}>{typed}</b></> : 'Focus stays in the input.'}
                </div>
            </Popover>
            <div className="modal-actions">
                <button className="btn" onClick={() => close(null)}>Close</button>
            </div>
        </div>
    );
}

function ModalPanel() {
    return (
        <div className="panel panel-pad demo-row">
            <button
                className="btn btn-primary"
                onClick={() => { void modal.open((close) => <ModalPopoverContent close={close} />); }}
            >
                <i className="bi bi-front" /> Open modal with a popover inside
            </button>
            <span className="dim">Proves top-layer stacking — a body-portaled z-indexed div would render under the dialog.</span>
        </div>
    );
}

function ScrollPanel() {
    const btnRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Repositioning in a scroll container</div>
            <div style={{ height: 170, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface2)' }}>
                <div style={{ height: 84 }} />
                <div style={{ padding: '0 14px' }}>
                    <button ref={btnRef} className="btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                        <i className="bi bi-arrows-move" /> Anchor inside scrolling content
                    </button>
                </div>
                <div style={{ height: 280 }} />
            </div>
            <Popover anchorRef={btnRef} open={open} onClose={() => setOpen(false)}>
                <div className="dim" style={{ padding: '8px 12px' }}>
                    Scroll the container — I stay glued to the anchor.
                </div>
            </Popover>
            <p className="dim" style={{ margin: '12px 0 0' }}>
                Container scrolls don't bubble, so the popover listens in the CAPTURE phase —
                any ancestor's scroll (or a window resize, or the anchor/popover resizing)
                repositions it. Being portal-mounted, it also escapes the container's
                clipping entirely.
            </p>
        </div>
    );
}

export function PopoverDemo() {
    return (
        <>
            <BasicPanel />
            <PlacementsPanel />
            <ModalPanel />
            <ScrollPanel />
        </>
    );
}
