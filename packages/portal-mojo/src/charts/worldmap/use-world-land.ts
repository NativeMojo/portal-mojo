import { useEffect, useState } from 'react';
import type { GeoLandCollection } from './worldmap-data';

/**
 * Lazily load the shipped basemap geometry.
 *
 * `world-land.ts` is ~143KB of coordinates (~40KB gzipped). Importing it
 * statically puts it in whatever chunk touches `portal-mojo/charts`, which in
 * this app is the main bundle — so every page would pay for it, including the
 * many with no map on them. The dynamic `import()` here is what actually makes
 * Rollup emit it as its own chunk, fetched only when a map first renders.
 *
 * The module-level cache means the second and later maps in a session get the
 * geometry synchronously on first render, and concurrent mounts share one
 * request rather than racing.
 *
 * Returns `null` until it resolves, which is not a special case: `WorldMap`
 * treats a null `land` as "draw the ocean + graticule fallback", so a map is
 * fully readable — markers, legend, tooltips, status — before the coastlines
 * arrive, and simply gains them a moment later.
 */
let cached: GeoLandCollection | null = null;
let inflight: Promise<GeoLandCollection> | null = null;

export function useWorldLand(enabled = true): GeoLandCollection | null {
    const [land, setLand] = useState<GeoLandCollection | null>(cached);

    useEffect(() => {
        if (!enabled || cached) return;
        let alive = true;
        inflight ??= import('./world-land').then((mod) => {
            cached = mod.WORLD_LAND;
            return cached;
        });
        inflight
            .then((loaded) => { if (alive) setLand(loaded); })
            .catch((err) => {
                // A failed chunk fetch must not blank the map: the fallback is a
                // legitimate rendering, so warn and carry on rather than throw.
                inflight = null;
                console.warn('WorldMap: basemap geometry failed to load; drawing the graticule fallback', err);
            });
        return () => { alive = false; };
    }, [enabled]);

    return enabled ? land : null;
}
