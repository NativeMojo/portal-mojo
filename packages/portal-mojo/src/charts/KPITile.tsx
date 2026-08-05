// KPITile — compact dashboard tile: small label, big tabular-numerals value,
// color-coded delta badge, embedded sparkline. Ported from web-mojo
// src/extensions/charts/KPITile.js (176 lines, read in full).
//
// Presentation-only, exactly like the source: no fetch, no settings — one
// parent (KPIStrip, or any page) fetches once and feeds many tiles. The
// delta logic is the source's, verbatim via deltaBadge(): finite deltaPct →
// "+12%"; pct absent (prev was 0) but delta present → "+4" absolute; both
// absent → no badge. Never renders Infinity%. `tone` decides whether rising
// is green or red; `severity` adds the left-stripe accent.
//
// Deviation: severity/spark colors are theme tokens ('high' shares the warn
// token — there is no orange in the 8-token palette), and the value
// formatter is a typed function.
import type { ReactNode } from 'react';
import { MiniChart } from './MiniChart';
import { deltaBadge } from './stats';

export type KpiSeverity = 'critical' | 'high' | 'warn' | 'info' | 'good';
export type KpiTone = 'good' | 'bad';

const SEVERITY_COLOR: Record<KpiSeverity, string> = {
    critical: 'var(--bad)',
    high: 'var(--warn)',
    warn: 'var(--warn)',
    info: 'var(--info)',
    good: 'var(--ok)',
};

const KNOWN_SEVERITIES: readonly KpiSeverity[] = ['critical', 'high', 'warn', 'info', 'good'];

export interface KPITileProps {
    label: string;
    /** null → '—'. Strings render verbatim; numbers go through `formatter`. */
    value: number | string | null | undefined;
    formatter?: (v: number) => string;
    /** Absolute change vs the comparison bucket. */
    delta?: number | null;
    /** Percent change; omit when the previous bucket was 0. */
    deltaPct?: number | null;
    /** 'bad' = rising is bad (errors); 'good' = rising is good. Default neutral. */
    tone?: KpiTone | null;
    /** Left-stripe accent for tiles that ARE the alert. */
    severity?: KpiSeverity | null;
    sparkline?: readonly number[] | null;
    sparklineColor?: string;
    sparklineHeight?: number;
    /** Extra line under the value (the strip does not use it; pages may). */
    hint?: ReactNode;
    onClick?: () => void;
    /** Skeleton state — value/badge render as shimmer placeholders. */
    loading?: boolean;
    className?: string;
}

export function KPITile({
    label,
    value,
    formatter,
    delta = null,
    deltaPct = null,
    tone = null,
    severity = null,
    sparkline = null,
    sparklineColor,
    sparklineHeight = 36,
    hint,
    onClick,
    loading = false,
    className = '',
}: KPITileProps) {
    let sev: KpiSeverity | null = severity;
    if (sev != null && !KNOWN_SEVERITIES.includes(sev)) {
        console.warn(`KPITile: unknown severity "${String(severity)}" — ignoring`);
        sev = null;
    }

    const display = value == null
        ? '—'
        : typeof value === 'number'
            ? (formatter ? formatter(value) : value.toLocaleString())
            : String(value);

    const badge = deltaBadge(delta, deltaPct, tone);
    // Default to the info tone when no severity is set — a neutral grey line
    // blends into the dark surface (source note carried over).
    const sparkColor = sparklineColor ?? (sev ? SEVERITY_COLOR[sev] : 'var(--info)');
    const hasSpark = Array.isArray(sparkline) && sparkline.length > 1;

    const rootClass = `kpi-tile${sev ? ` kpi-tile-${sev}` : ''}${onClick ? ' kpi-tile-clickable' : ''}${className ? ` ${className}` : ''}`;
    const body = (
        <>
            <span className="kpi-tile-label">{label}</span>
            {loading ? (
                <span className="kpi-tile-value"><span className="skel skel-w-60" /></span>
            ) : (
                <span className="kpi-tile-value">{display}</span>
            )}
            {!loading && badge && <span className={`kpi-tile-delta kpi-tile-delta-${badge.tone}`}>{badge.text}</span>}
            {!loading && hint != null && <span className="kpi-tile-hint">{hint}</span>}
            <span className="kpi-tile-spark">
                {hasSpark && (
                    <MiniChart
                        data={sparkline as number[]}
                        chartType="line"
                        height={sparklineHeight}
                        color={sparkColor}
                        fill
                        smoothing={0.3}
                        showTooltip={false}
                        showCrosshair={false}
                        padding={2}
                        animate={false}
                    />
                )}
            </span>
        </>
    );

    return onClick ? (
        <button type="button" className={rootClass} onClick={onClick}>{body}</button>
    ) : (
        <div className={rootClass}>{body}</div>
    );
}
