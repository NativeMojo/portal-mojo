// DateRangePicker demos — trigger + popover with the "Quick range" rail,
// month/year precisions, custom presets + autoApply off, the inline mount
// (the FilterBar daterange dialog shape), and the trigger states.
import { useState } from 'react';
import { dateFns } from 'portal-mojo/ui';
// MERGE-WIRE: portal-mojo/ui
import { DateRangePicker } from '../../../../../packages/portal-mojo/src/ui/date/DateRangePicker';
// MERGE-WIRE: portal-mojo/ui
import type { PresetEntry } from '../../../../../packages/portal-mojo/src/ui/date/PresetRail';

const { formatYmd, today } = dateFns;

function useEventLog(): [string[], (line: string) => void] {
    const [lines, setLines] = useState<string[]>([]);
    const push = (line: string) => setLines((prev) => [...prev, line].slice(-6));
    return [lines, push];
}

function EventLog({ lines }: { lines: string[] }) {
    return (
        <pre className="demo-pre" style={{ margin: 0, minHeight: 96 }}>
            {lines.length ? lines.join('\n') : '(pick a range…)'}
        </pre>
    );
}

export function DateRangeTriggerDemo() {
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [formatted, setFormatted] = useState('');
    const [log, push] = useEventLog();

    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Trigger + popover — day precision, two panes, default presets</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ width: 320, flex: 'none' }}>
                    <DateRangePicker
                        presets="default"
                        start={start}
                        end={end}
                        onChange={(e) => {
                            setStart(e.start); setEnd(e.end); setFormatted(e.formatted);
                            push(`onChange ${e.start || '∅'} → ${e.end || '∅'}  (was ${e.oldStart || '∅'} → ${e.oldEnd || '∅'})`);
                        }}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 260 }}>
                    <pre className="demo-pre" style={{ marginTop: 0 }}>
                        start:     {JSON.stringify(start)}{'\n'}
                        end:       {JSON.stringify(end)}{'\n'}
                        formatted: {JSON.stringify(formatted)}
                    </pre>
                    <EventLog lines={log} />
                    <p className="dim" style={{ marginTop: 10 }}>
                        Click the field: the popover opens with the <b>Quick range</b> rail
                        (Today … This year, with the source's divider) beside two day panes.
                        A preset highlights itself and closes the popover (<code>autoApply</code>);
                        starting a manual range clears the highlight. Values are canonical
                        <code> YYYY-MM-DD</code> strings; the trigger shows <code>MMM DD, YYYY – …</code>
                        and the ✕ clears (hidden when <code>required</code>/<code>disabled</code>/<code>readOnly</code>).
                    </p>
                </div>
            </div>
        </div>
    );
}

export function DateRangePrecisionDemo() {
    const [mStart, setMStart] = useState('');
    const [mEnd, setMEnd] = useState('');
    const [yStart, setYStart] = useState('');
    const [yEnd, setYEnd] = useState('');

    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Month + year precision — one pane, per-precision preset lists</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ width: 280, flex: 'none' }}>
                    <DateRangePicker
                        precision="month"
                        presets="default"
                        start={mStart}
                        end={mEnd}
                        onChange={(e) => { setMStart(e.start); setMEnd(e.end); }}
                    />
                    <pre className="demo-pre">month: {JSON.stringify(mStart)} → {JSON.stringify(mEnd)}</pre>
                </div>
                <div style={{ width: 280, flex: 'none' }}>
                    <DateRangePicker
                        precision="year"
                        presets="default"
                        start={yStart}
                        end={yEnd}
                        onChange={(e) => { setYStart(e.start); setYEnd(e.end); }}
                    />
                    <pre className="demo-pre">year: {JSON.stringify(yStart)} → {JSON.stringify(yEnd)}</pre>
                </div>
                <p className="dim" style={{ flex: 1, minWidth: 220, marginTop: 0 }}>
                    <code>precision="month"</code> emits <code>YYYY-MM</code> over the month grid
                    (presets: This / Last / Last 3 / Last 6 / YTD / Last 12);
                    <code> precision="year"</code> emits <code>YYYY</code> over the decade grid
                    (This / Last / Last 3 / Last 5 / Last 10). Both default to a single pane and
                    strip day tokens from the display format.
                </p>
            </div>
        </div>
    );
}

export function DateRangeCustomDemo() {
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [log, push] = useEventLog();

    const y = today().y;
    const quarterPresets: PresetEntry[] = [
        { label: 'Q1', range: () => ({ start: { y, m: 1, d: 1 }, end: { y, m: 3, d: 31 } }) },
        { label: 'Q2', range: () => ({ start: { y, m: 4, d: 1 }, end: { y, m: 6, d: 30 } }) },
        { label: 'Q3', range: () => ({ start: { y, m: 7, d: 1 }, end: { y, m: 9, d: 30 } }) },
        { label: 'Q4', range: () => ({ start: { y, m: 10, d: 1 }, end: { y, m: 12, d: 31 } }) },
        { divider: true },
        { label: 'Full year', range: () => ({ start: { y, m: 1, d: 1 }, end: { y, m: 12, d: 31 } }) },
    ];
    const min = formatYmd({ y, m: 1, d: 1 });
    const max = formatYmd({ y, m: 12, d: 31 });

    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Custom presets + autoApply off + min/max — one pane</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ width: 320, flex: 'none' }}>
                    <DateRangePicker
                        months={1}
                        presets={quarterPresets}
                        autoApply={false}
                        min={min}
                        max={max}
                        placeholder="Pick a quarter…"
                        start={start}
                        end={end}
                        onChange={(e) => { setStart(e.start); setEnd(e.end); push(`onChange ${e.start} → ${e.end}`); }}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 260 }}>
                    <pre className="demo-pre" style={{ marginTop: 0 }}>
                        start: {JSON.stringify(start)}{'\n'}end:   {JSON.stringify(end)}
                    </pre>
                    <EventLog lines={log} />
                    <p className="dim" style={{ marginTop: 10 }}>
                        A custom <code>presets</code> array ({'{'}label, range(){'}'} entries with a
                        divider) replaces the defaults. <code>autoApply={'{false}'}</code> keeps the
                        popover open after a commit — values still apply immediately; only the
                        auto-close is off (close by clicking outside or Escape). <code>min</code>/
                        <code>max</code> pin this year: page past the edges and cells gray out.
                    </p>
                </div>
            </div>
        </div>
    );
}

export function DateRangeInlineDemo() {
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');

    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Inline — the FilterBar daterange dialog mount</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ width: 480, maxWidth: '100%', flex: 'none' }}>
                    <DateRangePicker
                        inline
                        months={1}
                        presets="default"
                        start={start}
                        end={end}
                        onChange={(e) => { setStart(e.start); setEnd(e.end); }}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 240 }}>
                    <pre className="demo-pre" style={{ marginTop: 0 }}>
                        start: {JSON.stringify(start)}{'\n'}end:   {JSON.stringify(end)}
                    </pre>
                    <p className="dim" style={{ marginTop: 10 }}>
                        <code>inline</code> renders the rail + calendar in place — no trigger, no
                        popover; the body is fluid to its host. This is exactly what the FilterBar
                        daterange dialog mounts: its Apply button writes the picked values into the
                        <code> dr_field/dr_start/dr_end</code> triple, so the params-store contract
                        (deep links included) is unchanged. Escape here cancels an in-progress
                        anchor (the engine behavior — focus must be inside the calendar).
                    </p>
                </div>
            </div>
        </div>
    );
}

export function DateRangeStatesDemo() {
    const t = today();
    const fixedStart = formatYmd({ y: t.y, m: t.m, d: 1 });
    const fixedEnd = formatYmd(t);
    const [reqStart, setReqStart] = useState(fixedStart);
    const [reqEnd, setReqEnd] = useState(fixedEnd);

    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Trigger states — required (no clear ✕), disabled, readOnly</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 16 }}>
                <div style={{ width: 260, flex: 'none' }}>
                    <DateRangePicker
                        required
                        start={reqStart}
                        end={reqEnd}
                        onChange={(e) => { setReqStart(e.start); setReqEnd(e.end); }}
                    />
                    <div className="dim" style={{ marginTop: 6 }}>required — opens, can't be cleared</div>
                </div>
                <div style={{ width: 260, flex: 'none' }}>
                    <DateRangePicker disabled start={fixedStart} end={fixedEnd} />
                    <div className="dim" style={{ marginTop: 6 }}>disabled — inert</div>
                </div>
                <div style={{ width: 260, flex: 'none' }}>
                    <DateRangePicker readOnly start={fixedStart} end={fixedEnd} />
                    <div className="dim" style={{ marginTop: 6 }}>readOnly — shows, won't open</div>
                </div>
            </div>
        </div>
    );
}

export function DateRangeDemo() {
    return (
        <>
            <DateRangeTriggerDemo />
            <DateRangePrecisionDemo />
            <DateRangeCustomDemo />
            <DateRangeInlineDemo />
            <DateRangeStatesDemo />
        </>
    );
}
