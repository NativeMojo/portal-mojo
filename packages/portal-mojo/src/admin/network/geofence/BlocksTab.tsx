// BlocksTab — the evidence surface. Port of web-mojo `GeofenceBlocksView.js`.
//
// Activity strip: the two KPI tiles the backend really records
// (`geofence:blocks`, `geofence:exempt`, both dual-written to `global` and
// `group-<pk>`), a chart over both with PNG export for compliance evidence,
// and a server-derived "top blocked countries" list from the
// `geofence:blocks:country:*` slug family. Every metrics read is gated on
// METRICS_GLOBAL_VIEW_PERMS — `check_view_permissions` demands a GLOBAL
// view_metrics/metrics grant for `account="global"`, so a geofence-only
// operator would otherwise fire three requests that all 403.
//
// TWO CORRECTIONS over the source:
//   · the table offered ONLY `geofence_block` while the second KPI tile
//     counted exemptions, so the table could never explain the tile. A
//     category segment now covers Blocks · Exemptions used · Both.
//   · the Endpoint column read `metadata.scope`, which the reporter never
//     writes (`scope` is the top-level Event column and stays "global" for
//     every geofence row). It is `metadata.geofence_scope`, and the column
//     rendered "—" on every deployment until now.
import { useRef, useState } from 'react';
import {
    Badge, ModelTable, fmt, groupByDay,
    type Column, type FilterDef, type Tone,
} from '../../../ui';
import { useCan } from '../../../client/runtime';
import { MetricsChart, MetricsMiniWidget, exportChartPng } from '../../../charts';
import { COUNTRY_OPTIONS, countryName } from '../../../charts/worldmap/countryCentroids';
import { countryFlag } from '../../security/geoip';
import { showEventDetail, type EventRow } from '../../incidents';
import {
    GEOFENCE_EVENT_CATEGORIES, GEOFENCE_LEVEL_OPTIONS, GeofenceEventModel,
    METRICS_GLOBAL_VIEW_PERMS, useGeofenceCountryTotals,
} from '../models';
import { SECURITY_EVENTS_PERMS, describeDecision, regionName } from './geofence-data';

const SLUG_BLOCKS = 'geofence:blocks';
const SLUG_EXEMPT = 'geofence:exempt';

function metaString(row: EventRow, key: string): string {
    const value = row.metadata?.[key];
    return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/**
 * Plain-language cell text for a block event's reason code. `lookup_failed`
 * gets its own copy: the log genuinely cannot distinguish a fail-open
 * pass-through (level 6) from a fail-closed block (level 5) — the level column
 * carries that, and pretending otherwise here would be a guess.
 */
export function blockReasonText(reason: string): string {
    if (!reason) return '—';
    if (reason === 'lookup_failed') return 'Location lookups were unavailable — the fail posture applied.';
    return describeDecision({ reason, allowed: false });
}

const COLUMNS: Column<EventRow>[] = [
    {
        key: 'created', label: 'When', sortable: true, hideable: false,
        render: (row) => <span title={fmt.datetime(row.created)}>{fmt.relative(row.created)}</span>,
    },
    {
        key: 'category', label: 'Kind',
        render: (row) => row.category === GEOFENCE_EVENT_CATEGORIES.exempt
            ? <Badge tone="info"><i className="bi bi-shield-check" /> Exempt</Badge>
            : <Badge tone="danger"><i className="bi bi-slash-circle" /> Block</Badge>,
    },
    {
        key: 'metadata__reason', label: 'What happened', hideable: false,
        render: (row) => {
            const text = blockReasonText(metaString(row, 'reason'));
            return <span title={text}>{fmt.truncate(text, 72)}</span>;
        },
    },
    {
        // The INDEXED top-level column, populated by Event.sync_metadata from
        // the geolocated source IP — not the metadata copy.
        key: 'country_code', label: 'Country',
        render: (row) => {
            const code = row.country_code || metaString(row, 'country_code');
            if (!code) return <span className="dim">—</span>;
            const flag = countryFlag(code);
            return <span title={countryName(code)}>{flag && <span className="geoip-flag">{flag}</span>}{code}</span>;
        },
    },
    {
        key: 'metadata__region_code', label: 'Region',
        render: (row) => {
            const code = metaString(row, 'region_code');
            return code ? regionName(code) : <span className="dim">—</span>;
        },
    },
    {
        key: 'source_ip', label: 'Source IP',
        render: (row) => row.source_ip ? <code>{row.source_ip}</code> : <span className="dim">—</span>,
    },
    {
        key: 'metadata__geofence_scope', label: 'Endpoint scope',
        render: (row) => {
            const scope = metaString(row, 'geofence_scope');
            return scope ? <code className="dim">{scope}</code> : <span className="dim">—</span>;
        },
    },
    {
        key: 'level', label: 'Level', sortable: true, align: 'center',
        render: (row) => <Badge tone={levelTone(row.level)}>L{row.level}</Badge>,
    },
];

function levelTone(level: number): Tone {
    return level >= 7 ? 'danger' : level >= 5 ? 'warning' : 'muted';
}

const FILTERS: FilterDef[] = [
    { key: 'created', label: 'When', type: 'daterange' },
    { key: 'level', label: 'Level', type: 'select', options: GEOFENCE_LEVEL_OPTIONS },
    { key: 'country_code', label: 'Country', type: 'select', options: [...COUNTRY_OPTIONS] },
    { key: 'source_ip', label: 'Source IP contains', type: 'text' },
    { key: 'metadata__geofence_scope', label: 'Endpoint scope', type: 'text', lookup: 'exact' },
    { key: 'metadata__reason', label: 'Reason code', type: 'text', lookup: 'exact' },
];

function TopCountries({ days }: { days: number }) {
    const query = useGeofenceCountryTotals(days);
    if (query.isPending) return <p className="dim">Loading country totals…</p>;
    if (query.error) return <p className="text-bad">{query.error.message}</p>;
    const rows = query.data ?? [];
    if (rows.length === 0) return <p className="dim">No per-country block counters recorded in this window.</p>;
    const max = rows[0]!.total || 1;
    return (
        <ol className="geo-country-bars">
            {rows.slice(0, 12).map((row) => (
                <li key={row.country_code}>
                    <span className="geo-country-label">
                        {countryFlag(row.country_code) && <span className="geoip-flag">{countryFlag(row.country_code)}</span>}
                        {countryName(row.country_code)}
                    </span>
                    <span className="geo-country-bar">
                        <span className="geo-country-fill" style={{ width: `${Math.max(3, (row.total / max) * 100)}%` }} />
                    </span>
                    <b>{row.total.toLocaleString()}</b>
                </li>
            ))}
        </ol>
    );
}

export function BlocksTab() {
    const { can: canMetrics } = useCan(METRICS_GLOBAL_VIEW_PERMS);
    const { can: canEvents } = useCan(SECURITY_EVENTS_PERMS);
    const chartRef = useRef<HTMLDivElement>(null);
    const [category, setCategory] = useState<'block' | 'exempt' | 'both'>('block');

    const categoryParams: Record<string, string> = category === 'both'
        ? { category__in: `${GEOFENCE_EVENT_CATEGORIES.block},${GEOFENCE_EVENT_CATEGORIES.exempt}` }
        : { category: GEOFENCE_EVENT_CATEGORIES[category] };

    return (
        <>
            {canMetrics ? (
                <>
                    <div className="geo-kpis">
                        <MetricsMiniWidget
                            title="Geofence blocks"
                            icon="bi bi-slash-circle"
                            slugs={[SLUG_BLOCKS]}
                            account="global"
                            granularity="days"
                            defaultRange="30d"
                            chartType="bar"
                            tone="bad"
                            height={72}
                            showTrending
                            subtitle={(ctx) => <><b>{ctx.total.toLocaleString()}</b> in 30d</>}
                        />
                        <MetricsMiniWidget
                            title="Exempt passes"
                            icon="bi bi-shield-check"
                            slugs={[SLUG_EXEMPT]}
                            account="global"
                            granularity="days"
                            defaultRange="30d"
                            chartType="bar"
                            tone="info"
                            height={72}
                            showTrending
                            subtitle={(ctx) => <><b>{ctx.total.toLocaleString()}</b> in 30d</>}
                        />
                    </div>

                    <div className="geo-chart-head">
                        <span className="dim">
                            Counters increment on every block, including the repeats that are deduped
                            in the log below — so the tiles will read higher than the row count.
                        </span>
                        <button
                            type="button"
                            className="btn btn-compact"
                            onClick={() => exportChartPng(chartRef.current, { filename: 'geofence-blocks.png' })}
                        >
                            <i className="bi bi-download" /> Export PNG
                        </button>
                    </div>
                    <div ref={chartRef} className="geo-chart">
                        <MetricsChart
                            title="Blocks over time"
                            slugs={[SLUG_BLOCKS, SLUG_EXEMPT]}
                            seriesLabels={{ [SLUG_BLOCKS]: 'Blocks', [SLUG_EXEMPT]: 'Exempt passes' }}
                            account="global"
                            defaultRange="30d"
                            defaultGranularity="days"
                            defaultType="bar"
                            height={220}
                        />
                    </div>

                    <div className="panel netsec-card">
                        <div className="netsec-card-head">
                            <span>Top blocked countries</span>
                            <span className="eyebrow">server-derived · 30 days</span>
                        </div>
                        <div className="netsec-card-body">
                            <TopCountries days={30} />
                            <p className="dim">
                                Totals come from the per-country metric counters, not from the rows below —
                                a page of events could never account for a whole window.
                            </p>
                        </div>
                    </div>
                </>
            ) : (
                <div className="netsec-note netsec-note-info">
                    <i className="bi bi-bar-chart" />
                    <div>
                        Block counters and the country breakdown read global metrics, which need the
                        <code> view_metrics</code> or <code>metrics</code> grant. No request was issued.
                    </div>
                </div>
            )}

            {canEvents ? (
                <>
                    <div className="geo-cat-seg">
                        <div className="seg">
                            {([
                                ['block', 'Blocks'],
                                ['exempt', 'Exemptions used'],
                                ['both', 'Both'],
                            ] as const).map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    className={`seg-btn${category === value ? ' seg-active' : ''}`}
                                    onClick={() => setCategory(value)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <ModelTable<EventRow>
                        key={category}
                        model={GeofenceEventModel}
                        eyebrow="Geofencing"
                        title="Blocks log"
                        searchable={false}
                        columns={COLUMNS}
                        filters={FILTERS}
                        defaultParams={categoryParams}
                        defaultSort="-created"
                        columnChooser
                        persistState
                        persistKey={`admin:network:geofence-blocks:${category}`}
                        rowTone={(row) => row.level >= 7 ? 'danger' : row.level >= 5 ? 'warning' : null}
                        onRowClick={(row) => showEventDetail(row.id)}
                        {...groupByDay<EventRow>('created')}
                    />
                </>
            ) : (
                <div className="netsec-note netsec-note-info">
                    <i className="bi bi-eye-slash" />
                    <div>
                        The block log reads security events — it requires security-events access
                        (<code>view_security</code>). No request was issued.
                    </div>
                </div>
            )}
        </>
    );
}
