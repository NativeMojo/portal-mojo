// Drawer demos: the right slide-over variant of the awaitable modal manager.
// Every button here exercises one contract point — width presets, the
// eyebrow/title/meta header, stacking over a modal, the awaited result, and
// the non-dismissable case where the body owns the only way out.
import { toast } from 'portal-mojo/ui';
// MERGE-WIRE: portal-mojo/ui — must become `import { modal, toast } from
// 'portal-mojo/ui'`. The modal manager's stack is a MODULE SINGLETON shared
// with <ModalHost/>; two import paths = two stacks = nothing renders.
import { modal } from '../../../../../packages/portal-mojo/src/ui/modal';

const ROWS = [
    { at: '09:41', what: 'Session opened', who: 'jane@example.com' },
    { at: '09:44', what: 'Group switched → Northwind', who: 'jane@example.com' },
    { at: '10:02', what: 'Export requested (csv)', who: 'jane@example.com' },
    { at: '10:07', what: 'Password reset sent', who: 'system' },
    { at: '11:19', what: 'Member invited', who: 'jane@example.com' },
    { at: '11:52', what: 'Batch disable · 3 succeeded, 2 failed', who: 'jane@example.com' },
    { at: '12:30', what: 'Session refreshed', who: 'system' },
    { at: '13:14', what: 'Filter saved to view', who: 'jane@example.com' },
];

function LogRows() {
    return (
        <table className="demo-table" style={{ width: '100%' }}>
            <tbody>
                {ROWS.concat(ROWS).map((r, i) => (
                    <tr key={i}>
                        <td style={{ whiteSpace: 'nowrap' }}><code>{r.at}</code></td>
                        <td>{r.what}</td>
                        <td className="dim" style={{ whiteSpace: 'nowrap' }}>{r.who}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export function DrawerDemo() {
    // 1 — the plain case: title + static content, dismiss resolves null.
    const basic = async () => {
        await modal.drawer({
            eyebrow: 'Source IP',
            title: '198.51.100.24',
            meta: [{ icon: 'bi-clock', text: 'Last 30 days' }, '412 events'],
            content: (
                <>
                    <p className="dim">
                        Default width (480px), full viewport height, right-anchored. Escape, the
                        backdrop and the X all dismiss — each resolves <code>null</code>.
                    </p>
                    <LogRows />
                </>
            ),
        });
        toast.info('drawer closed → null');
    };

    // 2 — the 'wide' preset, for content that needs the room.
    const wide = () => {
        void modal.drawer({
            eyebrow: 'Metric History',
            title: 'Auth Failures · daily buckets',
            meta: [
                { icon: 'bi-calendar3', text: 'Last 30 days' },
                { icon: 'bi-bar-chart-line', text: 'Daily buckets' },
            ],
            width: 'wide',
            content: (
                <>
                    <p className="dim"><code>width: 'wide'</code> → 720px. A number (e.g. <code>width: 900</code>) works too; both clamp to <code>100vw</code>.</p>
                    <LogRows />
                </>
            ),
        });
    };

    // 3 — numeric width, past the 'wide' preset.
    const numeric = () => {
        void modal.drawer({
            eyebrow: 'Numeric width',
            title: 'width: 900',
            meta: ['clamped to 100vw on narrow viewports'],
            width: 900,
            content: <LogRows />,
        });
    };

    // 4 — stacking: a drawer opened from inside an open modal. Native <dialog>
    //     puts it in the top layer over the modal, with its own backdrop.
    const fromModal = async () => {
        const outcome = await modal.open<string | null>((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">A modal</h2>
                <div className="modal-message">
                    Open a drawer from here. It stacks into the top layer above this dialog —
                    no z-index bookkeeping — and hands its result back to the modal.
                </div>
                <div className="modal-actions">
                    <button className="btn" onClick={() => close(null)}>Close</button>
                    <button
                        className="btn btn-primary"
                        onClick={() => {
                            void modal.drawer<string>({
                                eyebrow: 'Stacked',
                                title: 'Drawer over modal',
                                meta: [{ icon: 'bi-layers', text: 'depth 2 · top layer' }],
                                render: (closeDrawer) => (
                                    <>
                                        <p className="dim">
                                            Escape closes the drawer first, then the modal underneath — the
                                            native top-layer stack unwinds in order.
                                        </p>
                                        <div className="demo-row" style={{ marginTop: 14 }}>
                                            <button className="btn btn-primary" onClick={() => closeDrawer('picked from drawer')}>
                                                Resolve to the modal
                                            </button>
                                        </div>
                                    </>
                                ),
                            }).then((picked) => { if (picked) close(picked); });
                        }}
                    >
                        Open drawer
                    </button>
                </div>
            </div>
        ));
        toast.info(outcome ? `modal resolved: ${outcome}` : 'modal dismissed → null');
    };

    // 5 — the awaitable contract: the body resolves the value.
    const awaited = async () => {
        const choice = await modal.drawer<string>({
            eyebrow: 'Awaitable',
            title: 'Pick an outcome',
            meta: [{ icon: 'bi-arrow-return-left', text: 'resolves on close' }],
            render: (close) => (
                <>
                    <p className="dim">
                        Whatever <code>close(value)</code> passes comes back from the await; a
                        dismiss resolves <code>null</code>. Resolution lands AFTER the slide-out.
                    </p>
                    <div className="demo-row" style={{ marginTop: 14 }}>
                        <button className="btn btn-primary" onClick={() => close('approved')}>Approve</button>
                        <button className="btn btn-danger-ghost" onClick={() => close('rejected')}>Reject</button>
                    </div>
                </>
            ),
        });
        toast.info(choice ? `drawer resolved: ${choice}` : 'dismissed → null');
    };

    // 6 — dismissable:false. No X, no Escape, no backdrop — the body's own
    //     button is the only exit (which is why the flag requires a render()).
    const sticky = async () => {
        const ack = await modal.drawer<boolean>({
            eyebrow: 'dismissable: false',
            title: 'Acknowledge to continue',
            dismissable: false,
            render: (close) => (
                <>
                    <p className="dim">
                        Escape and the backdrop are inert and the header X is gone — the only way
                        out is below. Passing this flag without a <code>render</code> falls back to
                        dismissable with a <code>console.warn</code>.
                    </p>
                    <div className="demo-row" style={{ marginTop: 14 }}>
                        <button className="btn btn-primary" onClick={() => close(true)}>I acknowledge</button>
                    </div>
                </>
            ),
        });
        toast.info(`acknowledged: ${String(ack)}`);
    };

    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 14 }}>
                Same manager, same awaitable contract as <code>confirm</code>/<code>detail</code> — a
                native <code>&lt;dialog showModal&gt;</code> pinned right, full viewport height, with a
                slide-in/out that respects <code>prefers-reduced-motion</code>.
            </p>
            <div className="demo-row">
                <button className="btn" onClick={() => void basic()}>drawer()</button>
                <button className="btn" onClick={wide}>drawer (wide)</button>
                <button className="btn" onClick={numeric}>drawer (width: 900)</button>
                <button className="btn" onClick={() => void fromModal()}>drawer from a modal</button>
                <button className="btn btn-primary" onClick={() => void awaited()}>awaited result</button>
                <button className="btn" onClick={() => void sticky()}>dismissable: false</button>
            </div>
        </div>
    );
}
