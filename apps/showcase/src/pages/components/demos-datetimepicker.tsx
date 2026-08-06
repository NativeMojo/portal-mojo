// DateTimePicker demos — the combined date+time field in every configuration
// the port carries: the default ISO serialization, 12h + step=5, the timezone
// row wired to the REAL <TimezoneSelect> through the slot, object output,
// min/max bounds (date-bounded calendar + boundary-day time clamp), and the
// inline panel. Each panel shows the LIVE controlled value plus a rolling
// change log, so the commit-only pipeline is visible: no-op edits never fire.
import { useState, type ReactNode } from 'react';
import { TimezoneSelect } from 'portal-mojo/ui';
import { DateTimePicker, type DateTimeValue } from 'portal-mojo/ui';

function useEventLog(): [string[], (line: string) => void] {
    const [lines, setLines] = useState<string[]>([]);
    const push = (line: string) => setLines((prev) => [...prev, line].slice(-6));
    return [lines, push];
}

function EventLog({ lines }: { lines: string[] }) {
    return (
        <pre className="demo-pre" style={{ margin: 0, minHeight: 92 }}>
            {lines.length ? lines.join('\n') : '(pick a day, step the time, press Now…)'}
        </pre>
    );
}

/** One demo shell: picker on the left, value + log + copy on the right. */
function Bench({ eyebrow, control, value, lines, children }: {
    eyebrow: string;
    control: ReactNode;
    value: DateTimeValue;
    lines: string[];
    children: ReactNode;
}) {
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">{eyebrow}</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ width: 280, flex: 'none' }}>{control}</div>
                <div style={{ flex: 1, minWidth: 260 }}>
                    <pre className="demo-pre" style={{ marginTop: 0 }}>value: {JSON.stringify(value)}</pre>
                    <EventLog lines={lines} />
                    <p className="dim" style={{ marginTop: 10 }}>{children}</p>
                </div>
            </div>
        </div>
    );
}

export function DateTimePickerIsoDemo() {
    const [value, setValue] = useState<DateTimeValue>('2026-05-04T14:30:00');
    const [lines, push] = useEventLog();
    return (
        <Bench
            eyebrow="iso — the default: one popover, one value"
            value={value}
            lines={lines}
            control={(
                <DateTimePicker
                    value={value}
                    onChange={(e) => { setValue(e.value); push(`change ${JSON.stringify(e.oldValue)} → ${JSON.stringify(e.value)} (${e.formatted})`); }}
                />
            )}
        >
            Calendar on the left, the embedded time steppers on the right, Now/Done below.
            <b> Done only closes</b> — every edit already committed. Picking a date with no
            time set yet defaults the time to <code>00:00</code>; committing a time with no
            date defaults the date to <b>today</b> and the calendar follows. Serialization is{' '}
            <code>YYYY-MM-DDTHH:MM:00</code> (no zone enabled → no offset suffix). Re-committing
            the same value stays silent, so the log only grows on real changes.
        </Bench>
    );
}

export function DateTimePicker12hDemo() {
    const [value, setValue] = useState<DateTimeValue>('2026-05-04 09:05');
    const [lines, push] = useEventLog();
    return (
        <Bench
            eyebrow="timeFormat=12h + timeStep=5 — display only, storage stays 24h"
            value={value}
            lines={lines}
            control={(
                <DateTimePicker
                    timeFormat="12h"
                    timeStep={5}
                    displayFormat="MMM D, YYYY"
                    value={value}
                    onChange={(e) => { setValue(e.value); push(`change → ${JSON.stringify(e.value)} (${e.formatted})`); }}
                />
            )}
        >
            The time column shows 1–12 plus AM/PM and steps minutes by 5 (through
            total-minutes math, so it carries into the hour and wraps across midnight); the
            value never stops being <code>HH:MM</code> in 24h. <code>displayFormat</code>{' '}
            governs the DATE half of the trigger text only —{' '}
            <code>MMM D, YYYY</code> here — while the time half follows{' '}
            <code>timeFormat</code>.
        </Bench>
    );
}

export function DateTimePickerTimezoneDemo() {
    const [value, setValue] = useState<DateTimeValue>('2026-07-04 14:30 America/Los_Angeles');
    const [lines, push] = useEventLog();
    return (
        <Bench
            eyebrow="timezone — full-width row, the real TimezoneSelect through the slot"
            value={value}
            lines={lines}
            control={(
                <DateTimePicker
                    timezone
                    value={value}
                    renderTimezoneSelect={({ value: tz, onChange, timezones, disabled }) => (
                        <TimezoneSelect
                            value={tz}
                            timezones={timezones ?? null}
                            disabled={disabled}
                            onChange={(e) => onChange(e.value)}
                        />
                    )}
                    onChange={(e) => { setValue(e.value); push(`change → ${JSON.stringify(e.value)}`); }}
                />
            )}
        >
            The zone row spans the whole popover so the IANA combobox has room. This picker
            owns all the zone value/serialization logic and renders the picker through{' '}
            <code>renderTimezoneSelect</code> — the real <code>&lt;TimezoneSelect&gt;</code>{' '}
            is passed in here (it is also the default tenant). <b>The DST proof:</b> the
            offset is computed at the <i>selected</i> date, so July 4 serializes{' '}
            <code>-07:00</code> and paging back to January 4 serializes <code>-08:00</code> —
            same zone, different offset. The IANA name lives in component state, so echoing
            the ISO value back never degrades it to a bare offset.
        </Bench>
    );
}

export function DateTimePickerObjectDemo() {
    const [value, setValue] = useState<DateTimeValue>({ date: '2026-05-04', time: '08:15', timezone: 'Europe/Berlin' });
    const [lines, push] = useEventLog();
    return (
        <Bench
            eyebrow="outputFormat=object — {date, time, timezone}"
            value={value}
            lines={lines}
            control={(
                <DateTimePicker
                    outputFormat="object"
                    timezone={['UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'Asia/Tokyo']}
                    value={value}
                    onChange={(e) => { setValue(e.value); push(`change → ${JSON.stringify(e.value)}`); }}
                />
            )}
        >
            Object output hands back the parts instead of a string:{' '}
            <code>{'{date: "YYYY-MM-DD", time: "HH:MM", timezone}'}</code> — and{' '}
            <code>null</code> (not <code>''</code>) when cleared. The <code>timezone</code>{' '}
            key only exists because the zone row is on; passing an <b>array</b> to{' '}
            <code>timezone</code> both enables the row and constrains the list to those five
            zones. <code>oldValue</code> stays the previous canonical STRING in every format
            — it is the diffing key, not a mirror of <code>value</code>.
        </Bench>
    );
}

export function DateTimePickerBoundsDemo() {
    const [value, setValue] = useState<DateTimeValue>('2026-05-06 12:00');
    const [lines, push] = useEventLog();
    return (
        <Bench
            eyebrow="min / max — the calendar is date-bounded, the boundary DAY is time-clamped"
            value={value}
            lines={lines}
            control={(
                <DateTimePicker
                    min="2026-05-04 09:00"
                    max="2026-05-08 17:30"
                    value={value}
                    onChange={(e) => { setValue(e.value); push(`change → ${JSON.stringify(e.value)}`); }}
                />
            )}
        >
            Bounds accept a date or a datetime. The DATE part greys out everything before
            May 4 / after May 8 in the calendar. Where the bound also spelled a TIME, that
            time clamps <b>on the boundary day only</b>: land on May 4 and the hour cannot go
            below <code>09:00</code>; land on May 8 and it cannot pass <code>17:30</code>;
            May 5–7 are unrestricted. <b>Now</b> is clamped the same way — press it and the
            value snaps into the window rather than escaping it.
        </Bench>
    );
}

export function DateTimePickerInlineDemo() {
    const [value, setValue] = useState<DateTimeValue>('2026-05-04 18:45');
    const [lines, push] = useEventLog();
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">inline — the panel in place, plus the disabled / required / invalid states</div>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div style={{ flex: 'none' }}>
                    <DateTimePicker
                        inline
                        value={value}
                        onChange={(e) => { setValue(e.value); push(`inline → ${JSON.stringify(e.value)}`); }}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 260 }}>
                    <pre className="demo-pre" style={{ marginTop: 0 }}>value: {JSON.stringify(value)}</pre>
                    <EventLog lines={lines} />
                    <p className="dim" style={{ marginTop: 10 }}>
                        <code>inline</code> renders the same panel directly — no trigger, no
                        popover, so <b>Done</b> is omitted (it exists to dismiss the popover and
                        there is none). <b>Now</b> still commits.
                    </p>
                    <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                        <div>
                            <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>disabled</div>
                            <DateTimePicker disabled value="2026-05-04 09:00" onChange={(e) => push(`disabled → ${JSON.stringify(e.value)}`)} />
                        </div>
                        <div>
                            <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>readOnly (focusable, never opens)</div>
                            <DateTimePicker readOnly value="2026-05-04 09:00" onChange={(e) => push(`readOnly → ${JSON.stringify(e.value)}`)} />
                        </div>
                        <div>
                            <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>required (no ✕) + invalid, empty</div>
                            <DateTimePicker required invalid onChange={(e) => push(`invalid → ${JSON.stringify(e.value)}`)} />
                        </div>
                    </div>
                    <p className="dim" style={{ marginTop: 10 }}>
                        <code>disabled</code> greys the trigger and cannot be focused;{' '}
                        <code>readOnly</code> stays focusable but never opens the panel (both
                        hide the ✕, as does <code>required</code>). <code>invalid</code> paints
                        the error border, and the empty picker shows its placeholder. None of
                        these three should ever log.
                    </p>
                </div>
            </div>
        </div>
    );
}

export function DateTimePickerDemo() {
    return (
        <>
            <DateTimePickerIsoDemo />
            <DateTimePicker12hDemo />
            <DateTimePickerTimezoneDemo />
            <DateTimePickerObjectDemo />
            <DateTimePickerBoundsDemo />
            <DateTimePickerInlineDemo />
        </>
    );
}
