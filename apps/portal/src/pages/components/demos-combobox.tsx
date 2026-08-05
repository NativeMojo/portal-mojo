// ComboBox demos — the house autocomplete. Everything here exercises the
// COMMIT pipeline: the value lines only ever change on selection, Enter on
// custom text, or blur-settle — never per keystroke.
import { useState } from 'react';
// MERGE-WIRE: portal-mojo/ui
import { ComboBox, type ComboOption, type ComboValue } from '../../../../../packages/portal-mojo/src/ui/ComboBox';

// The rule-builder shape ComboInput was written for: field pickers whose
// options carry a description line and a meta payload (field type).
const INCIDENT_FIELDS: ComboOption[] = [
    { value: 'level', label: 'Level', description: 'Severity: error, warning, info', meta: { type: 'str' } },
    { value: 'source_ip', label: 'Source IP', description: 'Origin address of the event', meta: { type: 'str' } },
    { value: 'hostname', label: 'Hostname', description: 'Host that reported the event', meta: { type: 'str' } },
    { value: 'message', label: 'Message', description: 'Raw log message text', meta: { type: 'str' } },
    { value: 'count', label: 'Count', description: 'Events bucketed into this incident', meta: { type: 'int' } },
    { value: 'category', label: 'Category', description: 'Incident rule category slug', meta: { type: 'str' } },
    { value: 'component', label: 'Component', description: 'Reporting app or subsystem', meta: { type: 'str' } },
    { value: 'created', label: 'Created', description: 'Epoch seconds the incident opened', meta: { type: 'datetime' } },
];

// Label ≠ value, and 12 options so the default maxSuggestions=10 cap shows.
const COUNTRIES: ComboOption[] = [
    { value: 'USA', label: 'United States' },
    { value: 'CAN', label: 'Canada' },
    { value: 'MEX', label: 'Mexico' },
    { value: 'GBR', label: 'United Kingdom' },
    { value: 'FRA', label: 'France' },
    { value: 'DEU', label: 'Germany' },
    { value: 'ESP', label: 'Spain' },
    { value: 'ITA', label: 'Italy' },
    { value: 'JPN', label: 'Japan' },
    { value: 'BRA', label: 'Brazil' },
    { value: 'IND', label: 'India' },
    { value: 'AUS', label: 'Australia' },
];

// Bare strings — the normalization path ({ value: s, label: s }).
const FRUITS = ['apple', 'apricot', 'avocado', 'banana', 'blueberry', 'cherry', 'grape', 'grapefruit', 'mango', 'peach', 'pear', 'pineapple'];

const PRIORITIES: ComboOption[] = [
    { value: 1, label: 'Low', description: 'Fix eventually' },
    { value: 2, label: 'Medium', description: 'Fix this sprint' },
    { value: 3, label: 'High', description: 'Fix this week' },
    { value: 4, label: 'Critical', description: 'Fix now' },
];

const show = (v: ComboValue | null) => (v === null || v === '' ? '(empty)' : `${JSON.stringify(v)} (${typeof v})`);

export function ComboBoxDemo() {
    const [field, setField] = useState<ComboValue | null>(null);
    const [lastSelect, setLastSelect] = useState('—');
    const [countryCustom, setCountryCustom] = useState<ComboValue | null>('USA');
    const [countryStrict, setCountryStrict] = useState<ComboValue | null>('CAN');
    const [fruit, setFruit] = useState<ComboValue | null>(null);
    const [prio, setPrio] = useState<ComboValue | null>(2);
    const [submitted, setSubmitted] = useState('—');
    const [requiredVal, setRequiredVal] = useState<ComboValue | null>(null);

    return (
        <>
            <div className="panel panel-pad">
                <div className="eyebrow">Descriptions + meta — the rule-builder field picker</div>
                <p className="dim" style={{ margin: '0 0 10px' }}>
                    Options carry a muted description line (<code>showDescription</code>, default on) and an opaque
                    <code> meta</code> payload that <code>onSelect</code> hands back. Typing filters across label,
                    value and description with the match <mark className="combo-mark">highlighted</mark>; ranking is
                    exact label, then label-starts-with, then input order.
                </p>
                <div style={{ maxWidth: 420 }}>
                    <ComboBox
                        options={INCIDENT_FIELDS}
                        value={field}
                        placeholder="Pick or type an incident field…"
                        onChange={(v) => setField(v)}
                        onSelect={(opt) => setLastSelect(JSON.stringify({ value: opt.value, meta: opt.meta }))}
                    />
                </div>
                <p className="dim" style={{ margin: '10px 0 0' }}>
                    committed: <code>{show(field)}</code> · last onSelect: <code>{lastSelect}</code>
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">allowCustom — on (default) vs off</div>
                <div className="demo-row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ width: 280 }}>
                        <ComboBox
                            options={COUNTRIES}
                            value={countryCustom}
                            onChange={(v) => setCountryCustom(v)}
                            placeholder="Country or anything…"
                        />
                        <p className="dim" style={{ margin: '8px 0 0' }}>
                            custom ok — committed: <code>{show(countryCustom)}</code>
                        </p>
                    </div>
                    <div style={{ width: 280 }}>
                        <ComboBox
                            options={COUNTRIES}
                            value={countryStrict}
                            allowCustom={false}
                            onChange={(v) => setCountryStrict(v)}
                            placeholder="Options only…"
                        />
                        <p className="dim" style={{ margin: '8px 0 0' }}>
                            strict — committed: <code>{show(countryStrict)}</code>
                        </p>
                    </div>
                </div>
                <p className="dim" style={{ margin: '10px 0 0' }}>
                    Left: unmatched text commits as a custom value (Enter or click away). Right: type junk and click
                    away — the display reverts to the committed label. The input shows <b>labels</b>; state holds
                    <b> values</b> (pick United States, the state is <code>"USA"</code>). Escape always restores the
                    committed value; the chevron reopens with the filter cleared. 12 options,
                    <code> maxSuggestions</code> default 10 — the list caps until you narrow it.
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">minChars=2 — typing gates the auto-open</div>
                <div style={{ maxWidth: 320 }}>
                    <ComboBox
                        options={FRUITS}
                        value={fruit}
                        minChars={2}
                        onChange={(v) => setFruit(v)}
                        placeholder="Type 2+ characters…"
                    />
                </div>
                <p className="dim" style={{ margin: '10px 0 0' }}>
                    One typed character closes the list; two opens it filtered. Explicit opens (focus, chevron,
                    ArrowDown) still show everything — the gate is on typing only. Bare-string options normalize to
                    value = label. committed: <code>{show(fruit)}</code>
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">Numeric values — no DOM round-trip</div>
                <div style={{ maxWidth: 320 }}>
                    <ComboBox
                        options={PRIORITIES}
                        value={prio}
                        allowCustom={false}
                        onChange={(v) => setPrio(v)}
                        placeholder="Priority…"
                    />
                </div>
                <p className="dim" style={{ margin: '10px 0 0' }}>
                    Option values stay <code>number</code> through selection — web-mojo matched stringified DOM
                    attributes with <code>===</code> and numeric options could never re-select.
                    committed: <code>{show(prio)}</code>
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">disabled / readOnly / required</div>
                <div className="demo-row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ width: 220 }}>
                        <ComboBox options={COUNTRIES} value="USA" disabled placeholder="Disabled" />
                        <p className="dim" style={{ margin: '6px 0 0' }}>disabled — no focus, no chevron</p>
                    </div>
                    <div style={{ width: 220 }}>
                        <ComboBox options={COUNTRIES} value="CAN" readOnly placeholder="Read-only" />
                        <p className="dim" style={{ margin: '6px 0 0' }}>readOnly — focusable, never opens</p>
                    </div>
                    <form
                        style={{ width: 260 }}
                        onSubmit={(e) => { e.preventDefault(); setSubmitted(show(requiredVal)); }}
                    >
                        <div className="demo-row">
                            <div style={{ flex: 1 }}>
                                <ComboBox
                                    options={COUNTRIES}
                                    value={requiredVal}
                                    required
                                    onChange={(v) => setRequiredVal(v)}
                                    placeholder="Required…"
                                />
                            </div>
                            <button type="submit" className="btn btn-compact">Submit</button>
                        </div>
                        <p className="dim" style={{ margin: '6px 0 0' }}>
                            required — empty blocks native submit · submitted: <code>{submitted}</code>
                        </p>
                    </form>
                </div>
            </div>
        </>
    );
}
