// Groups — the source's ListView-of-MemberList scoped to this user (read in
// full 2026-08-05): group-membership cards (name + kind badge + joined date)
// with the per-group permission keys as chips below, server search
// (SEARCH_FIELDS sweep user__username/email/display_name — search here
// narrows by the group side too on the mock) and pageSize-5 paging. Row
// click opens the group's detail, stacked.
import { Badge, fmt } from '../../../../ui';
import { MemberModel } from '../../members';
import type { UserRow } from '../models';
import { Pager, SectionSearch, useSectionList } from './shared';

export function GroupsSection({ user, onOpenGroup }: { user: UserRow; onOpenGroup?: (groupId: number) => void }) {
    const list = useSectionList(5, { user: user.id, sort: '-created' });
    const { data, isPending } = MemberModel.useList(list.params);
    const rows = data?.rows ?? [];

    return (
        <>
            <div className="us-list-head">
                <SectionSearch state={list} placeholder="Search groups…" />
            </div>
            {isPending && <p className="dim">Loading…</p>}
            {!isPending && rows.length === 0 && (
                <div className="us-empty">
                    <i className="bi bi-people" />
                    <div>{list.search ? 'No memberships match this search.' : 'This user has no group memberships.'}</div>
                </div>
            )}
            {rows.map((m) => {
                const grants = Object.entries(m.permissions ?? {})
                    .filter(([, v]) => v === true || v === 1)
                    .map(([k]) => k);
                const content = (
                    <>
                        <div className="us-feed-top">
                            <strong>{m.group?.name ?? '—'}</strong>
                            {m.group?.kind && <Badge tone="muted">{m.group.kind}</Badge>}
                            {!m.is_active && <Badge tone="warning">Membership disabled</Badge>}
                            <span className="us-feed-when dim">Joined {fmt.date(m.created, '—')}</span>
                        </div>
                        {grants.length > 0 && (
                            <div className="us-feed-body chip-row">
                                {grants.map((g) => <span key={g} className="chip chip-muted">{g}</span>)}
                            </div>
                        )}
                    </>
                );
                return onOpenGroup && m.group?.id ? (
                    <button
                        key={m.id}
                        type="button"
                        className="us-feed-row"
                        onClick={() => onOpenGroup(m.group!.id)}
                    >
                        {content}
                    </button>
                ) : (
                    <div key={m.id} className="us-feed-row">{content}</div>
                );
            })}
            <Pager state={list} count={data?.count ?? 0} />
        </>
    );
}
