// RulesTab — the platform rules editor and the current-policy read-out.
// Port of web-mojo `GeofenceRulesView.js`.
//
// Rules are written ONLY through `POST /api/geo/rules`, which is
// server-validated by `services/geofence/dsl.validate_rule` and answers a
// human-readable 400 ("geofence rule: 'country' has unknown operator 'bogus';
// valid operators are ['eq','in','not_in']"). The generic Settings editor
// would bypass that validation entirely, which is why it is never offered.
//
// A save is a FULL REPLACE that takes effect fleet-wide immediately and
// invalidates cached decisions — so it is an ArmedButton whose armed label
// carries the plain-language diff of the clauses being added and removed.
import { useState } from 'react';
import { ArmedButton, Badge, fmt, toast } from '../../../ui';
import { useCan } from '../../../client';
import type { EventRow } from '../../incidents/models';
import {
    GEOFENCE_EVENT_CATEGORIES, GeofenceEventModel, configChangedBy,
    useRemoveGeoRulesOverride, useSaveGeoRules,
} from '../models';
import {
    GEOFENCE_MANAGE_PERMS, SECURITY_EVENTS_PERMS, describeRule, diffRules, isAdvancedRule,
    type GeoRulesConfig, type GeofenceRule, type RuleClause,
} from './geofence-data';
import {
    GeofenceRuleEditor, makeRuleEditorValue, ruleFromEditorValue, type RuleEditorValue,
} from './RuleEditor';

const CLAUSE_ICONS: Record<RuleClause['tone'], string> = {
    block: 'bi-slash-circle',
    warn: 'bi-exclamation-triangle',
    ok: 'bi-check-circle',
};

function ClauseRow({ clause }: { clause: RuleClause }) {
    return (
        <div className={`geo-clause geo-clause-${clause.tone}`}>
            <i className={`bi ${CLAUSE_ICONS[clause.tone]}`} />
            <span>{clause.text}</span>
        </div>
    );
}

/** The armed label: what this replace ADDS and REMOVES, in plain language. */
export function armedSaveLabel(oldRule: unknown, newRule: unknown): string {
    const { added, removed } = diffRules(oldRule, newRule);
    if (added.length === 0 && removed.length === 0) {
        return 'Click again — replaces the platform rule fleet-wide (no visible clause changes)';
    }
    const parts: string[] = [];
    if (added.length) parts.push(`adds ${added.length} clause${added.length === 1 ? '' : 's'}`);
    if (removed.length) parts.push(`removes ${removed.length} clause${removed.length === 1 ? '' : 's'}`);
    return `Click again — live fleet-wide immediately: ${parts.join(', ')}`;
}

function ChangeHistory() {
    const { can } = useCan(SECURITY_EVENTS_PERMS);
    // `enabled: can` — a geofence-only operator issues NO request here.
    const query = GeofenceEventModel.useList(
        { category: GEOFENCE_EVENT_CATEGORIES.config, size: 10, sort: '-created' },
        { enabled: can },
    );

    if (!can) {
        return (
            <p className="dim">
                <i className="bi bi-eye-slash" /> Change history reads security events — it requires
                security-events access (view_security).
            </p>
        );
    }
    if (query.isPending) return <p className="dim">Loading change history…</p>;
    if (query.error) return <p className="text-bad">{query.error.message}</p>;

    const rows = query.data?.rows ?? [];
    if (rows.length === 0) return <p className="dim">No changes recorded.</p>;

    return (
        <ul className="geo-history">
            {rows.map((event: EventRow) => (
                <li key={event.id}>
                    <span className="geo-history-when" title={fmt.datetime(event.created)}>
                        {fmt.relative(event.created)}
                    </span>
                    <span className="geo-history-who">{configChangedBy(event.metadata) || '—'}</span>
                    <span className="geo-history-what">{event.title || event.details || 'Configuration changed'}</span>
                </li>
            ))}
        </ul>
    );
}

export function RulesTab({ config }: { config: GeoRulesConfig | null | undefined }) {
    const { can: canManage } = useCan(GEOFENCE_MANAGE_PERMS);
    const save = useSaveGeoRules();
    const removeOverride = useRemoveGeoRulesOverride();

    const storedRule: GeofenceRule = (config?.system?.rule ?? {}) as GeofenceRule;
    const source = config?.system?.source || 'none';
    const advancedForced = isAdvancedRule(storedRule);

    // Re-baseline whenever the STORED rule changes identity (post-save
    // refetch). A live form must never be rebuilt under the operator.
    const baselineKey = JSON.stringify(storedRule);
    const [state, setState] = useState<{ key: string; value: RuleEditorValue }>(() => ({
        key: baselineKey,
        value: makeRuleEditorValue(storedRule),
    }));
    if (state.key !== baselineKey) {
        setState({ key: baselineKey, value: makeRuleEditorValue(storedRule) });
    }
    const [status, setStatus] = useState<{ text: string; tone: 'muted' | 'ok' | 'bad' }>({ text: '', tone: 'muted' });

    const draftRule = ruleFromEditorValue(state.value);
    const clauses = describeRule(storedRule);

    const onSave = async () => {
        if (draftRule === null) {
            const message = 'Not saved — the rule must be a valid JSON object.';
            setStatus({ text: message, tone: 'bad' });
            toast.error(message);
            return;
        }
        setStatus({ text: 'Saving…', tone: 'muted' });
        try {
            await save.mutateAsync(draftRule);
            setStatus({ text: 'Saved — rules are live.', tone: 'ok' });
            toast.success('Platform rules saved');
        } catch (err) {
            // The DSL validator's own message, inline AND as a toast.
            const message = err instanceof Error ? err.message : 'Failed to save rules';
            setStatus({ text: message, tone: 'bad' });
            toast.error(message);
        }
    };

    const onRemoveOverride = async () => {
        try {
            await removeOverride.mutateAsync();
            setStatus({ text: 'Portal override removed.', tone: 'ok' });
            toast.success('Portal override removed');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to remove the override';
            setStatus({ text: message, tone: 'bad' });
            toast.error(message);
        }
    };

    return (
        <div className="geo-two-col">
            <div className="panel netsec-card">
                <div className="netsec-card-head">
                    <span>Edit platform rules</span>
                    <span className="eyebrow">applies to every group</span>
                </div>
                <div className="netsec-card-body">
                    {!canManage ? (
                        <p className="dim">
                            <i className="bi bi-eye" /> You have read-only access to geofencing.
                            Editing platform rules requires the manage-geofence permission.
                        </p>
                    ) : (
                        <>
                            {source === 'conf' && (
                                <div className="netsec-note netsec-note-info">
                                    <i className="bi bi-lock" />
                                    <div>
                                        These rules come from the <b>deployment file</b>. Saving here creates a
                                        portal-managed override that takes precedence; removing the override
                                        falls back to the deploy-file rules.
                                    </div>
                                </div>
                            )}

                            <GeofenceRuleEditor
                                value={state.value}
                                onChange={(value) => setState({ key: baselineKey, value })}
                                advancedForced={advancedForced}
                                disabled={save.isPending}
                            />

                            <div className="geo-save-row">
                                <ArmedButton
                                    className="btn-primary btn-compact"
                                    icon="bi-check-lg"
                                    label="Save rules"
                                    armedLabel={armedSaveLabel(storedRule, draftRule ?? {})}
                                    disabled={save.isPending}
                                    onConfirm={onSave}
                                />
                                <button
                                    type="button"
                                    className="btn btn-compact"
                                    disabled={save.isPending}
                                    onClick={() => {
                                        setState({ key: baselineKey, value: makeRuleEditorValue(storedRule) });
                                        setStatus({ text: '', tone: 'muted' });
                                    }}
                                >
                                    Discard changes
                                </button>
                                <span className={`geo-status ${status.tone === 'bad' ? 'text-bad' : status.tone === 'ok' ? 'text-ok' : 'dim'}`}>
                                    {status.text}
                                </span>
                                {source === 'setting' && (
                                    <ArmedButton
                                        className="btn-compact btn-danger geo-remove-override"
                                        icon="bi-x-circle"
                                        label="Remove portal override"
                                        armedLabel="Click again — the server falls back to the deploy-file rules (or none) and cached decisions are invalidated"
                                        disabled={removeOverride.isPending}
                                        onConfirm={onRemoveOverride}
                                    />
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div className="geo-side">
                <div className="panel netsec-card">
                    <div className="netsec-card-head">
                        <span>Current policy</span>
                        <span className="eyebrow">plain language</span>
                    </div>
                    <div className="netsec-card-body">
                        {clauses.length > 0
                            ? clauses.map((clause, index) => <ClauseRow key={index} clause={clause} />)
                            : <p className="dim">No rules configured — all locations are allowed.</p>}
                        <div className="geo-clause geo-clause-note">
                            <i className="bi bi-plus-circle" />
                            <span>Groups may add stricter rules of their own on top. They can never loosen this floor.</span>
                        </div>
                        {config?.system?.modified && (
                            <p className="dim geo-modified">
                                Last written {fmt.datetime(config.system.modified)}
                                {' '}<Badge tone="muted">{source}</Badge>
                            </p>
                        )}
                    </div>
                </div>

                <div className="panel netsec-card">
                    <div className="netsec-card-head"><span>Change history</span></div>
                    <div className="netsec-card-body">
                        <ChangeHistory />
                        <p className="dim geo-history-foot">Every save is recorded with who and when.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
