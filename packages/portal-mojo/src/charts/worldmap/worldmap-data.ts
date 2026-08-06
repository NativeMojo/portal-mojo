// worldmap-data.ts — the WorldMap's data vocabulary and the pure binding
// helpers that turn django-mojo payloads into markers. No React, no DOM, so
// every rule here is headless-testable and the three admin consumers
// (#1291 logins, #1287 geofence, #1292 dashboard geography) share ONE
// slug-parsing and sizing implementation instead of three.
import type { ReactNode } from 'react';
import { COUNTRY_CENTROIDS, type CountryCentroid } from './countryCentroids';
import type { LatLng } from './geo';

/**
 * Marker/route colors are TOKENS, resolved by the browser at paint time.
 * A theme flip therefore needs no re-render and no recomputed hexes.
 *
 * `scale` is the value ramp: it replaces web-mojo's hardcoded teal→amber
 * rgba mix (MetricsCountryMapView.js:171-178, duplicated verbatim in
 * LoginLocationMapView.js:283-288) with the same visual gradient expressed
 * in tokens, so it reads correctly in both themes.
 */
export const MAP_TONES = {
    ok: 'var(--ok)',
    bad: 'var(--bad)',
    warn: 'var(--warn)',
    info: 'var(--info)',
    accent: 'var(--accent)',
    mute: 'var(--mute)',
    scale: 'var(--ok)',
} as const;

export type WorldMapTone = keyof typeof MAP_TONES;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * Tone → a CSS color string. `scale` interpolates `--ok` → `--warn` on
 * `intensity` via `color-mix`; every other tone ignores intensity.
 *
 * An unknown tone (wire data can carry anything) falls back to `accent`
 * WITH a console.warn — never to rendering nothing.
 */
export function toneColor(tone: WorldMapTone = 'accent', intensity = 0): string {
    let key = tone;
    if (!(key in MAP_TONES)) {
        console.warn(`WorldMap: unknown tone "${String(tone)}" — falling back to "accent"`);
        key = 'accent';
    }
    if (key !== 'scale') return MAP_TONES[key];
    const okPct = Math.round((1 - clamp01(intensity)) * 100);
    return `color-mix(in srgb, var(--ok) ${okPct}%, var(--warn))`;
}

/**
 * Event-type → tone, the login palette web-mojo hardcoded as rgba in
 * LoginLocationMapView.js:31-41. Unknown types land on `mute` (the source's
 * grey default) — deliberately silent, since "some other event type" is
 * normal data, not a caller mistake.
 */
export const LOGIN_EVENT_TONES: Record<string, WorldMapTone> = {
    success_login: 'ok',
    success: 'ok',
    login: 'ok',
    failed_login: 'bad',
    failure: 'bad',
    failed: 'bad',
    suspicious: 'warn',
    mfa_required: 'warn',
    mfa: 'warn',
};

/** Login event type → tone. Unknown/empty → 'mute'. */
export function loginEventTone(eventType: string | null | undefined): WorldMapTone {
    return LOGIN_EVENT_TONES[String(eventType ?? '').toLowerCase()] ?? 'mute';
}

/** One plotted point. `T` is the consumer's own row, handed back to handlers. */
export interface WorldMapMarker<T = unknown> {
    /** Stable React key and the identity used for hover/click bookkeeping. */
    id?: string;
    lat: number;
    lng: number;
    /** Diameter in px. Default 14. */
    size?: number;
    tone?: WorldMapTone;
    /** 0..1 — drives the `scale` tone's ramp. */
    intensity?: number;
    /** Bootstrap icon class drawn inside the dot, e.g. 'bi bi-broadcast-pin'. */
    icon?: string;
    /** Tooltip heading. */
    label?: string;
    /** Numeric value; the default tooltip renders it under the label. */
    value?: number;
    /** Extra tooltip body — a ReactNode SLOT, never an HTML string. */
    detail?: ReactNode;
    /** Legend bucket. Toggling that key in the legend hides this marker. */
    legendKey?: string;
    /** Typed payload for onMarkerClick/onMarkerDoubleClick/onMarkerHover. */
    data?: T;
}

/** An origin→destination line. Endpoint order decides which way the arc bows. */
export interface WorldMapRoute {
    id?: string;
    from: LatLng;
    to: LatLng;
    /** 0..1 — width, opacity and (for tone 'scale') color all ride this. */
    intensity?: number;
    tone?: WorldMapTone;
    label?: string;
    legendKey?: string;
}

export interface WorldMapLegendItem {
    key: string;
    label: string;
    tone?: WorldMapTone;
    /** Explicit swatch color; overrides `tone`. Use a token, not a hex. */
    color?: string;
}

// ── Injectable basemap geometry ───────────────────────────────────────
// The component ships NO coastlines (see docs/worldmap.md — that is an open
// decision). These are the minimal GeoJSON shapes the `land` prop accepts so
// geometry can be dropped in later without an API change.

/** GeoJSON position: [lng, lat] — note the order, opposite of LatLng. */
export type GeoPosition = [number, number];

export interface GeoPolygon {
    type: 'Polygon';
    coordinates: GeoPosition[][];
}

export interface GeoMultiPolygon {
    type: 'MultiPolygon';
    coordinates: GeoPosition[][][];
}

export interface GeoLandFeature {
    type: 'Feature';
    geometry: GeoPolygon | GeoMultiPolygon | null;
    properties?: Record<string, unknown> | null;
}

export interface GeoLandCollection {
    type: 'FeatureCollection';
    features: GeoLandFeature[];
}

/** Land geometry: a FeatureCollection, a bare feature array, or a geometry. */
export type WorldMapLand = GeoLandCollection | readonly GeoLandFeature[] | GeoPolygon | GeoMultiPolygon;

/** Normalize any accepted `land` shape into rings of [lng, lat] positions. */
export function landRings(land: WorldMapLand | null | undefined): GeoPosition[][] {
    if (!land) return [];
    // `'type' in land` rather than Array.isArray: TS does not narrow a
    // ReadonlyArray out of a union via Array.isArray.
    const features: readonly GeoLandFeature[] = 'type' in land
        ? (land.type === 'FeatureCollection'
            ? (Array.isArray(land.features) ? land.features : [])
            : [{ type: 'Feature', geometry: land }])
        : land;

    const rings: GeoPosition[][] = [];
    let skipped = 0;
    for (const feature of features) {
        const geometry = feature?.geometry;
        if (!geometry) { skipped += 1; continue; }
        if (geometry.type === 'Polygon') {
            for (const ring of geometry.coordinates) rings.push(ring);
        } else if (geometry.type === 'MultiPolygon') {
            for (const polygon of geometry.coordinates) for (const ring of polygon) rings.push(ring);
        } else {
            skipped += 1;
        }
    }
    if (skipped > 0) {
        console.warn(`WorldMap: skipped ${skipped} land feature(s) — only Polygon and MultiPolygon geometries are drawn`);
    }
    return rings;
}

// ── Sizing + slug binding ─────────────────────────────────────────────

/**
 * Value → marker diameter. Default range [18, 42] reproduces web-mojo's
 * `Math.round(18 + intensity * 24)` exactly (LoginLocationMapView used
 * `* 26`; pass `[18, 44]` for that). A non-positive or non-finite max means
 * "no scale yet" and returns the minimum rather than NaN.
 */
export function scaleMarkerSize(
    value: number,
    max: number,
    range: readonly [number, number] = [18, 42],
    scale: 'linear' | 'sqrt' = 'linear',
): number {
    const [min, top] = range;
    if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(value)) return Math.round(min);
    const i = clamp01(value / max);
    const eased = scale === 'sqrt' ? Math.sqrt(i) : i;
    return Math.round(min + eased * (top - min));
}

/**
 * Metrics key → ISO2 country code, or null.
 *
 * ONE rule covers both shapes found in the wild: bare codes
 * (MetricsCountryMapView.js:107-118 treats each key of `data.data` as an ISO
 * code) and namespaced slugs (`incident_events:country:US`,
 * `firewall:blocks:country:US`, `bouncer:blocks:country:US` —
 * GeographyPanel.js:232-243 takes the trailing segment). Uppercase the last
 * `:`-separated segment; accept it only if it is two characters AND a known
 * country. `api_calls` and `ZZ` therefore both return null.
 */
export function countryCodeFromSlug(slug: string | null | undefined): string | null {
    if (!slug) return null;
    const last = String(slug).split(':').pop()?.trim().toUpperCase();
    if (!last || last.length !== 2) return null;
    return last in COUNTRY_CENTROIDS ? last : null;
}

/** One country's rolled-up series — the payload markers carry as `data`. */
export interface CountryTotal {
    code: string;
    name: string;
    centroid: CountryCentroid;
    total: number;
    values: number[];
    /** total / the top country's total, 0..1. */
    intensity: number;
}

export interface CountrySeriesOptions {
    /** Top-N cut. Source default: MetricsCountryMapView's `maxCountries: 12`. */
    maxCountries?: number;
    tone?: WorldMapTone;
    sizeRange?: readonly [number, number];
    sizeScale?: 'linear' | 'sqrt';
    /** Noun in the default tooltip line, e.g. "12,043 Events". */
    metricLabel?: string;
    /** Legend bucket for every produced marker. */
    legendKey?: string;
}

/**
 * The shared binding: a metrics `data.data` map → sorted, top-N,
 * centroid-joined markers. Keys may be bare ISO2 or namespaced slugs; values
 * may be a series array or a single number. Rows that sum to zero, or whose
 * code is not a known country, are dropped — exactly what the source did,
 * only once instead of in each consumer.
 */
export function countrySeriesToMarkers(
    series: Readonly<Record<string, readonly number[] | number | null | undefined>>,
    opts: CountrySeriesOptions = {},
): WorldMapMarker<CountryTotal>[] {
    const {
        maxCountries = 12,
        tone = 'scale',
        sizeRange = [18, 42],
        sizeScale = 'linear',
        metricLabel = 'Events',
        legendKey,
    } = opts;

    const rows: Omit<CountryTotal, 'intensity'>[] = [];
    for (const [key, raw] of Object.entries(series ?? {})) {
        const code = countryCodeFromSlug(key);
        if (!code) continue;
        const values = Array.isArray(raw) ? raw.map((v) => Number(v) || 0) : [Number(raw) || 0];
        const total = values.reduce((sum, v) => sum + v, 0);
        if (!(total > 0)) continue;
        const centroid = COUNTRY_CENTROIDS[code]!;
        rows.push({ code, name: centroid.name, centroid, total, values });
    }

    rows.sort((a, b) => b.total - a.total);
    const top = rows.slice(0, Math.max(0, maxCountries));
    const max = top[0]?.total ?? 0;

    return top.map((row) => {
        const data: CountryTotal = { ...row, intensity: max > 0 ? row.total / max : 0 };
        return {
            id: row.code,
            lat: row.centroid.lat,
            lng: row.centroid.lng,
            size: scaleMarkerSize(row.total, max, sizeRange, sizeScale),
            tone,
            intensity: data.intensity,
            label: row.name,
            value: row.total,
            detail: `${row.total.toLocaleString()} ${metricLabel}`,
            ...(legendKey ? { legendKey } : {}),
            data,
        } satisfies WorldMapMarker<CountryTotal>;
    });
}
