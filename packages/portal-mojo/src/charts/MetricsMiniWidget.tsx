// MetricsMiniWidget — the compact metrics card: icon + title + computed
// subtitle, windowed trending chip, embedded MiniChart sparkline, and the
// stats / view-data / refresh / settings action row. Ported from web-mojo
// src/extensions/charts/MetricsMiniChartWidget.js (752) + MetricsMiniChart.js
// (253), both read in full, onto TanStack Query.
//
// New in this port (board #1258): the ENTITY SEARCH — a CollectionSelect
// bound to any model list, scoping the metric to the picked record via the
// `account` wire param ('group-<id>' / 'user-<id>'). Same shared cache keys
// as every other picker; never a parallel fetch path.
//
// Carried verbatim from source: windowed trending (trendRange/trendOffset/
// prevTrendOffset via computeTrend), the granularity-derived now/total
// labels, settings persistence under localStorage 'metrics-chart-<key>',
// the granularity-change window auto-adjust, and single-series semantics
// (the FIRST requested slug's series feeds the card; extra slugs ride along
// for the stats/data dialogs).
//
// Deviations, deliberate:
//   · subtitle is a ReactNode or a ({total, nowValue, …}) => ReactNode —
//     the source's Mustache '{{total}} Transactions' tokens become a typed
//     context (no HTML strings);
//   · the raw background/textColor CSS options become `tone` (token-tinted
//     card variants) — hardcoded colors can't survive both themes;
//   · custom dates from the settings dialog use DateRangePicker (day
//     precision) instead of two bare date inputs.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mojoMetrics } from '../client/client';
import type { ModelDef } from '../client/model';
import type { Params } from '../client/types';
import { CollectionSelect, type CollectionSelectValue } from '../ui/CollectionSelect';
import { Popover } from '../ui/Popover';
import { DateRangePicker } from '../ui/date/DateRangePicker';
import { modal } from '../ui/modal';
import { showSeriesData, showSeriesStats } from './chart-dialogs';
import { MiniChart, type MiniChartType } from './MiniChart';
import {
    computeTrend,
    quickRangeWindow,
    toNumber,
    ymdRangeToEpochSeconds,
    type TrendOptions,
} from './stats';

// ── Granularity-derived labels (source _updateGranularityLabels) ──────
const NOW_LABELS: Record<string, string> = {
    hours: 'This Hour', days: 'Today', weeks: 'This Week', months: 'This Month', years: 'This Year',
};
const TOTAL_LABELS: Record<string, string> = {
    hours: 'Total (24h)', days: 'Total (Period)', weeks: 'Total (Period)', months: 'Total (Period)', years: 'Total (Period)',
};

/** Subtitle / trending context — the typed twin of the Mustache tokens. */
export interface MiniWidgetContext {
    total: number;
    /** The latest bucket (always — the '{{now_value}} Today' value). */
    nowValue: number;
    /** Current trend-window sum (offset-shifted; '{{lastValue}}'). */
    lastValue: number | null;
    prevValue: number | null;
    trendingPercent: number | null;
    nowLabel: string;
    totalLabel: string;
    granularity: string;
}

export interface MiniWidgetSearch<T extends { id: number | string }> {
    /** One of model / endpoint — the CollectionSelect binding. */
    model?: ModelDef<T>;
    endpoint?: string;
    labelField?: string;
    valueField?: string;
    placeholder?: string;
    /** Picked row → the `account` wire value (e.g. (id) => `group-${id}`). */
    toAccount: (id: string | number, row?: T) => string;
    /** Extra wire params for the search list. */
    defaultParams?: Params | (() => Params | null | undefined);
    requiresActiveGroup?: boolean;
}

interface StoredSettings {
    granularity?: string;
    chartType?: MiniChartType;
    /** Canonical YYYY-MM-DD strings ('' = unset). */
    dateStart?: string;
    dateEnd?: string;
}

function loadSettings(key: string | null | undefined): StoredSettings | null {
    if (!key) return null;
    try {
        const raw = localStorage.getItem(`metrics-chart-${key}`);
        return raw ? (JSON.parse(raw) as StoredSettings) : null;
    } catch (err) {
        console.warn('MetricsMiniWidget: failed to load chart settings', err);
        return null;
    }
}

function saveSettings(key: string | null | undefined, settings: StoredSettings): void {
    if (!key) return;
    try {
        localStorage.setItem(`metrics-chart-${key}`, JSON.stringify(settings));
    } catch (err) {
        console.warn('MetricsMiniWidget: failed to save chart settings', err);
    }
}

const GRANULARITY_OPTIONS = [
    { value: 'hours', label: 'Hours' },
    { value: 'days', label: 'Days' },
    { value: 'weeks', label: 'Weeks' },
    { value: 'months', label: 'Months' },
    { value: 'years', label: 'Years' },
];

/** Granularity → auto-adjusted lookback (source _handleSettingsApply table). */
function autoWindowFor(granularity: string, now: Date): { start: Date; end: Date } {
    const end = now;
    const start = new Date(end);
    switch (granularity) {
        case 'hours': start.setTime(end.getTime() - 24 * 3600e3); break;
        case 'days': start.setTime(end.getTime() - 30 * 864e5); break;
        case 'weeks': start.setTime(end.getTime() - 12 * 7 * 864e5); break;
        case 'months': start.setMonth(start.getMonth() - 12); break;
        case 'years': start.setFullYear(start.getFullYear() - 5); break;
        default: start.setTime(end.getTime() - 30 * 864e5);
    }
    return { start, end };
}

const ymd = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ── Settings dialog (modal.form heritage — Apply resolves the values) ─
interface SettingsValues {
    granularity: string;
    chartType: MiniChartType;
    dateStart: string;
    dateEnd: string;
}

function SettingsDialog({ title, initial, showDateRange, onDone }: {
    title: string;
    initial: SettingsValues;
    showDateRange: boolean;
    onDone: (values: SettingsValues | null) => void;
}) {
    const [values, setValues] = useState(initial);
    return (
        <div className="modal-pad">
            <h2 className="modal-title">{title}</h2>
            <div className="mmw-settings">
                <label className="field">
                    <span className="field-label">Granularity</span>
                    <select
                        className="input"
                        value={values.granularity}
                        onChange={(e) => setValues((v) => ({ ...v, granularity: e.target.value }))}
                    >
                        {GRANULARITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </label>
                <label className="field">
                    <span className="field-label">Chart type</span>
                    <select
                        className="input"
                        value={values.chartType}
                        onChange={(e) => setValues((v) => ({ ...v, chartType: e.target.value === 'bar' ? 'bar' : 'line' }))}
                    >
                        <option value="line">Line</option>
                        <option value="bar">Bar</option>
                    </select>
                </label>
                {showDateRange && (
                    <div className="field">
                        <span className="field-label">Date range</span>
                        <DateRangePicker
                            start={values.dateStart}
                            end={values.dateEnd}
                            months={1}
                            onChange={(e) => setValues((v) => ({ ...v, dateStart: e.start, dateEnd: e.end }))}
                        />
                    </div>
                )}
            </div>
            <div className="modal-actions">
                <button className="btn" onClick={() => onDone(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => onDone(values)}>Apply</button>
            </div>
        </div>
    );
}

export interface MetricsMiniWidgetProps<T extends { id: number | string }> {
    title: string;
    /** Bootstrap-icons class ('bi bi-activity'). */
    icon?: string;
    /** Metric slugs; the FIRST drives the card, all feed the dialogs. */
    slugs: string[];
    account?: string;
    granularity?: string;
    /** '1h' | '24h' | '7d' | '30d' — the fetch window. null = backend default. */
    defaultRange?: string | null;
    chartType?: MiniChartType;
    height?: number;
    /** Sparkline color. Default: the tone's token, else var(--accent). */
    color?: string;
    /** Token-tinted card variant (replaces the source's raw background). */
    tone?: 'accent' | 'ok' | 'warn' | 'bad' | 'info' | null;
    /** Static node or ({total, nowValue, …}) => ReactNode. */
    subtitle?: ReactNode | ((ctx: MiniWidgetContext) => ReactNode);
    valueFormatter?: (v: number) => string;
    /** Windowed trending chip (computeTrend options ride along). */
    showTrending?: boolean;
    trendRange?: number | null;
    trendOffset?: number | null;
    prevTrendOffset?: number | null;
    showRefresh?: boolean;
    showStats?: boolean;
    showDataTable?: boolean;
    showSettings?: boolean;
    /** Include the date range in the settings dialog. */
    showDateRange?: boolean;
    /** localStorage persistence key for settings ('metrics-chart-<key>'). */
    settingsKey?: string;
    /** Entity search — scope the metric to a picked record via `account`. */
    search?: MiniWidgetSearch<T>;
    /** Called when the search scope changes (null = back to base account). */
    onScopeChange?: (account: string | null, row?: T) => void;
    /** Re-anchor + refetch every N ms. */
    refreshInterval?: number;
    /** Extra wire params merged under the built-ins. */
    apiParams?: Params;
    showXAxis?: boolean;
    smoothing?: number;
    fill?: boolean;
    className?: string;
}

export function MetricsMiniWidget<T extends { id: number | string } = { id: number }>({
    title,
    icon,
    slugs,
    account = 'global',
    granularity: granularityProp = 'hours',
    defaultRange = '24h',
    chartType: chartTypeProp = 'line',
    height = 72,
    color,
    tone = null,
    subtitle,
    valueFormatter,
    showTrending = false,
    trendRange = null,
    trendOffset = null,
    prevTrendOffset = null,
    showRefresh = true,
    showStats = true,
    showDataTable = true,
    showSettings = false,
    showDateRange = false,
    settingsKey,
    search,
    onScopeChange,
    refreshInterval,
    apiParams,
    showXAxis = false,
    smoothing = 0.3,
    fill = true,
    className = '',
}: MetricsMiniWidgetProps<T>) {
    // ── Settings (persisted state wins over props, source parity) ─────
    const stored = useMemo(() => (showSettings ? loadSettings(settingsKey) : null), [showSettings, settingsKey]);
    const [granularity, setGranularity] = useState(stored?.granularity ?? granularityProp);
    const [chartType, setChartType] = useState<MiniChartType>(stored?.chartType ?? chartTypeProp);
    const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(
        stored?.dateStart && stored?.dateEnd ? { start: stored.dateStart, end: stored.dateEnd } : null,
    );

    // ── Scope (the entity search) ─────────────────────────────────────
    const [pickedId, setPickedId] = useState<CollectionSelectValue>(null);
    // Scope shows as a tiny label; the picker opens from the header button.
    const [scopeLabel, setScopeLabel] = useState<string | null>(null);
    const [scopeOpen, setScopeOpen] = useState(false);
    const scopeBtnRef = useRef<HTMLButtonElement>(null);
    const [scopedAccount, setScopedAccount] = useState<string | null>(null);
    const effectiveAccount = scopedAccount ?? account;

    // ── Fetch window ──────────────────────────────────────────────────
    const [anchor, setAnchor] = useState(() => Date.now());
    useEffect(() => {
        if (!refreshInterval || refreshInterval <= 0) return;
        const id = window.setInterval(() => setAnchor(Date.now()), Math.max(5000, refreshInterval));
        return () => window.clearInterval(id);
    }, [refreshInterval]);

    const wire: Params = { ...apiParams, slugs: slugs.join(','), granularity, account: effectiveAccount };
    if (customRange) {
        const epochs = ymdRangeToEpochSeconds(customRange.start, customRange.end);
        if (epochs) {
            wire.dt_start = epochs.dtStart;
            wire.dt_end = epochs.dtEnd;
        }
    } else if (defaultRange) {
        const { startMs, endMs } = quickRangeWindow(defaultRange, anchor);
        // `range` is the mock's window param; dt_* the real backend's.
        wire.range = defaultRange;
        wire.dt_start = Math.floor(startMs / 1000);
        wire.dt_end = Math.floor(endMs / 1000);
    }

    const query = useQuery({
        queryKey: ['metrics', wire],
        queryFn: () => mojoMetrics(wire),
        enabled: slugs.length > 0,
    });

    // The card is single-series: the FIRST requested slug (source parity —
    // MetricsMiniChart took the response's first key; keying by slug is
    // deterministic when the map's order isn't).
    const firstSlug = slugs[0];
    const series = useMemo(() => {
        if (!query.data) return null;
        const ds = query.data.datasets.find((d) => d.label === firstSlug) ?? query.data.datasets[0] ?? null;
        return ds ? ds.data.map(toNumber) : null;
    }, [query.data, firstSlug]);
    const labels = query.data?.labels ?? [];

    const missingSlug = !!query.data && series == null;
    const warnedRef = useRef(false);
    useEffect(() => {
        if (missingSlug && !warnedRef.current) {
            warnedRef.current = true;
            console.warn(`MetricsMiniWidget: metrics response carries no series for "${firstSlug}" — showing the empty state`);
        }
    }, [missingSlug, firstSlug]);

    // ── Derived header values (source updateFromChartData) ────────────
    const trendOpts: TrendOptions = { trendRange, trendOffset, prevTrendOffset };
    const ctx = useMemo<MiniWidgetContext>(() => {
        const nums = series ?? [];
        const trend = nums.length ? computeTrend(nums, trendOpts) : null;
        return {
            total: nums.reduce((a, b) => a + b, 0),
            nowValue: nums.length ? nums[nums.length - 1]! : 0,
            lastValue: trend?.lastSum ?? null,
            prevValue: trend?.prevSum ?? null,
            trendingPercent: trend?.percent ?? null,
            nowLabel: NOW_LABELS[granularity] ?? 'Current',
            totalLabel: TOTAL_LABELS[granularity] ?? 'Total',
            granularity,
        };
        // trendOpts is value-stable per prop trio.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [series, granularity, trendRange, trendOffset, prevTrendOffset]);

    const fmt = valueFormatter ?? ((v: number) => v.toLocaleString());
    const subtitleNode = typeof subtitle === 'function' ? subtitle(ctx) : subtitle;

    const trendUp = (ctx.trendingPercent ?? 0) >= 0;
    const trendLabel = ctx.trendingPercent != null
        ? `${ctx.trendingPercent > 0 ? '+' : ''}${ctx.trendingPercent.toFixed(1)}%`
        : null;

    // ── Actions ───────────────────────────────────────────────────────
    const cleanTitle = title.trim();
    const dialogDatasets = query.data?.datasets ?? [];
    const openStats = () => {
        void showSeriesStats({
            title: `${cleanTitle} — Stats`,
            labels,
            datasets: dialogDatasets,
            granularity,
            formatter: valueFormatter,
        });
    };
    const openData = () => {
        void showSeriesData({
            title: cleanTitle || 'Chart data',
            labels,
            datasets: dialogDatasets,
            granularity,
            formatter: valueFormatter,
        });
    };
    const refresh = () => {
        setAnchor(Date.now());
        void query.refetch();
    };
    const openSettings = async () => {
        const initial: SettingsValues = {
            granularity,
            chartType,
            dateStart: customRange?.start ?? '',
            dateEnd: customRange?.end ?? '',
        };
        const next = await modal.open<SettingsValues | null>((close) => (
            <SettingsDialog
                title={cleanTitle ? `${cleanTitle} — Settings` : 'Chart Settings'}
                initial={initial}
                showDateRange={showDateRange}
                onDone={close}
            />
        ), { size: 'sm' });
        if (!next) return;

        const granChanged = next.granularity !== granularity;
        const datesSet = !!next.dateStart && !!next.dateEnd
            && (next.dateStart !== initial.dateStart || next.dateEnd !== initial.dateEnd);

        setGranularity(next.granularity);
        setChartType(next.chartType);
        let nextRange = customRange;
        if (datesSet) {
            nextRange = { start: next.dateStart, end: next.dateEnd };
        } else if (granChanged && customRange) {
            // Granularity changed with a custom window already in play —
            // auto-adjust the window to fit (source behavior; never sets
            // dates for the first time).
            const w = autoWindowFor(next.granularity, new Date());
            nextRange = { start: ymd(w.start), end: ymd(w.end) };
        }
        setCustomRange(nextRange);
        saveSettings(settingsKey, {
            granularity: next.granularity,
            chartType: next.chartType,
            dateStart: nextRange?.start ?? '',
            dateEnd: nextRange?.end ?? '',
        });
    };

    const toneColor = tone ? `var(--${tone === 'accent' ? 'accent' : tone})` : null;
    const chartColor = color ?? toneColor ?? 'var(--accent)';
    const anyAction = showStats || showDataTable || showRefresh || showSettings;

    return (
        <div className={`mmw panel${tone ? ` mmw-tone-${tone}` : ''}${className ? ` ${className}` : ''}`}>
            {anyAction && (
                <div className="mmw-actions">
                    {showStats && (
                        <button className="btn-icon btn-icon-sm" title="Stats" aria-label="Stats" onClick={openStats}>
                            <i className="bi bi-info-circle" />
                        </button>
                    )}
                    {showDataTable && (
                        <button className="btn-icon btn-icon-sm" title="View data" aria-label="View data" onClick={openData}>
                            <i className="bi bi-table" />
                        </button>
                    )}
                    {showRefresh && (
                        <button className="btn-icon btn-icon-sm" title="Refresh" aria-label="Refresh" onClick={refresh}>
                            <i className={`bi bi-arrow-clockwise${query.isFetching ? ' spin' : ''}`} />
                        </button>
                    )}
                    {search && (
                        <button
                            ref={scopeBtnRef}
                            className={`btn-icon btn-icon-sm${scopeOpen ? ' is-on' : ''}`}
                            title={scopeLabel ? `Scope: ${scopeLabel}` : 'Scope this metric'}
                            aria-label="Scope this metric"
                            aria-expanded={scopeOpen}
                            onClick={() => setScopeOpen((o) => !o)}
                        >
                            <i className="bi bi-funnel" />
                        </button>
                    )}
                    {showSettings && (
                        <button className="btn-icon btn-icon-sm" title="Settings" aria-label="Settings" onClick={() => void openSettings()}>
                            <i className="bi bi-gear" />
                        </button>
                    )}
                </div>
            )}

            <div className="mmw-head">
                <div className="mmw-id">
                    <div className="mmw-title">{title}</div>
                    {subtitleNode != null && <div className="mmw-subtitle">{subtitleNode}</div>}
                    <div className="mmw-meta">
                        {showTrending && trendLabel != null && (
                            <div className={`mmw-trend ${trendUp ? 'mmw-trend-up' : 'mmw-trend-down'}`}>
                                <i className={`bi ${trendUp ? 'bi-arrow-up' : 'bi-arrow-down'}`} />
                                {trendLabel}
                            </div>
                        )}
                        {/* Scope reads as a tiny LABEL, not a form control — the
                            picker lives behind the funnel button in the header.
                            Global scope shows nothing: a chart with no chip is
                            simply the whole account. */}
                        {scopeLabel && (
                            <button
                                type="button"
                                className="mmw-scope"
                                title={`Scoped to ${scopeLabel} — click to clear`}
                                onClick={() => { setPickedId(null); setScopeLabel(null); setScopedAccount(null); onScopeChange?.(null); }}
                            >
                                <i className="bi bi-funnel-fill" />
                                {scopeLabel}
                                <i className="bi bi-x mmw-scope-x" />
                            </button>
                        )}
                    </div>
                </div>
                {icon && <i className={`${icon} mmw-icon`} aria-hidden="true" />}
            </div>

            {/* The picker is a POPOVER off the funnel button — a metrics card
                is not a form, so it carries no resting form control. */}
            {search && (
                <Popover
                    anchorRef={scopeBtnRef}
                    open={scopeOpen}
                    placement="bottom-end"
                    onClose={() => setScopeOpen(false)}
                    aria-label="Scope this metric"
                >
                    <div className="mmw-scope-pop">
                        <CollectionSelect<T>
                            model={search.model}
                            endpoint={search.endpoint}
                            value={pickedId}
                            labelField={search.labelField ?? 'name'}
                            valueField={search.valueField ?? 'id'}
                            placeholder={search.placeholder ?? 'All (global)'}
                            defaultParams={search.defaultParams}
                            requiresActiveGroup={search.requiresActiveGroup ?? false}
                            onChange={(id, row) => {
                                setPickedId(id);
                                const label = id == null
                                    ? null
                                    : String((row as Record<string, unknown> | null)?.[search.labelField ?? 'name'] ?? id);
                                setScopeLabel(label);
                                const nextAccount = id == null ? null : search.toAccount(id, row);
                                setScopedAccount(nextAccount);
                                onScopeChange?.(nextAccount, row);
                                setScopeOpen(false);
                            }}
                        />
                    </div>
                </Popover>
            )}

            <div className="mmw-chart" style={{ minHeight: height }}>
                {query.isPending ? (
                    <span className="skel skel-block mmw-skel" style={{ height: Math.max(14, height - 20) }} />
                ) : query.isError ? (
                    <div className="mmw-error" role="alert">
                        <i className="bi bi-exclamation-triangle" />
                        <span>{query.error instanceof Error ? query.error.message : 'Failed to load metrics'}</span>
                        <button className="btn btn-compact" onClick={() => void query.refetch()}>Retry</button>
                    </div>
                ) : series == null || series.length === 0 ? (
                    <div className="mmw-empty">No data</div>
                ) : (
                    <MiniChart
                        data={series}
                        labels={labels}
                        chartType={chartType}
                        height={height}
                        color={chartColor}
                        fill={fill}
                        smoothing={smoothing}
                        showXAxis={showXAxis}
                        valueFormatter={fmt}
                    />
                )}
            </div>
        </div>
    );
}
