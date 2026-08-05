// GroupDetail — the GroupView.js port (web-mojo admin/account/groups/
// GroupView.js, read in full 2026-08-05): DetailView modal with Overview /
// Identity / Members / Sub-groups / Audit, kind-aware header, the hierarchy
// mini-tree with cross-record navigation (parent + sub-group links open a
// STACKED GroupDetail — native <dialog> stacking), and the disable/
// reactivate POST_SAVE_ACTIONS with the group reason set (admin | abuse |
// archived — measured in django-mojo services/disable.py).
//
// Fidelity notes vs the source:
//   · Identity's pencil-prompt-per-row grid becomes ONE FormView autosave
//     surface — name/kind plus the metadata.* settings rows (dotted names →
//     the backend's JSONField dict-merge, so editing timezone never clobbers
//     the rest of metadata).
//   · Members is the ListView port scoped down: server search (the model's
//     SEARCH_FIELDS sweep user__username/email/display_name), card rows with
//     permission chips. Membership WRITES stay off this screen until the
//     admin program's Members domain lands (#1260) — no phantom flows.
//   · API Keys / Webhooks sections are deliberately absent: the live
//     backend's /api/group/apikey 500s (measured), and webhook endpoints
//     aren't mounted on this deployment. The user-key surface lives on the
//     API Keys page instead.
import { useState } from 'react';
import {
    Badge, DetailView, Eyebrow, FlatRow, FormView, MetricCard, SecurityItem, Timeline,
    fmt, formModal, modal, toast,
    type DetailMenuEntry, type Field, type TimelineItem, type Tone,
} from 'portal-mojo/ui';
import { GroupModel, LogModel, MemberModel, GROUP_KIND_OPTIONS, memberParamsFor, type GroupRow } from '../models';

const LOG_TONE: Record<string, Tone> = {
    error: 'danger',
    critical: 'danger',
    warning: 'warning',
    info: 'info',
};

/** Kind → header icon (GroupView.iconForKind port, trimmed to seen kinds). */
export function iconForKind(kind: string | null | undefined): string {
    const k = String(kind ?? '').toLowerCase();
    if (k === 'org' || k === 'organization' || k === 'division' || k === 'department') return 'bi-buildings';
    if (k === 'region' || k === 'location') return 'bi-geo-alt';
    if (k === 'project') return 'bi-kanban';
    if (k === 'merchant' || k === 'partner' || k === 'client' || k === 'reseller') return 'bi-shop';
    if (k === 'route') return 'bi-signpost-2';
    if (k === 'inventory') return 'bi-box-seam';
    if (k === 'qa' || k === 'test' || k === 'testing') return 'bi-clipboard-check';
    return 'bi-people-fill';
}

/** Kind → capitalized noun for copy ("Don't hardcode 'group' in copy"). */
function kindLabel(kind: string | null | undefined): string {
    if (!kind) return '';
    const s = String(kind);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Open another group's detail as a stacked modal (source _openGroupById). */
function openGroupById(id: number) {
    void modal.detail((close) => <GroupDetail id={id} onClose={() => close(null)} />);
}

// ── Sections ──────────────────────────────────────────────────────────

function OverviewSection({ group }: { group: GroupRow }) {
    const { data: subs } = GroupModel.useList({ parent: group.id, size: 25, sort: 'name' });
    const { data: logs } = LogModel.useList({ gid: group.id, size: 5, sort: '-id' });
    const subGroups = subs?.rows ?? [];
    const items: TimelineItem[] = (logs?.rows ?? []).map((l) => ({
        tone: LOG_TONE[l.level] ?? 'muted',
        title: l.kind ?? l.level,
        body: l.log ? <span className="dim">{fmt.truncate(l.log, 90)}</span> : undefined,
        meta: fmt.relative(l.created),
    }));
    return (
        <>
            <div className="grid gap-3 grid-cols-2 xl:grid-cols-4" style={{ marginBottom: 14 }}>
                <MetricCard label="Members" value={group.member_count} />
                <MetricCard label="Sub-groups" value={subs?.count ?? '—'} />
                <MetricCard label="Last activity" value={fmt.relative(group.last_activity, '—')} />
                <MetricCard label="Created" value={fmt.date(group.created)} />
            </div>

            <Eyebrow>This group</Eyebrow>
            <FlatRow label="Name">{group.name}</FlatRow>
            <FlatRow label="Kind">
                {group.kind ? <Badge tone="primary">{kindLabel(group.kind)}</Badge> : <span className="dim-italic">Not set</span>}
            </FlatRow>
            <FlatRow label="Status"><Badge>{group.is_active ? 'Active' : 'Inactive'}</Badge></FlatRow>
            <FlatRow label="Parent">
                {group.parent?.id
                    ? <a href="#" onClick={(e) => { e.preventDefault(); openGroupById(group.parent!.id); }}>{group.parent.name ?? `#${group.parent.id}`}</a>
                    : <span className="dim-italic">None — top-level group</span>}
            </FlatRow>

            <Eyebrow>Hierarchy</Eyebrow>
            {/* GroupHierarchyTree port — small monospace mini-tree; the └─/├─
                rules are decorative, the links are the cross-record nav. */}
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, lineHeight: 1.9 }}>
                {group.parent?.id ? (
                    <a href="#" className="dim" onClick={(e) => { e.preventDefault(); openGroupById(group.parent!.id); }}>
                        {group.parent.name ?? `#${group.parent.id}`}
                    </a>
                ) : (
                    <span className="dim">Top-level group</span>
                )}
                <div>
                    └─ <b>{group.name}</b>
                    <span className="dim"> · {group.member_count} member{group.member_count === 1 ? '' : 's'} · {subGroups.length} sub-group{subGroups.length === 1 ? '' : 's'}</span>
                </div>
                {subGroups.length > 0 && (
                    <div style={{ marginLeft: 22 }}>
                        {subGroups.map((sg, i) => (
                            <div key={sg.id}>
                                {i === subGroups.length - 1 ? '└─' : '├─'}{' '}
                                <a href="#" onClick={(e) => { e.preventDefault(); openGroupById(sg.id); }}>{sg.name}</a>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Eyebrow>Recent activity</Eyebrow>
            <Timeline items={items} emptyText="No recorded activity for this group yet." />
        </>
    );
}

/**
 * Identity — autosave over name/kind + the metadata.* settings the source
 * edited via per-row prompts. Dotted names merge into the JSONField.
 */
const IDENTITY_FIELDS: Field[] = [
    { name: 'name', type: 'text', label: 'Name', columns: 6 },
    {
        name: 'kind', type: 'combo', label: 'Kind', columns: 6,
        options: GROUP_KIND_OPTIONS, placeholder: 'Type or pick a kind…',
        help: 'Drives sidebar context; free-typed kinds are allowed.',
    },
    { name: 'metadata.timezone', type: 'timezone', label: 'Timezone', columns: 6 },
    { name: 'metadata.short_name', type: 'text', label: 'Short name', columns: 6 },
    { name: 'metadata.domain', type: 'text', label: 'Domain', columns: 6, placeholder: 'example.com' },
    { name: 'metadata.portal', type: 'text', label: 'Portal URL', columns: 6, placeholder: 'https://…' },
];

function IdentitySection({ group }: { group: GroupRow }) {
    return (
        <>
            <Eyebrow>Profile &amp; settings</Eyebrow>
            <p className="dim" style={{ margin: '0 0 12px' }}>Edits save on commit — no save button. Metadata fields merge server-side.</p>
            <FormView model={GroupModel} row={group} fields={IDENTITY_FIELDS} />

            <Eyebrow>Record</Eyebrow>
            <FlatRow label="ID"><code>{group.id}</code></FlatRow>
            <FlatRow label="UUID">
                {group.uuid ? <code>{group.uuid}</code> : <span className="dim-italic">Not set</span>}
            </FlatRow>
            <FlatRow label="Auth domain">
                {group.auth_domain ? <code>{group.auth_domain}</code> : <span className="dim-italic">Not set</span>}
            </FlatRow>
            <FlatRow label="Created"><code>{fmt.datetime(group.created)}</code></FlatRow>
            <FlatRow label="Modified"><code>{fmt.datetime(group.modified)}</code></FlatRow>
        </>
    );
}

function MembersSection({ group }: { group: GroupRow }) {
    const [search, setSearch] = useState('');
    const { data } = MemberModel.useList(memberParamsFor(group.id, search));
    const members = data?.rows ?? [];
    return (
        <>
            <Eyebrow>Members</Eyebrow>
            <input
                className="input"
                type="search"
                placeholder="Search members…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ marginBottom: 12 }}
            />
            {members.length === 0 && <p className="dim-italic">No members{search ? ' match this search' : ' yet'}.</p>}
            {members.map((m) => {
                const grants = Object.entries(m.permissions ?? {}).filter(([, v]) => v === true || v === 1).map(([k]) => k);
                const u = m.user;
                return (
                    <SecurityItem
                        key={m.id}
                        icon="bi-person-circle"
                        title={u?.display_name || u?.email || u?.username || `User #${u?.id ?? '?'}`}
                        desc={`${u?.email ?? ''} · Joined ${fmt.date(m.created)}`}
                    >
                        <span className="chip-row">
                            {grants.map((g) => <Badge key={g} tone="info">{g}</Badge>)}
                            <Badge tone={m.is_active ? 'success' : 'muted'}>{m.is_active ? 'Active' : 'Disabled'}</Badge>
                        </span>
                    </SecurityItem>
                );
            })}
            {(data?.count ?? 0) > members.length && (
                <p className="dim" style={{ marginTop: 8 }}>{data!.count - members.length} more — refine the search.</p>
            )}
        </>
    );
}

function SubGroupsSection({ group }: { group: GroupRow }) {
    const { data } = GroupModel.useList({ parent: group.id, size: 25, sort: 'name' });
    const subs = data?.rows ?? [];
    return (
        <>
            <Eyebrow>Sub-groups</Eyebrow>
            {subs.length === 0 && <p className="dim-italic">No sub-groups.</p>}
            {subs.map((sg) => (
                <SecurityItem
                    key={sg.id}
                    icon={iconForKind(sg.kind)}
                    title={sg.name}
                    desc={`${kindLabel(sg.kind) || 'Group'} · ${sg.member_count} member${sg.member_count === 1 ? '' : 's'} · Created ${fmt.date(sg.created)}`}
                >
                    <Badge tone={sg.is_active ? 'success' : 'muted'}>{sg.is_active ? 'Active' : 'Inactive'}</Badge>
                    <button className="btn btn-compact" onClick={() => openGroupById(sg.id)}>Open</button>
                </SecurityItem>
            ))}
        </>
    );
}

function AuditSection({ group }: { group: GroupRow }) {
    const { data } = LogModel.useList({ gid: group.id, size: 15, sort: '-id' });
    const items: TimelineItem[] = (data?.rows ?? []).map((l) => ({
        tone: LOG_TONE[l.level] ?? 'muted',
        title: l.kind ?? l.level,
        body: (
            <span className="dim">
                {l.log ? fmt.truncate(l.log, 110) : ''}
                {l.username && <> · <code>{l.username}</code></>}
            </span>
        ),
        meta: fmt.relative(l.created),
    }));
    return (
        <>
            <Eyebrow>Audit</Eyebrow>
            <Timeline items={items} emptyText="No audit entries recorded for this group yet." />
        </>
    );
}

// ── The assembled detail modal ────────────────────────────────────────

export function GroupDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const { data: group, isPending } = GroupModel.useOne(id);
    const disable = GroupModel.useAction('disable');
    const reactivate = GroupModel.useAction('reactivate');
    const { data: memberPeek } = MemberModel.useList({ group: id, size: 1 });

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

    const MENU: DetailMenuEntry<GroupRow>[] = [
        {
            label: 'View parent', icon: 'bi-arrow-up-right-square',
            when: (g) => Boolean(g?.parent?.id),
            onSelect: () => { if (group.parent?.id) openGroupById(group.parent.id); },
        },
        { divider: true },
        {
            label: group.is_active ? `Deactivate ${noun.toLowerCase()}` : `Activate ${noun.toLowerCase()}`,
            icon: group.is_active ? 'bi-toggle-off' : 'bi-toggle-on',
            danger: group.is_active,
            permissions: 'manage_groups',
            onSelect: () => { void (group.is_active ? deactivate() : activate()); },
        },
    ];

    const memberCount = memberPeek?.count ?? group.member_count;
    const timezone = typeof group.metadata?.timezone === 'string' ? group.metadata.timezone : null;

    return (
        <DetailView<GroupRow>
            icon={iconForKind(group.kind)}
            title={group.name}
            subtitle={group.parent?.name ?? undefined}
            chips={[
                ...(group.kind ? [{ text: kindLabel(group.kind), tone: 'primary' as const }] : []),
                ...(memberCount > 0 ? [{ icon: 'bi-people', text: `${memberCount} member${memberCount === 1 ? '' : 's'}`, tone: 'muted' as const }] : []),
                ...(timezone ? [{ text: timezone, tone: 'muted' as const }] : []),
            ]}
            // Off → deactivate action (cancel leaves it on); on → reactivate.
            active={{ value: group.is_active, onChange: (next) => { void (next ? activate() : deactivate()); } }}
            contextMenu={MENU}
            menuContext={group}
            badges={{ Members: memberCount > 0 ? memberCount : null }}
            onClose={onClose}
            sections={[
                { key: 'Overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => <OverviewSection group={group} /> },
                { key: 'Identity', label: 'Identity', icon: 'bi-card-text', render: () => <IdentitySection group={group} /> },
                { divider: 'Membership' },
                { key: 'Members', label: 'Members', icon: 'bi-people', render: () => <MembersSection group={group} /> },
                { key: 'SubGroups', label: 'Sub-groups', icon: 'bi-diagram-3', render: () => <SubGroupsSection group={group} /> },
                { divider: 'Activity' },
                {
                    key: 'Audit', label: 'Audit', icon: 'bi-clock-history',
                    permissions: ['view_logs', 'manage_logs', 'security'],
                    render: () => <AuditSection group={group} />,
                },
            ]}
        />
    );
}
