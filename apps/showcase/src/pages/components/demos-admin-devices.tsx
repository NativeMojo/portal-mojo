// MERGE-WIRE: rail — ComponentsPage.tsx, 'Admin' group, after 'admin-bouncer'
// (plus the import line):
//   import { AdminDevicesDemo } from './demos-admin-devices';
//   { key: 'admin-devices', title: 'Devices, logins & GeoIP', icon: 'bi-laptop', … }
// MERGE-WIRE: theme.css — @import "./theme/admin-devices.css";
//
// Devices / login locations / GeoIP demos (board #1291). Every surface the
// item ships is reachable from here so the verifier and a human reviewer see
// the same set: three tables, four KISS detail modals, the map in both modes
// (with and without injected coastline geometry), and a permission-denied
// state.
import { useState } from 'react';
import {
    GeoIpCachePage,
    LoginLocationMap,
    LoginLocationsPage,
    UserDevicesPage,
    showGeoIpDossierForAddress,
    showLoginEventDetail,
    showUserDeviceDetailByDuid,
    showUserDeviceLocationDetail,
} from 'portal-mojo/admin';
import { Guarded } from 'portal-mojo/ui';
import { WorldMap, type WorldMapLand } from 'portal-mojo/charts';

type Surface = 'devices' | 'logins' | 'geoip' | 'map' | 'modals' | 'denied';

const TABS: { key: Surface; label: string; icon: string }[] = [
    { key: 'devices', label: 'User Devices', icon: 'bi-laptop' },
    { key: 'logins', label: 'Login Locations', icon: 'bi-pin-map' },
    { key: 'geoip', label: 'GeoIP Cache', icon: 'bi-globe2' },
    { key: 'map', label: 'Map binding', icon: 'bi-globe-americas' },
    { key: 'modals', label: 'Detail modals', icon: 'bi-window-stack' },
    { key: 'denied', label: 'Permission denied', icon: 'bi-shield-lock' },
];

/**
 * A deliberately crude two-landmass outline. WorldMap ships NO coastline
 * geometry (that is the repo owner's open decision — see docs/worldmap.md),
 * so every #1291 surface is designed against the graticule fallback. This
 * toggle proves the SAME map reads correctly either way.
 */
const DEMO_LAND: WorldMapLand = {
    type: 'FeatureCollection',
    features: [
        {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-125, 49], [-95, 49], [-82, 42], [-70, 45], [-66, 45],
                    [-80, 26], [-97, 26], [-107, 31], [-117, 32], [-124, 40], [-125, 49],
                ]],
            },
        },
        {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-10, 55], [2, 51], [10, 55], [20, 55], [30, 50], [28, 44],
                    [15, 40], [3, 43], [-9, 43], [-10, 55],
                ]],
            },
        },
    ],
};

function MapBindingDemo() {
    const [land, setLand] = useState(false);
    return (
        <div className="flex flex-col gap-3">
            <p className="dim">
                The map component is #1426&apos;s; only the binding is this item&apos;s. Summary mode
                positions from <code>COUNTRY_CENTROIDS</code> (falling back to the server&apos;s
                averaged coordinates), sizes by login count and drills into regions on a
                double-click. &quot;Every login&quot; mode colours by <code>is_new_country</code> /
                <code>is_new_region</code> — the fields the wire actually sends.
            </p>
            <label className="flex items-center gap-2">
                <input type="checkbox" checked={land} onChange={(e) => setLand(e.target.checked)} />
                <span>Inject a demo coastline outline (the <code>land</code> seam)</span>
            </label>
            {/* Two independent instances so the graticule fallback and the
                injected-geometry case can be compared side by side. */}
            <div className="panel panel-pad">
                <div className="eyebrow">Global · summary + every-login</div>
                <LoginLocationMap
                    height={340}
                    onOpenLogin={(id) => showLoginEventDetail(id, { onOpenDeviceByDuid: showUserDeviceDetailByDuid })}
                    onCountrySelect={(code) => console.info('country selected:', code)}
                />
            </div>
            <div className="panel panel-pad">
                <div className="eyebrow">Scoped to one user (UserDetail&apos;s Logins → Map tab)</div>
                <LoginLocationMap userId={1} height={260} showModeToggle={false} />
            </div>
            <div className="panel panel-pad">
                <div className="eyebrow">
                    {land ? 'With injected coastlines' : 'The shipped default — graticule fallback'}
                </div>
                {/* `LoginLocationMap` deliberately does NOT expose `land`:
                    coastline geometry is one app-level decision, not a
                    per-surface prop. This reaches WorldMap directly to show
                    what lands when the repo owner makes it — same markers,
                    same tooltips, same legend, either way. */}
                <WorldMap
                    land={land ? DEMO_LAND : null}
                    height={280}
                    markers={[
                        { id: 'us', lat: 39.8, lng: -98.6, size: 34, tone: 'scale', intensity: 1, label: 'United States', value: 1240 },
                        { id: 'de', lat: 51.2, lng: 10.4, size: 24, tone: 'scale', intensity: 0.4, label: 'Germany', value: 410 },
                        { id: 'gb', lat: 54, lng: -2.4, size: 20, tone: 'scale', intensity: 0.25, label: 'United Kingdom', value: 260 },
                    ]}
                    status={land
                        ? 'Injected demo geometry — nothing is bundled; this rides the `land` prop'
                        : 'No coastlines are shipped: every #1291 surface is designed against this'}
                />
            </div>
        </div>
    );
}

function ModalsDemo() {
    return (
        <div className="flex flex-col gap-3">
            <p className="dim">
                Every record inspection is a KISS <code>modal.detail</code> (#1425) — no
                right panel, no record-detail route. Seeded fixtures below.
            </p>
            <div className="flex flex-wrap gap-2">
                <button className="btn" onClick={() => showGeoIpDossierForAddress('185.220.101.44')}>
                    <i className="bi bi-shield-lock" /> GeoIP dossier — blocked Tor exit
                </button>
                <button className="btn" onClick={() => showGeoIpDossierForAddress('104.28.14.33')}>
                    <i className="bi bi-hourglass-bottom" /> GeoIP dossier — EXPIRED block
                </button>
                <button className="btn" onClick={() => showGeoIpDossierForAddress('203.0.113.9')}>
                    <i className="bi bi-shield-check" /> GeoIP dossier — whitelisted
                </button>
                <button className="btn" onClick={() => showGeoIpDossierForAddress('198.51.100.77')}>
                    <i className="bi bi-hourglass-bottom" /> GeoIP dossier — EXPIRED whitelist
                </button>
                <button className="btn" onClick={() => showUserDeviceLocationDetail(7300)}>
                    <i className="bi bi-geo-alt" /> Device location detail
                </button>
                <button className="btn" onClick={() => showLoginEventDetail(14400)}>
                    <i className="bi bi-box-arrow-in-right" /> Login event detail
                </button>
            </div>
            <p className="dim">
                The device dossier opens from any row in the <strong>User Devices</strong> tab —
                its Sessions section is real (the <code>sessions</code> graph&apos;s
                <code>bouncer_device</code> / <code>active_sessions</code> /
                <code>recent_locations</code>), and its Shared section answers &quot;is this
                device used by more than one account?&quot;.
            </p>
        </div>
    );
}

function DeniedDemo() {
    return (
        <div className="flex flex-col gap-3">
            <p className="dim">
                Gates are system-pinned and fail-closed. A permission-disabled surface
                issues <strong>no</strong> request — <code>enabled: false</code>, not a
                denied one. <code>sys.manage_devices</code> is deliberately in no clause:
                it passes the <code>/user/device/location</code> URL decorator and then
                fails the model&apos;s own VIEW_PERMS, so alone it opens nothing.
            </p>
            <Guarded
                permission={['sys.this_grant_does_not_exist']}
                fallback={
                    <div className="panel panel-pad">
                        <div className="empty">
                            <i className="bi bi-shield-lock" />
                            <h2>Access denied</h2>
                            <p className="dim">
                                This is what an operator without the clause sees — the section is
                                absent from the rail and unroutable, and nothing was fetched.
                            </p>
                        </div>
                    </div>
                }
            >
                <UserDevicesPage />
            </Guarded>
        </div>
    );
}

export function AdminDevicesDemo() {
    const [surface, setSurface] = useState<Surface>('devices');
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Devices admin surface">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        className={`btn btn-compact${surface === tab.key ? ' btn-primary' : ''}`}
                        onClick={() => setSurface(tab.key)}
                    >
                        <i className={`bi ${tab.icon}`} /> {tab.label}
                    </button>
                ))}
            </div>
            {surface === 'devices' && <UserDevicesPage />}
            {surface === 'logins' && <LoginLocationsPage />}
            {surface === 'geoip' && <GeoIpCachePage />}
            {surface === 'map' && <MapBindingDemo />}
            {surface === 'modals' && <ModalsDemo />}
            {surface === 'denied' && <DeniedDemo />}
        </div>
    );
}
