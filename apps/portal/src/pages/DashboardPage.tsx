// Dashboard — KPI cards fed by count queries (the stat-strip request shape:
// filters + size:0 → count only), a sparkline, and a recent-users feed.
import { useModelList, type User } from 'portal-mojo/client';
import { Badge, MetricCard, fmt, modal } from 'portal-mojo/ui';
import { MetricsChart } from 'portal-mojo/charts';
import { UserDetail } from './UserDetail';

const ENDPOINT = '/api/user';

function useCount(filters: Record<string, string>) {
    const q = useModelList<User>(ENDPOINT, { size: 0, ...filters });
    return q.data?.count;
}

export function DashboardPage() {
    const total = useCount({});
    const active = useCount({ is_active: 'true' });
    const superusers = useCount({ is_superuser: 'true' });
    const verified = useCount({ is_email_verified: 'true' });

    const recent = useModelList<User>(ENDPOINT, { size: 6, sort: '-created' });

    const openUser = (id: number) => { void modal.detail((close) => <UserDetail id={id} onClose={() => close(null)} />); };

    return (
        <div className="flex flex-col gap-4">
            <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Total Users" value={total ?? '—'} icon="bi-people" hint="All accounts" />
                <MetricCard label="Active" value={active ?? '—'} icon="bi-person-check" hint={total ? `${Math.round(((active ?? 0) / total) * 100)}% of total` : undefined} />
                <MetricCard label="Superusers" value={superusers ?? '—'} icon="bi-shield-lock" hint="System-wide access" />
                <MetricCard label="Email Verified" value={verified ?? '—'} icon="bi-patch-check" hint={total ? `${Math.round(((verified ?? 0) / total) * 100)}% of total` : undefined} />
            </div>

            <MetricsChart
                title="Platform activity"
                slugs={['api_calls', 'logins', 'errors']}
                defaultRange="24h"
                defaultGranularity="hours"
                height={300}
            />

            <div className="grid gap-4 lg:grid-cols-5">
                <div className="lg:col-span-3">
                    <MetricsChart
                        title="Traffic mix"
                        slugs={['api_calls', 'logins']}
                        defaultRange="7d"
                        defaultGranularity="days"
                        defaultType="bar"
                        height={240}
                    />
                </div>

                <div className="panel panel-pad lg:col-span-2">
                    <div className="eyebrow">Latest</div>
                    <h3 className="panel-subtitle">Recent users</h3>
                    <div className="feed">
                        {(recent.data?.rows ?? []).map((u) => (
                            <button key={u.id} className="feed-row" onClick={() => openUser(u.id)}>
                                <span className="cell-avatar">{fmt.initials(u.display_name || u.username)}</span>
                                <span className="feed-main">
                                    <span className="cell-name">{u.display_name || u.username}</span>
                                    <span className="cell-sub">last active {fmt.relative(u.last_activity, 'never')}</span>
                                </span>
                                <Badge>{u.is_active ? 'Active' : 'Inactive'}</Badge>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
