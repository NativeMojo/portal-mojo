// Expanding-search demo. The component is a 30px ICON at rest, which is why
// a bare mount reads as an empty panel — so this page says that first, shows
// the three resting states side by side and labelled, then puts a working one
// in front of a real server query.
//
// Two things are made observable rather than described: the 300ms debounce
// (an event log of every keystroke vs. the one commit that follows) and the
// wire (the params object the committed term becomes).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useModelList, type Params, type User } from 'portal-mojo/client';
import { ExpandingSearch, fmt } from 'portal-mojo/ui';
import { WireParams } from './demo-wire';

const PAGE_SIZE = 8;
/** Stable object → stable TanStack key; one cached call for the "of N" figure. */
const TOTAL_PARAMS: Params = { start: 0, size: 1 };

interface LogEntry {
    id: number;
    kind: 'typed' | 'committed';
    value: string;
    at: number;      // performance.now()
    delta: number;   // ms since the previous entry
}

/**
 * Wraps a live ExpandingSearch and logs the RAW keystrokes alongside the
 * debounced commits. Keystrokes never reach `onChange` — the component
 * buffers them — so they're read off the native input event, which is the
 * only honest way to show what the debounce is swallowing.
 */
function useKeystrokeLog() {
    const hostRef = useRef<HTMLDivElement>(null);
    const [log, setLog] = useState<LogEntry[]>([]);
    const seq = useRef(0);
    const lastAt = useRef<number | null>(null);

    const push = (kind: LogEntry['kind'], value: string) => {
        const at = performance.now();
        const delta = lastAt.current == null ? 0 : Math.round(at - lastAt.current);
        lastAt.current = at;
        setLog((prev) => [{ id: seq.current++, kind, value, at, delta }, ...prev].slice(0, 14));
    };

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const onInput = (e: Event) => push('typed', (e.target as HTMLInputElement).value);
        host.addEventListener('input', onInput);
        return () => host.removeEventListener('input', onInput);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one listener for the life of the host
    }, []);

    return {
        hostRef,
        log,
        logCommit: (value: string) => push('committed', value),
        clear: () => { setLog([]); lastAt.current = null; },
    };
}

function Stage({ label, note, children }: { label: string; note: ReactNode; children: ReactNode }) {
    return (
        <div className="sdemo-stage">
            <div className="sdemo-stage-head">
                <span className="sdemo-stage-label">{label}</span>
            </div>
            <div className="sdemo-stage-floor">{children}</div>
            <p className="sdemo-stage-note">{note}</p>
        </div>
    );
}

export function SearchDemo() {
    // Gallery specimens are controlled, like every input in this codebase —
    // no uncontrolled "looks right until it drifts" shortcuts.
    const [restValue, setRestValue] = useState('');
    const [holdingValue, setHoldingValue] = useState('chen');
    const focusStageRef = useRef<HTMLDivElement>(null);
    const [focusValue, setFocusValue] = useState('');

    // The working one.
    const [term, setTerm] = useState('');
    const { hostRef, log, logCommit, clear } = useKeystrokeLog();

    const params = useMemo<Params>(() => ({
        start: 0,
        size: PAGE_SIZE,
        sort: 'display_name',
        ...(term ? { search: term } : {}),
    }), [term]);

    const list = useModelList<User>('/api/user', params);
    const total = useModelList<User>('/api/user', TOTAL_PARAMS);
    const rows = list.data?.rows ?? [];

    return (
        <>
            <div className="panel panel-pad">
                <div className="eyebrow">Why this looks like an empty panel</div>
                <p className="dim" style={{ margin: '4px 0 0', maxWidth: 700 }}>
                    At rest <code>ExpandingSearch</code> is <b>a 30px magnifier icon and nothing
                    else</b> — no border, no field, no label. That is the point: in a table toolbar
                    it costs one icon of space until someone needs it. Search is also the one filter
                    with no pill, so the component pins itself open while it holds text — the open
                    input IS the &ldquo;a search is applied&rdquo; indicator. All three states below
                    are the real component; click into them.
                </p>
                <div className="sdemo-stages">
                    <Stage
                        label="1 · at rest"
                        note={<>Empty value → <code>width: 30px</code>, transparent border. Hover it and the{' '}
                            <kbd>/</kbd> hint fades in.</>}
                    >
                        <ExpandingSearch value={restValue} onChange={setRestValue} placeholder="Search…" />
                    </Stage>

                    <Stage
                        label="2 · focused"
                        note={<>Focus slides the input out to 220px and reveals the placeholder.{' '}
                            <button
                                className="btn btn-compact"
                                onClick={() => focusStageRef.current?.querySelector('input')?.focus()}
                            >Focus it</button></>}
                    >
                        <div ref={focusStageRef} style={{ display: 'contents' }}>
                            <ExpandingSearch value={focusValue} onChange={setFocusValue} placeholder="Type here…" />
                        </div>
                    </Stage>

                    <Stage
                        label="3 · holding text"
                        note={<>Non-empty value adds <code>.holding</code>: stays open after blur, keeps its
                            border. Clear it and it collapses back to state 1.</>}
                    >
                        <ExpandingSearch value={holdingValue} onChange={setHoldingValue} placeholder="Search…" />
                    </Stage>
                </div>
                <p className="dim" style={{ marginTop: 12, maxWidth: 700 }}>
                    There is no fourth state: the component takes{' '}
                    <code>{'{ value, onChange, placeholder }'}</code> only — <b>no <code>disabled</code>{' '}
                    prop</b>. A toolbar that must block search hides the control instead.
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">Live · the committed term is a server param</div>
                <p className="dim" style={{ margin: '4px 0 14px', maxWidth: 700 }}>
                    Type below. Keystrokes buffer for <b>300ms</b>; one commit then goes to the wire —
                    the log shows every keystroke it swallowed and the <code>+Δms</code> gap before
                    the commit. <kbd>Enter</kbd> commits without waiting out the window (its Δ lands
                    under 300ms), <kbd>Esc</kbd> blurs, and <kbd>/</kbd> from anywhere focuses this one —
                    it is the last-mounted instance, and the shortcut is per-instance, so on a real
                    page (exactly one search) it is unambiguous.
                </p>
                <div className="demo-row" ref={hostRef}>
                    <ExpandingSearch
                        value={term}
                        onChange={(next) => { logCommit(next); setTerm(next); }}
                        placeholder="Search users…"
                    />
                    <span className="dim">
                        committed value: <code>{JSON.stringify(term)}</code>
                    </span>
                    <span className="sdemo-hit-spacer" />
                    <button className="btn btn-compact" onClick={clear}>
                        <i className="bi bi-eraser" /> Clear log
                    </button>
                </div>

                <div className="sdemo-log">
                    {log.length === 0 ? (
                        <div className="sdemo-log-empty">
                            Nothing yet — type a few characters and pause. Every keystroke logs as
                            &ldquo;typed&rdquo;; the single &ldquo;committed&rdquo; row ~300ms later is the only one
                            that hits the server.
                        </div>
                    ) : log.map((e) => (
                        <div key={e.id} className={`sdemo-log-row sdemo-log--${e.kind === 'typed' ? 'typed' : 'commit'}`}>
                            <span className="sdemo-log-t">{(e.at / 1000).toFixed(3)}s</span>
                            <span className="sdemo-log-kind">{e.kind}</span>
                            <span className="sdemo-log-val">{JSON.stringify(e.value)}</span>
                            <span className="sdemo-log-delta">{e.delta > 0 ? `+${e.delta}ms` : ''}</span>
                        </div>
                    ))}
                </div>

                <div style={{ marginTop: 16 }}>
                    <div className="eyebrow">Outgoing wire params</div>
                    <div style={{ marginTop: 8 }}>
                        <WireParams
                            endpoint="/api/user"
                            params={params}
                            matched={list.data?.count}
                            total={total.data?.count}
                            loading={list.isPending}
                            note="search hits the model's SEARCH_FIELDS — username, email, display_name, phone_number."
                        />
                    </div>
                </div>

                <div className="sdemo-results">
                    {list.isPending ? (
                        [0, 1, 2].map((i) => (
                            <div key={i} className="sdemo-hit" aria-hidden="true">
                                <span className="skel skel-w-40" />
                            </div>
                        ))
                    ) : list.isError ? (
                        <div className="sdemo-log-empty">
                            {list.error instanceof Error ? list.error.message : 'Request failed'} —{' '}
                            <button className="btn btn-compact" onClick={() => list.refetch()}>Retry</button>
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="sdemo-log-empty">
                            No users match {JSON.stringify(term)} — the SERVER said so, not a filter
                            in the browser.
                        </div>
                    ) : rows.map((u) => (
                        <div key={u.id} className="sdemo-hit">
                            <span className="cell-avatar">{fmt.initials(u.display_name)}</span>
                            <span>
                                <span className="sdemo-hit-name">{u.display_name}</span>{' '}
                                <span className="sdemo-hit-meta">@{u.username}</span>
                            </span>
                            <span className="sdemo-hit-spacer" />
                            <span className="sdemo-hit-meta">{u.email}</span>
                        </div>
                    ))}
                </div>
                <p className="dim" style={{ marginTop: 12, maxWidth: 700 }}>
                    Showing at most {PAGE_SIZE} of the matches — this list is deliberately not a
                    ModelTable so the page stays about the search control; in a table the same
                    committed value lands in <code>params.wire.search</code> and the rest of the
                    contract (paging, sort, filters) rides along with it.
                </p>
            </div>
        </>
    );
}
