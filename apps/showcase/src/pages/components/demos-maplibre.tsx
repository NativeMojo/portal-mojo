import { useMemo, useState } from 'react';
import { MapLibreMap, type MapMarker, type MapStyle } from 'portal-mojo/maps';
import { useTheme } from 'portal-mojo/ui/shell';
import 'portal-mojo/maps.css';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// Vite emits one same-origin worker bundle, including MapLibre's shared module.
setWorkerUrl(workerUrl);

interface Device { status: string; lastSeen: string; city: string }
const LOCATIONS: MapMarker<Device>[] = [
    { id: 'a', label: 'Lobby kiosk', longitude: -98.4936, latitude: 29.4241, tone: 'ok', data: { status: 'Online', lastSeen: 'Just now', city: 'San Antonio' } },
    { id: 'b', label: 'Lounge kiosk', longitude: -98.487, latitude: 29.43, tone: 'ok', data: { status: 'Online', lastSeen: '2m ago', city: 'San Antonio' } },
    { id: 'c', label: 'Reception', longitude: -95.3698, latitude: 29.7604, tone: 'warn', data: { status: 'Needs attention', lastSeen: '5m ago', city: 'Houston' } },
    { id: 'd', label: 'Game room', longitude: -95.362, latitude: 29.767, tone: 'ok', data: { status: 'Online', lastSeen: 'Just now', city: 'Houston' } },
    { id: 'e', label: 'Front desk', longitude: -97.7431, latitude: 30.2672, tone: 'muted', data: { status: 'Offline', lastSeen: '2 weeks ago', city: 'Austin' } },
    { id: 'f', label: 'Entrance kiosk', longitude: -96.797, latitude: 32.7767, tone: 'ok', data: { status: 'Online', lastSeen: '1m ago', city: 'Dallas' } },
];
// Provider choice belongs to the host. The package has no default tile endpoint.
const STREETS = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };
const OFFLINE: MapStyle = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e5ebef' } }] };

export function MapLibreDemo() {
    const { resolved } = useTheme();
    const [updated, setUpdated] = useState(false);
    const [streets, setStreets] = useState(true);
    const [empty, setEmpty] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const markers = useMemo(() => empty ? [] : LOCATIONS.map((marker) => marker.id === 'e' && updated ? {
        ...marker, tone: 'ok' as const, data: { ...marker.data!, status: 'Online', lastSeen: 'Just now' },
    } : marker), [updated, empty]);
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div><h2>Fleet map</h2><p className="dim">Select a pin to see the last known state. Nearby locations are grouped together.</p></div>
        <MapLibreMap mapStyle={streets ? STREETS[resolved] : OFFLINE} markers={markers} selectedId={selectedId}
            onSelectionChange={setSelectedId} label="Kiosks" renderPopup={(marker) => <div>
                <strong>{marker.label}</strong><p className="dim" style={{ margin: '4px 0 12px' }}>{marker.data?.city}</p>
                <span style={{ color: `var(--${marker.tone === 'muted' ? 'mute' : marker.tone})` }}>● {marker.data?.status}</span>
                <p className="dim" style={{ margin: '6px 0 0', fontSize: 12 }}>Last seen {marker.data?.lastSeen.toLowerCase()}</p>
            </div>} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button className="btn btn-primary" onClick={() => setUpdated((value) => !value)}>{updated ? 'Reset demo update' : 'Simulate live update'}</button>
            <button className="btn" onClick={() => setEmpty((value) => !value)}>{empty ? 'Show locations' : 'Show empty state'}</button>
            <button className="btn" onClick={() => setStreets((value) => !value)}>{streets ? 'Use offline canvas' : 'Use street map'}</button>
        </div>
        <p className="dim" style={{ fontSize: 13 }}>Demo locations are illustrative. Street tiles are provided by OpenFreeMap. IP-based locations are approximate.</p>
    </div>;
}
