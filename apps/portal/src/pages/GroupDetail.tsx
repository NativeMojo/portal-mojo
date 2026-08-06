// GroupDetail — the FULL GroupView.js port (web-mojo admin/account/groups/
// GroupView.js, all 2243 lines read 2026-08-05; parity pass over the earlier
// subset build): DetailView modal with the complete section map —
//   Overview · Identity · ─Membership─ Members · Sub-Groups · ─Access─
//   API Keys · Webhooks(manage_group) · Geofencing(geofence perms) ·
//   ─Activity─ Events · Audit(view_logs…) · ─Detail─ Metadata
// — kind-aware header (icon/noun/chips), rail count badges, active toggle
// gated to manage_groups (the source hid it below that tier), kebab context
// menu (Invite Member · Add Sub-{Noun} · Configure Auth · View Parent ·
// Deactivate/Activate), and cross-record navigation (parent/sub-group links
// open a STACKED GroupDetail — native <dialog> stacking).
//
// Deviations from source, all deliberate and documented in-section:
//   · "Edit {Noun}" (the GroupForms.detailed modal) is not carried — the
//     Identity section IS that form, as an autosave surface covering every
//     field it had except avatar (no upload pipeline in portal-mojo yet).
//   · The header aux meta line ("Last activity 50m ago" under the toggle)
//     folds into the chips row — DetailView has no right-gutter meta slot;
//     Overview's KPI carries the same fact.
//   · Member row click opens the member's UserDetail (no MemberView in the
//     portal yet — the admin program owns it).
//   · Deactivate collects the REQUIRED reason (admin | abuse | archived —
//     django-mojo services/disable.py GROUP_REST_REASONS); web-mojo's bare
//     confirm predates that backend rule.
import { useQueryClient, useQuery } from '@tanstack/react-query';
import {
    DetailView, JsonBlock, MetadataSection, formModal, modal, toast,
    type DetailMenuEntry,
} from 'portal-mojo/ui';
import { mojoList, useCan, type Params } from 'portal-mojo/client';
import {
    GROUP_CREDENTIAL_PERMS, GroupApiKeyModel, GroupApiKeysSection,
    LogModel, WebhookSubscriptionModel, WebhookSubscriptionsSection,
} from 'portal-mojo/admin';
import { GroupModel, MemberModel, type GroupRow } from '../models';
import {
    GROUP_ADMIN_PERMS, GROUP_AUTH_PERMS, GROUP_DESTRUCTIVE_PERMS,
    iconForKind, kindLabel,
} from './group-sections/models';
import { GEOFENCE_VIEW_PERMS } from './group-sections/geofence-data';
import { groupAuditParams } from './group-sections/shared';
import { openAuthConfigDialog } from './group-sections/AuthConfigDialog';
import { OverviewSection } from './group-sections/OverviewSection';
import { IdentitySection } from './group-sections/IdentitySection';
import { MembersSection, runInviteMemberFlow } from './group-sections/MembersSection';
import { SubGroupsSection, runAddSubGroupFlow } from './group-sections/SubGroupsSection';
import { GeofenceSection } from './group-sections/GeofenceSection';
import { EventsSection } from './group-sections/EventsSection';
import { AuditSection } from './group-sections/AuditSection';

export { iconForKind } from './group-sections/models';

/** Open another group's detail as a stacked modal (source _openGroupById). */
function openGroupById(id: number) {
    void modal.detail((close) => <GroupDetail id={id} onClose={() => close(null)} />);
}

/**
 * count-only peek sharing useModelList's exact cache key ([endpoint,
 * params]), so a section mounting the same list dedupes with the badge.
 * `enabled:false` for gated surfaces (a non-manager's webhook badge must
 * not fire a guaranteed-403 request per open).
 */
function useCountPeek(endpoint: string, params: Params, enabled = true): number | null {
    const q = useQuery({
        queryKey: [endpoint, params],
        queryFn: () => mojoList(endpoint, params),
        enabled,
    });
    return q.data?.count ?? null;
}

export function GroupDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const qc = useQueryClient();
    const { data: group, isPending } = GroupModel.useOne(id);
    const groupSave = GroupModel.useSave();
    const disable = GroupModel.useAction('disable');
    const reactivate = GroupModel.useAction('reactivate');
    const { can: canDestroy } = useCan(GROUP_DESTRUCTIVE_PERMS);
    const { can: canAccessManage } = useCan(GROUP_CREDENTIAL_PERMS);
    const { can: canViewAudit } = useCan(['view_logs', 'manage_logs', 'security']);

    // Rail count badges (source setBadge wiring, as controlled props). The
    // member/apikey peeks share Overview's keys and dedupe; the gated ones
    // hold off until the caller could actually open the section.
    const memberCount = useCountPeek(MemberModel.endpoint, { group: id, size: 1, is_active: true });
    const subCount = useCountPeek(GroupModel.endpoint, { parent: id, size: 1 });
    const keyCount = useCountPeek(GroupApiKeyModel.endpoint, { group: id, size: 1 }, canAccessManage);
    const hookCount = useCountPeek(WebhookSubscriptionModel.endpoint, { group: id, size: 1 }, canAccessManage);
    const auditCount = useCountPeek(LogModel.endpoint, { ...groupAuditParams(id), size: 1 }, canViewAudit);

    if (isPending || !group) {
        return <div className="detail-loading"><span className="skel skel-block" /></div>;
    }

    const noun = kindLabel(group.kind) || 'Group';

    /** Deactivate collects the REQUIRED reason (admin | abuse | archived). */
    const deactivate = async () => {
        const data = await formModal({
            ...GroupModel.forms.disable!,
            title: `Deactivate ${noun.toLowerCase()}`,
            intro: <>Deactivate <b>{group.name}</b>? Members keep their accounts; the group stops resolving.</>,
        });
        if (!data) return;
        const payload: Record<string, unknown> = { reason: data.reason };
        if (data.note) payload.note = data.note;
        try {
            await disable.mutateAsync({ id: group.id, payload });
            toast.success(`${noun} deactivated`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Deactivate failed');
        }
    };

    const activate = async () => {
        try {
            await reactivate.mutateAsync({ id: group.id });
            toast.success(`${noun} reactivated`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Reactivate failed');
        }
    };

    // Kebab — the source contextItems (GroupView.js:1361-1373) minus "Edit
    // {Noun}" (Identity autosave replaces it — see the header comment).
    const MENU: DetailMenuEntry<GroupRow>[] = [
        {
            label: 'Invite Member', icon: 'bi-person-plus',
            permissions: GROUP_ADMIN_PERMS,
            onSelect: () => { void runInviteMemberFlow(group, qc); },
        },
        {
            label: `Add Sub-${noun}`, icon: 'bi-diagram-3',
            permissions: GROUP_ADMIN_PERMS,
            onSelect: () => { void runAddSubGroupFlow(group, groupSave.mutateAsync); },
        },
        {
            label: 'Configure Auth', icon: 'bi-box-arrow-in-right',
            permissions: GROUP_AUTH_PERMS,
            onSelect: () => { openAuthConfigDialog(group); },
        },
        {
            label: 'View Parent', icon: 'bi-arrow-up-right-square',
            when: (g) => Boolean(g?.parent?.id),
            onSelect: () => { if (group.parent?.id) openGroupById(group.parent.id); },
        },
        { divider: true },
        {
            label: group.is_active ? `Deactivate ${noun}` : `Activate ${noun}`,
            icon: group.is_active ? 'bi-toggle-off' : 'bi-toggle-on',
            danger: group.is_active,
            permissions: GROUP_DESTRUCTIVE_PERMS,
            onSelect: () => { void (group.is_active ? deactivate() : activate()); },
        },
    ];

    const shownMembers = memberCount ?? group.member_count;
    const timezone = typeof group.metadata?.timezone === 'string' ? group.metadata.timezone : null;
    const eodRaw = group.metadata?.eod_hour;
    const eodChip = eodRaw !== undefined && eodRaw !== null && eodRaw !== ''
        ? `EOD ${String(eodRaw).padStart(2, '0')}:00` : null;

    return (
        <DetailView<GroupRow>
            icon={iconForKind(group.kind)}
            title={group.name}
            subtitle={group.parent?.name ?? undefined}
            chips={[
                ...(group.kind ? [{ text: kindLabel(group.kind), tone: 'primary' as const }] : []),
                ...(shownMembers > 0 ? [{ icon: 'bi-people', text: `${shownMembers} member${shownMembers === 1 ? '' : 's'}`, tone: 'muted' as const }] : []),
                ...(subCount != null && subCount > 0 ? [{ icon: 'bi-diagram-3', text: `${subCount} sub-group${subCount === 1 ? '' : 's'}`, tone: 'muted' as const }] : []),
                ...(timezone ? [{ text: timezone, tone: 'muted' as const }] : []),
                ...(eodChip ? [{ text: eodChip, tone: 'muted' as const }] : []),
                ...(group.metadata?.portal ? [{ icon: 'bi-globe', text: 'Has portal', tone: 'muted' as const }] : []),
            ]}
            // Toggle hidden below manage_groups (source _buildHeaderAux gate).
            // Off → deactivate flow (cancel leaves it on); on → reactivate.
            active={canDestroy
                ? { value: group.is_active, onChange: (next) => { void (next ? activate() : deactivate()); } }
                : undefined}
            contextMenu={MENU}
            menuContext={group}
            badges={{
                Members: shownMembers > 0 ? shownMembers : null,
                SubGroups: subCount != null && subCount > 0 ? subCount : null,
                ApiKeys: keyCount != null && keyCount > 0 ? keyCount : null,
                Webhooks: hookCount != null && hookCount > 0 ? hookCount : null,
                Audit: auditCount != null && auditCount > 0 ? auditCount : null,
            }}
            onClose={onClose}
            sections={[
                { key: 'Overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => <OverviewSection group={group} openGroup={openGroupById} /> },
                { key: 'Identity', label: 'Identity', icon: 'bi-card-text', render: () => <IdentitySection group={group} /> },
                { divider: 'Membership' },
                { key: 'Members', label: 'Members', icon: 'bi-people', render: () => <MembersSection group={group} /> },
                { key: 'SubGroups', label: 'Sub-Groups', icon: 'bi-diagram-3', render: () => <SubGroupsSection group={group} openGroup={openGroupById} /> },
                { divider: 'Access' },
                {
                    key: 'ApiKeys', label: 'API Keys', icon: 'bi-key',
                    permissions: GROUP_CREDENTIAL_PERMS,
                    render: () => <GroupApiKeysSection group={group} />,
                },
                {
                    key: 'Webhooks', label: 'Webhooks', icon: 'bi-broadcast',
                    permissions: GROUP_CREDENTIAL_PERMS,
                    render: () => <WebhookSubscriptionsSection group={group} />,
                },
                {
                    key: 'Geofencing', label: 'Geofencing', icon: 'bi-globe-americas',
                    permissions: GEOFENCE_VIEW_PERMS,
                    render: () => <GeofenceSection group={group} />,
                },
                { divider: 'Activity' },
                { key: 'Events', label: 'Events', icon: 'bi-calendar-event', render: () => <EventsSection group={group} /> },
                {
                    key: 'Audit', label: 'Audit', icon: 'bi-clock-history',
                    // Wider than the source's bare 'view_logs': the fetch
                    // itself needs logit's VIEW_PERMS, so the gate matches
                    // what can actually load (fail-closed alignment).
                    permissions: ['view_logs', 'manage_logs', 'security'],
                    render: () => <AuditSection group={group} />,
                },
                { divider: 'Detail' },
                {
                    key: 'Metadata', label: 'Metadata', icon: 'bi-braces',
                    render: () => (
                        <>
                            <MetadataSection
                                endpoint={GroupModel.endpoint}
                                id={group.id}
                                metadata={group.metadata ?? {}}
                                onSaved={(next) => {
                                    // Owner write-through + refetch (the primitive is
                                    // controlled — it never mirrors server state).
                                    qc.setQueryData(GroupModel.keys.one(group.id), { ...group, metadata: next });
                                    void GroupModel.invalidate(qc);
                                }}
                            />
                            <div style={{ marginTop: 16 }}>
                                <JsonBlock value={group.metadata ?? {}} label="Raw metadata (JSON)" collapsible defaultOpen={false} />
                            </div>
                        </>
                    ),
                },
            ]}
        />
    );
}
