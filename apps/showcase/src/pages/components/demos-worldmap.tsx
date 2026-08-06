// MERGE-WIRE: rail — ComponentsPage.tsx, 'Display' group, after 'charts-pie'
// (plus the import line):
//   import { WorldMapDemo, WorldMapRoutesDemo } from './demos-worldmap';
//   { key: 'worldmap', title: 'WorldMap', icon: 'bi-globe-americas', … }
//   { key: 'worldmap-routes', title: 'WorldMap routes', icon: 'bi-broadcast-pin', … }
// MERGE-WIRE: theme.css — @import "./theme/worldmap.css";
//
// WorldMap demos (board #1426). Every fixture is inline and deterministic:
// WorldMap is presentational and fetches NOTHING — no tiles, no CDN, no
// network of any kind — so these sections run identically offline.
import { useMemo, useState } from 'react';
import {
    COUNTRY_CENTROIDS,
    COUNTRY_OPTIONS,
    DEFAULT_VIEW,
    WorldMap,
    countryName,
    countrySeriesToMarkers,
    loginEventTone,
    scaleMarkerSize,
    type CountryTotal,
    type WorldMapLand,
    type WorldMapMarker,
    type WorldMapRoute,
    type WorldMapView,
} from 'portal-mojo/charts';

// A metrics `data.data` payload in BOTH key shapes found in the wild: bare
// ISO2 codes (MetricsCountryMapView) and namespaced slugs (GeographyPanel).
// `api_calls` and `ZZ` are deliberate rejects; `blocks:country:AQ` is the
// off-bounds case.
const COUNTRY_SERIES: Record<string, number[]> = {
    US: [820, 910, 1040, 990],
    'incident_events:country:DE': [410, 380, 455, 402],
    'firewall:blocks:country:BR': [260, 300, 288, 274],
    IN: [520, 610, 590, 640],
    JP: [180, 210, 196, 205],
    GB: [305, 288, 340, 312],
    AU: [96, 120, 104, 118],
    ZA: [64, 71, 58, 80],
    'bouncer:blocks:country:RU': [140, 160, 152, 171],
    ES: [128, 142, 137, 150],
    api_calls: [9999, 9999],      // not a country → dropped
    ZZ: [500],                    // not a known country → dropped
    NU: [0, 0, 0],                // all-zero → dropped
};

// Individual login events — the "every login" list mode. `{lat: 0, lng: 0}`
// is REAL data (Null Island) and must plot; the NaN row must be skipped with
// a warn, not silently vanish.
interface LoginEvent {
    id: string;
    lat: number;
    lng: number;
    city: string;
    ip: string;
    eventType: string;
}

const LOGIN_EVENTS: LoginEvent[] = [
    { id: 'e1', lat: 38.9, lng: -77.03, city: 'Washington, DC', ip: '198.51.100.14', eventType: 'success_login' },
    { id: 'e2', lat: 37.77, lng: -122.42, city: 'San Francisco, CA', ip: '198.51.100.22', eventType: 'success_login' },
    { id: 'e3', lat: 51.51, lng: -0.13, city: 'London, GB', ip: '203.0.113.7', eventType: 'failed_login' },
    { id: 'e4', lat: 52.52, lng: 13.4, city: 'Berlin, DE', ip: '203.0.113.31', eventType: 'success_login' },
    { id: 'e5', lat: 35.69, lng: 139.69, city: 'Tokyo, JP', ip: '203.0.113.88', eventType: 'suspicious' },
    { id: 'e6', lat: -33.87, lng: 151.21, city: 'Sydney, AU', ip: '192.0.2.44', eventType: 'failed_login' },
    { id: 'e7', lat: 19.08, lng: 72.88, city: 'Mumbai, IN', ip: '192.0.2.90', eventType: 'success_login' },
    { id: 'e8', lat: -23.55, lng: -46.63, city: 'São Paulo, BR', ip: '192.0.2.117', eventType: 'mfa_required' },
    { id: 'e9', lat: 0, lng: 0, city: 'Null Island (0, 0)', ip: '192.0.2.0', eventType: 'unknown_event' },
    { id: 'e10', lat: -77.85, lng: 166.67, city: 'McMurdo, AQ', ip: '192.0.2.201', eventType: 'success_login' },
    { id: 'e11', lat: Number.NaN, lng: 4.9, city: 'Broken GeoIP row', ip: '192.0.2.255', eventType: 'failed_login' },
];

// Region fixtures for the drill-down (country → its regions), mirroring the
// shape /api/account/logins/summary?country_code=..&region=true returns.
const REGIONS: Record<string, { region: string; lat: number; lng: number; count: number }[]> = {
    US: [
        { region: 'Virginia', lat: 37.43, lng: -78.66, count: 512 },
        { region: 'California', lat: 36.78, lng: -119.42, count: 388 },
        { region: 'Texas', lat: 31.97, lng: -99.9, count: 140 },
    ],
    DE: [
        { region: 'Berlin', lat: 52.52, lng: 13.4, count: 210 },
        { region: 'Bavaria', lat: 48.79, lng: 11.5, count: 132 },
        { region: 'Hesse', lat: 50.65, lng: 9.16, count: 60 },
    ],
    IN: [
        { region: 'Maharashtra', lat: 19.75, lng: 75.71, count: 300 },
        { region: 'Karnataka', lat: 15.32, lng: 75.71, count: 190 },
        { region: 'Delhi', lat: 28.7, lng: 77.1, count: 150 },
    ],
};

// A SHAPE FIXTURE, not coastlines. Three crude polygons that prove the `land`
// seam draws and that antimeridian breaking works — real geometry is an open
// decision (see docs/worldmap.md); when it lands it is passed to this exact
// prop with no API change.
const LAND_FIXTURE: WorldMapLand = {
    type: 'FeatureCollection',
    features: [
        {
            type: 'Feature',
            properties: { name: 'fixture: Africa-ish' },
            geometry: {
                type: 'Polygon',
                coordinates: [[[-17, 14], [10, 37], [34, 31], [51, 12], [40, -12], [20, -35], [12, -6], [-6, 5], [-17, 14]]],
            },
        },
        {
            type: 'Feature',
            properties: { name: 'fixture: Australia-ish' },
            geometry: {
                type: 'Polygon',
                coordinates: [[[113, -22], [131, -12], [143, -11], [153, -28], [146, -39], [129, -32], [115, -34], [113, -22]]],
            },
        },
        {
            type: 'Feature',
            properties: { name: 'fixture: antimeridian straddler' },
            geometry: {
                type: 'Polygon',
                coordinates: [[[168, 63], [179, 66], [-179, 65], [-172, 60], [172, 58], [168, 63]]],
            },
        },
    ],
};

const ORIGIN = { lat: 38.958, lng: -77.346, name: 'Reston, VA' };

function EventReadout({ lines }: { lines: string[] }) {
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Interaction log</div>
            {lines.length === 0
                ? <p className="dim">Hover, click and double-click a marker — the typed payload lands here.</p>
                : (
                    <ul style={{ margin: 0, paddingLeft: 18, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>
                        {lines.map((line, i) => <li key={i} className="dim">{line}</li>)}
                    </ul>
                )}
        </div>
    );
}

// ── Markers, legend, drill-down, land seam, empty + off-bounds ────────
export function WorldMapDemo() {
    const [log, setLog] = useState<string[]>([]);
    const [drill, setDrill] = useState<string | null>(null);
    const [view, setView] = useState<WorldMapView>(DEFAULT_VIEW);
    const [showLand, setShowLand] = useState(true);
    const [emptied, setEmptied] = useState(false);

    const push = (line: string) => setLog((prev) => [line, ...prev].slice(0, 6));

    const countryMarkers = useMemo(
        () => countrySeriesToMarkers(COUNTRY_SERIES, { metricLabel: 'events', maxCountries: 12 }),
        [],
    );

    // Drill-down markers: same generic payload contract, region rows instead
    // of country rows — no `_countryCode`/`_isRegion` smuggling.
    const regionMarkers: WorldMapMarker<CountryTotal>[] = useMemo(() => {
        if (!drill) return [];
        const rows = REGIONS[drill] ?? [];
        const max = Math.max(...rows.map((r) => r.count), 0);
        return rows.map((row) => ({
            id: `${drill}-${row.region}`,
            lat: row.lat,
            lng: row.lng,
            size: scaleMarkerSize(row.count, max),
            tone: 'scale' as const,
            intensity: max > 0 ? row.count / max : 0,
            label: row.region,
            value: row.count,
            detail: `${row.count.toLocaleString()} logins · ${countryName(drill)}`,
        }));
    }, [drill]);

    const summaryMarkers = emptied ? [] : (drill ? regionMarkers : countryMarkers);

    // Login events: tone palette + legend buckets, finite-check on the wire row.
    const eventMarkers: WorldMapMarker<LoginEvent>[] = useMemo(
        () => LOGIN_EVENTS.map((ev) => {
            const tone = loginEventTone(ev.eventType);
            return {
                id: ev.id,
                lat: ev.lat,
                lng: ev.lng,
                size: 12,
                tone,
                label: ev.city,
                legendKey: tone === 'ok' ? 'Successful' : tone === 'bad' ? 'Failed' : tone === 'warn' ? 'Suspicious' : 'Other',
                detail: <><code>{ev.ip}</code> · {ev.eventType}</>,
                data: ev,
            };
        }),
        [],
    );

    return (
        <>
            <div className="panel panel-pad">
                <div className="eyebrow">Summary mode · sized markers, `scale` tone, drill-down</div>
                <div className="demo-row" style={{ marginBottom: 10 }}>
                    {drill && (
                        <button className="btn btn-compact" onClick={() => { setDrill(null); setView(DEFAULT_VIEW); }}>
                            <i className="bi bi-arrow-left" /> All countries
                        </button>
                    )}
                    <button className="btn btn-compact" onClick={() => setShowLand((v) => !v)}>
                        <i className="bi bi-map" /> {showLand ? 'Hide' : 'Show'} land fixture
                    </button>
                    <button className="btn btn-compact" onClick={() => setEmptied((v) => !v)}>
                        <i className="bi bi-eraser" /> {emptied ? 'Restore data' : 'Empty state'}
                    </button>
                    <span className="dim">
                        {drill ? `Regions in ${countryName(drill)}` : 'Double-click US, DE or IN to drill down · double-click the ocean to reset the view'}
                    </span>
                </div>
                <WorldMap<CountryTotal>
                    markers={summaryMarkers}
                    land={showLand ? LAND_FIXTURE : null}
                    height={360}
                    view={view}
                    onViewChange={setView}
                    fit={drill ? 'markers' : 'none'}
                    status={drill
                        ? `${regionMarkers.length} region${regionMarkers.length === 1 ? '' : 's'} plotted`
                        : `${summaryMarkers.length} countries · top ${Math.min(12, summaryMarkers.length)}`}
                    onMarkerHover={(m) => { if (m) push(`hover → ${m.label} (${m.value?.toLocaleString()})`); }}
                    onMarkerClick={(m) => push(`click → ${m.id} · data.code=${m.data?.code ?? '—'}`)}
                    onMarkerDoubleClick={(m) => {
                        const code = m.data?.code;
                        push(`dblclick → ${m.id}${code && REGIONS[code] ? ` · drilling into ${code}` : ' · no regions'}`);
                        if (code && REGIONS[code]) setDrill(code);
                    }}
                />
                <p className="dim cmp-blurb" style={{ maxWidth: 'none', marginTop: 10 }}>
                    Markers come from <code>countrySeriesToMarkers</code>, which parses BOTH metrics
                    key shapes — bare <code>US</code> and namespaced
                    <code> incident_events:country:DE</code> — and drops <code>api_calls</code>,
                    <code> ZZ</code> and the all-zero <code>NU</code> series. Sizes are the source's
                    <code> 18 + intensity × 24</code>; the colour is the <code>scale</code> tone,
                    a token <code>color-mix</code> replacing web-mojo's hardcoded teal→amber rgba.
                    The land polygons are a <b>shape fixture, not coastlines</b> — no geometry is
                    bundled; the third polygon straddles the antimeridian to prove the path breaks
                    instead of smearing.
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">List mode · login tone palette, legend toggles, off-bounds counter</div>
                <WorldMap<LoginEvent>
                    markers={eventMarkers}
                    height={340}
                    defaultView={DEFAULT_VIEW}
                    status={`${LOGIN_EVENTS.length} events in the feed`}
                    onMarkerClick={(m) => push(`click → ${m.data?.city} (${m.data?.eventType})`)}
                    renderTooltip={(m) => (
                        <>
                            <div className="chart-tip-head">{m.label}</div>
                            <div className="worldmap-tip-detail">{m.detail}</div>
                        </>
                    )}
                />
                <p className="dim cmp-blurb" style={{ maxWidth: 'none', marginTop: 10 }}>
                    Legend keys toggle whole buckets; turn them all off and the plot empties but the
                    legend stays live (never a dead end). Two rows are deliberately awkward:
                    <b> Null Island (0, 0)</b> is real data and PLOTS — web-mojo's
                    <code> if (!lng || !lat) return</code> dropped it — while the NaN row is skipped
                    with one aggregated <code>console.warn</code>. <b>McMurdo (lat −77.85)</b> sits
                    below the default <code>south: −58</code> crop, so it is counted in the footer
                    rather than clamped to the edge, which would lie about where it happened.
                </p>
            </div>

            <EventReadout lines={log} />
        </>
    );
}

// ── Routes, animation opt-out, interactive on/off ─────────────────────
export function WorldMapRoutesDemo() {
    const [animate, setAnimate] = useState(true);

    const countryMarkers = useMemo(
        () => countrySeriesToMarkers(COUNTRY_SERIES, { metricLabel: 'events' }),
        [],
    );

    const markers: WorldMapMarker<CountryTotal>[] = useMemo(() => [
        ...countryMarkers,
        {
            id: 'origin',
            lat: ORIGIN.lat,
            lng: ORIGIN.lng,
            size: 26,
            tone: 'accent' as const,
            icon: 'bi bi-broadcast-pin',
            label: ORIGIN.name,
            detail: 'Operations hub · route origin',
        },
    ], [countryMarkers]);

    const routes: WorldMapRoute[] = useMemo(
        () => countryMarkers.map((m) => ({
            id: `route-${m.id}`,
            from: ORIGIN,
            to: { lat: m.lat, lng: m.lng },
            intensity: m.intensity ?? 0,
            tone: 'scale' as const,
        })),
        [countryMarkers],
    );

    return (
        <>
            <div className="panel panel-pad">
                <div className="eyebrow">Routes · origin → country arcs</div>
                <div className="demo-row" style={{ marginBottom: 10 }}>
                    <button className="btn btn-compact" onClick={() => setAnimate((v) => !v)}>
                        <i className="bi bi-play-circle" /> Animation: {animate ? 'on' : 'off'}
                    </button>
                    <span className="dim">
                        Reston, VA → the top countries. Width 1.75→6, opacity 0.45→0.95 on intensity
                        (source paint ramps, verbatim). Reston→Tokyo crosses the antimeridian and
                        splits into two segments instead of running backwards across the map.
                    </span>
                </div>
                <WorldMap<CountryTotal>
                    markers={markers}
                    routes={routes}
                    animateRoutes={animate}
                    height={380}
                    status="Wheel to zoom toward the cursor · drag to pan · double-click the ocean to reset"
                />
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">interactive on vs off</div>
                <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                        <div className="dim" style={{ marginBottom: 6 }}>interactive (grab cursor, wheel zoom, drag pan)</div>
                        <WorldMap markers={markers} routes={routes} height={240} animateRoutes={false} />
                    </div>
                    <div>
                        <div className="dim" style={{ marginBottom: 6 }}>interactive={'{false}'} — inert canvas, markers still hoverable</div>
                        <WorldMap markers={markers} routes={routes} height={240} interactive={false} animateRoutes={false} />
                    </div>
                </div>
                <p className="dim cmp-blurb" style={{ maxWidth: 'none', marginTop: 10 }}>
                    The right-hand map ignores wheel and drag entirely (no <code>preventDefault</code>
                    on the page scroll either), which is what web-mojo's <code>interactive: false</code>
                    meant. Both maps still answer hover, click and double-click on markers.
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">COUNTRY_OPTIONS · the geofence picker's source</div>
                <p className="dim cmp-blurb" style={{ maxWidth: 'none' }}>
                    {COUNTRY_OPTIONS.length} options, <code>localeCompare</code>-sorted, derived from
                    the same {Object.keys(COUNTRY_CENTROIDS).length}-row centroid table the map plots
                    against. <code>ES</code> is <b>{countryName('ES')}</b> here — in web-mojo the
                    duplicate ISO2 rows made it resolve to “Canarias”, so its geofence picker listed
                    a Spanish island group where Spain should have been.
                </p>
                <div className="demo-row">
                    <select className="input input-compact" defaultValue="ES" aria-label="Country">
                        {COUNTRY_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label} ({opt.value})</option>
                        ))}
                    </select>
                </div>
            </div>
        </>
    );
}
