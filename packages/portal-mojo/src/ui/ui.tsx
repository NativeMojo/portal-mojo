// Small display primitives: Badge (the HTML-returning formatters become
// components), MetricCard (flat monochrome KPI), Spark (dependency-free SVG
// mini chart — the chartlib porting pattern in miniature).
import type { ReactNode } from 'react';
import { inferTone, type Tone } from './format';

export function Badge({ tone, children }: { tone?: Tone; children: ReactNode }) {
    const t = tone ?? (typeof children === 'string' || typeof children === 'boolean' ? inferTone(children) : 'muted');
    return <span className={`chip chip-${t}`}>{children === true ? 'Yes' : children === false ? 'No' : children}</span>;
}

export function MetricCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: string }) {
    return (
        <div className="metric">
            <div className="metric-top">
                <span className="metric-label">{label}</span>
                {icon && <i className={`bi ${icon} metric-icon`} />}
            </div>
            <div className="metric-value">{value}</div>
            {hint && <div className="metric-hint">{hint}</div>}
        </div>
    );
}

/** Inline SVG sparkline with area fill and emphasized endpoint. */
export function Spark({ data, height = 48 }: { data: number[]; height?: number }) {
    if (data.length < 2) return null;
    const w = 100;
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const span = max - min || 1;
    const pts = data.map((v, i) => [
        (i / (data.length - 1)) * w,
        height - 4 - ((v - min) / span) * (height - 10),
    ]);
    const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    // No endpoint circle: preserveAspectRatio="none" would stretch it into a
    // blob. The stroke stays crisp via vector-effect: non-scaling-stroke.
    return (
        <svg viewBox={`0 0 ${w} ${height}`} className="spark" preserveAspectRatio="none" role="img" aria-label="Trend">
            <polyline points={`0,${height} ${line} ${w},${height}`} className="spark-fill" />
            <polyline points={line} className="spark-line" />
        </svg>
    );
}
