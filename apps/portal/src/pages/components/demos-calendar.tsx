// Calendar demos — the picker ENGINE inline (no popover/trigger shells yet):
// one engine, three precisions, single + range modes, 1 or 2 day panes.
// Every commit is a canonical string (YYYY-MM-DD / YYYY-MM / YYYY) shown
// live, with a rolling log proving the callback surface.
import { useState } from 'react';
// MERGE-WIRE: portal-mojo/ui
import { Calendar } from '../../../../../packages/portal-mojo/src/ui/date/Calendar';
// MERGE-WIRE: portal-mojo/ui (dateFns namespace)
import { addMonths, daysInMonth, formatYmd, today } from '../../../../../packages/portal-mojo/src/ui/date/fns';

function useEventLog(): [string[], (line: string) => void] {
    const [lines, setLines] = useState<string[]>([]);
    const push = (line: string) => setLines((prev) => [...prev, line].slice(-6));
    return [lines, push];
}

function EventLog({ lines }: { lines: string[] }) {
    return (
        <pre className="demo-pre" style={{ margin: 0, minHeight: 96 }}>
            {lines.length ? lines.join('\n') : '(interact with the calendar…)'}
        </pre>
    );
}

export function CalendarDaySingleDemo() {
    const [value, setValue] = useState<string | null>(null);
    const [log, push] = useEventLog();

    // Constraints relative to today so the demo always has something to show:
    // min = 1st of last month, max = end of next month, two dates blocked.
    const t = today();
    const min = formatYmd({ ...addMonths({ y: t.y, m: t.m }, -1), d: 1 });
    const nextM = addMonths({ y: t.y, m: t.m }, 1);
    const max = formatYmd({ y: nextM.y, m: nextM.m, d: daysInMonth(nextM.y, nextM.m) });
    const disabledDates = [formatYmd({ y: t.y, m: t.m, d: 12 }), formatYmd({ y: t.y, m: t.m, d: 13 })];

    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Day — single, drill-down zoom, min/max + disabled days</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ width: 300, flex: 'none' }}>
                    <Calendar
                        value={value}
                        min={min}
                        max={max}
                        disabledDates={disabledDates}
                        onSelect={(e) => { setValue(e.value); push(`onSelect value=${e.value}`); }}
                        onViewChange={(e) => push(`onViewChange view=${e.view}`)}
                        onNavigate={(e) => push(`onNavigate delta=${e.delta}`)}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                    <pre className="demo-pre" style={{ marginTop: 0 }}>value: {JSON.stringify(value)}</pre>
                    <EventLog lines={log} />
                    <p className="dim" style={{ marginTop: 10 }}>
                        Click the header label to zoom out (day → month → year); pick a tile to drill
                        back down. The 12th/13th are <code>disabledDates</code>; paging past ±1 month
                        hits <code>min</code>/<code>max</code> — zoom out and whole months/years gray
                        out too (bounds compare at the pane's precision). PageUp/PageDown page when the
                        calendar has focus. Today wears the red marker.
                    </p>
                </div>
            </div>
        </div>
    );
}

export function CalendarDayRangeDemo() {
    const [start, setStart] = useState<string | null>(null);
    const [end, setEnd] = useState<string | null>(null);
    const [log, push] = useEventLog();

    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Day — range, two panes, cross-page anchor + hover preview</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ width: 620, maxWidth: '100%', flex: 'none' }}>
                    <Calendar
                        mode="range"
                        months={2}
                        startValue={start}
                        endValue={end}
                        onRangeSelect={(e) => { setStart(e.start); setEnd(e.end); push(`onRangeSelect ${e.start} → ${e.end}`); }}
                        onRangeStart={(e) => push(`onRangeStart anchor=${e.anchor}`)}
                        onRangeCancel={() => push('onRangeCancel')}
                        onNavigate={(e) => push(`onNavigate delta=${e.delta}`)}
                        onViewChange={(e) => push(`onViewChange view=${e.view}`)}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                    <pre className="demo-pre" style={{ marginTop: 0 }}>
                        start: {JSON.stringify(start)}{'\n'}end:   {JSON.stringify(end)}
                    </pre>
                    <EventLog lines={log} />
                    <p className="dim" style={{ marginTop: 10 }}>
                        Click a start day (solid anchor pill), then hover — the preview tint tracks the
                        cursor and is a lighter/live tint than a committed range. Page prev/next with
                        the anchor placed: it persists, and the preview still fills the visible cells.
                        Clicking the second day commits (ends swap if you picked backwards); chevrons
                        point inward from each end. <b>Escape</b> cancels an in-progress anchor
                        (focus must be inside the calendar).
                    </p>
                </div>
            </div>
        </div>
    );
}

export function CalendarMonthRangeDemo() {
    const [start, setStart] = useState<string | null>(null);
    const [end, setEnd] = useState<string | null>(null);
    const [log, push] = useEventLog();

    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Month — range (values are YYYY-MM)</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ width: 300, flex: 'none' }}>
                    <Calendar
                        precision="month"
                        mode="range"
                        startValue={start}
                        endValue={end}
                        onRangeSelect={(e) => { setStart(e.start); setEnd(e.end); push(`onRangeSelect ${e.start} → ${e.end}`); }}
                        onRangeStart={(e) => push(`onRangeStart anchor=${e.anchor}`)}
                        onRangeCancel={() => push('onRangeCancel')}
                        onNavigate={(e) => push(`onNavigate delta=${e.delta}`)}
                        onViewChange={(e) => push(`onViewChange view=${e.view}`)}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                    <pre className="demo-pre" style={{ marginTop: 0 }}>
                        start: {JSON.stringify(start)}{'\n'}end:   {JSON.stringify(end)}
                    </pre>
                    <EventLog lines={log} />
                    <p className="dim" style={{ marginTop: 10 }}>
                        Same engine at month precision: tiles commit, the header zooms out to the year
                        grid, ranges span year boundaries (anchor in one year, commit in another).
                    </p>
                </div>
            </div>
        </div>
    );
}

export function CalendarYearSingleDemo() {
    const [value, setValue] = useState<string | null>(null);
    const [log, push] = useEventLog();

    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Year — single (values are YYYY)</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ width: 300, flex: 'none' }}>
                    <Calendar
                        precision="year"
                        value={value}
                        onSelect={(e) => { setValue(e.value); push(`onSelect value=${e.value}`); }}
                        onNavigate={(e) => push(`onNavigate delta=${e.delta}`)}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                    <pre className="demo-pre" style={{ marginTop: 0 }}>value: {JSON.stringify(value)}</pre>
                    <EventLog lines={log} />
                    <p className="dim" style={{ marginTop: 10 }}>
                        The decade grid is the top zoom level — the header label is inert here; prev/next
                        page by decade.
                    </p>
                </div>
            </div>
        </div>
    );
}

export function CalendarDemo() {
    return (
        <>
            <CalendarDaySingleDemo />
            <CalendarDayRangeDemo />
            <CalendarMonthRangeDemo />
            <CalendarYearSingleDemo />
        </>
    );
}
