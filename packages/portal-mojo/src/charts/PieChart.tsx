// PieChart — native SVG pie / doughnut, ported from web-mojo
// src/extensions/charts/PieChart.js (546 lines, read in full). No chart
// library. Carries: the three input shapes (array of {label,value,color?} /
// Chart.js {labels,datasets} / object map), optional endpoint fetch through
// the one client boundary, the golden-angle color generator, cutout +
// center label/sub-label (static or computed), right/bottom legend, slice
// edge labels with percentages, clamped tooltip, slice click, the
// full-circle single-segment special case, and the label-keyed arc tween.
//
// Deviations, deliberate:
//   · default palette is CHART_PALETTE (the mission-control set SeriesChart
//     uses) instead of web-mojo's Chart.js-era hexes; overflow indices go to
//     the golden-angle generator exactly as in the source;
//   · valueFormatter is a typed function (never a DataFormatter pipe string);
//   · malformed data warns and renders the empty state (the source silently
//     rendered nothing);
//   · endpoint errors warn + empty state; TanStack owns retry/caching.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mojoCall } from '../client/client';
import type { Params } from '../client/types';
import { CHART_PALETTE } from './SeriesChart';
import {
    arcPath,
    buildPieGeometry,
    goldenAngleColor,
    interpolateSegments,
    parsePieInput,
    type PieInput,
    type PieSegment,
} from './pie-math';

/** The center-label context ({total, segments} — source ctx shape). */
export interface PieCenterContext {
    total: number;
    segments: readonly PieSegment[];
}

export type PieCenterLabel = string | number | ((ctx: PieCenterContext) => string | number);

export interface PieChartProps {
    /** One of the three shapes. Ignored while `endpoint` is set. */
    data?: PieInput | null;
    /** GET this endpoint through the client boundary; its `data` feeds the pie. */
    endpoint?: string;
    /** Wire params for the endpoint fetch. */
    params?: Params;
    width?: number;
    height?: number;
    /** 0 = solid pie; 0..1 = inner-hole fraction (doughnut). */
    cutout?: number;
    /** Doughnut center text (needs cutout > 0). String or ({total, segments}) => string. */
    centerLabel?: PieCenterLabel | null;
    /** Smaller uppercase line under the center label. */
    centerSubLabel?: PieCenterLabel | null;
    /** Per-index colors; overflow falls to `colorGenerator`. Default CHART_PALETTE. */
    colors?: string[];
    colorGenerator?: (i: number) => string;
    showLegend?: boolean;
    /** 'right' | 'bottom' | 'none'. Unknown values warn and fall back to 'right'. */
    legendPosition?: 'right' | 'bottom' | 'none';
    /** Slice-edge labels outside the arc. */
    showLabels?: boolean;
    /** Append "(12.5%)" to edge labels; legend always shows percentages. */
    showPercentages?: boolean;
    showTooltip?: boolean;
    animate?: boolean;
    animationDuration?: number;
    valueFormatter?: (v: number) => string;
    onSliceClick?: (e: { label: string; value: number; pct: number; index: number }) => void;
    emptyText?: string;
    className?: string;
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export function PieChart({
    data: dataProp = null,
    endpoint,
    params,
    width = 200,
    height = 200,
    cutout = 0,
    centerLabel = null,
    centerSubLabel = null,
    colors,
    colorGenerator = goldenAngleColor,
    showLegend = true,
    legendPosition = 'right',
    showLabels = false,
    showPercentages = true,
    showTooltip = true,
    animate = true,
    animationDuration = 300,
    valueFormatter,
    onSliceClick,
    emptyText = 'No data',
    className = '',
}: PieChartProps) {
    let legendPos: 'right' | 'bottom' | 'none' = legendPosition;
    if (legendPos !== 'right' && legendPos !== 'bottom' && legendPos !== 'none') {
        console.warn(`PieChart: unknown legendPosition "${String(legendPosition)}" — falling back to "right"`);
        legendPos = 'right';
    }
    const legendOn = showLegend && legendPos !== 'none';

    // ── Endpoint fetch (optional) through the one client boundary ─────
    const query = useQuery({
        queryKey: [endpoint, 'pie', params ?? {}],
        queryFn: () => mojoCall(endpoint!, { params }),
        enabled: !!endpoint,
    });
    useEffect(() => {
        if (query.isError) {
            console.warn(`PieChart: endpoint fetch failed (${endpoint}) — rendering empty state`, query.error);
        }
    }, [query.isError, query.error, endpoint]);

    // Source heuristic carried over: some endpoints nest the payload one
    // level deeper (`data.data`) — prefer it when present.
    const raw: unknown = endpoint
        ? (query.data ? ((query.data.data as { data?: unknown } | null)?.data ?? query.data.data) : null)
        : dataProp;

    // ── Normalize + color + geometry ──────────────────────────────────
    const palette = colors && colors.length ? colors : CHART_PALETTE;
    const target = useMemo(() => {
        const slices = parsePieInput(raw);
        const total = slices.reduce((s, d) => s + d.value, 0);
        const colored = slices.map((s, i) => ({
            label: s.label,
            value: s.value,
            pct: total > 0 ? (s.value / total) * 100 : 0,
            color: s.color ?? palette[i] ?? colorGenerator(i),
        }));
        return buildPieGeometry(colored);
    }, [raw, palette, colorGenerator]);
    const total = useMemo(() => target.reduce((s, seg) => s + seg.value, 0), [target]);

    // ── Tween (label-keyed, rAF, cancelled on change/unmount) ─────────
    const [painted, setPainted] = useState<readonly PieSegment[]>(target);
    const prevRef = useRef<readonly PieSegment[]>(target);
    const firstPaint = useRef(true);
    const targetKey = useMemo(
        () => target.map((s) => `${s.label}:${s.value}`).join('|'),
        [target],
    );
    useEffect(() => {
        // First paint is direct (source: onAfterRender painted without animation).
        if (firstPaint.current || !animate || animationDuration <= 0) {
            firstPaint.current = false;
            prevRef.current = target;
            setPainted(target);
            return;
        }
        const prev = prevRef.current;
        const start = performance.now();
        let raf = 0;
        const step = (now: number) => {
            const t = Math.min(1, (now - start) / animationDuration);
            setPainted(interpolateSegments(prev, target, easeOutCubic(t)));
            if (t < 1) raf = requestAnimationFrame(step);
            else prevRef.current = target;
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
        // targetKey is the identity of `target`; the ref carries the old one.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [targetKey, animate, animationDuration]);

    // ── Tooltip (clamped inside the svg area, source _moveTooltip) ────
    const [hover, setHover] = useState<number | null>(null);
    // Legend hover highlights a slice but must not summon the mouse-anchored
    // tooltip (it would render at a stale position) — arc hover only.
    const [tipOn, setTipOn] = useState(false);
    const areaRef = useRef<HTMLDivElement>(null);
    const tipRef = useRef<HTMLDivElement>(null);
    const mouseRef = useRef({ x: 0, y: 0 });
    const placeTip = () => {
        const tip = tipRef.current;
        const area = areaRef.current;
        if (!tip || !area) return;
        const aw = area.clientWidth;
        const ah = area.clientHeight;
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        let left = mouseRef.current.x - tw / 2;
        let top = mouseRef.current.y - th - 8;
        if (left < 0) left = 0;
        if (left + tw > aw) left = aw - tw;
        if (top < 0) top = mouseRef.current.y + 12;
        if (top + th > ah) top = ah - th;
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
    };
    useLayoutEffect(() => { if (hover != null) placeTip(); });
    const trackMouse = (e: React.MouseEvent) => {
        const area = areaRef.current;
        if (!area) return;
        const rect = area.getBoundingClientRect();
        mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        placeTip();
    };

    const fmt = valueFormatter ?? ((v: number) => v.toLocaleString());

    const cx = width / 2;
    const cy = height / 2;
    const outerR = Math.min(cx, cy) - 4;
    const innerR = cutout > 0 ? outerR * Math.min(1, Math.max(0, cutout)) : 0;

    const visible = painted.filter((s) => Math.abs(s.endAngle - s.startAngle) > 1e-6);
    const fullCircle = visible.length === 1
        && Math.abs(Math.abs(visible[0]!.endAngle - visible[0]!.startAngle) - Math.PI * 2) < 1e-3;
    const hasData = target.length > 0 && total > 0;

    const centerCtx: PieCenterContext = { total, segments: target };
    const resolveCenter = (v: PieCenterLabel | null): string | null => {
        if (v == null) return null;
        return String(typeof v === 'function' ? v(centerCtx) : v);
    };
    const centerMain = resolveCenter(centerLabel);
    const centerSub = resolveCenter(centerSubLabel);

    const sliceHandlers = (i: number) => ({
        onMouseEnter: (e: React.MouseEvent) => { setHover(i); if (showTooltip) { setTipOn(true); trackMouse(e); } },
        onMouseMove: (e: React.MouseEvent) => { if (showTooltip) trackMouse(e); },
        onMouseLeave: () => { setHover(null); setTipOn(false); },
        onClick: () => {
            const seg = target[i];
            if (seg && onSliceClick) onSliceClick({ label: seg.label, value: seg.value, pct: seg.pct, index: i });
        },
    });

    const hovered = hover != null ? target[hover] : null;

    return (
        <div className={`pie-chart pie-layout-${legendPos === 'bottom' ? 'bottom' : 'right'}${className ? ` ${className}` : ''}`}>
            <div className="pie-svg-area" style={{ width, height }} ref={areaRef}>
                {!hasData ? (
                    <div className="pie-empty">{endpoint && query.isPending ? <span className="skel skel-block" /> : emptyText}</div>
                ) : (
                    <svg
                        className="pie-svg"
                        viewBox={`0 0 ${width} ${height}`}
                        width="100%"
                        height="100%"
                        preserveAspectRatio="xMidYMid meet"
                        role="img"
                    >
                        {fullCircle ? (
                            // Single-segment special case: SVG arcs cannot draw a
                            // full 360° — a circle element does (source parity).
                            innerR > 0 ? (
                                <circle
                                    cx={cx} cy={cy} r={(outerR + innerR) / 2}
                                    fill="none" stroke={visible[0]!.color} strokeWidth={outerR - innerR}
                                    className="pie-segment"
                                    {...sliceHandlers(painted.indexOf(visible[0]!))}
                                />
                            ) : (
                                <circle
                                    cx={cx} cy={cy} r={outerR} fill={visible[0]!.color}
                                    className="pie-segment"
                                    {...sliceHandlers(painted.indexOf(visible[0]!))}
                                />
                            )
                        ) : (
                            painted.map((seg, i) => {
                                if (seg.endAngle - seg.startAngle <= 0) return null;
                                return (
                                    <path
                                        key={seg.label || i}
                                        d={arcPath(cx, cy, outerR, innerR, seg)}
                                        fill={seg.color}
                                        stroke="var(--surface)"
                                        strokeWidth={1.5}
                                        className={`pie-segment${hover === i ? ' pie-segment-hot' : ''}`}
                                        {...sliceHandlers(i)}
                                    />
                                );
                            })
                        )}

                        {/* Slice-edge labels */}
                        {showLabels && !fullCircle && painted.map((seg, i) => {
                            const arc = seg.endAngle - seg.startAngle;
                            if (arc <= 0.05) return null;
                            const mid = (seg.startAngle + seg.endAngle) / 2;
                            const lx = cx + (outerR + 12) * Math.cos(mid);
                            const ly = cy + (outerR + 12) * Math.sin(mid);
                            return (
                                <text
                                    key={`l${seg.label || i}`}
                                    x={lx} y={ly}
                                    textAnchor={lx < cx ? 'end' : 'start'}
                                    className="pie-edge-label"
                                >
                                    {showPercentages ? `${seg.label} (${seg.pct.toFixed(1)}%)` : seg.label}
                                </text>
                            );
                        })}

                        {/* Doughnut center label(s) */}
                        {innerR > 0 && centerMain != null && (
                            <text
                                x={cx} y={centerSub != null ? cy - 2 : cy + 6}
                                textAnchor="middle" dominantBaseline="middle"
                                className="pie-center-label"
                            >
                                {centerMain}
                            </text>
                        )}
                        {innerR > 0 && centerSub != null && (
                            <text
                                x={cx} y={cy + 16}
                                textAnchor="middle" dominantBaseline="middle"
                                className="pie-center-sub"
                            >
                                {centerSub.toUpperCase()}
                            </text>
                        )}
                    </svg>
                )}

                {showTooltip && tipOn && hovered && (
                    <div className="pie-tip" ref={tipRef}>
                        <strong>{hovered.label}</strong>
                        <span>{fmt(hovered.value)} ({hovered.pct.toFixed(1)}%)</span>
                    </div>
                )}
            </div>

            {legendOn && hasData && (
                <div className="pie-legend">
                    {target.map((seg, i) => (
                        <div
                            key={seg.label || i}
                            className={`pie-legend-item${hover === i ? ' pie-legend-hot' : ''}`}
                            onMouseEnter={() => setHover(i)}
                            onMouseLeave={() => setHover(null)}
                        >
                            {/* Color as a style property, never string-interpolated markup —
                                the value can come from the API (source note carried over). */}
                            <span className="pie-legend-swatch" style={{ background: seg.color }} />
                            <span className="pie-legend-label">{seg.label}</span>
                            <span className="pie-legend-value">{seg.pct.toFixed(1)}%</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
