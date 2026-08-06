// JobRunnersPage — the fleet roster. Port of web-mojo JobRunnersPage.js +
// sections/JobRunnersSection.js.
//
// Deliberately NOT a ModelTable. `GET /api/jobs/runners` reads exactly one
// param (`channel`) and returns the COMPLETE list — no start/size, no sort, no
// search. Wrapping it in a server table would render a pager and sort headers
// that silently do nothing, so search and ordering happen client-side over the
// full list. Same precedent as MetricsPermissionsPage.
import { useMemo, useState } from 'react';
import { Badge, ExpandingSearch, fmt } from '../../ui';
import { showRunnerDetail } from './RunnerDetail';
import {
    formatHeartbeatAge,
    formatUptime,
    heartbeatAgeSeconds,
    runnerFailureRate,
    runnerHealth,
    runnerUptimeSeconds,
    type RunnerHealthKey,
    type RunnerRow,
} from './models';
import { useRunners } from './queries';

type SortKey = 'runner_id' | 'health' | 'channels' | 'jobs_processed' | 'jobs_failed' | 'last_heartbeat';

const HEALTH_ORDER: Record<RunnerHealthKey, number> = { down: 0, stale: 1, healthy: 2 };

const FILTERS: { key: 'all' | RunnerHealthKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'healthy', label: 'Healthy' },
    { key: 'stale', label: 'Stale' },
    { key: 'down', label: 'Down' },
];

export function JobRunnersPage() {
    const query = useRunners();
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | RunnerHealthKey>('all');
    const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'health', desc: false });

    const rows = useMemo(() => {
        const all = query.data ?? [];
        const term = search.trim().toLowerCase();
        const filtered = all.filter((runner) => {
            if (filter !== 'all' && runnerHealth(runner).key !== filter) return false;
            if (!term) return true;
            return `${runner.runner_id} ${runner.hostname} ${runner.channels.join(' ')}`.toLowerCase().includes(term);
        });
        const value = (runner: RunnerRow): number | string => {
            switch (sort.key) {
                case 'health': return HEALTH_ORDER[runnerHealth(runner).key];
                case 'channels': return runner.channels.length;
                case 'jobs_processed': return runner.jobs_processed;
                case 'jobs_failed': return runner.jobs_failed;
                case 'last_heartbeat': return heartbeatAgeSeconds(runner.last_heartbeat) ?? Number.MAX_SAFE_INTEGER;
                default: return runner.runner_id;
            }
        };
        return [...filtered].sort((a, b) => {
            const av = value(a);
            const bv = value(b);
            const cmp = typeof av === 'number' && typeof bv === 'number'
                ? av - bv
                : String(av).localeCompare(String(bv));
            return sort.desc ? -cmp : cmp;
        });
    }, [query.data, search, filter, sort]);

    const total = query.data?.length ?? 0;
    const alive = (query.data ?? []).filter((runner) => runner.alive).length;

    const header = (key: SortKey, label: string) => (
        <th>
            <button
                type="button"
                className="th-sort"
                onClick={() => setSort((prev) => ({ key, desc: prev.key === key ? !prev.desc : false }))}
            >
                {label}
                <i className={`bi sort-icon ${sort.key !== key ? 'bi-arrow-down-up sort-idle' : sort.desc ? 'bi-arrow-down' : 'bi-arrow-up'}`} />
            </button>
        </th>
    );

    return (
        <div className="panel jobs-runners-page">
            <div className="toolbar">
                <div className="toolbar-heading">
                    <div className="eyebrow">Jobs</div>
                    <h1 className="panel-title">Runners</h1>
                </div>
                <div className="toolbar-controls">
                    <ExpandingSearch value={search} onChange={setSearch} placeholder="Search runner, host, channel…" />
                    <div className="tool-group">
                        <button
                            className="btn-icon"
                            title="Refresh · auto every 60s"
                            onClick={() => void query.refetch()}
                        >
                            <i className={`bi bi-arrow-repeat${query.isFetching ? ' spin' : ''}`} />
                        </button>
                    </div>
                </div>
            </div>

            <div className="seg-row">
                <div className="seg">
                    {FILTERS.map((entry) => (
                        <button
                            key={entry.key}
                            className={`seg-btn${filter === entry.key ? ' seg-active' : ''}`}
                            onClick={() => setFilter(entry.key)}
                        >
                            {entry.label}
                        </button>
                    ))}
                </div>
                {total > 0 && (
                    <span className="result-count">
                        {alive} of {total} alive
                        {rows.length !== total && <span className="dim"> · {rows.length} shown</span>}
                    </span>
                )}
            </div>

            <div className="tbl-scroll">
                <table className="tbl">
                    <thead>
                        <tr>
                            {header('runner_id', 'Runner')}
                            {header('health', 'Health')}
                            {header('channels', 'Channels')}
                            {header('jobs_processed', 'Processed')}
                            {header('jobs_failed', 'Failed')}
                            <th>Failure rate</th>
                            {header('last_heartbeat', 'Heartbeat')}
                            <th>Uptime</th>
                        </tr>
                    </thead>
                    <tbody>
                        {query.isPending && (
                            <tr><td colSpan={8}><div className="empty-state"><p>Loading runners…</p></div></td></tr>
                        )}
                        {query.isError && (
                            <tr><td colSpan={8}>
                                <div className="empty-state">
                                    <i className="bi bi-exclamation-triangle" />
                                    <h3>Could not load runners</h3>
                                    <p>{query.error instanceof Error ? query.error.message : 'Request failed'}</p>
                                    <button className="btn" onClick={() => void query.refetch()}>Retry</button>
                                </div>
                            </td></tr>
                        )}
                        {!query.isPending && !query.isError && rows.length === 0 && (
                            <tr><td colSpan={8}>
                                <div className="empty-state">
                                    <i className="bi bi-cpu" />
                                    {total === 0
                                        ? (
                                            <>
                                                <h3>No runners registered</h3>
                                                <p>Nothing is consuming the queues — jobs will not be processed.</p>
                                            </>
                                        )
                                        : (
                                            <>
                                                <h3>No runners match this view</h3>
                                                <button className="btn" onClick={() => { setSearch(''); setFilter('all'); }}>Clear</button>
                                            </>
                                        )}
                                </div>
                            </td></tr>
                        )}
                        {rows.map((runner) => {
                            const health = runnerHealth(runner);
                            const rate = runnerFailureRate(runner);
                            const uptime = runnerUptimeSeconds(runner);
                            return (
                                <tr key={runner.id} className="row-click" onClick={() => showRunnerDetail(runner)}>
                                    <td>
                                        <div className="jobs-runner-id"><code>{runner.runner_id}</code></div>
                                        <div className="dim">{runner.hostname}</div>
                                    </td>
                                    <td>
                                        <span className={`jobs-dot jobs-dot-${health.tone}`} />
                                        <Badge tone={health.tone}>{health.label}</Badge>
                                    </td>
                                    <td>
                                        {runner.channels.length > 0
                                            ? runner.channels.map((channel) => <code key={channel} className="jobs-channel-chip">{channel}</code>)
                                            : <span className="dim">none</span>}
                                    </td>
                                    <td>{fmt.number(runner.jobs_processed)}</td>
                                    <td>{runner.jobs_failed > 0 ? <span className="jobs-text-danger">{fmt.number(runner.jobs_failed)}</span> : '0'}</td>
                                    <td>{rate == null ? '—' : `${rate.toFixed(2)}%`}</td>
                                    <td title={fmt.datetime(runner.last_heartbeat)}>
                                        {formatHeartbeatAge(heartbeatAgeSeconds(runner.last_heartbeat))}
                                    </td>
                                    <td>{uptime == null ? '—' : formatUptime(uptime)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Stating the contract beats rendering a pager that would lie. */}
            <div className="pager">
                <span className="result-count">
                    {total === 0 ? 'No runners' : `${total} runner${total === 1 ? '' : 's'}`}
                    <span className="dim"> · the runners endpoint returns the complete fleet; sorting and search are applied here</span>
                </span>
            </div>
        </div>
    );
}
