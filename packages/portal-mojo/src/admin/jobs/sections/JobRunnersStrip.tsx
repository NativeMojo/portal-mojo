// JobRunnersStrip — the fleet summary that opens the dashboard. Port of
// web-mojo JobsRunnersStrip.js.
//
// Runners are the PRIMARY alert signal: if none are alive nothing moves, no
// matter how healthy the channel numbers look. Hence the position at the top
// and the critical empty state.
import { Badge, fmt } from '../../../ui';
import { showRunnerDetail } from '../RunnerDetail';
import {
    formatHeartbeatAge,
    heartbeatAgeSeconds,
    runnerHealth,
    type RunnerRow,
} from '../models';
import { useRunners } from '../queries';

/** Worst state in the fleet drives the header tone. */
function summaryTone(runners: RunnerRow[], loaded: boolean): 'success' | 'warning' | 'danger' | 'muted' {
    if (!loaded) return 'muted';
    if (runners.length === 0) return 'danger';
    if (runners.some((runner) => runnerHealth(runner).key === 'down')) return 'danger';
    if (runners.some((runner) => runnerHealth(runner).key === 'stale')) return 'warning';
    return 'success';
}

export function JobRunnersStrip() {
    const query = useRunners();
    const runners = query.data ?? [];
    const loaded = !query.isPending && !query.isError;
    const alive = runners.filter((runner) => runner.alive).length;
    const processed = runners.reduce((sum, runner) => sum + (runner.jobs_processed || 0), 0);
    const tone = summaryTone(runners, loaded);

    const summary = query.isPending
        ? 'Loading runners…'
        : query.isError
            ? 'Could not load runners'
            : runners.length === 0
                ? 'No runners registered'
                : `${alive} of ${runners.length} runner${runners.length === 1 ? '' : 's'} alive · ${fmt.number(processed)} jobs processed`;

    return (
        <details className="panel jobs-strip" open>
            <summary className="jobs-strip-head">
                <span className="jobs-strip-title"><i className="bi bi-cpu" /> Runners</span>
                <span className={`jobs-strip-summary jobs-text-${tone}`}>{summary}</span>
                <i className="bi bi-chevron-down jobs-strip-chevron" />
            </summary>
            <ul className="jobs-strip-list">
                {loaded && runners.length === 0 && (
                    <li className="jobs-strip-row jobs-strip-empty">
                        <i className="bi bi-exclamation-triangle" />
                        No runners registered — jobs will not be processed.
                    </li>
                )}
                {runners.map((runner) => {
                    const health = runnerHealth(runner);
                    return (
                        <li key={runner.id}>
                            <button type="button" className="jobs-strip-row" onClick={() => showRunnerDetail(runner)}>
                                <span className={`jobs-dot jobs-dot-${health.tone}`} />
                                <span className="jobs-strip-id">
                                    <code>{runner.runner_id}</code>
                                    <span className="dim">
                                        {runner.channels.length > 0 ? runner.channels.join(', ') : 'no channels'}
                                        {' · '}
                                        {fmt.number(runner.jobs_processed)} done
                                        {runner.jobs_failed > 0 && ` · ${fmt.number(runner.jobs_failed)} failed`}
                                    </span>
                                </span>
                                <span className="dim jobs-strip-when" title={fmt.datetime(runner.last_heartbeat)}>
                                    {formatHeartbeatAge(heartbeatAgeSeconds(runner.last_heartbeat))}
                                </span>
                                <Badge tone={health.tone}>{health.label}</Badge>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </details>
    );
}
