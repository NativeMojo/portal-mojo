import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

/** Collect console.warn output so fallback-with-warn can be asserted. */
function captureWarnings(fn) {
    const original = console.warn;
    const seen = [];
    console.warn = (...args) => { seen.push(args.map(String).join(' ')); };
    try { return { result: fn(), warnings: seen }; } finally { console.warn = original; }
}

try {
    const geo = await server.ssrLoadModule('/packages/portal-mojo/src/charts/worldmap/geo.ts');
    const centroids = await server.ssrLoadModule('/packages/portal-mojo/src/charts/worldmap/countryCentroids.ts');
    const data = await server.ssrLoadModule('/packages/portal-mojo/src/charts/worldmap/worldmap-data.ts');

    // ── Projection ────────────────────────────────────────────────────
    // 720x284 matches DEFAULT_BOUNDS' 360x142 aspect exactly, so at zoom 1
    // the crop corners land on the viewport corners with no letterboxing.
    const projection = geo.equirectangular({ width: 720, height: 284, bounds: geo.DEFAULT_BOUNDS, view: geo.DEFAULT_VIEW });
    assert.equal(projection.scale, 2, 'zoom 1 fits the bounds box');
    const nw = projection.project({ lat: geo.DEFAULT_BOUNDS.north, lng: geo.DEFAULT_BOUNDS.west });
    const se = projection.project({ lat: geo.DEFAULT_BOUNDS.south, lng: geo.DEFAULT_BOUNDS.east });
    assert.deepEqual(nw, { x: 0, y: 0 }, 'north-west corner maps to the viewport origin');
    assert.deepEqual(se, { x: 720, y: 284 }, 'south-east corner maps to the viewport corner');

    for (const point of [{ lat: 0, lng: 0 }, { lat: 51.51, lng: -0.13 }, { lat: -33.87, lng: 151.21 }, { lat: 38.82, lng: -96.33 }]) {
        const back = projection.invert(projection.project(point));
        assert(Math.abs(back.lat - point.lat) < 1e-9 && Math.abs(back.lng - point.lng) < 1e-9, `project∘invert round-trips ${JSON.stringify(point)}`);
    }

    // 0,0 is DATA, not "missing" — the source's truthiness check dropped it.
    assert.equal(geo.isFinitePoint({ lat: 0, lng: 0 }), true);
    assert.equal(geo.isFinitePoint({ lat: Number.NaN, lng: 4.9 }), false);
    assert.equal(geo.isFinitePoint(null), false);
    assert.equal(projection.contains({ lat: 0, lng: 0 }), true);
    assert.equal(projection.contains({ lat: -77.85, lng: 166.67 }), false, 'Antarctica is outside the default crop');

    // ── Zoom / pan clamping ───────────────────────────────────────────
    const size = { width: 720, height: 284 };
    assert.equal(geo.clampView({ lat: 0, lng: 0, zoom: 99 }, geo.DEFAULT_BOUNDS, size).zoom, geo.MAX_ZOOM);
    assert.equal(geo.clampView({ lat: 0, lng: 0, zoom: 0.1 }, geo.DEFAULT_BOUNDS, size).zoom, geo.MIN_ZOOM);
    const panned = geo.clampView({ lat: 89, lng: 400, zoom: 4 }, geo.DEFAULT_BOUNDS, size);
    assert(panned.lat < geo.DEFAULT_BOUNDS.north && panned.lat > geo.DEFAULT_BOUNDS.south, 'pan cannot leave the crop vertically');
    assert(panned.lng <= geo.DEFAULT_BOUNDS.east && panned.lng >= geo.DEFAULT_BOUNDS.west, 'pan cannot leave the crop horizontally');
    // At zoom 1 the whole crop is visible, so the view is pinned to its center.
    assert.deepEqual(geo.clampView({ lat: 70, lng: 150, zoom: 1 }, geo.DEFAULT_BOUNDS, size), { lat: 13, lng: 0, zoom: 1 });

    // ── fitViewToPoints (the fitBounds replacement) ───────────────────
    const fitPoints = [
        { lat: 37.43, lng: -78.66 },
        { lat: 36.78, lng: -119.42 },
        { lat: 31.97, lng: -99.9 },
    ];
    const fitted = geo.fitViewToPoints(fitPoints, { size, bounds: geo.DEFAULT_BOUNDS });
    const fittedProjection = geo.equirectangular({ width: size.width, height: size.height, bounds: geo.DEFAULT_BOUNDS, view: fitted });
    for (const point of fitPoints) {
        assert(fittedProjection.contains(point), `fitViewToPoints keeps ${JSON.stringify(point)} in frame`);
    }
    assert(fitted.zoom > 1, 'fitting three US states zooms in');
    // No points → the fallback, untouched. One point → recenter, KEEP the zoom.
    const fallback = { lat: 5, lng: 6, zoom: 3 };
    assert.deepEqual(geo.fitViewToPoints([], { size, fallback }), fallback);
    const single = geo.fitViewToPoints([{ lat: 20, lng: 30 }], { size, fallback });
    assert.equal(single.zoom, 3, 'a single point never divides by zero — the zoom is kept');
    assert(Math.abs(single.lat - 20) < 1e-6 && Math.abs(single.lng - 30) < 1e-6, 'a single point recenters');
    // A point near the crop edge still fits — the clamp keeps the frame full
    // rather than centering exactly and revealing dead space past ±180°.
    const edge = geo.fitViewToPoints([{ lat: 35.69, lng: 139.69 }], { size, fallback });
    assert(geo.equirectangular({ width: size.width, height: size.height, bounds: geo.DEFAULT_BOUNDS, view: edge }).contains({ lat: 35.69, lng: 139.69 }));
    // Non-finite rows are filtered, not propagated as NaN.
    const withJunk = geo.fitViewToPoints([{ lat: Number.NaN, lng: 1 }, ...fitPoints], { size, fallback });
    assert(Number.isFinite(withJunk.lat) && Number.isFinite(withJunk.lng) && Number.isFinite(withJunk.zoom));

    // ── Antimeridian ──────────────────────────────────────────────────
    const split = geo.splitAntimeridian({ lat: 10, lng: 170 }, { lat: 30, lng: -170 });
    assert.equal(split.length, 2, '170° → −170° splits');
    assert.equal(split[0][1].lng, 180);
    assert.equal(split[1][0].lng, -180);
    assert.equal(split[0][1].lat, 20, 'latitude is interpolated at the crossing');
    assert.equal(split[1][0].lat, 20);
    const splitBack = geo.splitAntimeridian({ lat: 10, lng: -170 }, { lat: 30, lng: 170 });
    assert.equal(splitBack.length, 2);
    assert.equal(splitBack[0][1].lng, -180);
    assert.equal(geo.splitAntimeridian({ lat: 0, lng: -10 }, { lat: 0, lng: 10 }).length, 1, 'a short hop is one segment');
    assert.equal(geo.splitAntimeridian({ lat: 0, lng: -90 }, { lat: 0, lng: 90 }).length, 1, 'exactly 180° does not split');
    assert.deepEqual(geo.splitAntimeridian({ lat: Number.NaN, lng: 0 }, { lat: 0, lng: 0 }), []);

    // ── Arcs ──────────────────────────────────────────────────────────
    const arc = geo.geoArcPath(projection, { lat: 38.958, lng: -77.346 }, { lat: 51.51, lng: -0.13 });
    assert.match(arc, /^M[-\d.]+,[-\d.]+ Q[-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+$/, 'a quadratic bezier, never NaN');
    assert.equal(geo.geoArcPath(projection, { lat: 10, lng: 10 }, { lat: 10, lng: 10 }), '', 'zero-length arcs are skipped');
    assert.equal(geo.geoArcPath(projection, { lat: Number.NaN, lng: 10 }, { lat: 10, lng: 10 }), '');

    // ── Graticule ─────────────────────────────────────────────────────
    const grat = geo.graticule(geo.DEFAULT_BOUNDS);
    assert(grat.meridians.includes(0) && grat.parallels.includes(0), 'equator and prime meridian are drawn');
    assert(grat.meridians.every((lng) => lng >= -180 && lng <= 180));
    assert(grat.parallels.every((lat) => lat >= geo.DEFAULT_BOUNDS.south && lat <= geo.DEFAULT_BOUNDS.north));

    // ── Centroid table ────────────────────────────────────────────────
    const codes = Object.keys(centroids.COUNTRY_CENTROIDS);
    assert.equal(codes.length, 244, 'the 249 source rows dedupe to 244 ISO2 keys');
    assert.equal(new Set(codes).size, 244);
    for (const [code, row] of Object.entries(centroids.COUNTRY_CENTROIDS)) {
        assert.match(code, /^[A-Z]{2}$/, `${code} is an ISO2 key`);
        assert(typeof row.name === 'string' && row.name.length > 0, `${code} has a name`);
        assert(Number.isFinite(row.lat) && row.lat >= -90 && row.lat <= 90, `${code} latitude in range`);
        assert(Number.isFinite(row.lng) && row.lng >= -180 && row.lng <= 180, `${code} longitude in range`);
    }
    // The bug the dedupe fixes: last-write-wins made ES resolve to Canarias.
    assert.equal(centroids.COUNTRY_CENTROIDS.ES.name, 'Spain');
    assert.equal(centroids.COUNTRY_CENTROIDS.ES.lat, 40.365008336683836);
    assert.equal(centroids.COUNTRY_CENTROIDS.BQ.name, 'Bonaire');
    assert.equal(centroids.COUNTRY_CENTROIDS.TF.name, 'French Southern Territories');
    assert.equal(centroids.COUNTRY_CENTROIDS.US.lat, 38.8208089190304, 'values are verbatim from source');

    assert.equal(centroids.countryName('es'), 'Spain');
    assert.equal(centroids.countryName('zz'), 'ZZ', 'unknown codes pass through uppercased, never blank');
    assert.equal(centroids.countryName(''), '');
    assert.equal(centroids.countryName(null), '');
    assert.equal(centroids.getCountryCentroid('us').name, 'United States');
    assert.equal(centroids.getCountryCentroid('zz'), null);
    assert.equal(centroids.getCountryCentroid(undefined), null);

    assert.equal(centroids.COUNTRY_OPTIONS.length, 244);
    const labels = centroids.COUNTRY_OPTIONS.map((o) => o.label);
    assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)), 'COUNTRY_OPTIONS is localeCompare-sorted');
    assert(centroids.COUNTRY_OPTIONS.some((o) => o.value === 'ES' && o.label === 'Spain'));
    assert(!centroids.COUNTRY_OPTIONS.some((o) => o.label === 'Canarias'));

    // ── Slug parsing (both metrics key shapes) ────────────────────────
    assert.equal(data.countryCodeFromSlug('US'), 'US');
    assert.equal(data.countryCodeFromSlug('us'), 'US');
    assert.equal(data.countryCodeFromSlug('incident_events:country:US'), 'US');
    assert.equal(data.countryCodeFromSlug('firewall:blocks:country:US'), 'US');
    assert.equal(data.countryCodeFromSlug('bouncer:blocks:country:de'), 'DE');
    assert.equal(data.countryCodeFromSlug('api_calls'), null);
    assert.equal(data.countryCodeFromSlug('ZZ'), null);
    assert.equal(data.countryCodeFromSlug(''), null);
    assert.equal(data.countryCodeFromSlug(null), null);
    assert.equal(data.countryCodeFromSlug('country:'), null);

    // ── Marker sizing ─────────────────────────────────────────────────
    assert.equal(data.scaleMarkerSize(0, 10), 18, 'the range floor');
    assert.equal(data.scaleMarkerSize(10, 10), 42, 'the range ceiling');
    assert.equal(data.scaleMarkerSize(5, 10), 30, 'web-mojo parity: 18 + intensity * 24');
    assert.equal(data.scaleMarkerSize(5, 0), 18, 'a zero max returns the floor, not NaN');
    assert.equal(data.scaleMarkerSize(Number.NaN, 10), 18);
    assert.equal(data.scaleMarkerSize(10, 10, [18, 44]), 44, 'LoginLocationMapView used 18 + i * 26');
    assert.equal(data.scaleMarkerSize(25, 100, [0, 100], 'sqrt'), 50);

    // ── countrySeriesToMarkers ────────────────────────────────────────
    const markers = data.countrySeriesToMarkers({
        US: [10, 10],
        'incident_events:country:DE': [5],
        JP: 3,
        api_calls: [9999],
        ZZ: [500],
        NU: [0, 0],
    });
    assert.deepEqual(markers.map((m) => m.id), ['US', 'DE', 'JP'], 'sorted descending, unknown + all-zero dropped');
    assert.equal(markers[0].value, 20);
    assert.equal(markers[0].label, 'United States');
    assert.equal(markers[0].size, 42, 'the top country gets the max size');
    assert.equal(markers[0].tone, 'scale');
    assert.equal(markers[0].intensity, 1);
    assert.equal(markers[1].data.code, 'DE', 'the typed payload rides on `data`, not underscore fields');
    assert.equal(markers[2].data.total, 3);
    assert(markers.every((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng)));
    assert.equal(data.countrySeriesToMarkers({ US: [1], DE: [2], JP: [3] }, { maxCountries: 2 }).length, 2);
    assert.deepEqual(data.countrySeriesToMarkers({}), []);
    assert.deepEqual(data.countrySeriesToMarkers({ api_calls: [5] }), []);

    // ── Tones ─────────────────────────────────────────────────────────
    assert.equal(data.toneColor('ok'), 'var(--ok)');
    assert.equal(data.toneColor('bad'), 'var(--bad)');
    assert.match(data.toneColor('scale', 0), /var\(--ok\) 100%/, 'intensity 0 is all --ok');
    assert.match(data.toneColor('scale', 1), /var\(--ok\) 0%/, 'intensity 1 is all --warn');
    assert(data.toneColor('scale', 0.5).includes('color-mix'), 'the value ramp is token-only, no hexes');
    assert(!JSON.stringify(data.MAP_TONES).includes('#'), 'no hardcoded colors in the tone table');
    const unknownTone = captureWarnings(() => data.toneColor('chartreuse', 0));
    assert.equal(unknownTone.result, 'var(--accent)', 'unknown tones fall back to accent');
    assert.equal(unknownTone.warnings.length, 1, '…WITH a console.warn, never silently');
    assert.match(unknownTone.warnings[0], /unknown tone/);

    assert.equal(data.loginEventTone('success_login'), 'ok');
    assert.equal(data.loginEventTone('FAILED_LOGIN'), 'bad');
    assert.equal(data.loginEventTone('mfa_required'), 'warn');
    assert.equal(data.loginEventTone('something_else'), 'mute');
    assert.equal(data.loginEventTone(null), 'mute');

    // ── Land seam (no geometry is bundled; the prop is the contract) ──
    assert.deepEqual(data.landRings(null), []);
    const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    assert.equal(data.landRings(polygon).length, 1);
    assert.equal(data.landRings({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: polygon }] }).length, 1);
    assert.equal(data.landRings([{ type: 'Feature', geometry: polygon }]).length, 1);
    assert.equal(data.landRings({ type: 'MultiPolygon', coordinates: [polygon.coordinates, polygon.coordinates] }).length, 2);
    const badGeometry = captureWarnings(() => data.landRings({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }, { type: 'Feature', geometry: polygon }],
    }));
    assert.equal(badGeometry.result.length, 1, 'unsupported geometry is skipped, the rest still draw');
    assert.match(badGeometry.warnings[0], /skipped 1 land feature/);

    // ── Source invariants that must not regress ───────────────────────
    const [component, geoSource, themePortal, themeShowcase] = await Promise.all([
        readFile(new URL('../packages/portal-mojo/src/charts/worldmap/WorldMap.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../packages/portal-mojo/src/charts/worldmap/geo.ts', import.meta.url), 'utf8'),
        readFile(new URL('../apps/portal/src/theme/worldmap.css', import.meta.url), 'utf8'),
        readFile(new URL('../apps/showcase/src/theme/worldmap.css', import.meta.url), 'utf8'),
    ]);
    // Comments are stripped first: the header comments name the CDN and tile
    // server precisely to record why this is a rebuild, and that provenance
    // must not be what trips the "no network" assertion.
    const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const code = stripComments(`${component}\n${geoSource}`);
    assert.doesNotMatch(code, /dangerouslySetInnerHTML|innerHTML/, 'tooltips are ReactNode slots, never HTML strings');
    assert.doesNotMatch(code, /https?:\/\//, 'WorldMap is presentational: no CDN, no tile server, no network');
    assert.doesNotMatch(code, /maplibre|leaflet|demotiles/i, 'no map library and no demo tile server');
    assert.doesNotMatch(code, /fetch\(|useQuery|mojoCall/, 'consumers own the queries — the map fetches nothing');
    assert.doesNotMatch(component, /#[0-9a-fA-F]{6}\b/, 'colors are tokens, so a theme flip needs no re-render');
    assert.match(component, /prefers-reduced-motion|animateRoutes/, 'route animation is opt-out');
    assert.equal(themePortal, themeShowcase, 'the two theme dirs keep worldmap.css byte-identical');
    assert.doesNotMatch(stripComments(themePortal), /#[0-9a-fA-F]{3,6}\b/, 'the stylesheet is tokens-only');

    console.log('worldmap projection/centroid/binding contract verified');
} finally {
    await server.close();
}
