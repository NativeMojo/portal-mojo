// DatePicker demos — the single-value picker shell over the Calendar engine:
// day / month / year precision, trigger-or-inline, min/max + disabledDates,
// display-format token stripping, and the required/disabled/readOnly states
// that govern the clear ✕.
//
// Every panel is controlled: the value line only changes on a COMMIT (a
// calendar pick or the clear button), which is the whole pipeline.
import { useState } from 'react';
import { dateFns } from 'portal-mojo/ui';
// MERGE-WIRE: portal-mojo/ui
import { DatePicker, type DatePickerChangeEvent } from '../../../../../packages/portal-mojo/src/ui/date/DatePicker';

const { addMonths, daysInMonth, formatYm, formatYmd, today } = dateFns;

// Constraints relative to today so the demo always has something to show.
const T = today();
const LAST_MONTH = addMonths({ y: T.y, m: T.m }, -1);
const NEXT_MONTH = addMonths({ y: T.y, m: T.m }, 1);
const MIN_DAY = formatYmd({ ...LAST_MONTH, d: 1 });
const MAX_DAY = formatYmd({ ...NEXT_MONTH, d: daysInMonth(NEXT_MONTH.y, NEXT_MONTH.m) });
const BLOCKED = [formatYmd({ y: T.y, m: T.m, d: 12 }), formatYmd({ y: T.y, m: T.m, d: 13 })];

function useEventLog(): [string[], (line: string) => void] {
    const [lines, setLines] = useState<string[]>([]);
    const push = (line: string) => setLines((prev) => [...prev, line].slice(-6));
    return [lines, push];
}

function logLine(e: DatePickerChangeEvent): string {
    return `onChange value=${JSON.stringify(e.value)} formatted=${JSON.stringify(e.formatted)} old=${JSON.stringify(e.oldValue)}`;
}

function EventLog({ lines }: { lines: string[] }) {
    return (
        <pre className="demo-pre" style={{ margin: 0, minHeight: 90 }}>
            {lines.length ? lines.join('\n') : '(pick a date…)'}
        </pre>
    );
}

// ── Day, with bounds and blocked days ────────────────────────────────
function DayPanel() {
    const [value, setValue] = useState<string | null>(null);
    const [log, push] = useEventLog();
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Day precision (default) — min/max + disabledDates</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ width: 260, flex: 'none' }}>
                    <DatePicker
                        value={value}
                        min={MIN_DAY}
                        max={MAX_DAY}
                        disabledDates={BLOCKED}
                        onChange={(e) => { setValue(e.value); push(logLine(e)); }}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 240 }}>
                    <pre className="demo-pre" style={{ marginTop: 0 }}>value: {JSON.stringify(value)}</pre>
                    <EventLog lines={log} />
                </div>
            </div>
            <p className="dim" style={{ margin: '12px 0 0' }}>
                Click the trigger → the calendar opens in the shared <code>Popover</code> (bottom-start,
                top layer). Picking commits and closes (<code>autoApply</code>, default true); outside
                click and Escape close without changing anything. Bounds are ±1 month, the 12th/13th are
                blocked, and the header label still zooms out to month/year. The ✕ clears
                (<code>value: null</code>); it is a sibling of the trigger, so clicking it never opens
                the popover.
            </p>
        </div>
    );
}

// ── Month + year ─────────────────────────────────────────────────────
function PrecisionPanel() {
    const [month, setMonth] = useState<string | null>(null);
    const [year, setYear] = useState<string | null>('2026');
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Month-only and year-only variants</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ width: 240 }}>
                    <DatePicker precision="month" value={month} onChange={(e) => setMonth(e.value)} />
                    <p className="dim" style={{ margin: '8px 0 0' }}>
                        committed: <code>{JSON.stringify(month)}</code>
                    </p>
                </div>
                <div style={{ width: 240 }}>
                    <DatePicker precision="year" value={year} onChange={(e) => setYear(e.value)} />
                    <p className="dim" style={{ margin: '8px 0 0' }}>
                        committed: <code>{JSON.stringify(year)}</code>
                    </p>
                </div>
            </div>
            <p className="dim" style={{ margin: '12px 0 0' }}>
                Same component, same engine — only the grid that COMMITS moves. Values are canonical at
                precision (<code>YYYY-MM</code> / <code>YYYY</code>) and the default display formats
                follow (<code>MMM YYYY</code> / <code>YYYY</code>). The month picker opens on its month
                grid, the year picker on its decade grid.
            </p>
        </div>
    );
}

// ── Display formats + token stripping ────────────────────────────────
function FormatPanel() {
    const [a, setA] = useState<string | null>(formatYmd({ y: T.y, m: T.m, d: 4 }));
    const [b, setB] = useState<string | null>(formatYm({ y: T.y, m: T.m }));
    const [c, setC] = useState<string | null>(String(T.y));
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">displayFormat — and the incompatible-token strip</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ width: 240 }}>
                    <DatePicker
                        value={a}
                        displayFormat="D MMMM YYYY"
                        onChange={(e) => setA(e.value)}
                    />
                    <p className="dim" style={{ margin: '8px 0 0' }}>
                        day · <code>D MMMM YYYY</code> — passes through untouched
                    </p>
                </div>
                <div style={{ width: 240 }}>
                    <DatePicker
                        precision="month"
                        value={b}
                        displayFormat="D MMMM YYYY"
                        onChange={(e) => setB(e.value)}
                    />
                    <p className="dim" style={{ margin: '8px 0 0' }}>
                        month · same format, <code>D</code> stripped
                    </p>
                </div>
                <div style={{ width: 240 }}>
                    <DatePicker
                        precision="year"
                        value={c}
                        displayFormat="D MMMM YYYY"
                        onChange={(e) => setC(e.value)}
                    />
                    <p className="dim" style={{ margin: '8px 0 0' }}>
                        year · month + day tokens stripped
                    </p>
                </div>
            </div>
            <p className="dim" style={{ margin: '12px 0 0' }}>
                A custom format is filtered to the tokens the precision can actually fill, then trailing
                separators are trimmed (a year format that strips to nothing falls back to
                <code> YYYY</code>). The strip removes the token, not punctuation around it — at month
                precision <code>&quot;MMM DD, YYYY&quot;</code> becomes <code>&quot;MMM , YYYY&quot;</code>, so pass a
                format that suits the precision or lean on the default.
            </p>
        </div>
    );
}

// ── States ───────────────────────────────────────────────────────────
function StatesPanel() {
    const [req, setReq] = useState<string | null>(formatYmd({ y: T.y, m: T.m, d: 1 }));
    const fixed = formatYmd({ y: T.y, m: T.m, d: 9 });
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">required · disabled · readOnly · invalid</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 20 }}>
                <div style={{ width: 220 }}>
                    <label className="field-label" htmlFor="dp-required">Required <em>*</em></label>
                    <DatePicker id="dp-required" required value={req} onChange={(e) => setReq(e.value)} />
                    <p className="dim" style={{ margin: '8px 0 0' }}>no ✕ — can&apos;t go back to empty</p>
                </div>
                <div style={{ width: 220 }}>
                    <label className="field-label" htmlFor="dp-disabled">Disabled</label>
                    <DatePicker id="dp-disabled" disabled value={fixed} />
                    <p className="dim" style={{ margin: '8px 0 0' }}>inert trigger, no ✕</p>
                </div>
                <div style={{ width: 220 }}>
                    <label className="field-label" htmlFor="dp-readonly">Read-only</label>
                    <DatePicker id="dp-readonly" readOnly value={fixed} />
                    <p className="dim" style={{ margin: '8px 0 0' }}>focusable, opens nothing, no ✕</p>
                </div>
                <div style={{ width: 220 }}>
                    <label className="field-label" htmlFor="dp-invalid">Invalid</label>
                    <DatePicker id="dp-invalid" invalid value={null} placeholder="Required — pick a date" />
                    <p className="dim" style={{ margin: '8px 0 0' }}>error border + empty placeholder styling</p>
                </div>
            </div>
            <p className="dim" style={{ margin: '12px 0 0' }}>
                Each trigger takes an <code>id</code> so a <code>&lt;label htmlFor&gt;</code> reaches it.
                The ✕ is hidden by <code>required</code>, <code>disabled</code> and <code>readOnly</code>
                alike; read-only stays focusable (tab to it and press Enter — nothing opens), disabled
                does not.
            </p>
        </div>
    );
}

// ── Inline + autoApply=false ─────────────────────────────────────────
function InlinePanel() {
    const [value, setValue] = useState<string | null>(null);
    const [sticky, setSticky] = useState<string | null>(null);
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">inline — the calendar in place, no trigger</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 28 }}>
                <div style={{ width: 280, flex: 'none' }}>
                    <DatePicker inline value={value} onChange={(e) => setValue(e.value)} />
                </div>
                <div style={{ flex: 1, minWidth: 240 }}>
                    <pre className="demo-pre" style={{ marginTop: 0 }}>inline value: {JSON.stringify(value)}</pre>
                    <p className="dim" style={{ margin: '12px 0 0' }}>
                        <code>inline</code> renders the calendar directly — no trigger, no popover, no ✕.
                        The value is still controlled, so it lights up only after the owner writes the
                        commit back. Give it a sized wrapper (the calendar fills its container).
                    </p>
                    <div style={{ marginTop: 16, maxWidth: 260 }}>
                        <label className="field-label" htmlFor="dp-sticky">autoApply={'{false}'}</label>
                        <DatePicker id="dp-sticky" value={sticky} autoApply={false} onChange={(e) => setSticky(e.value)} />
                        <p className="dim" style={{ margin: '8px 0 0' }}>
                            Commits without closing — pick, watch the trigger update, pick again. Close it
                            yourself (outside click, Escape, or the trigger).
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Invalid incoming value ───────────────────────────────────────────
// Button-driven so the page loads with a clean console; clicking it proves
// rule 4 (fall back WITH a warn, never render nothing).
function BadValuePanel() {
    const [value, setValue] = useState<string | null>(formatYmd({ y: T.y, m: T.m, d: 6 }));
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Unparseable value → empty + one console.warn</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 20 }}>
                <div style={{ width: 240 }}>
                    <DatePicker value={value} onChange={(e) => setValue(e.value)} />
                </div>
                <div className="demo-row">
                    <button className="btn" onClick={() => setValue('last Tuesday')}>
                        Feed &quot;last Tuesday&quot;
                    </button>
                    <button className="btn" onClick={() => setValue(formatYmd({ y: T.y, m: T.m, d: 6 }))}>
                        Restore a valid one
                    </button>
                </div>
            </div>
            <p className="dim" style={{ margin: '12px 0 0' }}>
                prop: <code>{JSON.stringify(value)}</code> — a value that does not parse at the picker&apos;s
                precision shows as empty and logs <b>one</b> warn naming the expected shape (re-feeding the
                same bad value stays quiet). The control never displays something its state does not hold.
            </p>
        </div>
    );
}

export function DatePickerDemo() {
    return (
        <>
            <DayPanel />
            <PrecisionPanel />
            <FormatPanel />
            <StatesPanel />
            <InlinePanel />
            <BadValuePanel />
        </>
    );
}
