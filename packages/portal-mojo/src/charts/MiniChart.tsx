// MiniChart — the compact single-series sparkline (line / bar), ported from
// web-mojo src/extensions/charts/MiniChart.js (674 lines, read in full).
// Carries: area fill, curve smoothing, hard crops (minValue/maxValue), bar
// soft bounds (softMin/softMax expand-only targets), the zero-crossing-aware
// x-axis, per-bucket hover tooltip + crosshair + bar highlight, dots, and
// the all-zero "alive, just zero" dashed baseline. Draw-in animation uses
// pathLength-normalized CSS (no getTotalLength measuring).
//
// Deviations, deliberate: geometry comes from a measured container width
// (ResizeObserver — the SeriesChart pattern) instead of the source's
// stretched viewBox; colors default to theme tokens; the tooltip formatter
// is a typed function (never a DataFormatter pipe string).
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toNumber } from './stats';

export type MiniChartType = 'line' | 'bar';

export interface MiniChartProps {
    data: readonly number[];
    /** Per-bucket tooltip labels (index-aligned with data). */
    labels?: readonly string[];
    /** 'line' | 'bar'. Unknown values warn and fall back to 'line'. */
    chartType?: MiniChartType;
    /** px, or 'fill' to take the container's height (uniform-height cards). */
    height?: number | 'fill';
    /** Stroke / bar color — any CSS color incl. var() tokens. */
    color?: string;
    /** Area fill under the line. Default: `color` at 0.12 opacity. */
    fillColor?: string;
    fill?: boolean;
    strokeWidth?: number;
    barGap?: number;
    /** 0 = straight segments; the source's cubic smoothing. */
    smoothing?: number;
    padding?: number;
    /** Hard axis crops (both chart types). */
    minValue?: number;
    maxValue?: number;
    /** Bar-only soft bounds: normalize to these, expand if data exceeds. */
    softMin?: number;
    softMax?: number;
    showDots?: boolean;
    dotRadius?: number;
    showTooltip?: boolean;
    valueFormatter?: (v: number) => string;
    showCrosshair?: boolean;
    showXAxis?: boolean;
    animate?: boolean;
    className?: string;
}

/** The source's simpler horizontal-control-point smoothing (not Catmull-Rom). */
function smoothPath(points: readonly { x: number; y: number }[], smoothing: number): string {
    if (points.length === 0) return '';
    if (points.length < 2 || smoothing <= 0) {
        return `M ${points.map((p) => `${p.x},${p.y}`).join(' L ')}`;
    }
    let path = `M ${points[0]!.x},${points[0]!.y}`;
    for (let i = 0; i < points.length - 1; i++) {
        const cur = points[i]!;
        const next = points[i + 1]!;
        const cp1x = cur.x + (next.x - cur.x) * smoothing;
        const cp2x = next.x - (next.x - cur.x) * smoothing;
        path += ` C ${cp1x},${cur.y} ${cp2x},${next.y} ${next.x},${next.y}`;
    }
    return path;
}

export function MiniChart({
    data: dataProp,
    labels,
    chartType = 'line',
    height: heightProp = 48,
    color = 'var(--accent)',
    fillColor,
    fill = true,
    strokeWidth = 2,
    barGap = 2,
    smoothing = 0.3,
    padding = 2,
    minValue,
    maxValue,
    softMin,
    softMax,
    showDots = false,
    dotRadius = 2,
    showTooltip = true,
    valueFormatter,
    showCrosshair = true,
    showXAxis = false,
    animate = true,
    className = '',
}: MiniChartProps) {
    // Malformed feed → warn + empty (unknown-value rule; never crash).
    const validShape = Array.isArray(dataProp);
    if (!validShape) {
        console.warn('MiniChart: data is not an array — rendering empty', { data: dataProp });
    }
    let type: MiniChartType = chartType;
    if (type !== 'line' && type !== 'bar') {
        console.warn(`MiniChart: unknown chartType "${String(chartType)}" — falling back to "line"`);
        type = 'line';
    }
    const values = useMemo(() => (validShape ? dataProp.map(toNumber) : []), [validShape, dataProp]);

    const wrapRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(120);
    const [fillH, setFillH] = useState(72);
    const [hover, setHover] = useState<number | null>(null);

    useLayoutEffect(() => {
        const node = wrapRef.current;
        if (!node) return;
        const ro = new ResizeObserver(([entry]) => {
            const w = entry?.contentRect.width ?? 0;
            if (w > 0) setWidth(w);
            // 'fill' cards take their height from the box too, so a chart can
            // grow into a stretched card instead of leaving a void under it.
            const h = entry?.contentRect.height ?? 0;
            if (h > 0) setFillH(h);
        });
        ro.observe(node);
        return () => ro.disconnect();
    }, []);

    // Resolve 'fill' to the measured box height.
    const height = heightProp === 'fill' ? fillH : heightProp;

    const n = values.length;
    const dataMin = n ? Math.min(...values) : 0;
    const dataMax = n ? Math.max(...values) : 0;

    // Line bounds (source calculateBounds): hard crops win; zero-range pads.
    let lineMin = minValue ?? dataMin;
    let lineMax = maxValue ?? dataMax;
    if (lineMax - lineMin === 0) {
        if (type === 'bar' && lineMin === 0) lineMax = 1;
        else { lineMin -= 1; lineMax += 1; }
    }

    const drawTop = padding;
    const drawBottom = height - padding;
    const drawH = drawBottom - drawTop;
    const xStep = (width - padding * 2) / (n - 1 || 1);
    const points = values.map((v, i) => ({
        x: padding + i * xStep,
        y: drawBottom - ((v - lineMin) / (lineMax - lineMin)) * drawH,
    }));

    // Bar bounds (source renderBar): always include zero; soft bounds expand.
    const barLo = minValue !== undefined ? minValue : Math.min(0, softMin ?? 0, dataMin);
    const barHiRaw = maxValue !== undefined ? maxValue : Math.max(0, softMax ?? 0, dataMax);
    const barHi = barHiRaw === barLo ? barLo + 1 : barHiRaw;
    const yScale = drawH / (barHi - barLo);
    const yBase = Math.max(drawTop, Math.min(drawBottom, drawBottom - (0 - barLo) * yScale));

    const allZero = n > 0 && dataMin === 0 && dataMax === 0;
    const callerBounds = minValue !== undefined || maxValue !== undefined || softMin !== undefined || softMax !== undefined;
    const barsAsBaseline = type === 'bar' && allZero && !callerBounds;

    // X-axis at zero when the data crosses it, else at the bottom (source).
    let axisY = drawBottom;
    if (lineMin <= 0 && lineMax >= 0) {
        axisY = drawBottom - ((0 - lineMin) / (lineMax - lineMin)) * drawH;
    }

    const barW = n > 0 ? Math.max(1, (width - padding * 2 - barGap * (n - 1)) / n) : 0;
    const fmt = valueFormatter ?? ((v: number) => v.toLocaleString());
    const fillPaint = fillColor ?? color;
    const fillOpacity = fillColor ? 1 : 0.12;

    const colW = n > 0 ? width / n : width;
    const onMove = (e: React.MouseEvent<SVGRectElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        setHover(Math.min(n - 1, Math.max(0, Math.floor(x / (colW || 1)))));
    };

    // Re-run the draw-in whenever the series identity changes (source parity:
    // every setData re-animated).
    const dataKey = useMemo(() => values.join('|'), [values]);

    const linePath = smoothPath(points, smoothing);
    const areaPath = points.length
        ? `${linePath} L ${points[points.length - 1]!.x},${drawBottom} L ${points[0]!.x},${drawBottom} Z`
        : '';

    const tipX = hover != null ? Math.min(Math.max(colW * (hover + 0.5), 40), Math.max(width - 40, 40)) : 0;

    return (
        <div
            ref={wrapRef}
            className={`minichart${className ? ` ${className}` : ''}`}
            style={{ height: heightProp === 'fill' ? '100%' : height }}
            onMouseLeave={() => setHover(null)}
        >
            <svg width={width} height={height} className="minichart-svg" role="img" key={animate ? dataKey : 'static'}>
                {showXAxis && n > 0 && (
                    <line
                        x1={padding} x2={width - padding} y1={axisY} y2={axisY}
                        stroke={color} strokeWidth={1} strokeOpacity={0.5} strokeDasharray="2,2"
                    />
                )}

                {n > 0 && type === 'line' && (
                    <>
                        {fill && (
                            <path d={areaPath} fill={fillPaint} fillOpacity={fillOpacity} stroke="none" />
                        )}
                        <path
                            d={linePath}
                            fill="none"
                            stroke={color}
                            strokeWidth={strokeWidth}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            pathLength={1}
                            className={animate ? 'minichart-draw' : undefined}
                        />
                        {showDots && points.map((p, i) => (
                            <circle key={i} cx={p.x} cy={p.y} r={hover === i ? dotRadius + 1 : dotRadius} fill={color} />
                        ))}
                    </>
                )}

                {n > 0 && type === 'bar' && (barsAsBaseline ? (
                    // All-zero, no caller bounds: dashed baseline says "alive,
                    // just zero" instead of looking broken (source behavior).
                    <line
                        x1={padding} x2={width - padding} y1={drawBottom} y2={drawBottom}
                        stroke={color} strokeWidth={1} strokeOpacity={0.4} strokeDasharray="2,2"
                    />
                ) : (
                    values.map((v, i) => {
                        const yRaw = drawBottom - (v - barLo) * yScale;
                        const yVal = Math.max(drawTop, Math.min(drawBottom, yRaw));
                        const top = Math.min(yVal, yBase);
                        const h = Math.max(0, Math.abs(yVal - yBase));
                        return (
                            <rect
                                key={i}
                                x={points[i]!.x - barW / 2}
                                y={top}
                                width={barW}
                                height={h}
                                rx={1}
                                fill={color}
                                opacity={hover === i ? 0.7 : 1}
                                className={animate ? 'minichart-grow' : undefined}
                                style={animate ? { animationDelay: `${i * 20}ms` } : undefined}
                            />
                        );
                    })
                ))}

                {showCrosshair && hover != null && (
                    <line
                        x1={colW * (hover + 0.5)} x2={colW * (hover + 0.5)}
                        y1={0} y2={height}
                        className="minichart-crosshair"
                    />
                )}

                {/* One overlay drives index hover (SeriesChart pattern). */}
                {n > 0 && (showTooltip || showCrosshair) && (
                    <rect
                        x={0} y={0} width={width} height={height}
                        fill="transparent"
                        onMouseMove={onMove}
                        onMouseLeave={() => setHover(null)}
                    />
                )}
            </svg>

            {showTooltip && hover != null && n > 0 && (
                <div className="minichart-tip" style={{ left: tipX }}>
                    {labels?.[hover] != null && <div className="minichart-tip-label">{labels[hover]}</div>}
                    <strong>{fmt(values[hover] ?? 0)}</strong>
                </div>
            )}
        </div>
    );
}
