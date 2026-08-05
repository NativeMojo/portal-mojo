// group-sections/GeofenceSection.tsx — GroupGeofenceSection port
// (admin/account/groups/GroupGeofenceSection.js, read in full 2026-08-05):
// the GROUP-scoped geofence panel, three layers so an operator always sees
// the effective policy, never just the fragment they can edit:
//   1. the platform floor (read-only, GET /api/geo/rules?group_uuid=),
//   2. this group's additional rules (editable — they can only tighten),
//   3. the effective policy (floor + group, each clause tagged by source).
//
// FAIL-CLOSED floor: portal_test measures a 403 on /api/geo/rules — correct
// gating (the endpoint honors only GLOBAL geofence grants). The floor card
// then reads "Platform rules unavailable (requires the global geofence
// permission)" and the group's own rule (from group.metadata.geofence) still
// renders + edits — exactly the source's degradation.
//
// Saves go through the standard group REST: django deep-merges the metadata
// JSONField (null deletes a key; nested __replace is NOT supported), so the
// payload comes from buildGroupRulePayload — the new rule plus explicit
// nulls for anything removed. The server validates the merged rule and 400s
// with a human-readable message, surfaced inline + toast.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Eyebrow, MultiSelectDropdown,
    toast,
} from 'portal-mojo/ui';
import { mojoCall, useCan } from 'portal-mojo/client';
import { GroupModel, type GroupRow } from '../../models';
import {
    ABUSE_FLAGS, COUNTRY_MODE_OPTS, COUNTRY_OPTIONS, GROUP_GEOFENCE_EDIT_PERMS,
    US_STATES, buildGroupRulePayload, coerceRuleInput, describeRule, formToRule,
    isAdvancedRule, ruleToForm,
    type GeoRulesConfig, type GeofenceRule, type RuleClause, type RuleForm,
} from './geofence-data';

const CLAUSE_ICONS: Record<RuleClause['tone'], string> = {
    block: 'bi-slash-circle',
    warn: 'bi-exclamation-triangle',
    ok: 'bi-check-circle',
};

function ClauseRow({ clause, source }: { clause: RuleClause; source?: 'platform' | 'group' }) {
    return (
        <div className={`ga-clause ga-clause-${clause.tone}`}>
            <i className={`bi ${CLAUSE_ICONS[clause.tone]}`} />
            <span>{clause.text}</span>
            {source && (
                <span className={`chip ${source === 'platform' ? 'chip-muted' : 'chip-primary'}`}>
                    {source === 'platform' ? 'Platform' : 'This group'}
                </span>
            )}
        </div>
    );
}

/** The friendly editor over the RuleForm projection. */
function FriendlyEditor({ form, onChange }: { form: RuleForm; onChange: (next: RuleForm) => void }) {
    return (
        <div className="ga-geo-form">
            <label className="field">
                <span className="field-label">Country policy</span>
                <select
                    className="input"
                    value={form.country_mode}
                    onChange={(e) => onChange({ ...form, country_mode: e.target.value as RuleForm['country_mode'] })}
                >
                    {COUNTRY_MODE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            </label>
            {form.country_mode !== '' && (
                <MultiSelectDropdown
                    label="Countries"
                    help="Countries are matched by ISO code; pick them by name."
                    options={COUNTRY_OPTIONS}
                    value={form.countries}
                    onChange={(values) => onChange({ ...form, countries: values.map(String) })}
                    placeholder="Pick countries…"
                />
            )}
            <MultiSelectDropdown
                label="Blocked US states"
                help="States are matched by region code (Washington → US-WA)."
                options={US_STATES}
                value={form.blocked_states}
                onChange={(values) => onChange({ ...form, blocked_states: values.map(String) })}
                placeholder="No blocked states"
            />
            <div className="ga-geo-flags">
                <div className="field-label">Anonymized connections</div>
                {ABUSE_FLAGS.map((f) => (
                    <label key={f.key} className="switch-row">
                        <span className="field-label">
                            Block {f.label.toLowerCase()}
                            <span className="field-help" style={{ display: 'block' }}>{f.help}</span>
                        </span>
                        <input
                            type="checkbox"
                            role="switch"
                            className="switch"
                            checked={form[`block_${f.key}`]}
                            onChange={(e) => onChange({ ...form, [`block_${f.key}`]: e.target.checked })}
                        />
                    </label>
                ))}
            </div>
        </div>
    );
}

export function GeofenceSection({ group }: { group: GroupRow }) {
    const { can: canEdit } = useCan(GROUP_GEOFENCE_EDIT_PERMS);
    const save = GroupModel.useSave();

    // The platform floor + the server's view of this group's rule. 4xx
    // (MojoError) never retries under mojoQueryDefaults; a 403 lands in
    // `error` and the card degrades — fail-closed, never a spinner forever.
    const floorQuery = useQuery({
        queryKey: ['geo-rules', group.uuid ?? group.id],
        queryFn: async (): Promise<GeoRulesConfig> => {
            const body = await mojoCall('/api/geo/rules', {
                params: group.uuid ? { group_uuid: group.uuid } : {},
            });
            return (body.data ?? {}) as GeoRulesConfig;
        },
    });

    const floorRule: GeofenceRule = floorQuery.data?.system?.rule ?? {};
    // The group rule: prefer the server's view (the /api/geo/rules payload
    // echoes it), else the metadata blob on the row.
    const groupRuleStored: GeofenceRule = useMemo(() => {
        const fromServer = floorQuery.data?.group?.rule;
        if (fromServer !== undefined && fromServer !== null) return fromServer;
        const meta = group.metadata?.geofence;
        return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as GeofenceRule : {};
    }, [floorQuery.data, group.metadata]);

    const advancedForced = isAdvancedRule(groupRuleStored);

    // Editor state, re-baselined whenever the STORED rule changes identity
    // (post-save refetch). A live form must not be rebuilt under the user —
    // the baseline key ties state to the stored snapshot (source
    // _onModelChange no-op semantics).
    const baselineKey = JSON.stringify(groupRuleStored);
    const [editorState, setEditorState] = useState<{ key: string; form: RuleForm; json: string }>(() => ({
        key: baselineKey,
        form: ruleToForm(groupRuleStored),
        json: JSON.stringify(groupRuleStored, null, 2),
    }));
    if (editorState.key !== baselineKey) {
        setEditorState({ key: baselineKey, form: ruleToForm(groupRuleStored), json: JSON.stringify(groupRuleStored, null, 2) });
    }
    const [status, setStatus] = useState<{ text: string; tone: 'muted' | 'ok' | 'bad' }>({ text: '', tone: 'muted' });

    const floorClauses = describeRule(floorRule);
    const groupClauses = describeRule(groupRuleStored);
    const floorEmptyText = floorQuery.isPending
        ? 'Loading platform rules…'
        : floorQuery.isError
            ? 'Platform rules unavailable (requires the global geofence permission).'
            : 'No platform rules — the floor allows all locations.';

    const saveRules = async () => {
        let newRule: GeofenceRule;
        if (advancedForced) {
            const coerced = coerceRuleInput(editorState.json);
            if (coerced === null) {
                setStatus({ text: 'Not saved — the rule must be a valid JSON object.', tone: 'bad' });
                toast.error('Not saved — the rule must be a valid JSON object.');
                return;
            }
            newRule = coerced;
        } else {
            newRule = formToRule(editorState.form);
        }

        const payload = buildGroupRulePayload(groupRuleStored, newRule);
        if (payload === null) {
            setStatus({ text: 'No changes to save.', tone: 'muted' });
            return;
        }

        setStatus({ text: 'Saving…', tone: 'muted' });
        try {
            await save.mutateAsync({ id: group.id, changes: { metadata: { geofence: payload } } });
            await floorQuery.refetch();
            setStatus({ text: 'All changes saved.', tone: 'ok' });
            toast.success('Group geofence rules saved');
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to save the group rules';
            setStatus({ text: msg, tone: 'bad' });
            toast.error(msg);
        }
    };

    return (
        <>
            <Eyebrow>Geofencing</Eyebrow>
            <p className="dim" style={{ margin: '0 0 12px' }}>
                Rules here apply only to this group and can only <b>tighten</b> the
                platform rules — they can't loosen the platform floor.
            </p>

            <div className="ga-geo-card">
                <div className="ga-geo-card-head"><i className="bi bi-lock" /> Platform floor — read only</div>
                <div className="ga-geo-card-body">
                    {floorClauses.length > 0
                        ? floorClauses.map((c, i) => <ClauseRow key={i} clause={c} />)
                        : <div className="dim">{floorEmptyText}</div>}
                </div>
            </div>

            {canEdit ? (
                <div className="ga-geo-card">
                    <div className="ga-geo-card-head">This group's additional rules</div>
                    <div className="ga-geo-card-body">
                        {advancedForced ? (
                            <>
                                <div className="ga-geo-advanced-note">
                                    <i className="bi bi-braces" /> This group's rule uses options the guided editor
                                    can't represent, so it's shown as JSON. Edits are still validated by the server on save.
                                </div>
                                <label className="field">
                                    <span className="field-label">Group rule (JSON)</span>
                                    <textarea
                                        className="input ga-geo-json"
                                        rows={8}
                                        value={editorState.json}
                                        onChange={(e) => setEditorState({ ...editorState, json: e.target.value })}
                                    />
                                    <span className="field-help">Top-level keys: country, region, abuse. Operators: in, not_in, eq.</span>
                                </label>
                            </>
                        ) : (
                            <FriendlyEditor
                                form={editorState.form}
                                onChange={(next) => setEditorState({ ...editorState, form: next })}
                            />
                        )}
                        <div className="ga-geo-save-row">
                            <span className={`ga-geo-status ${status.tone === 'bad' ? 'ga-status-bad' : status.tone === 'ok' ? 'ga-status-ok' : 'dim'}`}>
                                {status.text}
                            </span>
                            <button className="btn btn-primary btn-compact" disabled={save.isPending} onClick={() => void saveRules()}>
                                <i className="bi bi-check-lg" /> Save group rules
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="ga-geo-card">
                    <div className="ga-geo-card-body dim">
                        <i className="bi bi-eye" /> You have read-only access to this group's geofence rules.
                    </div>
                </div>
            )}

            <div className="ga-geo-card">
                <div className="ga-geo-card-head">
                    Effective policy for this group
                    <span className="ga-geo-eyebrow">what a visitor experiences</span>
                </div>
                <div className="ga-geo-card-body">
                    {floorClauses.length === 0 && groupClauses.length === 0 ? (
                        <div className="dim">No rules apply — all locations are allowed.</div>
                    ) : (
                        <>
                            {floorClauses.map((c, i) => <ClauseRow key={`f${i}`} clause={c} source="platform" />)}
                            {groupClauses.map((c, i) => <ClauseRow key={`g${i}`} clause={c} source="group" />)}
                        </>
                    )}
                </div>
            </div>
        </>
    );
}
