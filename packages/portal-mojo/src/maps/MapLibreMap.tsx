import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Map as LibreMap, Marker, NavigationControl, Popup, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl';
import { markerBounds, markersToGeoJSON, validMapMarkers } from './markers';
import type { MapLibreMapProps, MapView } from './types';

const SOURCE = 'mojo-markers';
const POINTS = 'mojo-points';
const CLUSTERS = 'mojo-clusters';
const DEFAULT_VIEW: MapView = { longitude: 0, latitude: 20, zoom: 1.5 };

/** Street maps with opt-in tiles, clustered pins and view-preserving live updates. */
export function MapLibreMap<T>({
    mapStyle, markers, label = 'Locations', height = 420, className = '', initialView = DEFAULT_VIEW,
    view, onViewChange, selectedId, onSelectionChange, renderPopup, cluster = true,
    fitOnLoad = true, loading = false, onError,
}: MapLibreMapProps<T>) {
    const host = useRef<HTMLDivElement>(null);
    const mapRef = useRef<LibreMap | null>(null);
    const fitted = useRef(false);
    const [ready, setReady] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [internalId, setInternalId] = useState<string | null>(null);
    const [popupHost, setPopupHost] = useState<HTMLElement | null>(null);
    const valid = useMemo(() => validMapMarkers(markers), [markers]);
    const activeId = selectedId === undefined ? internalId : selectedId;
    const active = valid.find((marker) => marker.id === activeId);
    const pickerId = useId();
    const latest = useRef({ valid, activeId, onSelectionChange, onViewChange, onError, mapStyle, cluster });
    latest.current = { valid, activeId, onSelectionChange, onViewChange, onError, mapStyle, cluster };
    const reportFailure = (error: Error) => {
        setFailure('Map unavailable. You can still choose a location below.');
        latest.current.onError?.(error);
    };
    const select = (id: string | null) => { setInternalId(id); latest.current.onSelectionChange?.(id); };
    const fit = () => {
        const map = mapRef.current;
        const points = latest.current.valid;
        if (!map || !points.length) return;
        const bounds = markerBounds(points);
        if (bounds) map.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: 0 });
    };

    // One engine per mount/retry. Styles and live data update it in place.
    useEffect(() => {
        if (!host.current) return;
        let disposed = false;
        let map: LibreMap;
        let observer: ResizeObserver | undefined;
        let themeObserver: MutationObserver | undefined;
        const clusterPins = new globalThis.Map<number, Marker>();
        const fail = (error: Error) => {
            if (disposed) return;
            reportFailure(error);
        };
        const paint = () => {
            if (!map.getLayer(POINTS) || !host.current) return;
            const css = getComputedStyle(host.current);
            const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
            map.setPaintProperty(POINTS, 'circle-color', ['match', ['get', 'tone'],
                'ok', color('--ok', '#1e7a4d'), 'warn', color('--warn', '#8a5f14'),
                'bad', color('--bad', '#b23b3b'), 'muted', color('--mute', '#67717f'), color('--info', '#16657f')]);
            map.setPaintProperty(POINTS, 'circle-stroke-color', color('--surface', '#ffffff'));
        };
        // HTML cluster counts need no remote glyph/font service. Single pins are GPU layers.
        const drawClusters = () => {
            if (!map.getLayer(CLUSTERS)) return;
            const visible = new Set<number>();
            for (const feature of map.queryRenderedFeatures(undefined, { layers: [CLUSTERS] })) {
                if (feature.geometry.type !== 'Point') continue;
                const id = Number(feature.properties.cluster_id);
                if (visible.has(id)) continue;
                visible.add(id);
                if (clusterPins.has(id)) {
                    const existing = clusterPins.get(id)!;
                    existing.setLngLat(feature.geometry.coordinates as [number, number]);
                    existing.getElement().dataset.longitude = String(feature.geometry.coordinates[0]);
                    existing.getElement().dataset.latitude = String(feature.geometry.coordinates[1]);
                    existing.getElement().textContent = Number(feature.properties.point_count).toLocaleString();
                    existing.getElement().setAttribute('aria-label', `Zoom into ${feature.properties.point_count} locations`);
                    continue;
                }
                const coordinates = feature.geometry.coordinates as [number, number];
                const button = document.createElement('button');
                button.dataset.longitude = String(coordinates[0]); button.dataset.latitude = String(coordinates[1]);
                button.type = 'button'; button.className = 'mojo-map-cluster';
                const count = Number(feature.properties.point_count);
                button.textContent = count.toLocaleString();
                button.setAttribute('aria-label', `Zoom into ${count} locations`);
                button.onclick = () => {
                    const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
                    if (!source) return;
                    const dataAtClick = latest.current.valid;
                    void source.getClusterExpansionZoom(id).then((zoom) => {
                        if (!disposed && dataAtClick === latest.current.valid && map.getSource(SOURCE) === source) {
                            map.easeTo({ center: [Number(button.dataset.longitude), Number(button.dataset.latitude)], zoom, duration: 300 });
                        }
                    }).catch((error: Error) => { if (!disposed) latest.current.onError?.(error); });
                };
                clusterPins.set(id, new Marker({ element: button }).setLngLat(coordinates).addTo(map));
            }
            for (const [id, pin] of clusterPins) if (!visible.has(id)) { pin.remove(); clusterPins.delete(id); }
        };
        const clearClusters = () => { for (const pin of clusterPins.values()) pin.remove(); clusterPins.clear(); };
        fitted.current = false;
        const install = () => {
            if (disposed) return;
            clearClusters();
            if (!map.getSource(SOURCE)) {
                map.addSource(SOURCE, { type: 'geojson', data: markersToGeoJSON(latest.current.valid), cluster: latest.current.cluster, clusterRadius: 48, clusterMaxZoom: 14 });
                map.addLayer({ id: CLUSTERS, type: 'circle', source: SOURCE, filter: ['has', 'point_count'], paint: { 'circle-radius': 21, 'circle-opacity': 0 } });
                map.addLayer({ id: POINTS, type: 'circle', source: SOURCE, filter: ['!', ['has', 'point_count']], paint: { 'circle-radius': 8, 'circle-stroke-width': 2 } });
            }
            paint();
            setReady(true); setFailure(null);
            if (fitOnLoad && !view && !fitted.current && latest.current.valid.length) { fit(); fitted.current = true; }
        };
        try {
            const camera = view ?? initialView;
            map = new LibreMap({ container: host.current, style: latest.current.mapStyle, center: [camera.longitude, camera.latitude], zoom: camera.zoom, attributionControl: { compact: true } });
            mapRef.current = map;
            map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
            map.on('style.load', install);
            map.on('render', drawClusters);
            map.on('error', (event) => fail(event.error instanceof Error ? event.error : new Error(event.error.message)));
            map.on('moveend', () => {
                const center = map.getCenter();
                latest.current.onViewChange?.({ longitude: center.lng, latitude: center.lat, zoom: map.getZoom() });
            });
            map.on('click', (event: MapMouseEvent) => {
                if (!map.getLayer(POINTS)) return;
                const hit = map.queryRenderedFeatures(event.point, { layers: [POINTS] })[0];
                if (hit) select(String(hit.properties.markerId));
            });
            map.on('mousemove', (event: MapMouseEvent) => {
                if (map.getLayer(POINTS)) map.getCanvas().style.cursor = map.queryRenderedFeatures(event.point, { layers: [POINTS] }).length ? 'pointer' : '';
            });
            observer = new ResizeObserver(() => map.resize()); observer.observe(host.current);
            themeObserver = new MutationObserver(paint);
            themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
        return () => {
            disposed = true; observer?.disconnect(); themeObserver?.disconnect(); clearClusters();
            mapRef.current = null; map?.remove();
        };
        // Constructor options are mount-only; mutable props use latest refs/effects below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        setReady(false); setFailure(null);
        map.setStyle(mapStyle);
    }, [mapStyle]);
    useEffect(() => {
        const map = mapRef.current;
        const source = map?.getSource(SOURCE) as GeoJSONSource | undefined;
        if (!source) return;
        if (fitOnLoad && !view && !fitted.current && valid.length) { fit(); fitted.current = true; }
        void source.setData(markersToGeoJSON(valid)).catch((error: Error) => { if (mapRef.current === map) reportFailure(error); });
    }, [valid, ready]);
    useEffect(() => {
        const map = mapRef.current;
        const source = map?.getSource(SOURCE) as GeoJSONSource | undefined;
        if (source) void source.setClusterOptions({ cluster }).catch((error: Error) => { if (mapRef.current === map) reportFailure(error); });
    }, [cluster]);
    useEffect(() => {
        if (activeId !== null && !valid.some((marker) => marker.id === activeId)) select(null);
    }, [activeId, valid]);
    useEffect(() => {
        if (!view || !mapRef.current) return;
        const map = mapRef.current;
        const center = map.getCenter();
        if (center.lng !== view.longitude || center.lat !== view.latitude || map.getZoom() !== view.zoom) {
            map.jumpTo({ center: [view.longitude, view.latitude], zoom: view.zoom });
        }
    }, [view]);
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready || !active) { setPopupHost(null); return; }
        const node = document.createElement('div'); node.className = 'mojo-map-popup-body';
        const popup = new Popup({ closeOnClick: false, maxWidth: '280px', offset: 14 }).setLngLat([active.longitude, active.latitude]).setDOMContent(node).addTo(map);
        setPopupHost(node);
        const close = () => select(null);
        popup.on('close', close);
        // React fills the portal after MapLibre's initial empty measurement.
        // Re-anchor and pan only the amount needed to keep its actions in view.
        let pending = 0;
        let disposed = false;
        const fitPopup = () => {
            cancelAnimationFrame(pending);
            const frame = map.getContainer().getBoundingClientRect();
            if (frame.height > 0) {
                node.style.maxHeight = `${Math.max(72, frame.height - 64)}px`;
                node.style.overflowY = 'auto';
            }
            popup.setLngLat([active.longitude, active.latitude]);
            pending = requestAnimationFrame(() => {
                if (disposed) return;
                const box = node.closest('.maplibregl-popup')?.getBoundingClientRect();
                if (!box || !frame.width || !frame.height) return;
                const dx = box.left < frame.left + 4 ? box.left - frame.left - 12
                    : box.right > frame.right - 4 ? box.right - frame.right + 12 : 0;
                const dy = box.top < frame.top + 4 ? box.top - frame.top - 12
                    : box.bottom > frame.bottom - 4 ? box.bottom - frame.bottom + 12 : 0;
                if (dx || dy) map.panBy([dx, dy], { duration: 0 });
            });
        };
        const size = new ResizeObserver(fitPopup);
        size.observe(node);
        map.on('resize', fitPopup);
        map.on('moveend', fitPopup);
        return () => {
            disposed = true; cancelAnimationFrame(pending); size.disconnect();
            map.off('resize', fitPopup); map.off('moveend', fitPopup);
            popup.off('close', close); popup.remove();
        };
    }, [active?.id, active?.longitude, active?.latitude, ready, attempt]);

    return <section className={`mojo-map ${className}`} aria-label={label}>
        <div className="mojo-map-frame" style={{ height }}>
            <div ref={host} className="mojo-map-canvas" />
            {(failure || loading || !valid.length) && <div className="mojo-map-notice" role={failure ? 'alert' : 'status'}>
                {failure ?? (loading ? 'Loading locations…' : 'No locations to show')}
                {failure && <button type="button" onClick={() => { setReady(false); setFailure(null); setAttempt((value) => value + 1); }}>Retry map</button>}
            </div>}
        </div>
        <div className="mojo-map-toolbar">
            <label className="mojo-map-picker" htmlFor={pickerId}><span className="sr-only">Choose a location</span>
                <select id={pickerId} value={active?.id ?? ''} onChange={(event) => {
                    const id = event.target.value || null; select(id);
                    const marker = valid.find((point) => point.id === id);
                    if (marker) mapRef.current?.easeTo({ center: [marker.longitude, marker.latitude], zoom: Math.max(mapRef.current.getZoom(), 13), duration: 300 });
                }}><option value="">{label} ({valid.length})</option>{valid.map((marker) => <option key={marker.id} value={marker.id}>{marker.label}</option>)}</select>
            </label>
            <button type="button" className="btn btn-sm" disabled={!ready || !valid.length} onClick={fit}>Fit all</button>
            {markers.length > valid.length && <span className="mojo-map-skipped">{markers.length - valid.length} without valid coordinates</span>}
        </div>
        {popupHost && active && createPortal(renderPopup ? renderPopup(active) : <strong>{active.label}</strong>, popupHost)}
    </section>;
}
