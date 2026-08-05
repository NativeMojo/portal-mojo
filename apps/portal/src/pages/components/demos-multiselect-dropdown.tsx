// MultiSelectDropdown demos — the static-options checkbox dropdown. Five
// panels cover the whole port: the basic pick + summarization ladder
// (placeholder → labels → "N selected"), per-option and whole-control
// disabled, the scalar/0 coercion path with numeric values, the empty
// options menu, and a keyboard-only run that proves the row click and
// keyboard Space drive ONE controlled state (the web-mojo desync bug).
import { useState } from 'react';
// MERGE-WIRE: portal-mojo/ui
import {
    MultiSelectDropdown,
    type MultiSelectOption,
    type MultiSelectValue,
} from '../../../../../packages/portal-mojo/src/ui/MultiSelectDropdown';

// Bare strings — the normalization path ({ value: s, label: s }).
const REGIONS = ['us-east-1', 'us-west-2', 'eu-central-1', 'ap-southeast-2'];

// Six options so the maxLabelsToShow=3 ladder has somewhere to go, and one
// `text` label (the source's alias — accepted, `label` preferred).
const STATUSES: MultiSelectOption[] = [
    { value: 'new', label: 'New' },
    { value: 'open', label: 'Open' },
    { value: 'ack', text: 'Acknowledged' },
    { value: 'paused', label: 'Paused' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'ignored', label: 'Ignored' },
];

// Per-option disabled + numeric values (identity never round-trips through
// DOM strings, so 2 stays the number 2).
const PLANS: MultiSelectOption[] = [
    { value: 1, label: 'Starter' },
    { value: 2, label: 'Team' },
    { value: 3, label: 'Business — contact sales', disabled: true },
    { value: 4, label: 'Enterprise — contact sales', disabled: true },
    { value: 5, label: 'Internal' },
];

// value 0 is a real selection, not "nothing" — the source's truthy coercion
// dropped it.
const PRIORITIES: MultiSelectOption[] = [
    { value: 0, label: 'P0 — page someone' },
    { value: 1, label: 'P1 — same day' },
    { value: 2, label: 'P2 — this week' },
    { value: 3, label: 'P3 — backlog' },
];

const KEYBOARD_OPTIONS: MultiSelectOption[] = [
    { value: 'alpha', label: 'Alpha' },
    { value: 'bravo', label: 'Bravo' },
    { value: 'charlie', label: 'Charlie — disabled', disabled: true },
    { value: 'delta', label: 'Delta' },
    { value: 'echo', label: 'Echo' },
];

function BasicPanel() {
    const [regions, setRegions] = useState<MultiSelectValue[]>([]);
    const [statuses, setStatuses] = useState<MultiSelectValue[]>(['open']);
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Basic — the menu stays open while you tick</div>
            <p className="dim" style={{ margin: '4px 0 14px', maxWidth: 660 }}>
                The whole <b>row</b> is the click target; the checkbox is display-only. Ticking never
                closes the menu (that was the point of the source's <code>data-bs-auto-close="outside"</code>
                — here it is simply how the component is written): <b>Done</b> closes it, as do Escape
                and an outside click. Bare strings normalize to <code>{'{ value, label }'}</code>; the
                legacy <code>text</code> label alias is still accepted (see "Acknowledged").
            </p>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 20 }}>
                <div style={{ minWidth: 260 }}>
                    <MultiSelectDropdown
                        options={REGIONS}
                        value={regions}
                        onChange={setRegions}
                        label="Regions"
                        required
                        placeholder="Any region"
                        help="Bare-string options; custom placeholder."
                    />
                    <pre className="demo-pre" style={{ marginTop: 10 }}>{JSON.stringify(regions)}</pre>
                </div>
                <div style={{ minWidth: 260 }}>
                    <MultiSelectDropdown
                        options={STATUSES}
                        value={statuses}
                        onChange={setStatuses}
                        label="Status"
                        help="Object options — one uses the `text` alias."
                    />
                    <pre className="demo-pre" style={{ marginTop: 10 }}>{JSON.stringify(statuses)}</pre>
                </div>
            </div>
        </div>
    );
}

function SummaryPanel() {
    const [picked, setPicked] = useState<MultiSelectValue[]>(['new', 'open']);
    const [showLabels, setShowLabels] = useState(true);
    const [maxLabels, setMaxLabels] = useState(3);
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Trigger summarization — placeholder → labels → "N selected"</div>
            <p className="dim" style={{ margin: '4px 0 14px', maxWidth: 660 }}>
                Empty shows the muted placeholder. Up to <code>maxLabelsToShow</code> (default 3) picks
                show comma-joined labels in <b>selection order</b>; past that the trigger switches to
                <code> N selected</code>. Tick a 4th status below and watch it flip.
                <code> showSelectedLabels={'{false}'}</code> forces the count at every size.
            </p>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 20 }}>
                <div style={{ minWidth: 300 }}>
                    <MultiSelectDropdown
                        options={STATUSES}
                        value={picked}
                        onChange={setPicked}
                        label="Status"
                        showSelectedLabels={showLabels}
                        maxLabelsToShow={maxLabels}
                        maxHeight={140}
                        help="maxHeight=140 — six options, so the list scrolls."
                    />
                    <pre className="demo-pre" style={{ marginTop: 10 }}>
                        {picked.length} picked · {JSON.stringify(picked)}
                    </pre>
                </div>
                <div style={{ minWidth: 220 }}>
                    <label className="switch-row" style={{ maxWidth: 220 }}>
                        <span className="field-label" style={{ margin: 0 }}>showSelectedLabels</span>
                        <input
                            type="checkbox"
                            role="switch"
                            className="switch"
                            checked={showLabels}
                            onChange={(e) => setShowLabels(e.target.checked)}
                        />
                    </label>
                    <div className="field-label" style={{ marginTop: 6 }}>maxLabelsToShow</div>
                    <div className="seg">
                        {[0, 1, 2, 3, 5].map((n) => (
                            <button
                                key={n}
                                className={`seg-btn${maxLabels === n ? ' seg-active' : ''}`}
                                onClick={() => setMaxLabels(n)}
                            >
                                {n}
                            </button>
                        ))}
                    </div>
                    <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
                        An explicit <code>0</code> is honored (always the count) — the source's{' '}
                        <code>|| 3</code> quietly rewrote it.
                    </p>
                </div>
            </div>
        </div>
    );
}

function DisabledPanel() {
    const [plans, setPlans] = useState<MultiSelectValue[]>([2]);
    const [locked, setLocked] = useState<MultiSelectValue[]>(['us-east-1', 'eu-central-1']);
    const [priorities, setPriorities] = useState<MultiSelectValue[] | MultiSelectValue>(0);
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Disabled options · disabled control · scalar &amp; numeric values</div>
            <p className="dim" style={{ margin: '4px 0 14px', maxWidth: 660 }}>
                Per-option <code>disabled</code> refuses to toggle by click <b>and</b> by keyboard, and
                the row is skipped by arrow navigation. <code>disabled</code> on the control locks the
                trigger outright. The Priorities picker starts with a <b>bare scalar</b>{' '}
                <code>value={'{0}'}</code> — it coerces to <code>[0]</code>, and <code>0</code> counts as
                a selection (the source's truthy test discarded it).
            </p>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 20 }}>
                <div style={{ minWidth: 260 }}>
                    <MultiSelectDropdown
                        options={PLANS}
                        value={plans}
                        onChange={setPlans}
                        label="Plans"
                        help="Business + Enterprise are disabled rows."
                    />
                    <pre className="demo-pre" style={{ marginTop: 10 }}>{JSON.stringify(plans)}</pre>
                </div>
                <div style={{ minWidth: 260 }}>
                    <MultiSelectDropdown
                        options={REGIONS}
                        value={locked}
                        onChange={setLocked}
                        label="Regions (locked)"
                        disabled
                        error="Regions are fixed for this account."
                    />
                    <pre className="demo-pre" style={{ marginTop: 10 }}>{JSON.stringify(locked)}</pre>
                </div>
                <div style={{ minWidth: 260 }}>
                    <MultiSelectDropdown
                        options={PRIORITIES}
                        value={priorities}
                        onChange={setPriorities}
                        label="Priorities"
                        help="Numeric values; starts as the scalar 0."
                    />
                    <pre className="demo-pre" style={{ marginTop: 10 }}>{JSON.stringify(priorities)}</pre>
                </div>
            </div>
        </div>
    );
}

function EmptyPanel() {
    const [picked, setPicked] = useState<MultiSelectValue[]>([]);
    const [unknown, setUnknown] = useState<MultiSelectValue[]>(['ghost']);
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Empty options · unknown selected value</div>
            <p className="dim" style={{ margin: '4px 0 14px', maxWidth: 660 }}>
                With no options the menu is a single <b>"No options available"</b> line and no Done
                footer (source parity) — Escape or an outside click closes it. The second picker holds a
                value no option matches: the trigger shows the raw value rather than a blank summary,
                and warns <b>once</b> in the console (the unknown-value rule — a deliberate console
                message, not a stray log).
            </p>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 20 }}>
                <div style={{ minWidth: 260 }}>
                    <MultiSelectDropdown
                        options={[]}
                        value={picked}
                        onChange={setPicked}
                        label="Tags (none defined yet)"
                        placeholder="Nothing to pick"
                    />
                </div>
                <div style={{ minWidth: 260 }}>
                    <MultiSelectDropdown
                        options={STATUSES}
                        value={unknown}
                        onChange={setUnknown}
                        label="Status (stale value)"
                        help='value ["ghost"] matches no option.'
                    />
                    <pre className="demo-pre" style={{ marginTop: 10 }}>{JSON.stringify(unknown)}</pre>
                </div>
            </div>
        </div>
    );
}

function KeyboardPanel() {
    const [picked, setPicked] = useState<MultiSelectValue[]>([]);
    const [log, setLog] = useState<string[]>([]);
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Keyboard-only run — the desync bug, killed by construction</div>
            <p className="dim" style={{ margin: '4px 0 14px', maxWidth: 660 }}>
                Open the picker with <b>Enter</b> (or ArrowDown) — focus lands on the first enabled row,
                because the menu is portaled to the end of <code>&lt;body&gt;</code> and Tab could never
                reach it. Then: <b>Tab</b> / <b>ArrowDown</b> / <b>ArrowUp</b> move between rows
                (disabled rows are skipped by the arrows), <b>Space</b> toggles the focused one,{' '}
                <b>Tab</b> past the last row reaches <b>Done</b>, and <b>Escape</b> closes and returns
                focus to the trigger.
            </p>
            <p className="dim" style={{ margin: '0 0 14px', maxWidth: 660 }}>
                Every Space produces <b>exactly one</b> log line. web-mojo tracked selection only through
                row-click delegation while shipping a real focusable checkbox and a row-wide{' '}
                <code>&lt;label for&gt;</code> inside each row, so keyboard and label toggles moved the
                DOM without moving the tracked selection (or moved it twice). Here the row IS the
                checkbox widget (<code>role="checkbox"</code>) and the input is display-only — clicks and
                Space run the identical <code>toggle()</code> against the same controlled value.
            </p>
            <div className="demo-row" style={{ alignItems: 'flex-start', gap: 20 }}>
                <div style={{ minWidth: 280 }}>
                    <MultiSelectDropdown
                        options={KEYBOARD_OPTIONS}
                        value={picked}
                        onChange={(values) => {
                            setPicked(values);
                            setLog((prev) => [`#${prev.length + 1} → ${JSON.stringify(values)}`, ...prev].slice(0, 8));
                        }}
                        label="Squads"
                        help="Keyboard-only: Enter, arrows, Space, Tab to Done, Escape."
                    />
                </div>
                <div style={{ minWidth: 300 }}>
                    <div className="eyebrow">onChange log (newest first)</div>
                    <pre className="demo-pre" style={{ marginTop: 6, minHeight: 96 }}>
                        {log.length === 0 ? 'No changes yet.' : log.join('\n')}
                    </pre>
                    <button className="btn btn-compact" onClick={() => setLog([])}>Clear log</button>
                </div>
            </div>
        </div>
    );
}

export function MultiSelectDropdownDemo() {
    return (
        <>
            <BasicPanel />
            <SummaryPanel />
            <DisabledPanel />
            <EmptyPanel />
            <KeyboardPanel />
        </>
    );
}
