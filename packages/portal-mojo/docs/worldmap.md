# WorldMap — dependency-free geo map

```ts
import {
    WorldMap,
    // country data
    COUNTRY_CENTROIDS, COUNTRY_OPTIONS, getCountryCentroid, countryName,
    // binding helpers
    countrySeriesToMarkers, countryCodeFromSlug, scaleMarkerSize,
    toneColor, loginEventTone, landRings, MAP_TONES, LOGIN_EVENT_TONES,
    // projection math
    equirectangular, fitViewToPoints, clampView, splitAntimeridian,
    geoArcPath, graticule, isFinitePoint,
    DEFAULT_BOUNDS, DEFAULT_VIEW, MIN_ZOOM, MAX_ZOOM,
} from 'portal-mojo/charts';
```

One map for every "where in the world did this happen" surface: login
locations (#1291), geofence policy (#1287), the dashboard geography panel
(#1292). Demos: Develop → Components → Display → **WorldMap** and **WorldMap
routes**.

## Why this is a REBUILD, not a port

web-mojo drew all of its maps through `src/extensions/map/MapLibreView.js`,
which injects `https://unpkg.com/maplibre-gl@4.7.1` as a runtime `<script>`
(maplibre is not in its `package.json` at all) and takes basemap tiles and
glyphs from `demotiles.maplibre.org` — MapLibre's explicitly-demo server.
Porting that verbatim would make every admin deployment fetch a third-party
CDN and a demo tile server at page load, which is unacceptable for the
IP-restricted / separate-origin admin deployments independently of the
no-library rule. The rebuild covers exactly the MapLibre surface the
consumers used and nothing more.

## Invariants

1. **Presentational only.** `WorldMap` fetches NOTHING — no tiles, no CDN, no
   `fetch`, no `useQuery`. Consumers own their TanStack queries and pass
   `markers` / `routes` / `status` / `loading`. `verify-worldmap.mjs` asserts
   the absence of every network affordance in the source.
2. **Tokens, never hexes.** Every color is a `var(--…)` string resolved by
   the browser, so a theme flip needs no re-render.
3. **ReactNode tooltips, never HTML strings.** No `dangerouslySetInnerHTML`.
   Both web-mojo consumers concatenated popup HTML out of unescaped server
   values (`entry.region`, `ev.ip_address`, `ev.user.display_name`);
   `label` + `detail?: ReactNode` + `renderTooltip` replace that.
4. **Coordinate validity is `Number.isFinite`.** `{lat: 0, lng: 0}` is real
   data and plots. The source's `if (!lng || !lat) return`
   (`MapLibreView.js:223`) dropped the equator and the prime meridian.
5. **Off-bounds points are skipped and COUNTED**, surfaced in the footer as
   "N points outside the map view". Clamping to the frame edge would lie
   about where the event happened; dropping them silently is the
   silent-failure anti-pattern on the do-not-recreate list.
6. **Unknown values fall back WITH a `console.warn`** — an unknown tone
   becomes `accent`, an unsupported land geometry is skipped, non-array
   `markers`/`routes` render the empty state.

## `<WorldMap>`

```tsx
<WorldMap<CountryTotal>
    markers={markers}                  // WorldMapMarker<T>[] — full replace
    routes={routes}                    // WorldMapRoute[]
    land={null}                        // injectable geometry; see below
    height={320}
    bounds={DEFAULT_BOUNDS}
    view={view} onViewChange={setView} // controlled…
    defaultView={DEFAULT_VIEW}         // …or uncontrolled
    fit="none"                         // 'none' | 'markers'
    interactive                        // wheel zoom + drag pan
    showGraticule showLegend showTooltip
    legend={[{ key: 'Failed', label: 'Failed', tone: 'bad' }]}
    renderTooltip={(m) => <>…</>}
    onMarkerHover={(m) => …} onMarkerClick={(m) => …} onMarkerDoubleClick={(m) => …}
    animateRoutes viewTransition={600}
    loading={query.isPending}
    status={`${n} logins plotted`}
    emptyText="No locations to plot"
/>
```

| prop | type | default | notes |
|---|---|---|---|
| `markers` | `readonly WorldMapMarker<T>[]` | `[]` | Full replace, like `updateMarkers` |
| `routes` | `readonly WorldMapRoute[]` | `[]` | Origin→destination arcs |
| `land` | `WorldMapLand \| null` | `null` | Basemap geometry — nothing is bundled |
| `height` | `number` | `320` | Width is measured (ResizeObserver) |
| `bounds` | `GeoBounds` | `{west:-180,east:180,south:-58,north:84}` | The geographic crop |
| `view` / `defaultView` | `WorldMapView` | `DEFAULT_VIEW` | Controlled vs uncontrolled |
| `onViewChange` | `(view) => void` | — | Fires for gestures, `fit`, and resets |
| `fit` | `'none' \| 'markers'` | `'none'` | `'none'` = the source's `autoFitBounds: false` |
| `interactive` | `boolean` | `true` | Wheel zoom + drag pan; markers stay live either way |
| `showGraticule` / `showLegend` / `showTooltip` | `boolean` | `true` | |
| `legend` | `readonly WorldMapLegendItem[]` | derived | Falls back to the markers' `legendKey`s |
| `renderTooltip` | `(m) => ReactNode` | — | Replaces the whole tooltip body |
| `onMarkerHover/Click/DoubleClick` | `(m) => void` | — | See the click-deferral note |
| `animateRoutes` | `boolean` | `true` | `prefers-reduced-motion` still wins |
| `viewTransition` | `number` | `600` | ms; the `flyTo({duration: 600})` equivalent |
| `loading` / `status` / `emptyText` / `className` | | | `status` is the source's `setStatus()` |

### `WorldMapMarker<T>`

`{ id?, lat, lng, size?, tone?, intensity?, icon?, label?, value?, detail?,
legendKey?, data? }`

`data` is the typed payload every handler receives — the reason drill-down
does not need the `_countryCode` / `_isRegion` underscore fields web-mojo
smuggled through the marker object. `icon` is a bootstrap-icons class drawn
inside the dot (it rides an HTML overlay layer; an icon class cannot be put
into SVG `<text>` without knowing its codepoint).

### `WorldMapRoute`

`{ id?, from, to, intensity?, tone?, label?, legendKey? }`

Paint follows the source ramps verbatim (`MetricsCountryMapView.js:232-260`):
width `1.75 → 6`, opacity `0.45 → 0.95`, color teal→amber — now
`toneColor('scale', intensity)`.

### Tones

| tone | token | used for |
|---|---|---|
| `ok` | `--ok` | successful logins |
| `bad` | `--bad` | failed logins |
| `warn` | `--warn` | suspicious / MFA-required |
| `info` | `--info` | informational |
| `accent` | `--accent` | route origin, default |
| `mute` | `--mute` | unknown event types |
| `scale` | `color-mix(--ok → --warn)` | the value ramp |

`loginEventTone(eventType)` maps the login event vocabulary
(`LOGIN_EVENT_TONES`, from `LoginLocationMapView.js:31-41`); unknown types
land on `mute` — deliberately without a warn, since "some other event type"
is normal data.

## Projection contract

`equirectangular({width, height, bounds, view})` → `{project, invert, scale,
contains, size, bounds, view}`.

- **Equirectangular (plate carrée)**: `lat`/`lng` map linearly to `y`/`x`, so
  `invert` is exact — that is what makes a graticule-only map honest.
- **`zoom` is a fit multiple, not a tile level.** At `zoom: 1` the whole
  `bounds` box fits the frame; the scale is `min(width/spanLng,
  height/spanLat)` in BOTH axes, so a mismatched container letterboxes rather
  than stretching. Non-uniform fitting would turn markers into ellipses.
  Range: `MIN_ZOOM` 1 … `MAX_ZOOM` 12.
- **`invert`** exists for zoom-toward-the-cursor and for any consumer that
  needs "what is under this pixel".
- **`DEFAULT_BOUNDS`** crops to `south: -58, north: 84` — the framing web-mojo
  approximated with `center [10, 20], zoom 1.3`. Antarctica (lat −77) is
  outside it on purpose; widen `bounds` if a consumer needs it.
- `fitViewToPoints(points, {size, bounds, padding = 50, maxZoom, fallback})`
  replaces `fitBounds()`. Zero points returns `fallback`; ONE point recenters
  but KEEPS the current zoom (a single-point bbox has zero span).
- `clampView(view, bounds, size)` clamps zoom and pans so the map can never
  leave the frame.
- `splitAntimeridian(from, to)` returns 2 segments when the short path wraps
  past ±180°, 1 otherwise — without it a Reston→Tokyo arc runs backwards
  across the entire map.
- `geoArcPath(projection, from, to, curvature = 0.22)` is a quadratic bezier
  whose control point is perpendicular to the chord. **Named `geoArcPath`,
  not `arcPath`,** because `charts/pie-math` already exports `arcPath`.

## `countrySeriesToMarkers` and the two metrics key shapes

```ts
const markers = countrySeriesToMarkers(response.data, {
    maxCountries: 12, tone: 'scale', metricLabel: 'events',
});
```

Two key shapes exist in the wild and ONE rule covers both — uppercase the
last `:`-separated segment, accept it only if it is 2 characters AND a known
country:

| shape | source | example |
|---|---|---|
| bare ISO2 | `MetricsCountryMapView.js:107-118` | `US` |
| namespaced slug | `GeographyPanel.js:232-243` | `incident_events:country:US`, `firewall:blocks:country:US`, `bouncer:blocks:country:US` |

`api_calls` and `ZZ` therefore both return `null`, and rows summing to zero
are dropped. Results are sorted descending, cut to `maxCountries`, joined to
`COUNTRY_CENTROIDS`, and sized by `scaleMarkerSize` (default range
`[18, 42]` = the source's `18 + intensity × 24`; `LoginLocationMapView` used
`× 26`, i.e. `[18, 44]`).

## The `land` seam — an OPEN DECISION

Country outlines need geometry **neither repo has**, and which one to adopt
is the repo owner's call, not an agent's:

1. embed public-domain Natural Earth 110m as a one-time data asset
   (~50-100 KB, no runtime dependency), or
2. sanction a maplibre peer-dep for real tiles the way `zod` was sanctioned.

Until then the component ships the ocean/graticule fallback and takes
geometry through the `land` prop, so **either choice drops in without an API
change**: option 1 is a new module handed to this existing prop; option 2 is
a separate tile component reusing this projection and marker model. A future
agent adding geometry should touch `land` only.

`land` accepts a `FeatureCollection`, a bare feature array, or a single
`Polygon`/`MultiPolygon`. Unsupported geometry types are skipped with a
`console.warn` and the rest still draw (`landRings` is the exported
normalizer). A ring whose consecutive vertices jump more than 180° of
longitude BREAKS into a new subpath instead of smearing a band across the
map.

## Pitfalls

- **Double-click is drill-down, so canvas double-click does NOT zoom.** With
  both `onMarkerClick` and `onMarkerDoubleClick` wired, a single click is
  deferred `250ms` and cancelled by a double-click (in MapLibre the marker
  handler `stopPropagation`'d against `doubleClickZoom`). Double-clicking the
  canvas resets to `defaultView`.
- **Off-bounds markers do not render.** Check the footer count before
  concluding the data is missing; widen `bounds` to bring them in.
- **The centroid keys were deduped.** The source table has 249 rows but 244
  distinct ISO2 keys (`BQ`×3, `ES`×2, `TF`×3), and JS last-write-wins made
  **`ES` resolve to "Canarias" rather than Spain** — so web-mojo's geofence
  picker listed a Spanish island group where Spain belonged, and Spanish
  metrics plotted in the Canaries. Duplicate keys are also a hard TS error
  (TS1117). Here the primary territory keeps the key (`BQ`→Bonaire,
  `ES`→Spain, `TF`→French Southern Territories) and the 5 dropped rows are
  recorded with their coordinates in the module header.
- **`LoginLocationMapView`'s docstring says `size=500`; the code sends
  `size: 1000`** (`:208`). Consumers should follow the code.
- **`map.resize()` has no equivalent** — `ResizeObserver` covers the
  tab-activation and drawer-opening cases that forced it. A container at
  width 0 defers rendering until the first non-zero measurement.
- **`pitch` / `bearing` are dropped.** Cosmetic 3D tilt with no consumer
  semantics; a fake-perspective SVG map would be dishonest.
- **Route animation is an ADDITION.** web-mojo's routes were static
  LineStrings; only color/width/opacity interpolated on intensity. It is
  therefore opt-out (`animateRoutes={false}`) and lives inside
  `@media (prefers-reduced-motion: no-preference)`.
- **`fit="markers"` pushes through the same channel as a gesture** — it sets
  internal state when uncontrolled and calls `onViewChange` when controlled.
  A controlled consumer must write that value back for the fit to stick.

## Verification

```bash
node scripts/verify-worldmap.mjs   # or: npm run verify:worldmap
```

Headless assertions over the projection (corner mapping, `project`∘`invert`
round-trip, clamping, fitting, antimeridian splitting), the centroid table
(244 unique keys, coordinate ranges, `ES` = Spain), the binding helpers
(slug parsing, sizing, sorting/top-N/drops), tone fallbacks and their warns,
the land normalizer, and the source invariants above (no network, no map
library, no HTML-string tooltips, tokens-only CSS, and the two theme copies
staying byte-identical).
