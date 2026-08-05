// Dashboard — the mission-control landing: a KPI strip (metric tiles with
// sparklines + deltas beside count tiles fed by size:0 queries), the main
// metrics chart (stats / view-data / custom-range dialogs on the header),
// scoped mini widgets, and a user-base doughnut + verified ring built from
// the same count queries.
import { useModelList, type User } from 'portal-mojo/client';
import { Badge, fmt, modal } from 'portal-mojo/ui';
import { KPIStrip, MetricsChart, MetricsMiniWidget, PieChart } from 'portal-mojo/charts';
import { GroupModel } from '../models';
import { UserDetail } from './UserDetail';

const ENDPOINT = '/api/user';

function useCount(filters: Record<string, string>) {
    const q = useModelList<User>(ENDPOINT, { size: 0, ...filters });
    return q.data?.count;
}

export function DashboardPage() {
    const total = useCount({});
    const active = useCount({ is_active: 'true' });
    const verified = useCount({ is_email_verified: 'true' });

    const recent = useModelList<User>(ENDPOINT, { size: 6, sort: '-created' });

    const openUser = (id: number) => { void modal.detail((close) => <UserDetail id={id} onClose={() => close(null)} />); };

    const disabled = total != null && active != null ? Math.max(0, total - active) : null;
    const verifiedPct = total ? Math.round(((verified ?? 0) / total) * 100) : null;

    return (
        <div className="flex flex-col gap-4">
            {/* Metric tiles (sparkline + day-over-day delta from ONE batched
                fetch) beside count tiles fed by the size:0 count queries. */}
            <KPIStrip
                tiles={[
                    { key: 'users', label: 'Total Users', value: total ?? null },
                    { slug: 'api_calls', label: 'API Calls', tone: 'good' },
                    { slug: 'logins', label: 'Logins', tone: 'good' },
                    { slug: 'errors', label: 'Errors', tone: 'bad', severity: 'warn' },
                ]}
                granularity="days"
                range="7d"
            />

            <MetricsChart
                title="Platform activity"
                slugs={['api_calls', 'logins', 'errors']}
                seriesLabels={{ api_calls: 'API Calls', logins: 'Logins', errors: 'Errors' }}
                defaultRange="24h"
                defaultGranularity="hours"
                height={300}
            />

            <div className="grid gap-4 lg:grid-cols-3">
                <MetricsMiniWidget
                    title="Logins"
                    icon="bi bi-box-arrow-in-right"
                    slugs={['logins']}
                    granularity="hours"
                    defaultRange="24h"
                    showTrending
                    // Anchor the comparison off the IN-PROGRESS bucket and
                    // compare 6 complete hours vs the 6 before (trendRange/2).
                    trendOffset={1}
                    trendRange={12}
                    subtitle={(ctx) => <><b>{ctx.total.toLocaleString()}</b> in 24h</>}
                    search={{
                        model: GroupModel,
                        placeholder: 'All groups (global)',
                        toAccount: (id) => `group-${id}`,
                    }}
                />
                <MetricsMiniWidget
                    title="Errors"
                    icon="bi bi-bug"
                    slugs={['errors']}
                    granularity="hours"
                    defaultRange="24h"
                    chartType="bar"
                    tone="bad"
                    showTrending
                    // Anchor the comparison off the IN-PROGRESS bucket and
                    // compare 6 complete hours vs the 6 before (trendRange/2).
                    trendOffset={1}
                    trendRange={12}
                    subtitle={(ctx) => <><b>{ctx.total.toLocaleString()}</b> in 24h · {ctx.nowLabel.toLowerCase()}: {ctx.nowValue.toLocaleString()}</>}
                />
                <div className="panel panel-pad">
                    <div className="eyebrow">Accounts</div>
                    <h3 className="panel-subtitle">User base</h3>
                    <div className="flex items-center gap-6 flex-wrap">
                        <PieChart
                            data={total == null || disabled == null ? null : [
                                { label: 'Active', value: active ?? 0, color: 'var(--ok)' },
                                { label: 'Disabled', value: disabled, color: 'var(--bad)' },
                            ]}
                            width={150}
                            height={150}
                            cutout={0.62}
                            centerLabel={(ctx) => ctx.total.toLocaleString()}
                            centerSubLabel="users"
                            emptyText="Loading…"
                        />
                        {/* Verified is ONE number, not a composition — a second
                            ring beside the donut read as "two pie charts" and
                            made this the tallest card in the row. A stat says
                            it in less ink. */}
                        <div>
                            <div className="eyebrow">Email verified</div>
                            <div className="kpi-tile-value" style={{ marginTop: 2 }}>
                                {verifiedPct != null ? `${verifiedPct}%` : '—'}
                            </div>
                            <div className="dim" style={{ fontSize: 12.5 }}>
                                {verified ?? 0} of {total ?? 0} accounts
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
                <div className="lg:col-span-3">
                    <MetricsChart
                        title="Traffic mix"
                        slugs={['api_calls', 'logins']}
                        seriesLabels={{ api_calls: 'API Calls', logins: 'Logins' }}
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
