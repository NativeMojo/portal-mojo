// CircularProgress — SVG ring progress, ported from web-mojo
// src/extensions/charts/CircularProgress.js (740 lines, read in full).
// Carries: value/min/max, size presets (xs–xl) or explicit px with
// auto-scaled stroke width, variant colors, partial arcs (gap), rotation,
// rounded caps, gradient stroke, center value/label/icon with the
// percentage/fraction/value formats, multi-segment mode with segment gaps,
// and the dash-offset animation (value changes glide via CSS transition).
//
// Deviations, deliberate:
//   · colors are theme tokens (variant → var(--ok)/--bad/--warn/--info/
//     --accent; track → var(--surface2)) instead of hardcoded Bootstrap
//     hexes; the 'dark'/'light' THEME presets are dropped — data-theme
//     tokens make them meaningless here;
//   · the Bootstrap-popover tooltip is dropped (no Bootstrap); pass `title`
//     for a native tooltip or wrap the component;
//   · the imperative API (setValue/animateTo/pulse/complete) is the `value`
//     prop — the CSS transition animates every change;
//   · valueFormat falls back to 'percentage' WITH a console.warn on unknown
//     values (the source fell back silently through DataFormatter).
import { useEffect, useId, useState } from 'react';

export type CircularProgressSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;

const SIZE_PRESETS: Record<string, number> = { xs: 40, sm: 60, md: 80, lg: 120, xl: 180 };
const STROKE_PRESETS: Record<string, number> = { xs: 4, sm: 6, md: 8, lg: 12, xl: 16 };

function resolveSize(size: CircularProgressSize): { px: number; preset: string | null } {
    if (typeof size === 'number' && Number.isFinite(size) && size > 0) return { px: size, preset: null };
    if (typeof size === 'string' && SIZE_PRESETS[size] != null) return { px: SIZE_PRESETS[size]!, preset: size };
    console.warn(`CircularProgress: unknown size "${String(size)}" — falling back to "md"`);
    return { px: SIZE_PRESETS.md!, preset: 'md' };
}

function autoStrokeWidth(size: CircularProgressSize, px: number): number {
    if (typeof size === 'string' && STROKE_PRESETS[size] != null) return STROKE_PRESETS[size]!;
    if (px <= 40) return 4;
    if (px <= 60) return 6;
    if (px <= 80) return 8;
    if (px <= 120) return 12;
    return 16;
}

export type CircularProgressVariant = 'default' | 'success' | 'danger' | 'warning' | 'info';

const VARIANT_COLOR: Record<CircularProgressVariant, string> = {
    default: 'var(--accent)',
    success: 'var(--ok)',
    danger: 'var(--bad)',
    warning: 'var(--warn)',
    info: 'var(--info)',
};

export interface CircularProgressSegment {
    value: number;
    color?: string;
    label?: string;
}

export type CircularProgressFormat = 'percentage' | 'fraction' | 'value';

export interface CircularProgressProps {
    value?: number;
    min?: number;
    max?: number;
    size?: CircularProgressSize;
    /** 'auto' scales with size (preset table); a number pins it. */
    strokeWidth?: number | 'auto';
    /** Progress color; overrides `variant`. Tokens welcome. */
    color?: string;
    trackColor?: string;
    variant?: CircularProgressVariant;
    /** Two+ stops render the stroke through an SVG linearGradient. */
    gradientColors?: string[];
    /** Arc start in degrees; -90 = 12 o'clock (source default). */
    rotation?: number;
    /** Degrees left open (0 = full circle; 90 = three-quarter gauge). */
    gap?: number;
    rounded?: boolean;
    showValue?: boolean;
    /** 'percentage' | 'fraction' | 'value'. Unknown → warn + percentage. */
    valueFormat?: CircularProgressFormat;
    /** Wins over valueFormat. */
    valueFormatter?: (value: number, min: number, max: number) => string;
    /** Small line under the center value. */
    label?: string;
    /** Icon class replaces the center value ('bi bi-check-lg'). */
    icon?: string;
    /** Multi-segment mode — replaces `value`. Total > max warns + clamps visually. */
    segments?: CircularProgressSegment[];
    /** Degrees between segments. */
    segmentGap?: number;
    animate?: boolean;
    animationDuration?: number;
    onClick?: () => void;
    title?: string;
    className?: string;
}

export function CircularProgress({
    value = 0,
    min = 0,
    max = 100,
    size = 'md',
    strokeWidth = 'auto',
    color,
    trackColor = 'var(--surface2)',
    variant = 'default',
    gradientColors,
    rotation = -90,
    gap = 0,
    rounded = true,
    showValue = true,
    valueFormat = 'percentage',
    valueFormatter,
    label,
    icon,
    segments,
    segmentGap = 2,
    animate = true,
    animationDuration = 600,
    onClick,
    title,
    className = '',
}: CircularProgressProps) {
    const uid = useId();
    const gradientId = `cprog-grad-${uid}`;

    const { px, preset } = resolveSize(size);
    const sw = strokeWidth === 'auto' || strokeWidth == null ? autoStrokeWidth(size, px) : strokeWidth;

    let mainColor = color ?? VARIANT_COLOR[variant];
    if (color == null && VARIANT_COLOR[variant] == null) {
        console.warn(`CircularProgress: unknown variant "${String(variant)}" — falling back to "default"`);
        mainColor = VARIANT_COLOR.default;
    }
    const useGradient = Array.isArray(gradientColors) && gradientColors.length > 1;
    const strokePaint = useGradient ? `url(#${gradientId})` : mainColor;

    const center = px / 2;
    const radius = (px - sw) / 2;
    const circumference = 2 * Math.PI * radius;
    const arcDeg = gap > 0 ? 360 - gap : 360;
    const arcLen = (arcDeg / 360) * circumference;

    const range = max - min;
    const pctOf = (v: number): number => (range === 0 ? 0 : ((v - min) / range) * 100);
    const clamped = Math.max(min, Math.min(max, value));
    const percentage = pctOf(clamped);

    // Mount-from-empty so the first paint animates like the source did:
    // render offset=arcLen for one frame, then transition to the target.
    const [mounted, setMounted] = useState(!animate);
    useEffect(() => {
        if (!animate) return;
        const raf = requestAnimationFrame(() => setMounted(true));
        return () => cancelAnimationFrame(raf);
    }, [animate]);

    const transition = animate ? `stroke-dashoffset ${animationDuration}ms ease-out` : undefined;

    const segList = Array.isArray(segments) && segments.length > 0 ? segments : null;
    if (segList) {
        const totalSeg = segList.reduce((s, seg) => s + (seg.value || 0), 0);
        if (totalSeg > max) {
            console.warn('CircularProgress: segment total exceeds max — the overflow is clipped to the arc');
        }
    }

    const formatCenter = (): string => {
        if (valueFormatter) return valueFormatter(clamped, min, max);
        switch (valueFormat) {
            case 'percentage': return `${Math.round(percentage)}%`;
            case 'fraction': return `${clamped}/${max}`;
            case 'value': return String(clamped);
            default:
                console.warn(`CircularProgress: unknown valueFormat "${String(valueFormat)}" — falling back to "percentage"`);
                return `${Math.round(percentage)}%`;
        }
    };

    // Segment geometry: running dash offsets along the arc (source verbatim,
    // including the gapLen between painted segments).
    let runningOffset = 0;
    const segmentEls = (segList ?? []).map((seg, i) => {
        const segLen = (pctOf(min + (seg.value || 0)) / 100) * arcLen;
        const gapLen = (segmentGap / 360) * circumference;
        if (segLen <= 0) return null;
        const offset = -runningOffset;
        runningOffset += segLen + gapLen;
        return (
            <circle
                key={i}
                cx={center} cy={center} r={radius}
                fill="none"
                stroke={seg.color ?? mainColor}
                strokeWidth={sw}
                strokeLinecap={rounded ? 'round' : 'butt'}
                strokeDasharray={`${segLen} ${circumference}`}
                strokeDashoffset={mounted ? offset : arcLen}
                transform={`rotate(${rotation} ${center} ${center})`}
                style={{ transition, transitionDelay: animate ? `${i * 100}ms` : undefined }}
                className="cprog-segment"
            >
                {seg.label != null && <title>{seg.label}</title>}
            </circle>
        );
    });

    const progressLen = (percentage / 100) * arcLen;
    const dashOffset = arcLen - progressLen;

    const clickable = onClick != null;
    const rootClass = [
        'cprog',
        preset ? `cprog-${preset}` : '',
        clickable ? 'cprog-clickable' : '',
        className,
    ].filter(Boolean).join(' ');
    const rootStyle = { width: px, height: px };

    const body = (
        <>
            <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} className="cprog-svg" role="img">
                {useGradient && (
                    <defs>
                        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                            {gradientColors!.map((c, i) => (
                                <stop key={i} offset={`${(i / (gradientColors!.length - 1)) * 100}%`} stopColor={c} />
                            ))}
                        </linearGradient>
                    </defs>
                )}
                <circle
                    cx={center} cy={center} r={radius}
                    fill="none"
                    stroke={trackColor}
                    strokeWidth={sw}
                    strokeLinecap={rounded ? 'round' : 'butt'}
                    strokeDasharray={gap > 0 ? `${arcLen} ${circumference}` : undefined}
                    transform={`rotate(${rotation} ${center} ${center})`}
                />
                {segList ? segmentEls : (
                    <circle
                        cx={center} cy={center} r={radius}
                        fill="none"
                        stroke={strokePaint}
                        strokeWidth={sw}
                        strokeLinecap={rounded ? 'round' : 'butt'}
                        strokeDasharray={`${arcLen} ${circumference}`}
                        strokeDashoffset={mounted ? dashOffset : arcLen}
                        transform={`rotate(${rotation} ${center} ${center})`}
                        style={{ transition }}
                        className="cprog-bar"
                    />
                )}
            </svg>
            <div className="cprog-center">
                {icon ? (
                    <i className={icon} aria-hidden="true" />
                ) : showValue ? (
                    <>
                        <div className="cprog-value">{formatCenter()}</div>
                        {label && <div className="cprog-label">{label}</div>}
                    </>
                ) : label ? (
                    <div className="cprog-label">{label}</div>
                ) : null}
            </div>
        </>
    );

    return clickable ? (
        <button type="button" className={rootClass} style={rootStyle} onClick={onClick} title={title}>
            {body}
        </button>
    ) : (
        <div className={rootClass} style={rootStyle} title={title}>
            {body}
        </div>
    );
}
