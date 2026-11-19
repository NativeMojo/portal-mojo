import type { FeatureCollection, Point } from 'geojson';
import type { MapMarker } from './types';

/** IDs are stable keys, (0, 0) is valid, missing coordinates are never invented. */
export function validMapMarkers<T>(markers: readonly MapMarker<T>[]): MapMarker<T>[] {
    const seen = new Set<string>();
    return markers.filter((marker) => {
        if (!marker.id || seen.has(marker.id) || !Number.isFinite(marker.longitude) || !Number.isFinite(marker.latitude)
            || Math.abs(marker.longitude) > 180 || Math.abs(marker.latitude) > 85.051129) return false;
        seen.add(marker.id);
        return true;
    });
}

/** Minimal, non-sensitive worker payload; labels and arbitrary data stay in React. */
export function markersToGeoJSON(markers: readonly MapMarker[]): FeatureCollection<Point> {
    return {
        type: 'FeatureCollection',
        features: markers.map((marker) => ({
            type: 'Feature', geometry: { type: 'Point', coordinates: [marker.longitude, marker.latitude] },
            properties: { markerId: marker.id, tone: marker.tone ?? 'info' },
        })),
    };
}

/** Smallest longitude span, including locations straddling the date line. */
export function markerBounds(markers: readonly MapMarker[]): [[number, number], [number, number]] | null {
    if (!markers.length) return null;
    const longitudes = markers.map((marker) => marker.longitude).sort((a, b) => a - b);
    let gap = -1;
    let start = 0;
    for (let i = 0; i < longitudes.length; i++) {
        const next = i + 1 < longitudes.length ? longitudes[i + 1] : longitudes[0] + 360;
        if (next - longitudes[i] > gap) { gap = next - longitudes[i]; start = (i + 1) % longitudes.length; }
    }
    const west = longitudes[start];
    const east = west + 360 - gap;
    return [[west, Math.min(...markers.map((marker) => marker.latitude))], [east, Math.max(...markers.map((marker) => marker.latitude))]];
}
