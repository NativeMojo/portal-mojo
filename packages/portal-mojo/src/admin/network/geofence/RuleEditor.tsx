// GeofenceRuleEditor — the ONE geofence rule editor, shared by the platform
// page (RulesTab) and the group-scoped panel (apps/portal GeofenceSection).
// Port of web-mojo `GeofenceRuleForm.buildRuleFields` + the guided↔JSON mode
// machinery in `GeofenceRulesView`.
//
// Two scopes, one projection: the group surface can only TIGHTEN and writes
// `metadata.geofence` through the group REST (merge-safe, via
// `buildGroupRulePayload`); the platform surface writes `POST /api/geo/rules`
// (a full replace). Neither can write the other's rule — but both speak the
// same DSL through the same lossy projection, which is exactly why the
// projection lives in one module and the editor in one component.
import { MultiSelectDropdown, toast } from '../../../ui';
import {
    ABUSE_FLAGS, COUNTRY_MODE_OPTS, COUNTRY_OPTIONS, EMPTY_RULE_FORM, US_STATES,
    coerceRuleInput, formToRule, isAdvancedRule, ruleToForm,
    type GeofenceRule, type RuleForm,
} from './geofence-data';

/** The editor is fully controlled; this is its entire state. */
export interface RuleEditorValue {
    mode: 'guided' | 'json';
    form: RuleForm;
    json: string;
}

/**
 * Baseline the editor from a stored rule. A rule the guided form cannot
 * represent opens in JSON — never silently rewritten into a lossy form.
 */
export function makeRuleEditorValue(rule: unknown): RuleEditorValue {
    const forced = isAdvancedRule(rule);
    return {
        mode: forced ? 'json' : 'guided',
        form: forced ? { ...EMPTY_RULE_FORM, countries: [], blocked_states: [] } : ruleToForm(rule),
        json: JSON.stringify(rule ?? {}, null, 2),
    };
}

/** The rule the editor currently holds, or null when the JSON is invalid. */
export function ruleFromEditorValue(value: RuleEditorValue): GeofenceRule | null {
    return value.mode === 'json' ? coerceRuleInput(value.json) : formToRule(value.form);
}

const TOGGLE_JSON_ERROR = 'Fix the JSON before switching back to the guided editor.';
const TOGGLE_SHAPE_ERROR = "This rule uses options the guided editor can't represent.";

/**
 * Switch modes, carrying unsaved edits across. Returns the next value, or an
 * error message when the JSON→guided direction must be refused.
 */
export function toggleRuleEditorMode(value: RuleEditorValue): RuleEditorValue | { error: string } {
    if (value.mode === 'json') {
        const rule = coerceRuleInput(value.json);
        if (rule === null) return { error: TOGGLE_JSON_ERROR };
        if (isAdvancedRule(rule)) return { error: TOGGLE_SHAPE_ERROR };
        return { mode: 'guided', form: ruleToForm(rule), json: value.json };
    }
    // Guided → JSON: serialize the LIVE form, so nothing typed is lost.
    const rule = formToRule(value.form);
    return { mode: 'json', form: value.form, json: JSON.stringify(rule, null, 2) };
}

export function GeofenceRuleEditor({
    value, onChange, advancedForced = false, disabled = false, jsonHelp,
}: {
    value: RuleEditorValue;
    onChange: (next: RuleEditorValue) => void;
    /**
     * The STORED rule is unrepresentable, so the guided form is not offered at
     * all (no toggle) — flipping to it would silently drop clauses.
     */
    advancedForced?: boolean;
    disabled?: boolean;
    jsonHelp?: string;
}) {
    const setForm = (form: RuleForm) => onChange({ ...value, form });

    const onToggle = () => {
        const next = toggleRuleEditorMode(value);
        if ('error' in next) { toast.error(next.error); return; }
        onChange(next);
    };

    return (
        <div className="geo-rule-editor">
            {advancedForced && (
                <div className="netsec-note netsec-note-warn">
                    <i className="bi bi-braces" />
                    <div>
                        These rules use options the guided editor can’t represent, so they’re shown
                        as JSON. Edits are still validated by the server on save.
                    </div>
                </div>
            )}

            {value.mode === 'json' ? (
                <label className="field">
                    <span className="field-label">Rule (JSON)</span>
                    <textarea
                        className="input geo-rule-json"
                        rows={12}
                        spellCheck={false}
                        disabled={disabled}
                        value={value.json}
                        onChange={(e) => onChange({ ...value, json: e.target.value })}
                    />
                    <span className="field-help">
                        {jsonHelp ?? 'Top-level keys: country, region, abuse. Operators: in, not_in, eq. Abuse flags: false blocks when detected, true requires the flag.'}
                    </span>
                </label>
            ) : (
                <div className="geo-rule-form">
                    <label className="field">
                        <span className="field-label">Country policy</span>
                        <select
                            className="input"
                            disabled={disabled}
                            value={value.form.country_mode}
                            onChange={(e) => setForm({ ...value.form, country_mode: e.target.value as RuleForm['country_mode'] })}
                        >
                            {COUNTRY_MODE_OPTS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>

                    {value.form.country_mode !== '' && (
                        <MultiSelectDropdown
                            label="Countries"
                            help="Countries are matched by ISO code; pick them by name."
                            options={[...COUNTRY_OPTIONS]}
                            value={value.form.countries}
                            onChange={(values) => setForm({ ...value.form, countries: values.map(String) })}
                            placeholder="Pick countries…"
                        />
                    )}

                    <MultiSelectDropdown
                        label="Blocked US states"
                        help="States are matched by region code (Washington → US-WA)."
                        options={US_STATES}
                        value={value.form.blocked_states}
                        onChange={(values) => setForm({ ...value.form, blocked_states: values.map(String) })}
                        placeholder="No blocked states"
                    />

                    <div className="geo-rule-flags">
                        <div className="field-label">Anonymized connections</div>
                        {ABUSE_FLAGS.map((flag) => (
                            <label key={flag.key} className="switch-setting">
                                <span className="field-label">
                                    Block {flag.label.toLowerCase()}
                                    <span className="field-help" style={{ display: 'block' }}>{flag.help}</span>
                                </span>
                                <input
                                    type="checkbox"
                                    role="switch"
                                    className="switch"
                                    disabled={disabled}
                                    checked={value.form[`block_${flag.key}`]}
                                    onChange={(e) => setForm({ ...value.form, [`block_${flag.key}`]: e.target.checked })}
                                />
                            </label>
                        ))}
                    </div>
                </div>
            )}

            {!advancedForced && (
                <button type="button" className="btn-link geo-rule-toggle" disabled={disabled} onClick={onToggle}>
                    {value.mode === 'json' ? 'Back to the guided editor' : 'Edit as JSON (advanced)'}
                </button>
            )}
        </div>
    );
}
