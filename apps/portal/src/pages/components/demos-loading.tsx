// Loader demos — the busy/loading family, exercised for real.
//
// MERGE-WIRE: rail — add to ComponentsPage's GROUPS under 'Overlays':
//   { key: 'loading', title: 'Loaders', icon: 'bi-hourglass-split',
//     blurb: 'Spinner atom, the blocking full-screen overlay (top layer, above modals), the view loader, inline loaders — all with the anti-flash delay that keeps fast work silent.',
//     render: () => <LoadingDemo /> }
import { useState } from 'react';
import {
    Badge, modal, toast,
    Busy, InlineLoader, LoadingOverlay, Spinner, ViewLoader,
    busy, busyWhile, useDelayedFlag, LOADING_DELAY_MS,
} from 'portal-mojo/ui';

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/** A panel that "reloads" — the ViewLoader's natural habitat. */
function ReloadablePanel() {
    const [loading, setLoading] = useState(false);
    const [n, setN] = useState(1);

    const reload = async (ms: number) => {
        setLoading(true);
        await sleep(ms);
        setN((v) => v + 1);
        setLoading(false);
    };

    return (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="seg-row" style={{ padding: '12px 16px' }}>
                <div className="eyebrow">Members panel</div>
                <div className="demo-row">
                    <button className="btn btn-compact" disabled={loading} onClick={() => void reload(1800)}>
                        Slow reload (1.8s)
                    </button>
                    <button className="btn btn-compact" disabled={loading} onClick={() => void reload(120)}>
                        Fast reload (120ms)
                    </button>
                </div>
            </div>
            {loading ? (
                <ViewLoader label="Loading members…" hint="Server-driven — this is what a cold panel shows." />
            ) : (
                <div style={{ padding: '18px 16px 22px' }}>
                    <p style={{ margin: 0 }}>
                        Panel content, load #{n}. The fast reload shows <b>nothing</b> — under{' '}
                        {LOADING_DELAY_MS}ms the loader never mounts its spinner, only its reserved height,
                        so the panel doesn't jump either.
                    </p>
                </div>
            )}
        </div>
    );
}

/** The Busy wrapper: blocking is instant, dimming waits out the delay. */
function BusyFormCard() {
    const [saving, setSaving] = useState(false);
    const [name, setName] = useState('Acme Holdings');
    const [saved, setSaved] = useState(0);

    const save = async (ms: number) => {
        setSaving(true);
        await sleep(ms);
        setSaving(false);
        setSaved((v) => v + 1);
    };

    return (
        <Busy active={saving} label="Saving…">
            <div className="panel panel-pad" style={{ display: 'grid', gap: 10 }}>
                <label className="field">
                    <span className="field-label">Group name</span>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <div className="demo-row">
                    <button className="btn btn-primary btn-compact" onClick={() => void save(2000)}>Save (2s)</button>
                    <button className="btn btn-compact" onClick={() => void save(90)}>Save (90ms)</button>
                    <span className="dim">saves: <Badge tone="muted">{saved}</Badge></span>
                </div>
                <p className="dim" style={{ margin: 0 }}>
                    While saving, try clicking or <kbd>Tab</kbd>bing into this card — <code>inert</code>{' '}
                    blocks pointer, keyboard AND the accessibility tree from the instant the mutation
                    starts. The dim only arrives after the anti-flash delay.
                </p>
            </div>
        </Busy>
    );
}

export function LoadingDemo() {
    const [declarative, setDeclarative] = useState(false);
    const [pretendFetching, setPretendFetching] = useState(false);
    const flag = useDelayedFlag(pretendFetching);

    // ── The full-screen overlay ──────────────────────────────────────────
    const slowOp = () => void busyWhile('Rebuilding search index…', () => sleep(2400))
        .then(() => toast.success('Index rebuilt'));

    const fastOp = () => void busyWhile('Rebuilding search index…', () => sleep(120))
        .then(() => toast.success('Index rebuilt (nothing flashed)'));

    /** Two nested tickets: the newest label wins, the overlay survives the
        first close — web-mojo's reference counting, per-handle. */
    const nestedOp = async () => {
        const outer = busy('Exporting 3 files…');
        await sleep(1200);
        const inner = busy('Uploading archive…');
        await sleep(1400);
        inner.close();   // label falls BACK to "Exporting 3 files…"
        await sleep(900);
        outer.close();
        toast.success('Export finished');
    };

    /** Proof of the top layer: the overlay must paint above an open modal. */
    const fromModal = () => {
        void modal.open((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">Rotate signing key</h2>
                <p className="modal-message">
                    A native <code>&lt;dialog&gt;</code>. The busy overlay joins the top layer AFTER
                    it, so it paints above — no z-index arithmetic (web-mojo needed
                    <code> modal.z + 1000</code>).
                </p>
                <div className="modal-actions">
                    <button className="btn" onClick={() => close(null)}>Cancel</button>
                    <button
                        className="btn btn-primary"
                        onClick={async () => {
                            await busyWhile('Rotating key…', () => sleep(1800));
                            close(null);
                            toast.success('Key rotated');
                        }}
                    >
                        Rotate
                    </button>
                </div>
            </div>
        ));
    };

    /** Escape must NOT close it — only the caller can. */
    const undismissable = () => void busyWhile('Try Escape — only the caller closes this', () => sleep(3000));

    return (
        <div style={{ display: 'grid', gap: 16 }}>
            {/* Declarative twin of busy() — same overlay, boolean-driven. */}
            <LoadingOverlay active={declarative} label="Saving changes…" />

            <div className="panel panel-pad" style={{ display: 'grid', gap: 18 }}>
                <div>
                    <div className="eyebrow">The anti-flash rule — the whole point</div>
                    <p className="dim" style={{ margin: '4px 0 10px' }}>
                        Nothing appears until an operation has run <b>{LOADING_DELAY_MS}ms</b>; once the
                        overlay IS up it stays at least 400ms. A spinner that appears for 80ms is worse
                        than none — it reads as a glitch. Click both and watch: the same code path, one
                        indicator.
                    </p>
                    <div className="demo-row">
                        <button className="btn btn-primary btn-compact" onClick={slowOp}>
                            Slow operation (2.4s) — overlay
                        </button>
                        <button className="btn btn-compact" onClick={fastOp}>
                            Fast operation (120ms) — silent
                        </button>
                    </div>
                </div>

                <div>
                    <div className="eyebrow">Full-screen overlay — the rest of the contract</div>
                    <p className="dim" style={{ margin: '4px 0 10px' }}>
                        One <code>&lt;dialog&gt;</code> in the browser top layer: it clears open modals,
                        makes the document inert (pointer <i>and</i> keyboard), swallows Escape, and
                        returns focus where it was on close.
                    </p>
                    <div className="demo-row" style={{ flexWrap: 'wrap' }}>
                        <button className="btn btn-compact" onClick={() => void nestedOp()}>
                            Nested busy() — label stack
                        </button>
                        <button className="btn btn-compact" onClick={fromModal}>
                            From inside a modal
                        </button>
                        <button className="btn btn-compact" onClick={undismissable}>
                            Escape can't dismiss it
                        </button>
                        <button
                            className="btn btn-compact"
                            onClick={() => {
                                setDeclarative(true);
                                setTimeout(() => setDeclarative(false), 2200);
                            }}
                        >
                            &lt;LoadingOverlay active&gt; (declarative)
                        </button>
                    </div>
                </div>

                <div>
                    <div className="eyebrow">useDelayedFlag — the hook every loader is built on</div>
                    <div className="demo-row">
                        <button className="btn btn-compact" onClick={() => setPretendFetching((v) => !v)}>
                            {pretendFetching ? 'Stop' : 'Start'} pretend fetch
                        </button>
                        <span className="dim">
                            active: <Badge tone={pretendFetching ? 'primary' : 'muted'}>{String(pretendFetching)}</Badge>
                            {' '}→ delayed flag: <Badge tone={flag ? 'success' : 'muted'}>{String(flag)}</Badge>
                        </span>
                        {flag && <InlineLoader label="…and this is what it gates" delay={0} />}
                    </div>
                </div>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">Spinner — the atom</div>
                <p className="dim" style={{ margin: '4px 0 12px' }}>
                    Colored by <code>currentColor</code>, so it inherits its context. Decorative by
                    default (<code>aria-hidden</code>); pass <code>label</code> only when the spinner is
                    the only indication, e.g. an icon-only button.
                </p>
                <div className="demo-row" style={{ gap: 22, flexWrap: 'wrap' }}>
                    <span className="demo-row" style={{ gap: 7 }}><Spinner size="xs" /> <span className="dim">xs</span></span>
                    <span className="demo-row" style={{ gap: 7 }}><Spinner size="sm" /> <span className="dim">sm</span></span>
                    <span className="demo-row" style={{ gap: 7 }}><Spinner size="md" /> <span className="dim">md</span></span>
                    <span className="demo-row" style={{ gap: 7 }}><Spinner size="lg" /> <span className="dim">lg</span></span>
                    <span className="demo-row" style={{ gap: 7 }}><Spinner size={44} /> <span className="dim">44 (number)</span></span>
                    <button className="btn btn-primary btn-compact" disabled>
                        <Spinner size="xs" /> Saving…
                    </button>
                    <button className="btn-icon" title="Refreshing" disabled>
                        <Spinner size="sm" label="Refreshing" />
                    </button>
                    <span style={{ color: 'var(--mute)' }} className="demo-row">
                        <Spinner size="sm" /> <span className="dim">inherits --mute</span>
                    </span>
                </div>
            </div>

            <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>ViewLoader — a panel with nothing to show yet</div>
                <ReloadablePanel />
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">ViewLoader sizes</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 8 }}>
                    {(['sm', 'md', 'lg'] as const).map((s) => (
                        <div key={s} style={{ border: '1px solid var(--line)', borderRadius: 10 }}>
                            <ViewLoader size={s} label={`size="${s}"`} delay={0} />
                        </div>
                    ))}
                </div>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">InlineLoader — one row, cell, or field</div>
                <table className="tbl" style={{ marginTop: 8 }}>
                    <tbody>
                        <tr>
                            <td style={{ width: '40%' }}>portal_test</td>
                            <td><Badge tone="success">Active</Badge></td>
                            <td><InlineLoader label="checking sessions…" delay={0} /></td>
                        </tr>
                        <tr>
                            <td>jane.cooper</td>
                            <td><Badge tone="muted">Disabled</Badge></td>
                            <td><InlineLoader label="" delay={0} /></td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Busy — dim + disable while a mutation is in flight</div>
                <BusyFormCard />
            </div>

            {/* ── The decision that matters most ── */}
            <div className="panel panel-pad">
                <div className="eyebrow">Skeleton vs loader — when to use which</div>
                <p className="dim" style={{ margin: '4px 0 12px' }}>
                    They are not alternatives. A <b>skeleton</b> promises a shape you already know;
                    a <b>loader</b> says work is happening when there is no shape to promise. Getting
                    this backwards is the tell of a generated UI: a spinner where a table is about to
                    land, or a skeleton faking rows an export was never going to return.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                    <div>
                        <div className="eyebrow" style={{ marginBottom: 6 }}>Skeleton — shape known</div>
                        <table className="tbl">
                            <tbody>
                                {[0, 1, 2].map((i) => (
                                    <tr key={i} className="skel-row" aria-hidden="true">
                                        <td style={{ width: '55%' }}>
                                            <span className="skel-user">
                                                <span className="skel skel-avatar" />
                                                <span className="skel-stack">
                                                    <span className="skel skel-w-60" />
                                                    <span className="skel skel-w-90" />
                                                </span>
                                            </span>
                                        </td>
                                        <td><span className="skel skel-w-75" /></td>
                                        <td className="text-center"><span className="skel skel-pill" /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div>
                        <div className="eyebrow" style={{ marginBottom: 6 }}>Loader — shape unknown</div>
                        <div style={{ border: '1px solid var(--line)', borderRadius: 10 }}>
                            <ViewLoader label="Running report…" hint="No rows to draw yet — the query decides the shape." delay={0} />
                        </div>
                    </div>
                </div>
                <table className="demo-table" style={{ marginTop: 14 }}>
                    <tbody>
                        <tr><td>Table rows, detail grids, card lists</td><td><b>Skeleton</b> (<code>.skel</code> silhouette)</td></tr>
                        <tr><td>A panel/route with nothing to show yet</td><td><b>&lt;ViewLoader&gt;</b></td></tr>
                        <tr><td>One row/field resolving on its own</td><td><b>&lt;InlineLoader&gt;</b></td></tr>
                        <tr><td>A form/card whose own save is in flight</td><td><b>&lt;Busy&gt;</b></td></tr>
                        <tr><td>Work the user must wait out (export, long save)</td><td><b>busy() / &lt;LoadingOverlay&gt;</b></td></tr>
                        <tr><td>Long work with real percentages</td><td><b>toast.progress</b> (not a loader — see docs/idioms.md)</td></tr>
                        <tr><td>Background refresh of data already on screen</td><td><b>Nothing</b> — or the toolbar refresh spin</td></tr>
                    </tbody>
                </table>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">Reduced motion</div>
                <p className="dim" style={{ margin: '4px 0 0' }}>
                    Under <code>prefers-reduced-motion: reduce</code> the ring does not spin: it becomes
                    uniform and pulses opacity instead. (theme.css kills every animation with a universal{' '}
                    <code>!important</code> rule — right for a skeleton, wrong for a spinner, which would
                    freeze mid-rotation and read as stuck. The substitution out-ranks it on specificity.)
                    Verify with macOS System Settings → Accessibility → Display → Reduce motion, or
                    DevTools → Rendering → Emulate CSS prefers-reduced-motion.
                </p>
            </div>
        </div>
    );
}
