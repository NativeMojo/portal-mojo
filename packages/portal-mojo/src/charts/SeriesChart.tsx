// SeriesChart — dependency-free SVG multi-dataset chart, ported from
// web-mojo's SeriesChart. line / bar / area, bars STACKED by default
// (stacked:'auto' → true for bar), grouped opt-out, legend, gridlines,
// nice Y ticks, thinned X labels, and Chart.js-style "index mode"
// crosshair tooltips (snap to nearest column, ghost dots, multi-row card).
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type ChartType = 'line' | 'bar' | 'area';

export interface Dataset {
    label: string;
    /** Null, undefined and nonfinite numbers are missing samples, never zero. */
    data: (number | null | undefined)[];
    color?: string;
}

export interface SeriesChartProps {
    labels: string[];
    datasets: Dataset[];
    chartType?: ChartType;
    /** 'auto' (default) → stacked for bar, unstacked otherwise. */
    stacked?: boolean | 'auto';
    height?: number;
    showLegend?: boolean;
    showGrid?: boolean;
    gridLines?: number;
    showXLabels?: boolean;
    showYLabels?: boolean;
    /** Rendered in tooltips and Y ticks. */
    valueFormatter?: (v: number) => string;
    smoothing?: number; // 0 = straight segments
    showDots?: boolean;
    emptyText?: string;
    /** Numeric positions (e.g. epoch seconds), aligned with labels and data. */
    xValues?: number[];
    /** Visible numeric X window, in the same units as xValues. */
    xDomain?: [number, number];
    /** Split line/area runs when consecutive numeric X values exceed this gap. */
    maxGap?: number;
    /** Exact Y bounds; omitted bounds are computed from visible data. */
    minValue?: number;
    maxValue?: number;
    ariaLabel?: string;
    /** Shared pointer/touch/keyboard inspection; null means inspection ended. */
    onInspect?: (index: number | null) => void;
}

export const CHART_PALETTE = [
    '#4c8dff', '#4cc98a', '#d9a441', '#e07a7a',
    '#a78bfa', '#4db8d4', '#f0883e', '#8a96a6',
];

const PAD = { top: 10, right: 14, bottom: 26, left: 48 };
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function niceNum(range: number, round: boolean): number {
    const exp = Math.floor(Math.log10(range || 1));
    const f = (range || 1) / Math.pow(10, exp);
    let nf: number;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
}

/** Axis bounds on human-friendly round numbers. */
function niceScale(min: number, max: number, ticks: number) {
    if (max === min) max = min + 1;
    const range = niceNum(max - min, false);
    const step = niceNum(range / Math.max(1, ticks - 1), true);
    // Extreme but finite feeds must not turn tick generation into an endless
    // loop or emit nonfinite SVG coordinates.
    if (!Number.isFinite(step) || step <= 0) return { min, max, step: max / 2 - min / 2 || 1 };
    return {
        min: Math.floor(min / step) * step,
        max: Math.ceil(max / step) * step,
        step,
    };
}

function defaultFormat(v: number): string {
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Catmull-Rom → cubic bezier, matching web-mojo's `smoothing` option. */
function smoothPath(pts: [number, number][], tension: number): string {
    if (pts.length < 2) return '';
    if (tension <= 0) return `M${pts.map(([x, y]) => `${x},${y}`).join('L')}`;
    let d = `M${pts[0]![0]},${pts[0]![1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] ?? pts[i]!;
        const p1 = pts[i]!;
        const p2 = pts[i + 1]!;
        const p3 = pts[i + 2] ?? p2;
        const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension;
        const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension;
        const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension;
        const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension;
        d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
}

export function SeriesChart({
    labels: labelsProp,
    datasets: datasetsProp,
    chartType = 'line',
    stacked = 'auto',
    height: heightProp = 260,
    showLegend = true,
    showGrid = true,
    gridLines = 5,
    showXLabels = true,
    showYLabels = true,
    valueFormatter,
    smoothing = 0.3,
    showDots = true,
    emptyText = 'No data for this range',
    xValues,
    xDomain,
    maxGap,
    minValue,
    maxValue,
    ariaLabel = 'Series chart',
    onInspect,
}: SeriesChartProps) {
    const height = isFiniteNumber(heightProp) && heightProp > 0 ? heightProp : 260;
    // Malformed feed data must degrade to the empty state, not take down the
    // route (a live-backend shape drift did exactly that once) — warn + empty,
    // per the unknown-value rule.
    const validShape = Array.isArray(labelsProp) && Array.isArray(datasetsProp);
    if (!validShape) {
        console.warn('SeriesChart: labels/datasets are not arrays — rendering empty state', { labels: labelsProp, datasets: datasetsProp });
    }
    const labels = validShape ? labelsProp : [];
    const datasets = validShape ? datasetsProp : [];

    const wrapRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(600);
    const [hover, setHover] = useState<number | null>(null);
    const [visible, setVisible] = useState<Set<string>>(() => new Set());
    const id = useId();
    const tipRef = useRef<HTMLDivElement>(null);
    const [tipWidth, setTipWidth] = useState(180);

    // Measure the container — real pixel geometry keeps text unscaled
    // (a viewBox + preserveAspectRatio="none" would smear the labels).
    useLayoutEffect(() => {
        const node = wrapRef.current;
        if (!node) return;
        const ro = new ResizeObserver(([entry]) => {
            const w = entry?.contentRect.width ?? 0;
            if (isFiniteNumber(w) && w > 0) setWidth(w);
        });
        ro.observe(node);
        return () => ro.disconnect();
    }, []);

    // Reset hidden series when the series set itself changes.
    const seriesKey = datasets.map((d) => d.label).join('|');
    useEffect(() => { setVisible(new Set()); }, [seriesKey]);

    const fmt = valueFormatter ?? defaultFormat;
    const shown = datasets.filter((d) => !visible.has(d.label));
    const isStacked = stacked === 'auto' ? chartType === 'bar' : !!stacked;

    const plotW = Math.max(40, width - PAD.left - PAD.right);
    const plotH = Math.max(40, height - PAD.top - PAD.bottom);
    const n = labels.length;
    const colW = n > 0 ? plotW / n : plotW;
    const xPositions = useMemo(() => {
        if (!xValues) return labels.map((_, i) => PAD.left + colW * (i + 0.5));
        const values = xValues.slice(0, n).filter(isFiniteNumber);
        let min = values.reduce((a, b) => Math.min(a, b), Infinity);
        let max = values.reduce((a, b) => Math.max(a, b), -Infinity);
        if (xDomain && isFiniteNumber(xDomain[0]) && isFiniteNumber(xDomain[1]) && xDomain[1] > xDomain[0]) {
            [min, max] = xDomain;
        }
        return labels.map((_, i) => {
            const x = xValues[i];
            if (!isFiniteNumber(x) || x < min || x > max) return null;
            // Half-scaled differences also work for finite domains spanning
            // more than Number.MAX_VALUE, without overflowing the subtraction.
            const fraction = max === min ? 0.5 : (x / 2 - min / 2) / (max / 2 - min / 2);
            return Number.isFinite(fraction) ? PAD.left + fraction * plotW : null;
        });
    }, [labels, xValues, xDomain, n, colW, plotW]);
    const inspectable = xPositions.flatMap((x, i) => x == null ? [] : [i]);
    const active = hover != null && xPositions[hover] != null ? hover : null;
    const lastInspection = useRef<number | null | undefined>(undefined);
    // Compare content, not array identity: callers often construct props during
    // render, including renders caused by onInspect itself.
    const inspectionKey = JSON.stringify([seriesKey, labels, xValues, xDomain, datasets.map((ds) => ds.data)]);
    useEffect(() => { setHover(null); }, [inspectionKey]);
    useEffect(() => {
        if (onInspect && lastInspection.current !== active) {
            lastInspection.current = active;
            onInspect(active);
        }
    }, [active, onInspect]);

    const scale = useMemo(() => {
        let max = 0;
        let min = 0;
        if (isStacked) {
            for (let i = 0; i < labels.length; i++) {
                let pos = 0;
                let neg = 0;
                for (const ds of shown) {
                    const v = ds.data[i];
                    if (xPositions[i] == null || !isFiniteNumber(v)) continue;
                    if (v >= 0) pos += v; else neg += v;
                }
                max = Math.max(max, pos);
                min = Math.min(min, neg);
            }
        } else {
            for (const ds of shown) {
                for (let i = 0; i < n; i++) {
                    const v = ds.data[i];
                    if (xPositions[i] == null || !isFiniteNumber(v)) continue;
                    max = Math.max(max, v);
                    min = Math.min(min, v);
                }
            }
        }
        if (!Number.isFinite(min)) min = -Number.MAX_VALUE;
        if (!Number.isFinite(max)) max = Number.MAX_VALUE;
        const count = isFiniteNumber(gridLines) ? Math.max(2, Math.min(100, Math.floor(gridLines))) : 5;
        const nice = niceScale(min, max, count);
        let lo = isFiniteNumber(minValue) ? minValue : nice.min;
        let hi = isFiniteNumber(maxValue) ? maxValue : nice.max;
        if (hi <= lo) {
            if (isFiniteNumber(minValue) && !isFiniteNumber(maxValue)) hi = lo + Math.max(1, Math.abs(lo) * 0.1);
            else if (isFiniteNumber(maxValue) && !isFiniteNumber(minValue)) lo = hi - Math.max(1, Math.abs(hi) * 0.1);
            else { lo = nice.min; hi = nice.max; }
        }
        const boundedStep = niceNum((hi / 2 - lo / 2) / (count - 1), true) * 2;
        return { min: lo, max: hi, step: minValue != null || maxValue != null ? boundedStep : nice.step };
    }, [n, shown, isStacked, gridLines, xPositions, minValue, maxValue]);

    const yOf = useCallback(
        (v: number) => {
            const y = PAD.top + plotH - ((v / 2 - scale.min / 2) / (scale.max / 2 - scale.min / 2 || 1)) * plotH;
            return Number.isFinite(y) ? y : v > scale.max ? -plotH : plotH + height;
        },
        [plotH, scale, height],
    );

    const xCenter = (i: number) => xPositions[i]!;

    const ticks = useMemo(() => {
        const out: number[] = [];
        for (let i = 0; i < 200; i++) {
            const v = scale.min + i * scale.step;
            if (!isFiniteNumber(v) || v > scale.max) break;
            if (out.at(-1) !== v) out.push(v);
        }
        if (out.at(-1) !== scale.max) out.push(scale.max);
        return out;
    }, [scale]);

    // Thin X labels to whatever fits — ~54px per label.
    const labelStride = Math.max(1, Math.ceil((n * 54) / Math.max(plotW, 1)));

    const colorOf = (ds: Dataset, i: number) => ds.color ?? CHART_PALETTE[i % CHART_PALETTE.length]!;

    const onMove = (e: React.PointerEvent<SVGRectElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = PAD.left + (e.clientX - rect.left) * (plotW / (rect.width || plotW));
        let nearest: number | null = null;
        for (const i of inspectable) {
            if (nearest == null || Math.abs(xCenter(i) - x) < Math.abs(xCenter(nearest) - x)) nearest = i;
        }
        setHover(nearest);
    };

    const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
        const current = active == null ? -1 : inspectable.indexOf(active);
        let next: number | null;
        if (e.key === 'Home') next = inspectable[0] ?? null;
        else if (e.key === 'End') next = inspectable.at(-1) ?? null;
        else if (e.key === 'ArrowRight') next = inspectable[Math.min(inspectable.length - 1, current + 1)] ?? null;
        else if (e.key === 'ArrowLeft') next = inspectable[Math.max(0, current - 1)] ?? null;
        else if (e.key === 'Escape') next = null;
        else return;
        e.preventDefault();
        setHover(next);
    };

    const formatSample = (v: unknown) => isFiniteNumber(v) ? fmt(v) : 'Unavailable';
    const readout = active == null ? '' : `${labels[active]}. ${shown.map((ds) => `${ds.label}: ${formatSample(ds.data[active])}`).join('; ')}`;
    useLayoutEffect(() => {
        const measured = tipRef.current?.getBoundingClientRect().width;
        if (measured && Number.isFinite(measured)) setTipWidth(measured);
    }, [readout, width]);

    const hasData = n > 0 && datasets.length > 0 && inspectable.length > 0;

    return (
        <div className="chart-wrap" ref={wrapRef}>
            {showLegend && datasets.length > 0 && (
                <div className="chart-legend">
                    {datasets.map((ds, i) => {
                        const off = visible.has(ds.label);
                        return (
                            <button
                                type="button"
                                key={ds.label}
                                className={`legend-item${off ? ' legend-off' : ''}`}
                                aria-pressed={!off}
                                onClick={() => setVisible((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(ds.label)) next.delete(ds.label); else next.add(ds.label);
                                    return next;
                                })}
                                title={off ? `Show ${ds.label}` : `Hide ${ds.label}`}
                            >
                                <span className="legend-swatch" style={{ background: colorOf(ds, i) }} />
                                {ds.label}
                            </button>
                        );
                    })}
                </div>
            )}

            {!hasData ? (
                <div className="chart-empty" style={{ height }}>{emptyText}</div>
            ) : (
                <div className="chart-svg-area" style={{ height }}>
                    <svg width={width} height={height} className="series-svg" role="img"
                        tabIndex={0} aria-label={ariaLabel} aria-describedby={`${id}-help ${id}-value`}
                        onKeyDown={onKeyDown} onBlur={() => setHover(null)}>
                        <defs>
                            <clipPath id={`${id}-plot`}>
                                <rect x={PAD.left - 4} y={PAD.top} width={plotW + 8} height={plotH} />
                            </clipPath>
                        </defs>
                        {/* gridlines + Y ticks */}
                        {showGrid && ticks.map((t) => (
                            <line
                                key={`g${t}`}
                                x1={PAD.left} x2={PAD.left + plotW}
                                y1={yOf(t)} y2={yOf(t)}
                                className={t === 0 && scale.min < 0 ? 'grid-line grid-zero' : 'grid-line'}
                            />
                        ))}
                        {showYLabels && ticks.map((t) => (
                            <text key={`yl${t}`} x={PAD.left - 8} y={yOf(t)} className="axis-label" textAnchor="end" dominantBaseline="middle">
                                {fmt(t)}
                            </text>
                        ))}

                        {/* bars */}
                        {chartType === 'bar' && labels.map((_, i) => {
                            if (xPositions[i] == null) return null;
                            const previous = xPositions[i - 1];
                            const next = xPositions[i + 1];
                            const slot = xValues ? Math.min(colW,
                                previous == null ? colW : Math.abs(xCenter(i) - previous),
                                next == null ? colW : Math.abs(next - xCenter(i))) : colW;
                            const inner = slot * 0.72;
                            const groupN = Math.max(1, shown.length);
                            let posAcc = 0;
                            let negAcc = 0;
                            return (
                                <g key={`bar${i}`} clipPath={`url(#${id}-plot)`}>
                                    {shown.map((ds, di) => {
                                        const v = ds.data[i];
                                        if (!isFiniteNumber(v)) return null;
                                        const color = colorOf(ds, datasets.indexOf(ds));
                                        let x: number;
                                        let w: number;
                                        let y: number;
                                        let h: number;
                                        if (isStacked) {
                                            x = xCenter(i) - inner / 2;
                                            w = inner;
                                            const base = v >= 0 ? posAcc : negAcc;
                                            const top = base + v;
                                            if (!Number.isFinite(top)) return null;
                                            y = yOf(Math.max(base, top));
                                            h = Math.abs(yOf(top) - yOf(base));
                                            if (v >= 0) posAcc = top; else negAcc = top;
                                        } else {
                                            w = inner / groupN;
                                            x = xCenter(i) - inner / 2 + w * di;
                                            const zero = yOf(Math.max(0, scale.min));
                                            y = Math.min(zero, yOf(v));
                                            h = Math.abs(yOf(v) - zero);
                                        }
                                        return (
                                            <rect
                                                key={ds.label}
                                                x={x} y={y}
                                                width={Math.max(1, w - 1)} height={Math.max(0, h)}
                                                fill={color}
                                                className={`bar${active === i ? ' bar-hot' : ''}`}
                                            />
                                        );
                                    })}
                                </g>
                            );
                        })}

                        {/* area fills + lines */}
                        {chartType !== 'bar' && shown.map((ds) => {
                            const color = colorOf(ds, datasets.indexOf(ds));
                            const runs: { point: [number, number]; index: number }[][] = [];
                            let run: (typeof runs)[number] = [];
                            for (let i = 0; i < n; i++) {
                                const value = ds.data[i];
                                const previous = run.at(-1);
                                const gap = xValues && previous ? xValues[i]! - xValues[previous.index]! : 0;
                                if (xPositions[i] == null || !isFiniteNumber(value)) {
                                    run = [];
                                    continue;
                                }
                                if (previous && (gap < 0 || (isFiniteNumber(maxGap) && maxGap >= 0 && gap > maxGap))) run = [];
                                if (!run.length) runs.push(run);
                                run.push({ point: [xCenter(i), yOf(value)], index: i });
                            }
                            const zeroY = yOf(Math.max(0, scale.min));
                            return (
                                <g key={ds.label} clipPath={`url(#${id}-plot)`}>
                                    {runs.map((segment) => {
                                        const pts = segment.map((p) => p.point);
                                        const path = smoothPath(pts, isFiniteNumber(smoothing) ? smoothing : 0);
                                        return (
                                            <g key={segment[0]!.index}>
                                                {chartType === 'area' && pts.length > 1 && (
                                                    <path
                                                        d={`${path}L${pts[pts.length - 1]![0]},${zeroY}L${pts[0]![0]},${zeroY}Z`}
                                                        fill={color}
                                                        opacity={0.16}
                                                    />
                                                )}
                                                {pts.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth={2} className="series-line" />}
                                                {(pts.length === 1 || (showDots && n <= 40)) && segment.map(({ point: [x, y], index }) => (
                                                    <circle key={index} cx={x} cy={y} r={active === index ? 4 : 2.5} fill={color} className="series-dot" />
                                                ))}
                                            </g>
                                        );
                                    })}
                                </g>
                            );
                        })}

                        {/* crosshair */}
                        {active != null && (
                            <line
                                x1={xCenter(active)} x2={xCenter(active)}
                                y1={PAD.top} y2={PAD.top + plotH}
                                className="crosshair"
                            />
                        )}
                        {active != null && chartType !== 'bar' && shown.map((ds) => {
                            const value = ds.data[active];
                            if (!isFiniteNumber(value) || value < scale.min || value > scale.max) return null;
                            const color = colorOf(ds, datasets.indexOf(ds));
                            return (
                                <circle
                                    key={`h${ds.label}`}
                                    cx={xCenter(active)} cy={yOf(value)} className="series-inspect-dot"
                                    r={4} fill={color} stroke="var(--surface)" strokeWidth={1.5}
                                />
                            );
                        })}

                        {/* X labels */}
                        {showXLabels && labels.map((label, i) => (
                            i % labelStride === 0 && xPositions[i] != null ? (
                                <text key={`xl${i}`} x={xCenter(i)} y={height - 8} className="axis-label" textAnchor="middle">
                                    {label}
                                </text>
                            ) : null
                        ))}

                        {/* hit area — one overlay drives index-mode hover */}
                        <rect
                            x={PAD.left} y={PAD.top} width={plotW} height={plotH}
                            fill="transparent"
                            style={{ touchAction: 'pan-y' }}
                            onPointerMove={onMove}
                            onPointerDown={onMove}
                            onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHover(null); }}
                            onPointerCancel={() => setHover(null)}
                        />
                    </svg>

                    {active != null && (
                        <div
                            className="chart-tip" ref={tipRef} aria-hidden="true"
                            style={{
                                left: Math.max(8, Math.min(xCenter(active) - tipWidth / 2, width - tipWidth - 8)),
                                top: PAD.top,
                                transform: 'none', maxWidth: 'calc(100% - 16px)', minWidth: 0,
                                width: 'max-content', boxSizing: 'border-box', overflowWrap: 'anywhere',
                            }}
                        >
                            <div className="chart-tip-head">{labels[active]}</div>
                            {shown.map((ds) => (
                                <div key={ds.label} className="chart-tip-row">
                                    <span className="legend-swatch" style={{ background: colorOf(ds, datasets.indexOf(ds)) }} />
                                    <span className="chart-tip-label">{ds.label}</span>
                                    <span className="chart-tip-val">{formatSample(ds.data[active])}</span>
                                </div>
                            ))}
                            {isStacked && shown.length > 1 && (
                                <div className="chart-tip-row chart-tip-total">
                                    <span className="chart-tip-label">Total</span>
                                    <span className="chart-tip-val">
                                        {shown.every((ds) => isFiniteNumber(ds.data[active]))
                                            ? formatSample(shown.reduce((sum, ds) => sum + (ds.data[active] as number), 0))
                                            : 'Unavailable'}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                    <span id={`${id}-help`} className="chart-accessible">Use Left and Right arrows to inspect samples, Home or End for the first or last, and Escape to clear.</span>
                    <span id={`${id}-value`} className="chart-accessible" role="status" aria-live="polite" aria-atomic="true">{readout}</span>
                </div>
            )}
        </div>
    );
}
