// Shared MetricsChart presentation. The owner supplies every payload and request.
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DateRangePicker } from '../ui/date/DateRangePicker';
import { dayPresets, type PresetEntry } from '../ui/date/PresetRail';
import { formatByPrecision } from '../ui/date/fns';
import { modal } from '../ui/modal';
import { showSeriesData, showSeriesStats } from './chart-dialogs';
import { SeriesChart, type ChartType, type SeriesChartProps } from './SeriesChart';
import { ymdRangeToEpochSeconds } from './stats';
import { GRANULARITIES, QUICK_RANGES, metricsDateLabel, metricsGranularities, metricsQuickWindow, type MetricsChartWindow, type MetricsQuickRange } from './metrics-window';

const TYPES: { value: ChartType; icon: string; title: string }[] = [
    { value: 'line', icon: 'bi-graph-up', title: 'Line' },
    { value: 'bar', icon: 'bi-bar-chart-fill', title: 'Bar (stacked)' },
    { value: 'area', icon: 'bi-graph-up-arrow', title: 'Area' },
];

export interface MetricsChartViewProps extends SeriesChartProps {
    title: string;
    className?: string;
    /** Replace the plot with an owner-rendered report; status and toolbar remain shared. */
    content?: ReactNode;
    window: MetricsChartWindow;
    onWindowChange: (window: MetricsChartWindow) => void;
    /** Refresh never fetches or changes the window itself; the owner does both. */
    onRefresh?: () => void;
    onRetry?: () => void;
    loading?: boolean;
    isFetching?: boolean;
    error?: unknown;
    disabled?: boolean;
    defaultType?: ChartType;
    onTypeChange?: (type: ChartType) => void;
    allowedRanges?: readonly MetricsQuickRange[];
    allowedGranularities?: readonly string[];
    /** Exact supported history bounds, epoch seconds (including partial days). */
    minDate?: number;
    maxDate?: number;
    /** Abort blanks this view and removes its open dialogs from the shared stack. */
    signal?: AbortSignal;
    showGranularity?: boolean;
    showDateRange?: boolean;
    showTypeSwitch?: boolean;
    showRefresh?: boolean;
    showStats?: boolean;
    showDataTable?: boolean;
}

function RangeDialog({ initial, minDate, maxDate, onDone }: {
    initial: { start: string; end: string };
    minDate?: number; maxDate?: number;
    onDone: (range: { dt_start: number; dt_end: number } | null) => void;
}) {
    const [range, setRange] = useState(initial);
    const min = minDate == null ? undefined : metricsDateLabel(minDate);
    const max = maxDate == null ? undefined : metricsDateLabel(maxDate);
    const epochs = ymdRangeToEpochSeconds(range.start, range.end);
    const dt_start = epochs ? Math.max(epochs.dtStart, minDate ?? -Infinity) : NaN;
    const dt_end = epochs ? Math.min(epochs.dtEnd, maxDate ?? Infinity) : NaN;
    const complete = !!epochs && dt_start <= dt_end && (!min || range.start >= min) && (!max || range.end <= max);
    // Picker presets do not enforce min/max. Offer only supported calendar days,
    // then clamp partial first/last days to exact epoch bounds on Apply.
    const presets: PresetEntry[] = dayPresets().filter((preset) => {
        if (preset.divider) return minDate == null && maxDate == null;
        const r = preset.range();
        const start = formatByPrecision(r.start, 'day');
        const end = formatByPrecision(r.end, 'day');
        return (!min || start >= min) && (!max || end <= max);
    });
    return <div className="modal-pad chart-range-dialog">
        <h2 className="modal-title">Custom date range</h2>
        <DateRangePicker inline months={1} presets={presets} min={min} max={max}
            start={range.start} end={range.end} onChange={(e) => setRange({ start: e.start, end: e.end })} />
        <div className="modal-actions">
            <button className="btn" onClick={() => onDone(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={!complete} onClick={() => onDone({ dt_start, dt_end })}>Apply</button>
        </div>
    </div>;
}

export function MetricsChartView({
    title, className = '', content, window: selectedWindow, onWindowChange, onRefresh, onRetry = onRefresh,
    loading = false, isFetching = false, error, disabled = false,
    chartType: controlledType, defaultType = 'line', onTypeChange,
    allowedRanges = QUICK_RANGES, allowedGranularities, minDate, maxDate, signal,
    showGranularity = true, showDateRange = true, showTypeSwitch = true,
    showRefresh = true, showStats = true, showDataTable = true,
    height = 280, labels, datasets, valueFormatter, ...seriesProps
}: MetricsChartViewProps) {
    const [localType, setLocalType] = useState(defaultType);
    const chartType = controlledType ?? localType;
    const setChartType = (next: ChartType) => { if (controlledType == null) setLocalType(next); onTypeChange?.(next); };
    const aborted = useSyncExternalStore(
        (changed) => { signal?.addEventListener('abort', changed); return () => signal?.removeEventListener('abort', changed); },
        () => signal?.aborted ?? false,
        () => signal?.aborted ?? false,
    );
    const owner = useRef<AbortController | null>(null);
    // Compare content rather than array identity: inspection often re-renders
    // parents with equivalent arrays. Expired/replaced data must close snapshots.
    const dialogIdentity = JSON.stringify([title, selectedWindow, labels, datasets,
        seriesProps.xValues, seriesProps.xDomain, loading, !!error, disabled, minDate, maxDate, allowedGranularities, allowedRanges]);
    useLayoutEffect(() => {
        const controller = new AbortController();
        owner.current = controller;
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        return () => { signal?.removeEventListener('abort', abort); controller.abort(); };
    }, [signal, dialogIdentity]);
    const available = metricsGranularities(selectedWindow, allowedGranularities);
    const configured = GRANULARITIES.filter((g) => !allowedGranularities || allowedGranularities.includes(g.value));
    const effective = selectedWindow.granularity;
    const active = () => !disabled && !signal?.aborted && !!owner.current && !owner.current.signal.aborted;
    const setWindow = (next: MetricsChartWindow) => {
        const supported = metricsGranularities(next, allowedGranularities);
        if (!active() || !supported.length) return;
        onWindowChange({ ...next, granularity: supported.includes(next.granularity) ? next.granularity : supported.at(-1)! });
    };
    const quickWindow = (r: MetricsQuickRange) => metricsQuickWindow(r, effective, Math.min(Date.now(), (maxDate ?? Infinity) * 1000));
    const ranges = allowedRanges.filter((r) => Number.isFinite(r.durationMs) && r.durationMs > 0 && quickWindow(r).dt_start >= (minDate ?? -Infinity));
    const pickRange = (next: MetricsQuickRange) => setWindow(quickWindow(next));
    const setGranularity = (granularity: string) => setWindow({ ...selectedWindow, granularity });
    const openCustomRange = async () => {
        if (!active()) return;
        const dialogSignal = owner.current!.signal;
        const initial = selectedWindow.range ? { start: '', end: '' } : { start: metricsDateLabel(selectedWindow.dt_start), end: metricsDateLabel(selectedWindow.dt_end) };
        const picked = await modal.open<{ dt_start: number; dt_end: number } | null>((close) => (
            <RangeDialog initial={initial} minDate={minDate} maxDate={maxDate} onDone={close} />
        ), { size: 'md', signal: dialogSignal });
        if (!picked || dialogSignal.aborted) return;
        setWindow({ ...picked, granularity: effective });
    };
    const refresh = () => { if (active()) onRefresh?.(); };
    const openDialog = (stats: boolean) => {
        if (!active() || loading || error) return;
        const { xValues, xDomain } = seriesProps;
        const bounded = xDomain && Number.isFinite(xDomain[0]) && Number.isFinite(xDomain[1]) && xDomain[1] > xDomain[0];
        const indices = labels.flatMap((_, i) => !xValues || (Number.isFinite(xValues[i]) && (!bounded || (xValues[i]! >= xDomain[0] && xValues[i]! <= xDomain[1]))) ? [i] : []);
        void (stats ? showSeriesStats : showSeriesData)({
            title: stats ? `${title} — Stats` : title,
            labels: indices.map((i) => labels[i]!),
            datasets: datasets.map((d) => ({ ...d, data: indices.map((i) => d.data[i]) })),
            granularity: showGranularity ? effective : undefined, formatter: valueFormatter, signal: owner.current!.signal,
        });
    };
    const openStats = () => openDialog(true);
    const openData = () => openDialog(false);
    const customActive = !selectedWindow.range;
    const range = { start: metricsDateLabel(selectedWindow.dt_start), end: metricsDateLabel(selectedWindow.dt_end) };
    const customTitle = customActive ? `Custom range: ${range.start} – ${range.end}` : 'Custom range…';
    if (aborted) return null;

    return (
        <div className={`panel panel-pad chart-panel ${className}`.trim()}>
            <div className="chart-head">
                <div>
                    <div className="eyebrow">Metrics</div>
                    <h3 className="panel-subtitle">
                        {title}
                        {customActive && <span className="chart-range-chip">{range.start} – {range.end}</span>}
                    </h3>
                </div>
                <div className="chart-controls">
                    {showGranularity && (
                        <>
                            <div className="seg seg-xs gran-toggle" role="group" aria-label="Granularity">
                                {configured.map((g) => {
                                    const enabled = available.includes(g.value);
                                    return (
                                        <button
                                            key={g.value}
                                            className={`seg-btn${effective === g.value ? ' seg-active' : ''}`}
                                            disabled={disabled || !enabled}
                                            title={enabled ? g.label : `${g.label} — not available for this range`}
                                            onClick={() => setGranularity(g.value)}
                                        >
                                            {g.short}
                                        </button>
                                    );
                                })}
                            </div>
                            <select
                                className="input input-compact gran-select"
                                value={effective}
                                disabled={disabled || available.length === 0}
                                onChange={(e) => setGranularity(e.target.value)}
                                aria-label="Granularity"
                            >
                                {GRANULARITIES.filter((g) => available.includes(g.value)).map((g) => (
                                    <option key={g.value} value={g.value}>{g.label}</option>
                                ))}
                            </select>
                        </>
                    )}

                    {showDateRange && (
                        <div className="seg seg-xs" role="group" aria-label="Date range">
                            {ranges.map((r) => (
                                <button
                                    key={r.value}
                                    className={`seg-btn${selectedWindow.range === r.value ? ' seg-active' : ''}`}
                                    disabled={disabled}
                                    onClick={() => pickRange(r)}
                                >
                                    {r.label}
                                </button>
                            ))}
                            <button
                                className={`seg-btn${customActive ? ' seg-active' : ''}`}
                                title={customTitle}
                                aria-label="Custom date range"
                                disabled={disabled || available.length === 0}
                                onClick={() => void openCustomRange()}
                            >
                                <i className="bi bi-calendar-range" />
                            </button>
                        </div>
                    )}

                    {showTypeSwitch && (
                        <div className="seg seg-xs" role="group" aria-label="Chart type">
                            {TYPES.map((t) => (
                                <button
                                    key={t.value}
                                    className={`seg-btn${chartType === t.value ? ' seg-active' : ''}`}
                                    title={t.title}
                                    aria-label={t.title}
                                    disabled={disabled}
                                    onClick={() => setChartType(t.value)}
                                >
                                    <i className={`bi ${t.icon}`} />
                                </button>
                            ))}
                        </div>
                    )}

                    {showStats && (
                        <button className="btn-icon" title="Stats" aria-label="Stats" disabled={disabled || loading || !!error} onClick={openStats}>
                            <i className="bi bi-info-circle" />
                        </button>
                    )}
                    {showDataTable && (
                        <button className="btn-icon" title="View data" aria-label="View data" disabled={disabled || loading || !!error} onClick={openData}>
                            <i className="bi bi-table" />
                        </button>
                    )}
                    {showRefresh && (
                        <button className="btn-icon" title="Refresh" aria-label="Refresh" disabled={disabled || !onRefresh || isFetching} onClick={refresh}>
                            <i className={`bi bi-arrow-repeat${isFetching ? ' spin' : ''}`} />
                        </button>
                    )}
                </div>
            </div>

            <div className="chart-body" style={{ minHeight: height }}>
                {loading ? (
                    <div className="chart-overlay"><span className="skel skel-block" /></div>
                ) : !!error ? (
                    <div className="chart-overlay">
                        <div className="chart-error">
                            <i className="bi bi-exclamation-triangle" />
                            <span>{error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to load metrics'}</span>
                            <button className="btn btn-compact" disabled={disabled || !onRetry} onClick={() => { if (active()) onRetry?.(); }}>Retry</button>
                        </div>
                    </div>
                ) : content !== undefined ? content : (
                    <SeriesChart
                        {...seriesProps}
                        labels={labels}
                        datasets={datasets}
                        chartType={chartType}
                        height={height}
                        valueFormatter={valueFormatter}
                    />
                )}
            </div>
        </div>
    );
}
