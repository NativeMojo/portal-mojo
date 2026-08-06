// LoginLocationMap — the port of web-mojo `LoginLocationMapView.js`'s DATA
// half, rendered THROUGH #1426's WorldMap. No projection, SVG, marker
// geometry or colour ramp lives here: the single `portal-mojo/charts` import
// below is the ONLY coupling point, so reconciling with the map component
// ever again touches exactly one file.
//
// Three source behaviours are corrected rather than reproduced:
//
//   1. **Colour by what the wire sends.** `EVENT_COLORS` keyed on
//      `ev.event_type`, a field `UserLoginEvent` has never had — so every dot
//      fell through to grey. Tone here rides `is_new_country` /
//      `is_new_region`, which are real, indexed, and exactly the triage
//      question this surface exists to answer.
//   2. **Centroids beat server averages.** `_build_aggregation` returns
//      `Avg(latitude)`/`Avg(longitude)` per country; for a country spanning
//      the antimeridian that average lands in the wrong ocean. Summary
//      markers position from `COUNTRY_CENTROIDS` first and fall back to the
//      server average only for codes the table does not know. Region rows
//      have no centroid and always use the average.
//   3. **Bounded at 500.** The source docstring says `size=500`; the code
//      sent `size: 1000` (`:208`). The docstring wins.
//
// Coastlines: `WORLD_LAND` (checked-in public-domain Natural Earth 110m, no
// runtime dependency) is passed as the basemap. Rendering correctly WITHOUT it
// remains a hard requirement — drop the prop and WorldMap falls back to ocean +
// graticule, with the markers, legend, tooltips, drill bar and status line
// carrying the whole story either way.
import { useMemo, useState, type ReactNode } from 'react';
import {
    COUNTRY_CENTROIDS, WorldMap, countryName, scaleMarkerSize, useWorldLand,
    type WorldMapMarker,
} from '../../../charts';
import { fmt } from '../../../ui';
import {
    LOGIN_RISK_LEGEND, loginRiskLegendKey, loginRiskTone,
    normalizeCountryCode, useLoginLocationList, useLoginLocationSummary,
    type LoginEventRow, type LoginLocationSummaryRow,
} from './models';

export type LoginMapMode = 'summary' | 'list';

/** What a summary marker hands back to the drill/select handlers. */
export interface LoginSummaryMarkerData {
    countryCode: string | null;
    region: string | null;
    isRegion: boolean;
    count: number;
}

export type LoginMarkerData = LoginSummaryMarkerData | LoginEventRow;

export interface LoginLocationMapProps {
    /** Scopes both legs to one user (UserDetail's Logins → Map tab). */
    userId?: number | null;
    height?: number;
    /** YYYY-MM-DD — `/summary` and `/user` parse only this shape. */
    drStart?: string | null;
    drEnd?: string | null;
    defaultMode?: LoginMapMode;
    /** Single-click a country marker. NOTE: WorldMap defers a single click
     *  250ms so a double-click (drill-down) can cancel it — by design. */
    onCountrySelect?: (countryCode: string) => void;
    /** List mode, global scope only: the tooltip's "View user" affordance. */
    onOpenUser?: (userId: number) => void;
    /** List mode: opens the login event's detail modal. */
    onOpenLogin?: (id: number) => void;
    /** Hides the Summary/List toggle when the caller wants one fixed mode. */
    showModeToggle?: boolean;
    enabled?: boolean;
    className?: string;
}

/** Marker diameter for summary mode. `[18, 44]` is the source's
 *  `Math.round(18 + intensity * 26)` expressed as a range. */
const SUMMARY_SIZE_RANGE: readonly [number, number] = [18, 44];

/** Every individual login plots at the same small size (source: `size: 10`). */
const LIST_MARKER_SIZE = 10;

function summaryMarkers(
    rows: readonly LoginLocationSummaryRow[],
    drilling: boolean,
): WorldMapMarker<LoginSummaryMarkerData>[] {
    const max = rows.reduce((top, row) => Math.max(top, Number(row.count) || 0), 0);
    const out: WorldMapMarker<LoginSummaryMarkerData>[] = [];

    for (const row of rows) {
        const code = normalizeCountryCode(row.country_code);
        const isRegion = Boolean(row.region);
        const centroid = !isRegion && code ? COUNTRY_CENTROIDS[code] : undefined;
        // Centroid first (correction 2); the server average is the fallback,
        // and is the ONLY source for a drilled region row.
        const lat = centroid ? centroid.lat : row.latitude;
        const lng = centroid ? centroid.lng : row.longitude;
        // WorldMap skips non-finite points with an aggregated warn; dropping
        // them here keeps that warn for genuinely malformed data.
        if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

        const count = Number(row.count) || 0;
        const label = isRegion
            ? (row.region || 'Unknown region')
            : (code ? countryName(code) || code : 'Unknown country');
        const newCount = isRegion ? (row.new_region_count ?? 0) : (row.new_country_count ?? 0);
        const newLabel = isRegion ? 'new region' : 'new country';

        out.push({
            id: isRegion ? `${code ?? '??'}:${row.region ?? ''}` : (code ?? `${lat},${lng}`),
            lat,
            lng,
            size: scaleMarkerSize(count, max, SUMMARY_SIZE_RANGE),
            tone: 'scale',
            intensity: max > 0 ? count / max : 0,
            label,
            value: count,
            detail: (
                <>
                    <div>{count.toLocaleString()} login{count === 1 ? '' : 's'}</div>
                    {newCount > 0 && (
                        <div className="lm-tip-chips">
                            <span className="chip chip-warning">{newCount} {newLabel}</span>
                        </div>
                    )}
                    {!isRegion && !drilling && <div className="dim lm-tip-hint">Double-click to drill into regions</div>}
                </>
            ),
            data: { countryCode: code, region: row.region ?? null, isRegion, count },
        });
    }
    return out;
}

function listMarkers(
    rows: readonly LoginEventRow[],
    opts: { scoped: boolean; onOpenUser?: (id: number) => void },
): WorldMapMarker<LoginEventRow>[] {
    const out: WorldMapMarker<LoginEventRow>[] = [];
    for (const row of rows) {
        const { latitude: lat, longitude: lng } = row;
        if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const where = [row.city, row.region, row.country_code].filter(Boolean).join(', ');
        out.push({
            id: `login-${row.id}`,
            lat,
            lng,
            size: LIST_MARKER_SIZE,
            tone: loginRiskTone(row),
            legendKey: loginRiskLegendKey(row),
            label: where || 'Unknown location',
            detail: (
                <>
                    {row.ip_address && <div><code>{row.ip_address}</code></div>}
                    <div className="dim">{fmt.datetime(row.created)}</div>
                    {row.source && <div className="dim">via {row.source}</div>}
                    {(row.is_new_country || row.is_new_region) && (
                        <div className="lm-tip-chips">
                            {row.is_new_country && <span className="chip chip-danger">New country</span>}
                            {!row.is_new_country && row.is_new_region && <span className="chip chip-warning">New region</span>}
                        </div>
                    )}
                    {/* The "View user" button web-mojo built as an HTML string
                        with an unescaped display_name — a ReactNode slot here. */}
                    {!opts.scoped && row.user?.id != null && opts.onOpenUser && (
                        <button
                            type="button"
                            className="btn btn-compact lm-tip-user"
                            onClick={(e) => { e.stopPropagation(); opts.onOpenUser?.(row.user!.id); }}
                        >
                            <i className="bi bi-person" /> {row.user.display_name || row.user.username || 'View user'}
                        </button>
                    )}
                </>
            ),
            data: row,
        });
    }
    return out;
}

export function LoginLocationMap({
    userId = null,
    height = 360,
    drStart = null,
    drEnd = null,
    defaultMode = 'summary',
    onCountrySelect,
    onOpenUser,
    onOpenLogin,
    showModeToggle = true,
    enabled = true,
    className = '',
}: LoginLocationMapProps) {
    const [mode, setMode] = useState<LoginMapMode>(defaultMode);
    const [drillCountry, setDrillCountry] = useState<string | null>(null);
    const scoped = Number.isInteger(userId);

    const summary = useLoginLocationSummary({
        userId,
        countryCode: drillCountry,
        drStart,
        drEnd,
        enabled: enabled && mode === 'summary',
    });
    const list = useLoginLocationList({
        userId,
        drStart,
        drEnd,
        size: 500,
        enabled: enabled && mode === 'list',
    });

    const summaryRows = summary.data ?? [];
    const listRows = list.data?.rows ?? [];
    // Coastlines arrive in their own chunk; until then WorldMap draws the
    // graticule fallback, which every element of this surface is legible on.
    const land = useWorldLand();

    const markers = useMemo<WorldMapMarker<LoginMarkerData>[]>(() => (
        mode === 'summary'
            ? summaryMarkers(summaryRows, drillCountry != null) as WorldMapMarker<LoginMarkerData>[]
            : listMarkers(listRows, { scoped, onOpenUser }) as WorldMapMarker<LoginMarkerData>[]
    ), [mode, summaryRows, listRows, drillCountry, scoped, onOpenUser]);

    const pending = mode === 'summary' ? summary.isPending : list.isPending;
    const error = mode === 'summary' ? summary.error : list.error;

    // The status line is the source's `setStatus()`, and it carries the
    // information the map itself cannot: logins with no country never reach
    // these endpoints at all (`/summary` excludes null/empty country_code,
    // and private-range logins carry no coordinates), so a silent absence
    // would otherwise read as missing data.
    const status: ReactNode = (() => {
        if (!enabled) return 'You do not have permission to read login geography.';
        if (error) return <span className="text-bad">{error.message}</span>;
        if (pending) return 'Loading locations…';
        if (mode === 'summary') {
            const total = summaryRows.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
            if (!summaryRows.length) return 'No login locations found.';
            const noun = drillCountry ? 'region' : 'country';
            const n = summaryRows.length;
            return `${total.toLocaleString()} login${total === 1 ? '' : 's'} across ${n} ${noun}${n === 1 ? '' : drillCountry ? 's' : 'ies'}`;
        }
        const plotted = markers.length;
        const missing = listRows.length - plotted;
        if (!plotted && !missing) return 'No login events with location data found.';
        return `${plotted.toLocaleString()} login${plotted === 1 ? '' : 's'} plotted`
            + (missing > 0 ? ` · ${missing.toLocaleString()} without coordinates (see the Logins tab)` : '');
    })();

    const switchMode = (next: LoginMapMode) => {
        if (next === mode) return;
        setDrillCountry(null);
        setMode(next);
    };

    return (
        <div className={`login-location-map${className ? ` ${className}` : ''}`}>
            <div className="lm-toolbar">
                {drillCountry && (
                    <div className="lm-drill">
                        <button className="btn btn-compact" onClick={() => setDrillCountry(null)}>
                            <i className="bi bi-arrow-left" /> All countries
                        </button>
                        <span className="dim">Regions in {countryName(drillCountry) || drillCountry}</span>
                    </div>
                )}
                {showModeToggle && (
                    <div className="lm-modes" role="group" aria-label="Map data mode">
                        <button
                            type="button"
                            className={`btn btn-compact${mode === 'summary' ? ' btn-primary' : ''}`}
                            onClick={() => switchMode('summary')}
                            title="Aggregated by country"
                        >
                            <i className="bi bi-globe-americas" /> Summary
                        </button>
                        <button
                            type="button"
                            className={`btn btn-compact${mode === 'list' ? ' btn-primary' : ''}`}
                            onClick={() => switchMode('list')}
                            title="Every login"
                        >
                            <i className="bi bi-pin-map" /> Every login
                        </button>
                    </div>
                )}
            </div>

            <WorldMap<LoginMarkerData>
                markers={markers}
                height={height}
                land={land}
                loading={pending}
                status={status}
                emptyText={mode === 'summary' ? 'No login locations to plot' : 'No plottable login events'}
                showLegend={mode === 'list'}
                legend={mode === 'list' ? LOGIN_RISK_LEGEND : undefined}
                // Re-fit after a drill so a country's regions fill the frame
                // (the source's post-drillDown fitBounds()).
                fit={mode === 'summary' && drillCountry ? 'markers' : 'none'}
                onMarkerClick={(marker) => {
                    const data = marker.data;
                    if (mode === 'list') {
                        const row = data as LoginEventRow | undefined;
                        if (row?.id != null) onOpenLogin?.(row.id);
                        return;
                    }
                    const summaryData = data as LoginSummaryMarkerData | undefined;
                    if (summaryData?.countryCode) onCountrySelect?.(summaryData.countryCode);
                }}
                onMarkerDoubleClick={(marker) => {
                    // Drill-down is summary-mode + country-markers only —
                    // exactly the source's `if (!data || data._isRegion) return`.
                    if (mode !== 'summary' || drillCountry) return;
                    const data = marker.data as LoginSummaryMarkerData | undefined;
                    if (!data || data.isRegion || !data.countryCode) return;
                    setDrillCountry(data.countryCode);
                }}
            />
        </div>
    );
}
