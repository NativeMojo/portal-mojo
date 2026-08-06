// WorldMap — dependency-free SVG geo map in the mission-control design
// language. A REBUILD, not a port: web-mojo drew its maps through
// MapLibreView.js, which injects `https://unpkg.com/maplibre-gl@4.7.1` as a
// runtime <script> (maplibre is not even in its package.json) and pulls
// basemap tiles and glyphs from `demotiles.maplibre.org`. Every admin
// deployment would fetch a third-party CDN and a demo tile server at page
// load — unacceptable independently of the no-library rule.
//
// What it covers is the surface the three consumers actually used:
// full-replace markers ({lng,lat,size,color,icon,popup}), a dblclick
// drill-down handle, fitBounds after drill-down, flyTo on mode switch,
// resize on tab activation, origin→country line sources with
// intensity-driven paint, and the interactive/scrollZoom/dragPan toggles.
// Deliberately NOT carried: pitch/bearing (cosmetic 3D with no consumer
// semantics — a fake-perspective SVG map would be dishonest), satellite and
// terrain styles, clustering, glyph rendering.
//
// Two source bugs are fixed here rather than reproduced: coordinate validity
// is `Number.isFinite` (the source's `if (!lng || !lat) return` dropped
// points on the equator and prime meridian), and tooltips are ReactNode
// slots (both consumers concatenated popup HTML from unescaped server
// values — `entry.region`, `ev.ip_address`, `ev.user.display_name`).
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from 'react';
import {
    DEFAULT_BOUNDS,
    DEFAULT_VIEW,
    MAX_ZOOM,
    MIN_ZOOM,
    geoArcPath,
    clampView,
    equirectangular,
    fitViewToPoints,
    graticule,
    isFinitePoint,
    splitAntimeridian,
    type GeoBounds,
    type LatLng,
    type Projection,
    type WorldMapView,
} from './geo';
import {
    landRings,
    toneColor,
    type WorldMapLand,
    type WorldMapLegendItem,
    type WorldMapMarker,
    type WorldMapRoute,
} from './worldmap-data';

export interface WorldMapProps<T = unknown> {
    /** Plotted points. Full replace, like the source's `updateMarkers`. */
    markers?: readonly WorldMapMarker<T>[];
    /** Origin→destination arcs. */
    routes?: readonly WorldMapRoute[];
    /**
     * Basemap geometry. NOTHING is bundled: with `land` omitted the map draws
     * an ocean field and a graticule, which is honest about what it knows.
     * See docs/worldmap.md — shipping coastlines is an open decision, and
     * this prop is the seam that makes it a drop-in when it is made.
     */
    land?: WorldMapLand | null;
    height?: number;
    /** Geographic crop. Default: world minus the polar caps. */
    bounds?: GeoBounds;
    /** Controlled viewport. A change tweens over `viewTransition` ms. */
    view?: WorldMapView;
    /** Uncontrolled initial viewport, and the target of a canvas double-click. */
    defaultView?: WorldMapView;
    onViewChange?: (view: WorldMapView) => void;
    /**
     * 'none' (default) matches both consumers' `autoFitBounds: false`.
     * 'markers' re-fits whenever the marker set changes — the `fitBounds()`
     * the drill-down flow called.
     */
    fit?: 'none' | 'markers';
    /** Wheel zoom + drag pan. Default true (the source's master switch). */
    interactive?: boolean;
    showGraticule?: boolean;
    showLegend?: boolean;
    /** Explicit legend rows; omitted, they are derived from marker legendKeys. */
    legend?: readonly WorldMapLegendItem[];
    showTooltip?: boolean;
    /** Replace the whole tooltip body. ReactNode, never an HTML string. */
    renderTooltip?: (marker: WorldMapMarker<T>) => ReactNode;
    onMarkerHover?: (marker: WorldMapMarker<T> | null) => void;
    onMarkerClick?: (marker: WorldMapMarker<T>) => void;
    onMarkerDoubleClick?: (marker: WorldMapMarker<T>) => void;
    /** Route dash flow. Default true; `prefers-reduced-motion` still wins. */
    animateRoutes?: boolean;
    /** ms for a `view` change tween. Default 600 — flyTo({duration: 600}). */
    viewTransition?: number;
    loading?: boolean;
    /** Footer status line — the source's `setStatus()`. */
    status?: ReactNode;
    emptyText?: string;
    className?: string;
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Single click is deferred this long so a double-click can cancel it. */
const CLICK_DEFER_MS = 250;

/** Below this drag distance a pointer sequence still counts as a click. */
const DRAG_SLOP_PX = 3;

export function WorldMap<T = unknown>({
    markers: markersProp = [],
    routes: routesProp = [],
    land = null,
    height = 320,
    bounds = DEFAULT_BOUNDS,
    view: viewProp,
    defaultView,
    onViewChange,
    fit = 'none',
    interactive = true,
    showGraticule = true,
    showLegend = true,
    legend: legendProp,
    showTooltip = true,
    renderTooltip,
    onMarkerHover,
    onMarkerClick,
    onMarkerDoubleClick,
    animateRoutes = true,
    viewTransition = 600,
    loading = false,
    status,
    emptyText = 'No locations to plot',
    className = '',
}: WorldMapProps<T>) {
    // Malformed feed data degrades to the empty state, never takes the route
    // down — the same rule SeriesChart follows.
    const shapeOk = Array.isArray(markersProp) && Array.isArray(routesProp);
    if (!shapeOk) {
        console.warn('WorldMap: markers/routes are not arrays — rendering empty state', { markers: markersProp, routes: routesProp });
    }
    const markers = shapeOk ? markersProp : [];
    const routes = shapeOk ? routesProp : [];

    const wrapRef = useRef<HTMLDivElement>(null);
    const areaRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);

    // Real pixel geometry, measured — and the reason `map.resize()` (which
    // both consumers had to call on tab activation) has no equivalent here.
    useLayoutEffect(() => {
        const node = wrapRef.current;
        if (!node) return;
        const ro = new ResizeObserver(([entry]) => {
            const w = entry?.contentRect.width ?? 0;
            if (w > 0) setWidth(w);
        });
        ro.observe(node);
        return () => ro.disconnect();
    }, []);

    // ── Viewport: controlled-or-uncontrolled, with a rAF tween ────────
    const controlled = viewProp !== undefined;
    const homeView = defaultView ?? DEFAULT_VIEW;
    const [innerView, setInnerView] = useState<WorldMapView>(homeView);
    const targetView = controlled ? viewProp : innerView;

    const [painted, setPaintedState] = useState<WorldMapView>(targetView);
    const paintedRef = useRef<WorldMapView>(targetView);
    const setPainted = useCallback((v: WorldMapView) => {
        paintedRef.current = v;
        setPaintedState(v);
    }, []);

    const size = useMemo(() => ({ width, height }), [width, height]);
    const sizeRef = useRef(size);
    sizeRef.current = size;
    const targetRef = useRef(targetView);
    targetRef.current = targetView;
    // Gestures paint immediately; only programmatic view changes tween.
    const immediateRef = useRef(false);
    const firstPaintRef = useRef(true);

    const commitView = useCallback((next: WorldMapView, immediate = false) => {
        const clamped = clampView(next, bounds, sizeRef.current);
        immediateRef.current = immediate;
        if (!controlled) setInnerView(clamped);
        else if (immediate) setPainted(clamped);
        onViewChange?.(clamped);
    }, [bounds, controlled, onViewChange, setPainted]);

    const targetKey = `${targetView.lat}|${targetView.lng}|${targetView.zoom}`;
    useEffect(() => {
        const target = targetRef.current;
        if (firstPaintRef.current || immediateRef.current || viewTransition <= 0) {
            firstPaintRef.current = false;
            immediateRef.current = false;
            setPainted(target);
            return;
        }
        const from = paintedRef.current;
        const start = performance.now();
        let raf = 0;
        const step = (now: number) => {
            const t = Math.min(1, (now - start) / viewTransition);
            const e = easeOutCubic(t);
            setPainted({
                lat: from.lat + (target.lat - from.lat) * e,
                lng: from.lng + (target.lng - from.lng) * e,
                zoom: from.zoom + (target.zoom - from.zoom) * e,
            });
            if (t < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
        // targetKey IS the identity of `target`; refs carry the live values.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [targetKey, viewTransition, setPainted]);

    const projection: Projection = useMemo(
        () => equirectangular({ width: Math.max(1, width), height, bounds, view: painted }),
        [width, height, bounds, painted],
    );

    // ── Marker triage: finite / plottable / off-bounds ────────────────
    const markerKey = markers.map((m) => m.id ?? `${m.lat},${m.lng}`).join('|');
    // The warn is AGGREGATED (one line per bad marker set, not per marker)
    // and de-duplicated by this ref, so a consumer that hands over a fresh
    // array every render does not get one warning per paint.
    const warnedRef = useRef('');
    const finiteMarkers = useMemo(() => {
        const usable: WorldMapMarker<T>[] = [];
        let dropped = 0;
        for (const m of markers) {
            if (isFinitePoint(m)) usable.push(m); else dropped += 1;
        }
        const signature = `${markerKey}:${dropped}`;
        if (dropped > 0 && warnedRef.current !== signature) {
            warnedRef.current = signature;
            console.warn(`WorldMap: ${dropped} marker(s) skipped — lat/lng must be finite numbers (0,0 is valid data)`);
        }
        return usable;
    }, [markers, markerKey]);

    // ── Legend ────────────────────────────────────────────────────────
    const legendItems: WorldMapLegendItem[] = useMemo(() => {
        if (legendProp) return [...legendProp];
        const seen = new Map<string, WorldMapLegendItem>();
        for (const m of finiteMarkers) {
            if (!m.legendKey || seen.has(m.legendKey)) continue;
            seen.set(m.legendKey, { key: m.legendKey, label: m.legendKey, tone: m.tone });
        }
        return [...seen.values()];
    }, [legendProp, finiteMarkers]);

    const [hidden, setHidden] = useState<Set<string>>(() => new Set());
    const legendKey = legendItems.map((l) => l.key).join('|');
    useEffect(() => { setHidden(new Set()); }, [legendKey]);

    const shownMarkers = useMemo(
        () => finiteMarkers.filter((m) => !m.legendKey || !hidden.has(m.legendKey)),
        [finiteMarkers, hidden],
    );
    const shownRoutes = useMemo(
        () => routes.filter((r) => (!r.legendKey || !hidden.has(r.legendKey)) && isFinitePoint(r.from) && isFinitePoint(r.to)),
        [routes, hidden],
    );

    // Off-bounds points are SKIPPED and COUNTED, never clamped to the edge:
    // a marker pinned to the frame edge would lie about where the event was.
    const plotted = shownMarkers.filter((m) => projection.contains(m));
    const offBounds = shownMarkers.length - plotted.length;

    // ── fit="markers" — the fitBounds() replacement ───────────────────
    const fitKey = fit === 'markers' ? markerKey : '';
    useEffect(() => {
        if (fit !== 'markers' || width <= 0 || !finiteMarkers.length) return;
        commitView(fitViewToPoints(finiteMarkers, {
            size: sizeRef.current,
            bounds,
            fallback: targetRef.current,
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fitKey, fit, width]);

    // ── Pan / zoom ────────────────────────────────────────────────────
    const dragRef = useRef<{ x: number; y: number; moved: number } | null>(null);
    /** Distance of the gesture that just ended — outlives dragRef. */
    const lastDragMoved = useRef(0);
    const [dragging, setDragging] = useState(false);

    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!interactive || e.button !== 0) return;
        dragRef.current = { x: e.clientX, y: e.clientY, moved: 0 };
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
    };
    const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        drag.x = e.clientX;
        drag.y = e.clientY;
        const current = paintedRef.current;
        commitView({
            lat: current.lat + dy / projection.scale,
            lng: current.lng - dx / projection.scale,
            zoom: current.zoom,
        }, true);
    };
    const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!dragRef.current) return;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        lastDragMoved.current = dragRef.current.moved;
        dragRef.current = null;
        setDragging(false);
    };

    // Wheel must be a NON-passive native listener; React's synthetic wheel
    // handler is passive, so preventDefault there only logs a warning while
    // the page keeps scrolling under the cursor.
    useEffect(() => {
        const node = areaRef.current;
        if (!node || !interactive) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = node.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            const current = paintedRef.current;
            const anchor = equirectangular({
                width: Math.max(1, rect.width),
                height: rect.height,
                bounds,
                view: current,
            }).invert({ x: px, y: py });
            const nextZoom = clamp(current.zoom * Math.pow(0.999, e.deltaY), MIN_ZOOM, MAX_ZOOM);
            const spanLng = Math.max(1e-9, bounds.east - bounds.west);
            const spanLat = Math.max(1e-9, bounds.north - bounds.south);
            const scale = Math.min(rect.width / spanLng, rect.height / spanLat) * nextZoom;
            commitView({
                lat: anchor.lat + (py - rect.height / 2) / scale,
                lng: anchor.lng - (px - rect.width / 2) / scale,
                zoom: nextZoom,
            }, true);
        };
        node.addEventListener('wheel', onWheel, { passive: false });
        return () => node.removeEventListener('wheel', onWheel);
    }, [interactive, bounds, commitView]);

    // ── Hover + click / double-click ──────────────────────────────────
    const [hover, setHover] = useState<WorldMapMarker<T> | null>(null);
    const mouseRef = useRef({ x: 0, y: 0 });
    const tipRef = useRef<HTMLDivElement>(null);
    const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current); }, []);

    const placeTip = useCallback(() => {
        const tip = tipRef.current;
        const area = areaRef.current;
        if (!tip || !area) return;
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        let left = mouseRef.current.x - tw / 2;
        let top = mouseRef.current.y - th - 12;
        if (left < 0) left = 0;
        if (left + tw > area.clientWidth) left = area.clientWidth - tw;
        if (top < 0) top = mouseRef.current.y + 16;
        if (top + th > area.clientHeight) top = area.clientHeight - th;
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
    }, []);
    useLayoutEffect(() => { if (hover) placeTip(); });

    const trackMouse = (e: { clientX: number; clientY: number }) => {
        const area = areaRef.current;
        if (!area) return;
        const rect = area.getBoundingClientRect();
        mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        placeTip();
    };

    // In MapLibre the marker handler stop-propagated so canvas doubleClickZoom
    // did not also fire. Here BOTH click and double-click are public, so a
    // single click waits CLICK_DEFER_MS and a double-click cancels it.
    const markerHandlers = (marker: WorldMapMarker<T>) => ({
        onMouseEnter: (e: React.MouseEvent) => {
            setHover(marker);
            onMarkerHover?.(marker);
            if (showTooltip) trackMouse(e);
        },
        onMouseMove: (e: React.MouseEvent) => { if (showTooltip) trackMouse(e); },
        onMouseLeave: () => { setHover(null); onMarkerHover?.(null); },
        onClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            if (!onMarkerClick) return;
            if (clickTimer.current) clearTimeout(clickTimer.current);
            clickTimer.current = setTimeout(() => {
                clickTimer.current = null;
                onMarkerClick(marker);
            }, onMarkerDoubleClick ? CLICK_DEFER_MS : 0);
        },
        onDoubleClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
            onMarkerDoubleClick?.(marker);
        },
    });

    // Canvas double-click resets the view — it deliberately does NOT zoom,
    // because double-click is the drill-down gesture on markers.
    const onCanvasDoubleClick = () => {
        // A pan that happened to end in a double-click must not also reset.
        if (lastDragMoved.current > DRAG_SLOP_PX) { lastDragMoved.current = 0; return; }
        commitView(homeView);
    };

    // ── Geometry for the drawn layers ─────────────────────────────────
    const lines = useMemo(() => graticule(bounds), [bounds]);
    const rings = useMemo(() => landRings(land), [land]);
    const landPaths = useMemo(() => rings.map((ring) => ringPath(ring, projection)).filter(Boolean), [rings, projection]);

    const routePaths = useMemo(() => shownRoutes.flatMap((route, i) => {
        const intensity = clamp(Number(route.intensity) || 0, 0, 1);
        return splitAntimeridian(route.from, route.to)
            .map(([a, b]) => geoArcPath(projection, a, b))
            .filter((d) => d.length > 0)
            .map((d, seg) => ({
                key: `${route.id ?? i}-${seg}`,
                d,
                // Source paint ramps, verbatim (MetricsCountryMapView.js:232-260):
                // width 1.75→6, opacity 0.45→0.95, color teal→amber (now tokens).
                stroke: toneColor(route.tone ?? 'scale', intensity),
                strokeWidth: 1.75 + intensity * 4.25,
                opacity: 0.45 + intensity * 0.5,
            }));
    }), [shownRoutes, projection]);

    const measured = width > 0;
    const nothingToShow = plotted.length === 0 && routePaths.length === 0;

    return (
        <div className={`worldmap${className ? ` ${className}` : ''}`} ref={wrapRef}>
            {showLegend && legendItems.length > 0 && (
                <div className="chart-legend">
                    {legendItems.map((item) => {
                        const off = hidden.has(item.key);
                        return (
                            <button
                                key={item.key}
                                className={`legend-item${off ? ' legend-off' : ''}`}
                                onClick={() => setHidden((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(item.key)) next.delete(item.key); else next.add(item.key);
                                    return next;
                                })}
                                title={off ? `Show ${item.label}` : `Hide ${item.label}`}
                            >
                                <span className="legend-swatch" style={{ background: item.color ?? toneColor(item.tone ?? 'accent', 1) }} />
                                {item.label}
                            </button>
                        );
                    })}
                </div>
            )}

            <div
                className={`worldmap-area${interactive ? ' worldmap-interactive' : ''}${dragging ? ' worldmap-dragging' : ''}`}
                style={{ height }}
                ref={areaRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={onCanvasDoubleClick}
            >
                {measured && (
                    <svg width={width} height={height} className="worldmap-svg" role="img" aria-label="World map">
                        <rect x={0} y={0} width={width} height={height} className="worldmap-ocean" />

                        {showGraticule && (
                            <g className="worldmap-graticule">
                                {lines.meridians.map((lng) => {
                                    const top = projection.project({ lat: bounds.north, lng });
                                    const bottom = projection.project({ lat: bounds.south, lng });
                                    return (
                                        <line
                                            key={`m${lng}`}
                                            x1={top.x} y1={top.y} x2={bottom.x} y2={bottom.y}
                                            className={lng === 0 ? 'worldmap-grat-major' : 'worldmap-grat-line'}
                                        />
                                    );
                                })}
                                {lines.parallels.map((lat) => {
                                    const left = projection.project({ lat, lng: bounds.west });
                                    const right = projection.project({ lat, lng: bounds.east });
                                    return (
                                        <line
                                            key={`p${lat}`}
                                            x1={left.x} y1={left.y} x2={right.x} y2={right.y}
                                            className={lat === 0 ? 'worldmap-grat-major' : 'worldmap-grat-line'}
                                        />
                                    );
                                })}
                            </g>
                        )}

                        {landPaths.length > 0 && (
                            <g className="worldmap-land">
                                {landPaths.map((d, i) => <path key={i} d={d} />)}
                            </g>
                        )}

                        <g className={`worldmap-routes${animateRoutes ? ' worldmap-routes-flow' : ''}`}>
                            {routePaths.map((r) => (
                                <path
                                    key={r.key}
                                    d={r.d}
                                    className="worldmap-route"
                                    stroke={r.stroke}
                                    strokeWidth={r.strokeWidth}
                                    opacity={r.opacity}
                                    fill="none"
                                />
                            ))}
                        </g>

                        <g className="worldmap-markers">
                            {/* Largest first so small dots stay hoverable on top. */}
                            {[...plotted]
                                .sort((a, b) => (b.size ?? 14) - (a.size ?? 14))
                                .map((marker, i) => {
                                    const { x, y } = projection.project(marker);
                                    const r = Math.max(3, (marker.size ?? 14) / 2);
                                    const color = toneColor(marker.tone ?? 'accent', marker.intensity ?? 0);
                                    const key = marker.id ?? `${marker.lat},${marker.lng},${i}`;
                                    return (
                                        <circle
                                            key={key}
                                            cx={x} cy={y} r={r}
                                            fill={color}
                                            className={`worldmap-marker${isHovered(hover, marker) ? ' worldmap-marker-hot' : ''}`}
                                            {...markerHandlers(marker)}
                                        />
                                    );
                                })}
                        </g>
                    </svg>
                )}

                {/* Icon glyphs ride an HTML layer: a bootstrap-icons class cannot
                    be rendered into SVG <text> without knowing its codepoint, and
                    injecting raw markup is not an option here. */}
                {measured && plotted.some((m) => m.icon) && (
                    <div className="worldmap-icons">
                        {plotted.filter((m) => m.icon).map((marker, i) => {
                            const { x, y } = projection.project(marker);
                            return (
                                <i
                                    key={marker.id ?? `icon${i}`}
                                    className={`worldmap-icon ${marker.icon}`}
                                    style={{ left: x, top: y, fontSize: Math.max(8, (marker.size ?? 14) * 0.46) }}
                                />
                            );
                        })}
                    </div>
                )}

                {measured && nothingToShow && !loading && (
                    <div className="worldmap-empty">{emptyText}</div>
                )}

                {loading && (
                    <div className="worldmap-loading"><span className="skel skel-block" /></div>
                )}

                {showTooltip && hover && (
                    <div className="chart-tip worldmap-tip" ref={tipRef}>
                        {renderTooltip ? renderTooltip(hover) : (
                            <>
                                <div className="chart-tip-head">{hover.label ?? '—'}</div>
                                {hover.value != null && (
                                    <div className="chart-tip-row">
                                        <span className="legend-swatch" style={{ background: toneColor(hover.tone ?? 'accent', hover.intensity ?? 0) }} />
                                        <span className="chart-tip-label">Value</span>
                                        <span className="chart-tip-val">{hover.value.toLocaleString()}</span>
                                    </div>
                                )}
                                {hover.detail != null && <div className="worldmap-tip-detail">{hover.detail}</div>}
                            </>
                        )}
                    </div>
                )}
            </div>

            {(status != null || offBounds > 0) && (
                <div className="worldmap-foot">
                    {status != null && <span className="worldmap-foot-status">{status}</span>}
                    {offBounds > 0 && (
                        <span className="worldmap-foot-count" title="Widen the `bounds` prop to bring them into view">
                            {offBounds.toLocaleString()} point{offBounds === 1 ? '' : 's'} outside the map view
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Hover match. Object identity first (the usual case), falling back to `id`
 * so a consumer that rebuilds its marker array on every render does not lose
 * the highlight mid-hover.
 */
function isHovered<T>(hover: WorldMapMarker<T> | null, marker: WorldMapMarker<T>): boolean {
    if (!hover) return false;
    return hover === marker || (hover.id != null && hover.id === marker.id);
}

/**
 * One land ring → an SVG path. A jump wider than 180° of longitude between
 * consecutive vertices means the ring wrapped the antimeridian; the path
 * BREAKS there (new subpath) instead of smearing a horizontal band across
 * the whole map.
 */
function ringPath(ring: readonly [number, number][], projection: Projection): string {
    if (!Array.isArray(ring) || ring.length < 3) return '';
    let d = '';
    let prev: LatLng | null = null;
    for (const position of ring) {
        const point: LatLng = { lat: position[1], lng: position[0] };
        if (!isFinitePoint(point)) { prev = null; continue; }
        const { x, y } = projection.project(point);
        const wrapped = prev != null && Math.abs(point.lng - prev.lng) > 180;
        d += `${d && !wrapped ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
        prev = point;
    }
    return d ? `${d}Z` : '';
}
