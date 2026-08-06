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
import { Eyebrow, toast } from 'portal-mojo/ui';
import { mojoCall, useCan } from 'portal-mojo/client';
// ONE editor, ONE projection, two scopes (#1287): the platform page and this
// group panel now render the same `GeofenceRuleEditor` — including its
// guided↔JSON toggle, which this file's private FriendlyEditor never had.
import {
    GeofenceRuleEditor, makeRuleEditorValue, ruleFromEditorValue,
    type RuleEditorValue,
} from 'portal-mojo/admin';
import { GroupModel, type GroupRow } from '../../models';
import {
    GROUP_GEOFENCE_EDIT_PERMS, buildGroupRulePayload, describeRule, isAdvancedRule,
    type GeoRulesConfig, type GeofenceRule, type RuleClause,
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
    const [editorState, setEditorState] = useState<{ key: string; value: RuleEditorValue }>(() => ({
        key: baselineKey,
        value: makeRuleEditorValue(groupRuleStored),
    }));
    if (editorState.key !== baselineKey) {
        setEditorState({ key: baselineKey, value: makeRuleEditorValue(groupRuleStored) });
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
        const newRule: GeofenceRule | null = ruleFromEditorValue(editorState.value);
        if (newRule === null) {
            setStatus({ text: 'Not saved — the rule must be a valid JSON object.', tone: 'bad' });
            toast.error('Not saved — the rule must be a valid JSON object.');
            return;
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
                        <GeofenceRuleEditor
                            value={editorState.value}
                            onChange={(value) => setEditorState({ key: baselineKey, value })}
                            advancedForced={advancedForced}
                            disabled={save.isPending}
                        />
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
