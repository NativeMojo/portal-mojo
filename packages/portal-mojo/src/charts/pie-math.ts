// Pure pie geometry + parsing — no DOM, no React (headless-testable).
// Split out of the PieChart port (web-mojo src/extensions/charts/PieChart.js
// _parseData/_buildSegmentGeometry/_interpolateSegments + the golden-angle
// generator, verbatim).
import { toNumber } from './stats';

export const GOLDEN_ANGLE = 137.508;

/** Distinct hues forever: i × golden angle around the wheel (source verbatim). */
export function goldenAngleColor(i: number): string {
    return `hsl(${((i * GOLDEN_ANGLE) % 360).toFixed(0)}, 65%, 52%)`;
}

export interface PieDatum {
    label: string;
    value: number;
    color?: string;
}

/** Chart.js-style input (shape 2). Only the first dataset is read. */
export interface PieDatasetsInput {
    labels: string[];
    datasets: { data: number[]; backgroundColor?: string[] }[];
}

/** The three accepted shapes: array / Chart.js / object map. */
export type PieInput = PieDatum[] | PieDatasetsInput | Record<string, number>;

export interface ParsedSlice {
    label: string;
    value: number;
    color: string | null;
}

/**
 * Normalize any accepted input shape to [{label, value, color|null}].
 * Unknown shapes warn and yield [] (never crash, never render nothing
 * silently — the empty state says so).
 */
export function parsePieInput(input: unknown): ParsedSlice[] {
    if (input == null) return [];
    if (Array.isArray(input)) {
        const arr: readonly unknown[] = input;
        return arr.map((d) => {
            const item = d as Partial<PieDatum> | null;
            return {
                label: String(item?.label ?? ''),
                value: toNumber(item?.value),
                color: item?.color ?? null,
            };
        });
    }
    if (typeof input === 'object') {
        const asDs = input as Partial<PieDatasetsInput>;
        if (Array.isArray(asDs.labels) && Array.isArray(asDs.datasets)) {
            const first = asDs.datasets[0];
            const bg = Array.isArray(first?.backgroundColor) ? first.backgroundColor : null;
            return asDs.labels.map((label, i) => ({
                label: String(label),
                value: toNumber(first?.data?.[i]),
                color: bg?.[i] ?? null,
            }));
        }
        const entries = Object.entries(input as Record<string, unknown>);
        if (entries.every(([, v]) => typeof v !== 'object' || v == null)) {
            return entries.map(([label, v]) => ({ label, value: toNumber(v), color: null }));
        }
    }
    console.warn('PieChart: unrecognized data shape — rendering empty state', input);
    return [];
}

export interface PieSegment {
    label: string;
    value: number;
    /** 0–100 share of the total (0 when the total is 0). */
    pct: number;
    color: string;
    startAngle: number;
    endAngle: number;
}

/** Radians, 12 o'clock start, clockwise — the source's geometry, verbatim. */
export function buildPieGeometry(slices: readonly { label: string; value: number; pct: number; color: string }[]): PieSegment[] {
    let angle = -Math.PI / 2;
    return slices.map((s) => {
        const arc = (s.pct / 100) * Math.PI * 2;
        const seg: PieSegment = { ...s, startAngle: angle, endAngle: angle + arc };
        angle += arc;
        return seg;
    });
}

/** Label-keyed interpolation: existing slices slide, new ones grow from a 0-arc. */
export function interpolateSegments(prev: readonly PieSegment[], target: readonly PieSegment[], k: number): PieSegment[] {
    const lerp = (a: number, b: number) => a + (b - a) * k;
    const prevByLabel = new Map(prev.map((p) => [p.label, p]));
    return target.map((t) => {
        const p = prevByLabel.get(t.label);
        if (!p) return { ...t, endAngle: lerp(t.startAngle, t.endAngle) };
        return { ...t, startAngle: lerp(p.startAngle, t.startAngle), endAngle: lerp(p.endAngle, t.endAngle) };
    });
}

/** SVG path for one segment (doughnut when innerR > 0). */
export function arcPath(cx: number, cy: number, outerR: number, innerR: number, seg: PieSegment): string {
    const { startAngle, endAngle } = seg;
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const x1o = cx + outerR * Math.cos(startAngle);
    const y1o = cy + outerR * Math.sin(startAngle);
    const x2o = cx + outerR * Math.cos(endAngle);
    const y2o = cy + outerR * Math.sin(endAngle);
    if (innerR > 0) {
        const x1i = cx + innerR * Math.cos(endAngle);
        const y1i = cy + innerR * Math.sin(endAngle);
        const x2i = cx + innerR * Math.cos(startAngle);
        const y2i = cy + innerR * Math.sin(startAngle);
        return [
            `M ${x1o} ${y1o}`,
            `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2o} ${y2o}`,
            `L ${x1i} ${y1i}`,
            `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x2i} ${y2i}`,
            'Z',
        ].join(' ');
    }
    return [`M ${cx} ${cy}`, `L ${x1o} ${y1o}`, `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2o} ${y2o}`, 'Z'].join(' ');
}
