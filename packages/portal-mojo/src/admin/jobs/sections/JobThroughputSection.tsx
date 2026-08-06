// JobThroughputSection — the metrics half of the dashboard. Port of web-mojo
// sections/JobOverviewSection.js (the two sparkline widgets) plus the full
// MetricsChart the source never had.
//
// The per-channel switch is the interesting part. The backend's slug naming is
// ASYMMETRIC: publishing is recorded as `jobs.published.<channel>` while
// terminal outcomes are recorded as `jobs.channel.<channel>.completed` and
// `.failed`. There is NO per-channel slug for retried or expired, so those two
// series exist only in the all-channel view and the UI says so rather than
// plotting an empty line.
import { useRef, useState } from 'react';
import { MetricsChart, MetricsMiniWidget } from '../../../charts';

const GLOBAL_SLUGS = ['jobs.completed', 'jobs.failed', 'jobs.retried', 'jobs.expired'];
const GLOBAL_LABELS: Record<string, string> = {
    'jobs.completed': 'Completed',
    'jobs.failed': 'Failed',
    'jobs.retried': 'Retried',
    'jobs.expired': 'Expired',
};

/** The three slugs a channel actually has, in the backend's own naming. */
function channelSlugs(channel: string): { slugs: string[]; labels: Record<string, string> } {
    const published = `jobs.published.${channel}`;
    const completed = `jobs.channel.${channel}.completed`;
    const failed = `jobs.channel.${channel}.failed`;
    return {
        slugs: [published, completed, failed],
        labels: { [published]: 'Published', [completed]: 'Completed', [failed]: 'Failed' },
    };
}

export function JobThroughputSection({ channels }: { channels: string[] }) {
    const [channel, setChannel] = useState('');
    // A channel that disappears from the list (stream removed, settings
    // change) must not leave the chart requesting slugs that no longer exist.
    // The fallback is loud, but once per channel — not once per render.
    const warned = useRef<Set<string>>(new Set());
    const active = channel && channels.includes(channel) ? channel : '';
    if (channel && !active && !warned.current.has(channel)) {
        warned.current.add(channel);
        console.warn(`[admin/jobs] channel ${JSON.stringify(channel)} is no longer reported — falling back to all channels.`);
    }
    const scoped = active ? channelSlugs(active) : null;

    return (
        <div className="jobs-throughput">
            <div className="jobs-throughput-minis">
                <MetricsMiniWidget
                    title="Jobs published"
                    icon="bi bi-upload"
                    slugs={['jobs.published']}
                    account="global"
                    granularity="days"
                    defaultRange="30d"
                    chartType="line"
                    height={90}
                    showTrending
                    showSettings
                    settingsKey="admin-jobs-published"
                />
                <MetricsMiniWidget
                    title="Jobs failed"
                    icon="bi bi-exclamation-octagon"
                    slugs={['jobs.failed']}
                    account="global"
                    granularity="days"
                    defaultRange="30d"
                    chartType="line"
                    tone="bad"
                    height={90}
                    showTrending
                    showSettings
                    settingsKey="admin-jobs-failed"
                />
            </div>

            <div className="panel jobs-throughput-chart">
                <div className="toolbar">
                    <div className="toolbar-heading">
                        <div className="eyebrow">Throughput</div>
                        <h2 className="panel-title">Job outcomes</h2>
                    </div>
                    <div className="toolbar-controls">
                        <label className="jobs-inline-field">
                            <span className="dim">Channel</span>
                            <select
                                className="input input-compact"
                                value={active}
                                onChange={(event) => setChannel(event.target.value)}
                                aria-label="Metric channel"
                            >
                                <option value="">All channels</option>
                                {channels.map((name) => <option key={name} value={name}>{name}</option>)}
                            </select>
                        </label>
                    </div>
                </div>
                <MetricsChart
                    key={active || 'all'}
                    title={active ? `Outcomes · ${active}` : 'Outcomes · all channels'}
                    slugs={scoped ? scoped.slugs : GLOBAL_SLUGS}
                    seriesLabels={scoped ? scoped.labels : GLOBAL_LABELS}
                    account="global"
                    defaultRange="7d"
                    defaultGranularity="days"
                    defaultType="bar"
                    height={260}
                />
                {active && (
                    <p className="dim jobs-throughput-note">
                        Retried and expired are only recorded system-wide — the backend records no per-channel slug for them.
                    </p>
                )}
            </div>
        </div>
    );
}
