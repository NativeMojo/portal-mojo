// Overview — UserOverviewSection port (read in full 2026-08-05): KPI cards
// (Devices · Last login · Active sessions · Groups) fed by the SHARED
// queries UserDetail owns, the identity flat rows, and the recent-activity
// merge feed (logins + incidents + object logs + activity → top 5 by ts).
//
// KPI values are TOTAL row counts from the API envelopes (`count`), never
// the fetched-page length — the source read collection.meta.count for
// exactly this reason.
import { Eyebrow, FlatRow, MetricCard, Timeline, fmt, type TimelineItem } from '../../../../ui';
import type { UserRow } from '../models';
import { accountType, LOG_LEVEL_TONE, toMs } from './shared';
import type { SharedUserQueries } from './queries';

export function OverviewSection({ user, shared, onOpenGroup }: {
    user: UserRow;
    shared: SharedUserQueries;
    onOpenGroup?: (groupId: number) => void;
}) {
    const deviceTotal = (shared.devices.data?.count ?? 0) + (shared.pushDevices.data?.count ?? 0);
    const sessionCount = shared.devices.data?.count ?? 0;
    const groupCount = shared.members.data?.count ?? 0;
    const lastLogin = shared.logins.data?.rows[0]?.created ?? user.last_login;

    // ── Merge feed: 2 logins + 2 incidents + 2 object logs + 1 activity,
    //    newest 5 win (UserOverviewSection._buildActivityItems).
    const items: (TimelineItem & { _ts: number | null })[] = [];
    for (const l of shared.logins.data?.rows.slice(0, 2) ?? []) {
        const where = [l.city, l.country_code].filter(Boolean).join(', ');
        items.push({
            _ts: toMs(l.created),
            tone: 'info',
            title: 'Logged in',
            body: (
                <span className="dim">
                    {l.ip_address && <code>{l.ip_address}</code>}
                    {l.ip_address && where ? ' · ' : ''}
                    {where}
                </span>
            ),
            meta: fmt.relative(l.created),
        });
    }
    for (const e of shared.events.data?.rows.slice(0, 2) ?? []) {
        items.push({
            _ts: toMs(e.created),
            tone: 'danger',
            title: e.title || e.category || 'Incident event',
            body: e.category ? <span className="dim">{e.category}</span> : undefined,
            meta: fmt.relative(e.created),
        });
    }
    for (const log of shared.objectLogs.data?.rows.slice(0, 2) ?? []) {
        items.push({
            _ts: toMs(log.created),
            tone: LOG_LEVEL_TONE[(log.level ?? '').toLowerCase()] ?? 'muted',
            title: log.kind || 'Change',
            body: log.log ? <span className="dim">{fmt.truncate(log.log, 80)}</span> : undefined,
            meta: fmt.relative(log.created),
        });
    }
    for (const a of shared.activity.data?.rows.slice(0, 1) ?? []) {
        items.push({
            _ts: toMs(a.created),
            tone: LOG_LEVEL_TONE[(a.level ?? '').toLowerCase()] ?? 'muted',
            title: a.kind || 'Activity',
            body: a.path ? <code className="us-mono-sm">{a.path}</code> : undefined,
            meta: fmt.relative(a.created),
        });
    }
    const feed = items
        .filter((i) => i._ts != null)
        .sort((a, b) => (b._ts ?? 0) - (a._ts ?? 0))
        .slice(0, 5);

    const org = typeof user.org === 'object' && user.org ? user.org : null;

    return (
        <>
            <Eyebrow>Account snapshot</Eyebrow>
            <div className="grid gap-3 grid-cols-2 xl:grid-cols-4" style={{ marginBottom: 14 }}>
                <MetricCard label="Devices" value={String(deviceTotal)} />
                <MetricCard label="Last login" value={fmt.relative(lastLogin, '—')} />
                <MetricCard label="Active sessions" value={String(sessionCount)} />
                <MetricCard label="Groups" value={String(groupCount)} />
            </div>

            <Eyebrow>Identity</Eyebrow>
            <FlatRow label="Display name">{user.display_name ?? <span className="dim">—</span>}</FlatRow>
            <FlatRow label="Email">
                {user.email ? user.email : <span className="dim">—</span>}
            </FlatRow>
            <FlatRow label="Phone">
                {user.phone_number ? <code>{user.phone_number}</code> : <span className="dim">—</span>}
            </FlatRow>
            <FlatRow label="Account type">{accountType(user)}</FlatRow>
            {org && onOpenGroup && (
                <FlatRow label="Organization">
                    <a href="#" onClick={(e) => { e.preventDefault(); onOpenGroup(org.id); }}>
                        <i className="bi bi-buildings" /> {org.name}
                    </a>
                </FlatRow>
            )}
            {org && !onOpenGroup && <FlatRow label="Organization"><i className="bi bi-buildings" /> {org.name}</FlatRow>}

            <Eyebrow>Recent activity</Eyebrow>
            <Timeline items={feed} emptyText="No recent activity yet." />
        </>
    );
}
