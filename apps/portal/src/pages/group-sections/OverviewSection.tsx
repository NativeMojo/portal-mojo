// group-sections/OverviewSection.tsx — GroupOverviewSection port
// (GroupView.js:98-349): four KPI cards (Members / Sub-Groups / API Keys /
// Last activity), the "This group" flat rows, the monospace hierarchy
// mini-tree with cross-record navigation, and the recent-activity timeline
// fed by the group's OBJECT logs (model_name=account.Group — the source's
// shared audit collection, not the gid context feed).
import {
    Badge, Eyebrow, FlatRow, MetricCard, Timeline,
    fmt, type TimelineItem,
} from 'portal-mojo/ui';
import { GroupModel, LogModel, MemberModel, type GroupRow } from '../../models';
import { GroupApiKeyModel } from 'portal-mojo/admin';
import { kindLabel } from './models';
import { LOG_TONE, groupAuditParams } from './shared';

export function OverviewSection({ group, openGroup }: {
    group: GroupRow;
    openGroup: (id: number) => void;
}) {
    const { data: subs } = GroupModel.useList({ parent: group.id, size: 25, sort: 'name' });
    const { data: memberPeek } = MemberModel.useList({ group: group.id, size: 1, is_active: true });
    const { data: keyPeek } = GroupApiKeyModel.useList({ group: group.id, size: 1 });
    const { data: logs } = LogModel.useList({ ...groupAuditParams(group.id), size: 5 });

    const subGroups = subs?.rows ?? [];
    const subCount = subs?.count ?? subGroups.length;
    const memberCount = memberPeek?.count ?? group.member_count;
    const items: TimelineItem[] = (logs?.rows ?? []).map((l) => ({
        tone: LOG_TONE[l.level] ?? 'muted',
        title: l.kind ?? l.level,
        body: l.log ? <span className="dim">{fmt.truncate(l.log, 90)}</span> : undefined,
        meta: fmt.relative(l.created),
    }));

    const parentLink = group.parent?.id ? (
        <a href="#" onClick={(e) => { e.preventDefault(); openGroup(group.parent!.id); }}>
            {group.parent.name ?? `#${group.parent.id}`}
        </a>
    ) : null;

    return (
        <>
            <div className="grid gap-3 grid-cols-2 xl:grid-cols-4" style={{ marginBottom: 14 }}>
                <MetricCard label="Members" value={memberCount} />
                <MetricCard label="Sub-groups" value={subs ? subCount : '—'} />
                <MetricCard label="API keys" value={keyPeek?.count ?? '—'} />
                <MetricCard label="Last activity" value={fmt.relative(group.last_activity, '—')} />
            </div>

            <Eyebrow>This group</Eyebrow>
            <FlatRow label="Name">{group.name}</FlatRow>
            <FlatRow label="Kind">
                {group.kind ? <Badge tone="primary">{kindLabel(group.kind)}</Badge> : <span className="dim-italic">Not set</span>}
            </FlatRow>
            <FlatRow label="Status">
                <Badge tone={group.is_active ? 'success' : 'muted'}>{group.is_active ? 'Active' : 'Inactive'}</Badge>
            </FlatRow>
            <FlatRow label="Parent">
                {parentLink ?? <span className="dim-italic">None — top-level group</span>}
            </FlatRow>

            <Eyebrow>Hierarchy</Eyebrow>
            {/* GroupHierarchyTree port — the └─/├─ rules are decorative; the
                links are the cross-record nav (parent + sub-group open a
                STACKED GroupDetail via native <dialog> stacking). */}
            <div className="ga-tree">
                {group.parent?.id ? (
                    <a href="#" className="dim" onClick={(e) => { e.preventDefault(); openGroup(group.parent!.id); }}>
                        {group.parent.name ?? `#${group.parent.id}`}
                    </a>
                ) : (
                    <span className="dim">Top-level group</span>
                )}
                <div>
                    └─ <b>{group.name}</b>
                    <span className="dim">
                        {' '}· {memberCount} member{memberCount === 1 ? '' : 's'} · {subCount} sub-group{subCount === 1 ? '' : 's'}
                    </span>
                </div>
                {subGroups.length > 0 && (
                    <div className="ga-tree-children">
                        {subGroups.map((sg, i) => (
                            <div key={sg.id}>
                                {i === subGroups.length - 1 ? '└─' : '├─'}{' '}
                                <a href="#" onClick={(e) => { e.preventDefault(); openGroup(sg.id); }}>{sg.name}</a>
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
