// TimePicker demos — the stepper panel in every configuration the port
// carries: 24h / 12h with AM/PM, `step` minute math, min/max clamping, the
// timezone seam (running on the built-in fallback <select>), the inline and
// embeddable-footerless variants, and the disabled / readOnly / required /
// invalid states. Each panel shows the LIVE controlled value plus a rolling
// change log, so the commit-only pipeline is visible: typing changes nothing
// until Enter/blur.
import { useState, type ReactNode } from 'react';
// MERGE-WIRE: portal-mojo/ui
import { TimePicker, type TimeOutputFormat, type TimeValue } from '../../../../../packages/portal-mojo/src/ui/date/TimePicker';

function useEventLog(): [string[], (line: string) => void] {
    const [lines, setLines] = useState<string[]>([]);
    const push = (line: string) => setLines((prev) => [...prev, line].slice(-6));
    return [lines, push];
}

function EventLog({ lines }: { lines: string[] }) {
    return (
        <pre className="demo-pre" style={{ margin: 0, minHeight: 92 }}>
            {lines.length ? lines.join('\n') : '(commit a time — steppers, typing + Enter, Now, ✕…)'}
        </pre>
    );
}

/** One demo shell: picker on the left, value + log + copy on the right. */
function Bench({ eyebrow, control, value, lines, children }: {
    eyebrow: string;
    control: ReactNode;
    value: TimeValue;
    lines: string[];
    children: ReactNode;
}) {
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">{eyebrow}</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ width: 260, flex: 'none' }}>{control}</div>
                <div style={{ flex: 1, minWidth: 240 }}>
                    <pre className="demo-pre" style={{ marginTop: 0 }}>value: {JSON.stringify(value)}</pre>
                    <EventLog lines={lines} />
                    <p className="dim" style={{ marginTop: 10 }}>{children}</p>
                </div>
            </div>
        </div>
    );
}

export function TimePicker24hDemo() {
    const [value, setValue] = useState<TimeValue>('14:30');
    const [lines, push] = useEventLog();
    return (
        <Bench
            eyebrow="24h — the default clock, step 1"
            value={value}
            lines={lines}
            control={(
                <TimePicker
                    value={value}
                    onChange={(e) => { setValue(e.value); push(`change ${JSON.stringify(e.oldValue)} → ${JSON.stringify(e.value)} (${e.formatted})`); }}
                />
            )}
        >
            Click the trigger to open the panel. Hours wrap 0–23, minutes 0–59. Type
            straight into a column (digits only — the field selects on focus):{' '}
            <b>ArrowUp/Down</b> steps, <b>Enter</b> commits by blurring, and a blur clamps
            out-of-range input. Nothing fires while you type — <code>onChange</code> is a
            COMMIT event, and identical re-commits stay silent. Hover the trigger for the
            clear ✕.
        </Bench>
    );
}

export function TimePicker12hDemo() {
    const [value, setValue] = useState<TimeValue>('');
    const [lines, push] = useEventLog();
    return (
        <Bench
            eyebrow="12h — AM/PM toggle (storage stays canonical 24h)"
            value={value}
            lines={lines}
            control={(
                <TimePicker
                    format="12h"
                    value={value}
                    onChange={(e) => { setValue(e.value); push(`change → ${JSON.stringify(e.value)} (${e.formatted})`); }}
                />
            )}
        >
            The panel shows 1–12 and the AM/PM pair; the value never stops being{' '}
            <code>HH:MM</code>. The hour math is the fiddly part and it is ported exactly:{' '}
            <b>12 AM = 00</b>, <b>12 PM = 12</b>, and typing an hour maps through the
            CURRENT AM/PM state — set PM, type <code>3</code>, get <code>15:00</code>.
            Toggling AM/PM on an empty picker seeds 00:00 / 12:00.
        </Bench>
    );
}

export function TimePickerStepDemo() {
    const [value, setValue] = useState<TimeValue>('23:45');
    const [lines, push] = useEventLog();
    return (
        <Bench
            eyebrow="step=15 — minute stepping with midnight wraparound"
            value={value}
            lines={lines}
            control={(
                <TimePicker
                    step={15}
                    value={value}
                    onChange={(e) => { setValue(e.value); push(`change → ${JSON.stringify(e.value)}`); }}
                />
            )}
        >
            Minute steps run through total-minutes math, so they carry into the hour and
            wrap across midnight in BOTH directions: from <code>23:45</code>, ▲ gives{' '}
            <code>00:00</code>; from <code>00:00</code>, ▼ gives <code>23:45</code>. Hours
            always step by 1 regardless of <code>step</code>. Typing is unconstrained by{' '}
            <code>step</code> — it only governs the steppers, exactly as in the source.
        </Bench>
    );
}

export function TimePickerBoundsDemo() {
    const [value, setValue] = useState<TimeValue>('12:00');
    const [lines, push] = useEventLog();
    return (
        <Bench
            eyebrow="min / max — clamped on every commit path"
            value={value}
            lines={lines}
            control={(
                <TimePicker
                    min="09:00"
                    max="17:30"
                    value={value}
                    onChange={(e) => { setValue(e.value); push(`change → ${JSON.stringify(e.value)}`); }}
                />
            )}
        >
            Bounds are <code>09:00</code>–<code>17:30</code> (they are parsed with{' '}
            <code>parseTime</code>, so <code>"5:30 pm"</code> works too). Step past either
            end, type <code>03</code> into the hour, or press <b>Now</b> outside office
            hours — every path lands on the bound rather than an invalid value. Clamping is
            a snap, not a block: the stepper still moves, it just stops at the edge.
        </Bench>
    );
}

export function TimePickerTimezoneDemo() {
    const [outputFormat, setOutputFormat] = useState<TimeOutputFormat>('iso');
    const [value, setValue] = useState<TimeValue>('14:30 America/Los_Angeles');
    const [lines, push] = useEventLog();

    const pick = (next: TimeOutputFormat) => {
        setOutputFormat(next);
        setValue('14:30 America/Los_Angeles');
        push(`outputFormat = ${next}`);
    };

    return (
        <Bench
            eyebrow="timezone — the picker seam + all three outputFormats"
            value={value}
            lines={lines}
            control={(
                <>
                    <div className="seg" style={{ marginBottom: 10 }}>
                        {(['iso', 'iana', 'object'] as const).map((f) => (
                            <button
                                key={f}
                                className={`seg-btn${outputFormat === f ? ' seg-active' : ''}`}
                                onClick={() => pick(f)}
                            >{f}</button>
                        ))}
                    </div>
                    <TimePicker
                        key={outputFormat}
                        timezone
                        outputFormat={outputFormat}
                        value={value}
                        onChange={(e) => { setValue(e.value); push(`change → ${JSON.stringify(e.value)}`); }}
                    />
                </>
            )}
        >
            <b>The seam:</b> this picker owns all the zone value/serialization logic but
            renders the picker through <code>renderTimezoneSelect</code>. No slot is passed
            here, so you are seeing the built-in fallback <code>&lt;select&gt;</code> over{' '}
            <code>Intl.supportedValuesOf('timeZone')</code> — the real TimezoneSelect drops
            into the same hole with no value-pipeline change. Switch outputFormat to watch
            one internal state serialize three ways:{' '}
            <code>14:30-07:00</code> / <code>14:30 America/Los_Angeles</code> /{' '}
            <code>{'{time, timezone}'}</code>. Note that <code>iso</code> carries only the
            OFFSET — the picker keeps the IANA name in its own state so echoing the value
            back never degrades it.
        </Bench>
    );
}

export function TimePickerInlineDemo() {
    const [withFooter, setWithFooter] = useState<TimeValue>('08:15');
    const [embedded, setEmbedded] = useState<TimeValue>('08:15');
    const [lines, push] = useEventLog();
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">inline — panel in place, and the footerless embedded variant</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ flex: 'none' }}>
                    <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>inline</div>
                    <TimePicker
                        inline
                        value={withFooter}
                        onChange={(e) => { setWithFooter(e.value); push(`inline → ${JSON.stringify(e.value)}`); }}
                    />
                </div>
                <div style={{ flex: 'none' }}>
                    <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>inline + showFooter={'{false}'}</div>
                    <TimePicker
                        inline
                        showFooter={false}
                        format="12h"
                        value={embedded}
                        onChange={(e) => { setEmbedded(e.value); push(`embedded → ${JSON.stringify(e.value)}`); }}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 240 }}>
                    <pre className="demo-pre" style={{ marginTop: 0 }}>
                        inline:   {JSON.stringify(withFooter)}{'\n'}
                        embedded: {JSON.stringify(embedded)}
                    </pre>
                    <EventLog lines={lines} />
                    <p className="dim" style={{ marginTop: 10 }}>
                        <code>inline</code> renders the stepper panel directly — no trigger,
                        no popover, so <b>Set</b> has nothing to close and only fills an empty
                        value. <code>showFooter={'{false}'}</code> drops Now/Set entirely: that
                        is the variant DateTimePicker embeds in its time column, where the
                        parent owns the apply button.
                    </p>
                </div>
            </div>
        </div>
    );
}

export function TimePickerStatesDemo() {
    const [lines, push] = useEventLog();
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">states — disabled / readOnly / required / invalid</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 18 }}>
                <div style={{ width: 200, flex: 'none' }}>
                    <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>disabled</div>
                    <TimePicker disabled value="09:00" onChange={(e) => push(`disabled → ${JSON.stringify(e.value)}`)} />
                </div>
                <div style={{ width: 200, flex: 'none' }}>
                    <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>readOnly</div>
                    <TimePicker readOnly value="09:00" onChange={(e) => push(`readOnly → ${JSON.stringify(e.value)}`)} />
                </div>
                <div style={{ width: 200, flex: 'none' }}>
                    <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>required (no ✕)</div>
                    <TimePicker required value="09:00" onChange={(e) => push(`required → ${JSON.stringify(e.value)}`)} />
                </div>
                <div style={{ width: 200, flex: 'none' }}>
                    <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>invalid + empty</div>
                    <TimePicker invalid onChange={(e) => push(`invalid → ${JSON.stringify(e.value)}`)} />
                </div>
            </div>
            <div style={{ maxWidth: 620, marginTop: 14 }}>
                <EventLog lines={lines} />
                <p className="dim" style={{ marginTop: 10 }}>
                    <code>disabled</code> greys the trigger and cannot be focused;{' '}
                    <code>readOnly</code> stays focusable but never opens the panel (and hides
                    the ✕, like <code>required</code>). <code>invalid</code> paints the error
                    border. The empty picker shows its placeholder —{' '}
                    <code>HH:MM</code>, or <code>h:mm AM/PM</code> in 12h. None of these
                    should ever log.
                </p>
            </div>
        </div>
    );
}

export function TimePickerDemo() {
    return (
        <>
            <TimePicker24hDemo />
            <TimePicker12hDemo />
            <TimePickerStepDemo />
            <TimePickerBoundsDemo />
            <TimePickerTimezoneDemo />
            <TimePickerInlineDemo />
            <TimePickerStatesDemo />
        </>
    );
}
