// geo.ts — the WorldMap's projection math. Pure functions, no React, no DOM:
// everything here is headless-testable (scripts/verify-worldmap.mjs) and is
// the piece a future tile-backed map would reuse unchanged.
//
// Equirectangular (plate carrée) is the projection web-mojo effectively
// showed at zoom 1.3 over a demo tile server, and it is the only sane choice
// for a graticule fallback: lat/lng map to y/x linearly, so the inverse is
// exact and a "no geometry shipped" map still tells the truth about where a
// point is.
//
// Coordinate validity is `Number.isFinite`, never truthiness — web-mojo's
// `if (!lng || !lat) return` (MapLibreView.js:223) dropped legitimate points
// on the equator and the prime meridian.

/** A geographic point. `lat` is degrees north, `lng` degrees east. */
export interface LatLng {
    lat: number;
    lng: number;
}

/** A geographic crop. All four values are degrees. */
export interface GeoBounds {
    west: number;
    east: number;
    south: number;
    north: number;
}

/**
 * The viewport: which point sits at the center of the frame, and how far in.
 * `zoom` 1 fits the whole `bounds` box; `MAX_ZOOM` is the hard ceiling.
 */
export interface WorldMapView {
    lat: number;
    lng: number;
    zoom: number;
}

/** Pixel point in the SVG's own coordinate space (origin top-left). */
export interface PixelPoint {
    x: number;
    y: number;
}

export interface PixelSize {
    width: number;
    height: number;
}

/**
 * The default crop: the whole world minus the polar caps nothing plots in.
 * web-mojo approximated the same framing with `center [10, 20], zoom 1.3` on
 * a Mercator basemap. Antarctica (lat −77) sits OUTSIDE this box on purpose —
 * it is counted as off-bounds, not clamped to the edge; widen `bounds` if a
 * consumer really needs it.
 */
export const DEFAULT_BOUNDS: GeoBounds = { west: -180, east: 180, south: -58, north: 84 };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 12;

/** The whole-world view: the center of DEFAULT_BOUNDS at zoom 1. */
export const DEFAULT_VIEW: WorldMapView = { lat: 13, lng: 0, zoom: 1 };

/** True when both coordinates are real numbers. `{lat: 0, lng: 0}` passes. */
export function isFinitePoint(p: LatLng | null | undefined): p is LatLng {
    return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** A projection bound to one container size, crop and viewport. */
export interface Projection {
    size: PixelSize;
    bounds: GeoBounds;
    view: WorldMapView;
    /** Pixels per degree. Uniform in x and y — circles stay circles. */
    scale: number;
    project(p: LatLng): PixelPoint;
    invert(pt: PixelPoint): LatLng;
    /** True when the projected point falls inside the drawn frame. */
    contains(p: LatLng): boolean;
}

export interface ProjectionOptions {
    width: number;
    height: number;
    bounds?: GeoBounds;
    view?: WorldMapView;
}

/**
 * Build an equirectangular projection.
 *
 * At `zoom: 1` the whole `bounds` box fits the frame ("contain"): the scale
 * is `min(width/spanLng, height/spanLat)` in BOTH axes, so a container whose
 * aspect does not match the crop letterboxes rather than stretching. A
 * non-uniform fit would turn every marker into an ellipse and every distance
 * into a lie, which is the opposite of what a fallback map is for.
 */
export function equirectangular({
    width,
    height,
    bounds = DEFAULT_BOUNDS,
    view = DEFAULT_VIEW,
}: ProjectionOptions): Projection {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const spanLng = Math.max(1e-9, bounds.east - bounds.west);
    const spanLat = Math.max(1e-9, bounds.north - bounds.south);
    const base = Math.min(w / spanLng, h / spanLat);
    const zoom = clamp(Number.isFinite(view.zoom) ? view.zoom : 1, MIN_ZOOM, MAX_ZOOM);
    const scale = base * zoom;
    const cx = w / 2;
    const cy = h / 2;
    const centerLat = Number.isFinite(view.lat) ? view.lat : DEFAULT_VIEW.lat;
    const centerLng = Number.isFinite(view.lng) ? view.lng : DEFAULT_VIEW.lng;

    const project = (p: LatLng): PixelPoint => ({
        x: cx + (p.lng - centerLng) * scale,
        y: cy - (p.lat - centerLat) * scale,
    });

    return {
        size: { width: w, height: h },
        bounds,
        view: { lat: centerLat, lng: centerLng, zoom },
        scale,
        project,
        invert: (pt: PixelPoint): LatLng => ({
            lat: centerLat - (pt.y - cy) / scale,
            lng: centerLng + (pt.x - cx) / scale,
        }),
        contains: (p: LatLng): boolean => {
            if (!isFinitePoint(p)) return false;
            const { x, y } = project(p);
            return x >= 0 && x <= w && y >= 0 && y <= h;
        },
    };
}

/**
 * Clamp a viewport so the zoom stays in range and the map can never be
 * dragged out of the frame: on each axis, either the whole crop is visible
 * (then center on it) or the visible window is pinned inside the crop.
 */
export function clampView(view: WorldMapView, bounds: GeoBounds, size: PixelSize): WorldMapView {
    const spanLng = Math.max(1e-9, bounds.east - bounds.west);
    const spanLat = Math.max(1e-9, bounds.north - bounds.south);
    const w = Math.max(1, size.width);
    const h = Math.max(1, size.height);
    const base = Math.min(w / spanLng, h / spanLat);
    const zoom = clamp(Number.isFinite(view.zoom) ? view.zoom : 1, MIN_ZOOM, MAX_ZOOM);
    const scale = base * zoom;

    const halfLng = w / 2 / scale;
    const halfLat = h / 2 / scale;
    const midLng = (bounds.west + bounds.east) / 2;
    const midLat = (bounds.south + bounds.north) / 2;

    const lng = halfLng * 2 >= spanLng
        ? midLng
        : clamp(Number.isFinite(view.lng) ? view.lng : midLng, bounds.west + halfLng, bounds.east - halfLng);
    const lat = halfLat * 2 >= spanLat
        ? midLat
        : clamp(Number.isFinite(view.lat) ? view.lat : midLat, bounds.south + halfLat, bounds.north - halfLat);

    return { lat, lng, zoom };
}

export interface FitOptions {
    size: PixelSize;
    bounds?: GeoBounds;
    /** Breathing room around the fitted box, in px. Source parity: 50. */
    padding?: number;
    /** Source parity: MapLibre's `fitBounds({maxZoom: 15})`, clamped here. */
    maxZoom?: number;
    /** Returned when there is nothing to fit; its zoom is kept for one point. */
    fallback?: WorldMapView;
}

/**
 * The `fitBounds()` replacement (MapLibreView.js:261-274) — used by the
 * drill-down flow. Zero points returns `fallback` untouched; ONE point
 * re-centers but KEEPS the current zoom, because a single-point bounding box
 * has zero span and "fit" would divide by zero (MapLibre answered that case
 * with a `flyTo`, same idea).
 */
export function fitViewToPoints(points: readonly LatLng[], opts: FitOptions): WorldMapView {
    const bounds = opts.bounds ?? DEFAULT_BOUNDS;
    const fallback = opts.fallback ?? DEFAULT_VIEW;
    const padding = opts.padding ?? 50;
    const maxZoom = clamp(opts.maxZoom ?? MAX_ZOOM, MIN_ZOOM, MAX_ZOOM);
    const usable = (points ?? []).filter(isFinitePoint);
    if (!usable.length) return fallback;

    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    for (const p of usable) {
        west = Math.min(west, p.lng);
        east = Math.max(east, p.lng);
        south = Math.min(south, p.lat);
        north = Math.max(north, p.lat);
    }
    const center = { lat: (south + north) / 2, lng: (west + east) / 2 };

    const spanLng = east - west;
    const spanLat = north - south;
    if (spanLng <= 0 && spanLat <= 0) {
        return clampView({ ...center, zoom: fallback.zoom }, bounds, opts.size);
    }

    const w = Math.max(1, opts.size.width);
    const h = Math.max(1, opts.size.height);
    const base = Math.min(w / Math.max(1e-9, bounds.east - bounds.west), h / Math.max(1e-9, bounds.north - bounds.south));
    const usableW = Math.max(1, w - padding * 2);
    const usableH = Math.max(1, h - padding * 2);
    const needed = Math.min(
        spanLng > 0 ? usableW / spanLng : Infinity,
        spanLat > 0 ? usableH / spanLat : Infinity,
    );
    const zoom = clamp(needed / base, MIN_ZOOM, maxZoom);
    return clampView({ ...center, zoom }, bounds, opts.size);
}

/**
 * Split a great-circle-ish segment at the antimeridian.
 *
 * On an equirectangular map a Tokyo→Los Angeles line drawn naively runs
 * BACKWARDS across the entire world. When the shorter path wraps past ±180°
 * this returns two segments — one to the edge, one from the other edge —
 * with the latitude linearly interpolated at the crossing. Otherwise it
 * returns the single original segment.
 */
export function splitAntimeridian(from: LatLng, to: LatLng): [LatLng, LatLng][] {
    if (!isFinitePoint(from) || !isFinitePoint(to)) return [];
    const dLng = to.lng - from.lng;
    if (Math.abs(dLng) <= 180) return [[from, to]];

    // The short way wraps: restate `to` on the continuous side of `from`.
    const wrappedLng = dLng > 0 ? to.lng - 360 : to.lng + 360;
    const edge = dLng > 0 ? -180 : 180;
    const t = (edge - from.lng) / (wrappedLng - from.lng);
    const lat = from.lat + (to.lat - from.lat) * t;
    return [
        [from, { lat, lng: edge }],
        [{ lat, lng: -edge }, to],
    ];
}

/**
 * A quadratic-bezier arc between two projected points. The control point sits
 * perpendicular to the chord, offset proportionally to the chord's length, so
 * short hops stay nearly straight and long ones bow. `curvature: 0` degrades
 * to a straight line (the source's flat LineStrings).
 *
 * Returns '' for a zero-length or non-finite pair — the caller skips it
 * rather than emitting `M NaN NaN`.
 *
 * Named `geoArcPath`, not `arcPath`: `charts/pie-math` already exports an
 * `arcPath` (pie/doughnut segments) and both live under `portal-mojo/charts`.
 */
export function geoArcPath(projection: Projection, from: LatLng, to: LatLng, curvature = 0.22): string {
    if (!isFinitePoint(from) || !isFinitePoint(to)) return '';
    const a = projection.project(from);
    const b = projection.project(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 0.5)) return '';
    const off = len * curvature;
    // Unit normal, always to the LEFT of a→b, so parallel routes fan the
    // same way instead of crossing each other.
    const cxp = (a.x + b.x) / 2 + (-dy / len) * off;
    const cyp = (a.y + b.y) / 2 + (dx / len) * off;
    return `M${a.x.toFixed(2)},${a.y.toFixed(2)} Q${cxp.toFixed(2)},${cyp.toFixed(2)} ${b.x.toFixed(2)},${b.y.toFixed(2)}`;
}

/**
 * Graticule line positions inside `bounds`. Returns the meridians and
 * parallels the fallback basemap draws; `0` (equator / prime meridian) is
 * flagged so the component can stroke it with the stronger token.
 */
export function graticule(bounds: GeoBounds, lngStep = 30, latStep = 15) {
    const meridians: number[] = [];
    const parallels: number[] = [];
    const first = (from: number, step: number) => Math.ceil(from / step) * step;
    for (let lng = first(bounds.west, lngStep); lng <= bounds.east; lng += lngStep) meridians.push(lng);
    for (let lat = first(bounds.south, latStep); lat <= bounds.north; lat += latStep) parallels.push(lat);
    return { meridians, parallels };
}
