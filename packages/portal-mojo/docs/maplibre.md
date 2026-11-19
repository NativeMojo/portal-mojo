# MapLibreMap

Opt-in street maps, clustered location pins, safe React popups and incremental marker updates. Existing `WorldMap` remains the dependency-free SVG choice for geographic summaries. Nothing in `portal-mojo/ui`, `/charts` or the Admin Dashboard imports this engine.

## Install and use

```sh
npm install maplibre-gl@^6.19.0
```

Import the module **and its stylesheet** only in map routes (prefer a lazy route):

```tsx
import { MapLibreMap, type MapMarker } from 'portal-mojo/maps';
import 'portal-mojo/maps.css';
// Vite: bundle the MapLibre 6 ES-module worker on your own origin.
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
setWorkerUrl(workerUrl);

const markers: MapMarker<{ lastSeen: string }>[] = [
  { id: 'kiosk-42', label: 'Lobby', longitude: -98.49, latitude: 29.42,
    tone: 'ok', data: { lastSeen: '2 weeks ago' } },
];

<MapLibreMap
  mapStyle={configuredMapStyle}
  markers={markers}
  label="Kiosks"
  renderPopup={(marker) => <div><strong>{marker.label}</strong>
    <p>Last seen {marker.data?.lastSeen}</p></div>}
/>
```

The host supplies `configuredMapStyle`: a MapLibre Style Specification object or URL, including provider attribution. There is intentionally no default remote service, API key, CDN injection or geolocation request. Choose light/dark basemap styles in your host using `useTheme().resolved`; marker/control/popup colors follow the portal's tokens. The Showcase explicitly uses OpenFreeMap styles, with a network-free canvas option for testing.

## Data and selection

- `markers`: immutable keyed records. Pass a new array when data changes; the existing GeoJSON source updates without resetting camera, selection or the map instance. No polling or websocket client is included: use your existing query cache/realtime subscriptions to supply data.
- Each marker has `id`, `longitude`, `latitude`, `label`, optional `tone` (`ok`, `warn`, `bad`, `info`, `muted`) and optional typed `data`. Coordinates must be finite, longitude ±180 and latitude ±85.051129 (Web Mercator). `(0, 0)` is valid. Invalid coordinates and duplicate/empty IDs are excluded; a count is shown. Missing locations are never inferred.
- The worker receives coordinates, opaque IDs and tones only. Labels and metadata stay in React memory. Treat basemap providers as third parties: they receive tile requests that reveal the viewed region. Never attach portal bearer tokens to map requests.
- `selectedId` / `onSelectionChange` support controlled selection, or omit `selectedId` for internal selection. Selecting a location through the keyboard-accessible picker centers it. Pin clicks open a popup. Removed markers close their popup and notify selection removal. The selected marker's popup content updates on the next render, including status changes.
- `renderPopup(marker)` returns React content (not HTML strings). Normal React escaping applies. The component never calls `setHTML`. Use host routes/buttons for actions; map popups do not change permissions.
- `cluster` defaults true. Cluster buttons show their count and zoom in on click/keyboard activation. Counts use HTML, so no font service is required for markers.

## View and layout

`initialView={{ longitude, latitude, zoom }}` sets the constructor camera. `fitOnLoad` defaults true and fits the first nonempty set once. Subsequent updates never auto-fit. A controlled `view` takes precedence over automatic fitting. **Fit all** is the explicit reset action. Disable `fitOnLoad` to preserve your supplied initial camera.

`view` / `onViewChange` optionally control the camera. Keep the controlled value in sync with user movement. `height` defaults 420; use a CSS length or number. `className` styles the outer section. The map resizes with its container using ResizeObserver, including dialogs and narrow layouts. There is no fixed viewport/sidebar assumption.

`loading` shows a short loading message without dropping existing markers. `onError(Error)` reports engine/resource errors. A visible fallback leaves the location picker available; Retry map recreates the engine. Empty data has an explicit state. Unmount removes popups, cluster buttons, controls, observers, workers and the map canvas. React StrictMode remounts are supported.

## Hosting and CSP

MapLibre is an optional peer dependency. Consumers without maps need not install it. Map routes require WebGL2 and MapLibre 6.19+; no server-side map rendering is attempted. Load the route client-side.

MapLibre 6 ships ES-module workers. **Configure the worker before mounting**, as in the Vite example above; dependency prebundling cannot reliably infer the default sibling worker URL. The `?worker&url` import bundles its shared module as well. Other bundlers need their equivalent worker entry. Verify the production build, not just Vite dev. A strict CSP must permit your style, sprite, glyph and tile origins in `connect-src`/`img-src`, plus the emitted worker origin in `worker-src`. Where required configure MapLibre's `setWorkerUrl` **before** mounting any map to a same-origin bundled worker. Do not point production workers at an unversioned CDN. See [MapLibre's installation and CSP guidance](https://maplibre.org/maplibre-gl-js/docs/).

Honor your provider's license, attribution, rate limits and availability. Package styles retain MapLibre's attribution control. There is no guarantee of offline street tiles. An inline background style works offline with location pins, or serve your own tiles.

See Showcase → Display → MapLibre for live updates, clustered selection, empty data, offline canvas and theme switching. `npm run verify:maplibre` covers data boundaries and mounted lifecycle; real WebGL/browser checks remain necessary for deployment.
