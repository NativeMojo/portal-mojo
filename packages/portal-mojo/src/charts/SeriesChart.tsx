// SeriesChart — dependency-free SVG multi-dataset chart, ported from
// web-mojo's SeriesChart. line / bar / area, bars STACKED by default
// (stacked:'auto' → true for bar), grouped opt-out, legend, gridlines,
// nice Y ticks, thinned X labels, and Chart.js-style "index mode"
// crosshair tooltips (snap to nearest column, ghost dots, multi-row card).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type ChartType = 'line' | 'bar' | 'area';

export interface Dataset {
    label: string;
    data: number[];
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
}

export const CHART_PALETTE = [
    '#4c8dff', '#4cc98a', '#d9a441', '#e07a7a',
    '#a78bfa', '#4db8d4', '#f0883e', '#8a96a6',
];

const PAD = { top: 10, right: 14, bottom: 26, left: 48 };

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
    height = 260,
    showLegend = true,
    showGrid = true,
    gridLines = 5,
    showXLabels = true,
    showYLabels = true,
    valueFormatter,
    smoothing = 0.3,
    showDots = true,
    emptyText = 'No data for this range',
}: SeriesChartProps) {
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

    // Measure the container — real pixel geometry keeps text unscaled
    // (a viewBox + preserveAspectRatio="none" would smear the labels).
    useLayoutEffect(() => {
        const node = wrapRef.current;
        if (!node) return;
        const ro = new ResizeObserver(([entry]) => {
            const w = entry?.contentRect.width ?? 0;
            if (w > 0) setWidth(w);
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

    const scale = useMemo(() => {
        let max = 0;
        let min = 0;
        if (isStacked) {
            for (let i = 0; i < labels.length; i++) {
                let pos = 0;
                let neg = 0;
                for (const ds of shown) {
                    const v = ds.data[i] ?? 0;
                    if (v >= 0) pos += v; else neg += v;
                }
                max = Math.max(max, pos);
                min = Math.min(min, neg);
            }
        } else {
            for (const ds of shown) {
                for (const v of ds.data) {
                    max = Math.max(max, v ?? 0);
                    min = Math.min(min, v ?? 0);
                }
            }
        }
        return niceScale(min, max, gridLines);
    }, [labels.length, shown, isStacked, gridLines]);

    const yOf = useCallback(
        (v: number) => PAD.top + plotH - ((v - scale.min) / (scale.max - scale.min || 1)) * plotH,
        [plotH, scale],
    );

    const n = labels.length;
    const colW = n > 0 ? plotW / n : plotW;
    // Line/area sample at column centers; bars fill the column.
    const xCenter = useCallback((i: number) => PAD.left + colW * (i + 0.5), [colW]);

    const ticks = useMemo(() => {
        const out: number[] = [];
        for (let v = scale.min; v <= scale.max + scale.step / 2; v += scale.step) out.push(v);
        return out;
    }, [scale]);

    // Thin X labels to whatever fits — ~54px per label.
    const labelStride = Math.max(1, Math.ceil((n * 54) / Math.max(plotW, 1)));

    const colorOf = (ds: Dataset, i: number) => ds.color ?? CHART_PALETTE[i % CHART_PALETTE.length]!;

    const onMove = (e: React.MouseEvent<SVGRectElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const idx = Math.min(n - 1, Math.max(0, Math.floor(x / (colW || 1))));
        setHover(idx);
    };

    const hasData = n > 0 && datasets.length > 0;

    return (
        <div className="chart-wrap" ref={wrapRef}>
            {showLegend && datasets.length > 0 && (
                <div className="chart-legend">
                    {datasets.map((ds, i) => {
                        const off = visible.has(ds.label);
                        return (
                            <button
                                key={ds.label}
                                className={`legend-item${off ? ' legend-off' : ''}`}
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
                    <svg width={width} height={height} className="series-svg" role="img">
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
                            const inner = colW * 0.72;
                            const groupN = Math.max(1, shown.length);
                            let posAcc = 0;
                            let negAcc = 0;
                            return (
                                <g key={`bar${i}`}>
                                    {shown.map((ds, di) => {
                                        const v = ds.data[i] ?? 0;
                                        const color = colorOf(ds, datasets.indexOf(ds));
                                        let x: number;
                                        let w: number;
                                        let y: number;
                                        let h: number;
                                        if (isStacked) {
                                            x = PAD.left + colW * i + (colW - inner) / 2;
                                            w = inner;
                                            const base = v >= 0 ? posAcc : negAcc;
                                            const top = base + v;
                                            y = yOf(Math.max(base, top));
                                            h = Math.abs(yOf(top) - yOf(base));
                                            if (v >= 0) posAcc = top; else negAcc = top;
                                        } else {
                                            w = inner / groupN;
                                            x = PAD.left + colW * i + (colW - inner) / 2 + w * di;
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
                                                className={`bar${hover === i ? ' bar-hot' : ''}`}
                                            />
                                        );
                                    })}
                                </g>
                            );
                        })}

                        {/* area fills + lines */}
                        {chartType !== 'bar' && shown.map((ds) => {
                            const color = colorOf(ds, datasets.indexOf(ds));
                            const pts = ds.data.slice(0, n).map((v, i) => [xCenter(i), yOf(v ?? 0)] as [number, number]);
                            if (!pts.length) return null;
                            const path = smoothPath(pts, smoothing);
                            const zeroY = yOf(Math.max(0, scale.min));
                            return (
                                <g key={ds.label}>
                                    {chartType === 'area' && (
                                        <path
                                            d={`${path}L${pts[pts.length - 1]![0]},${zeroY}L${pts[0]![0]},${zeroY}Z`}
                                            fill={color}
                                            opacity={0.16}
                                        />
                                    )}
                                    <path d={path} fill="none" stroke={color} strokeWidth={2} className="series-line" />
                                    {showDots && n <= 40 && pts.map(([x, y], i) => (
                                        <circle key={i} cx={x} cy={y} r={hover === i ? 4 : 2.5} fill={color} className="series-dot" />
                                    ))}
                                </g>
                            );
                        })}

                        {/* crosshair */}
                        {hover != null && (
                            <line
                                x1={xCenter(hover)} x2={xCenter(hover)}
                                y1={PAD.top} y2={PAD.top + plotH}
                                className="crosshair"
                            />
                        )}
                        {hover != null && chartType !== 'bar' && shown.map((ds) => {
                            const color = colorOf(ds, datasets.indexOf(ds));
                            return (
                                <circle
                                    key={`h${ds.label}`}
                                    cx={xCenter(hover)} cy={yOf(ds.data[hover] ?? 0)}
                                    r={4} fill={color} stroke="var(--surface)" strokeWidth={1.5}
                                />
                            );
                        })}

                        {/* X labels */}
                        {showXLabels && labels.map((label, i) => (
                            i % labelStride === 0 ? (
                                <text key={`xl${i}`} x={xCenter(i)} y={height - 8} className="axis-label" textAnchor="middle">
                                    {label}
                                </text>
                            ) : null
                        ))}

                        {/* hit area — one overlay drives index-mode hover */}
                        <rect
                            x={PAD.left} y={PAD.top} width={plotW} height={plotH}
                            fill="transparent"
                            onMouseMove={onMove}
                            onMouseLeave={() => setHover(null)}
                        />
                    </svg>

                    {hover != null && (
                        <div
                            className="chart-tip"
                            style={{
                                left: Math.min(Math.max(xCenter(hover), 90), width - 90),
                                top: PAD.top,
                            }}
                        >
                            <div className="chart-tip-head">{labels[hover]}</div>
                            {shown.map((ds) => (
                                <div key={ds.label} className="chart-tip-row">
                                    <span className="legend-swatch" style={{ background: colorOf(ds, datasets.indexOf(ds)) }} />
                                    <span className="chart-tip-label">{ds.label}</span>
                                    <span className="chart-tip-val">{fmt(ds.data[hover] ?? 0)}</span>
                                </div>
                            ))}
                            {isStacked && shown.length > 1 && (
                                <div className="chart-tip-row chart-tip-total">
                                    <span className="chart-tip-label">Total</span>
                                    <span className="chart-tip-val">
                                        {fmt(shown.reduce((sum, ds) => sum + (ds.data[hover!] ?? 0), 0))}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
