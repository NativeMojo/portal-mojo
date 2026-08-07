// Device / login-location model layer — the CANONICAL definitions of
// `/api/user/device`, `/api/user/device/location` and `/api/account/logins`.
// `admin/identity/users/models.ts` RE-EXPORTS from here: one endpoint must
// never have two `defineModel` calls, because two definitions mean two cache
// keys and therefore a double fetch of the same rows.
//
// Ported from web-mojo `admin/account/devices/DeviceView.js` (961),
// `UserDeviceLocationView.js` (465) and `LoginLocationMapView.js` (422 — the
// DATA half only; rendering belongs to #1426's WorldMap), reconciled against
// `django-mojo/mojo/apps/account/models/device.py`, `models/login_event.py`,
// `rest/device.py` and `rest/login_event.py` (all read in full 2026-08-06).
//
// Backend-forced corrections carried here:
//   · `is_trusted` / `is_blocked` DO NOT EXIST on UserDevice. The source's
//     active toggle, "Mark trusted/untrusted" kebab item, Trusted/Blocked
//     chips and trust timeline row all wrote a field the model never had.
//   · `event_type` DOES NOT EXIST on UserLoginEvent, so the source's
//     EVENT_COLORS map coloured every marker grey. Risk tone here rides
//     `is_new_country` / `is_new_region`, which are real and are the actual
//     triage question.
//   · No model here declares `CAN_DELETE`, and `rest.py` defaults it to
//     False — "Forget device", "Delete GeoIP record" and "Delete location
//     record" are all impossible.
//   · `UserDevice` declares NO `SEARCH_FIELDS`; only DUID/user-agent text is
//     searchable via the default fallback, so the UI must not promise more.
import { useQuery } from '@tanstack/react-query';
import {
    defineModel, mojoCall, mojoList, useAuthSnapshot,
    type Params,
} from '../../../client';
import type { WorldMapTone } from '../../../charts';
import type { GeoLocatedIPRow } from '../geoip/models';

// ── Permissions (backend-derived, `sys.`-pinned, fail-closed) ─────────
//
// `sys.manage_devices` is DELIBERATELY ABSENT from every clause below. It
// passes the `@requires_global_perms` decorator on `/user/device/location`
// and `/user/device/lookup`, but it is NOT in `UserDeviceLocation.VIEW_PERMS`
// (`manage_users | users`), so a caller holding only `manage_devices` gets
// through the URL gate and is then denied by the model. Alone it opens
// nothing; offering it as an affordance gate would promise access the server
// refuses.

/** `UserDevice.RestMeta.VIEW_PERMS` minus `owner` (that is the self path). */
export const USER_DEVICE_VIEW_PERMS = ['sys.manage_users', 'sys.users'];

/** URL decorator ∩ `UserDeviceLocation.RestMeta.VIEW_PERMS`. */
export const DEVICE_LOCATION_VIEW_PERMS = ['sys.manage_users', 'sys.users'];

/** `UserLoginEvent.RestMeta.VIEW_PERMS` minus `owner`. */
export const LOGIN_EVENT_VIEW_PERMS = ['sys.manage_users', 'sys.security', 'sys.users'];

/** `@requires_global_perms` on `/account/logins/summary` and `/account/logins/user`. */
export const LOGIN_SUMMARY_PERMS = ['sys.manage_users', 'sys.security', 'sys.users'];

// ── Shared sub-graphs ─────────────────────────────────────────────────

/** `parse_user_agent` output — the `device_info` JSONField, verbatim. */
export interface UAInfo {
    os: { major: string | null; minor: string | null; patch: string | null; family: string; patch_minor: string | null };
    device: { brand: string | null; model: string | null; family: string };
    user_agent: { major: string | null; minor: string | null; patch: string | null; family: string };
    string: string;
}

/** The `basic` User sub-graph every row below embeds. */
export interface UserBasicRef {
    id: number;
    display_name: string | null;
    username: string;
    last_login: number | null;
    last_activity: number | null;
    is_active: boolean;
    is_email_verified: boolean;
    is_phone_verified: boolean;
    is_dob_verified: boolean;
    avatar: unknown;
}

// ── UserDevice ────────────────────────────────────────────────────────

/** `/api/user/device` default graph. NOTE: no `is_trusted`, no `is_blocked`. */
export interface UserDeviceRow {
    id: number;
    user: UserBasicRef | null;
    /** Server-controlled device identity (the HttpOnly `_muid` cookie). */
    muid: string | null;
    /** Client-claimed localStorage id; `ua-hash-…` for API-born devices. */
    duid: string;
    device_info: UAInfo | null;
    user_agent_hash: string | null;
    last_ip: string | null;
    first_seen: number;
    last_seen: number;
}

/** One `active_sessions[]` tab entry (BouncerSignal, grouped by `mtab`). */
export interface DeviceSessionTab {
    mtab: string;
    started: number;
    last_activity: number;
    signal_count: number;
}

/** One 24h browser session, grouped by `msid`. */
export interface DeviceSession {
    msid: string;
    started: number;
    last_activity: number;
    ip: string | null;
    signal_count: number;
    tabs: DeviceSessionTab[];
}

/** `recent_locations[]` — the last 10 locations, flattened by the property. */
export interface DeviceRecentLocation {
    ip_address: string;
    first_seen: number;
    last_seen: number;
    city?: string;
    country?: string;
}

/** Pre-auth reputation for this device's MUID (`BouncerDevice`). */
export interface DeviceBouncerRef {
    risk_tier: string;
    event_count: number;
    block_count: number;
    fingerprint_id: string;
    first_seen: number;
    last_seen: number;
}

/**
 * The `sessions` graph. DeviceView's "Session history is not yet recorded
 * server-side" placeholder is OBSOLETE — `bouncer_device`, `active_sessions`
 * and `recent_locations` are all real `extra` properties on the model.
 */
export interface UserDeviceSessionsRow {
    id: number;
    user: UserBasicRef | null;
    muid: string | null;
    duid: string;
    device_info: UAInfo | null;
    last_ip: string | null;
    first_seen: number;
    last_seen: number;
    bouncer_device: DeviceBouncerRef | null;
    active_sessions: DeviceSession[];
    recent_locations: DeviceRecentLocation[];
}

export const UserDeviceModel = defineModel<UserDeviceRow>({
    name: 'user_device',
    endpoint: '/api/user/device',
    permissions: { view: USER_DEVICE_VIEW_PERMS },
});

/** Graph is part of the key so a sparse default row cannot satisfy it. */
export function deviceSessionsKey(id: number) {
    return [UserDeviceModel.endpoint, 'one', id, { graph: 'sessions' }] as const;
}

export function useUserDeviceSessions(id: number | null, enabled = true) {
    return useQuery({
        queryKey: id == null
            ? [UserDeviceModel.endpoint, 'one', null, { graph: 'sessions' }] as const
            : deviceSessionsKey(id),
        queryFn: async () => {
            const body = await mojoCall(`${UserDeviceModel.endpoint}/${id!}`, { params: { graph: 'sessions' } });
            return body.data as UserDeviceSessionsRow;
        },
        enabled: enabled && id != null,
    });
}

// ── UserDeviceLocation ────────────────────────────────────────────────

/**
 * The `user_device` sub-graph on a location row is `basic`:
 * `["muid","duid","last_ip","last_seen","device_info"]` — it carries NO `id`,
 * so a cross-link from a location back to its device must resolve by `duid`.
 */
export interface DeviceLocationDeviceRef {
    muid: string | null;
    duid: string;
    last_ip: string | null;
    last_seen: number;
    device_info: UAInfo | null;
}

export interface UserDeviceLocationRow {
    id: number;
    user: UserBasicRef | null;
    user_device: DeviceLocationDeviceRef | null;
    ip_address: string;
    /** The embedded GeoLocatedIP `default` graph, or null while unenriched. */
    geolocation: GeoLocatedIPRow | null;
    first_seen: number;
    last_seen: number;
}

export const UserDeviceLocationModel = defineModel<UserDeviceLocationRow>({
    name: 'user_device_location',
    endpoint: '/api/user/device/location',
    permissions: { view: DEVICE_LOCATION_VIEW_PERMS },
});

// ── UserLoginEvent ────────────────────────────────────────────────────

/**
 * `/api/account/logins`. `CAN_CREATE`, `CAN_UPDATE` and `CAN_DELETE` are all
 * explicitly False — this model is read-only by contract, hence no `manage`
 * permission and no actions.
 */
export interface LoginEventRow {
    id: number;
    ip_address: string | null;
    country_code: string | null;
    region: string | null;
    region_code: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    source: string | null;
    is_new_country: boolean;
    is_new_region: boolean;
    created: number;
    modified?: number;
    user: UserBasicRef | null;
    /** `default` graph only — the `basic` UserDevice sub-graph. */
    device?: DeviceLocationDeviceRef | null;
    user_agent_info?: UAInfo | null;
}

export const LoginEventModel = defineModel<LoginEventRow>({
    name: 'login_event',
    endpoint: '/api/account/logins',
    permissions: { view: LOGIN_EVENT_VIEW_PERMS },
});

/**
 * Login risk → map/dot tone, from fields the wire ACTUALLY sends.
 *
 * NOT to be confused with `loginEventTone(eventType)` exported by
 * `portal-mojo/charts`: that one maps the login event-type VOCABULARY
 * (`success_login`, `failed_login`, …) which `UserLoginEvent` has never had a
 * field for — feeding it a row would return `'mute'` for every marker, which
 * is precisely the web-mojo bug this port fixes. Same domain, different
 * input; both are kept because #1287/#1292 may bind a real event-type series.
 */
export function loginRiskTone(row: Pick<LoginEventRow, 'is_new_country' | 'is_new_region'>): WorldMapTone {
    if (row.is_new_country) return 'bad';
    if (row.is_new_region) return 'warn';
    return 'ok';
}

/** The map legend the tone above implies. */
export const LOGIN_RISK_LEGEND: readonly { key: string; label: string; tone: WorldMapTone }[] = [
    { key: 'new-country', label: 'New country', tone: 'bad' },
    { key: 'new-region', label: 'New region', tone: 'warn' },
    { key: 'known', label: 'Known location', tone: 'ok' },
];

export function loginRiskLegendKey(row: Pick<LoginEventRow, 'is_new_country' | 'is_new_region'>): string {
    if (row.is_new_country) return 'new-country';
    if (row.is_new_region) return 'new-region';
    return 'known';
}

// ── Login-location aggregation (the LoginLocationMapView data half) ───

/**
 * One `/summary` or `/user` row. `_build_aggregation` groups by
 * `country_code` (or `country_code, region` while drilling) and annotates
 * `count`, `Avg(latitude)`, `Avg(longitude)` and the matching new-* count.
 * The two branches emit DIFFERENT keys, so both are optional here.
 */
export interface LoginLocationSummaryRow {
    country_code: string | null;
    region?: string | null;
    count: number;
    latitude: number | null;
    longitude: number | null;
    new_country_count?: number;
    new_region_count?: number;
}

export interface LoginLocationSummaryArgs {
    /** Present → `/account/logins/user?user_id=`; absent → `/summary`. */
    userId?: number | null;
    /** Present → drill into this country's regions. Must be /^[A-Z]{2,3}$/. */
    countryCode?: string | null;
    /** YYYY-MM-DD. `/summary` and `/user` accept ONLY dr_start/dr_end. */
    drStart?: string | null;
    drEnd?: string | null;
    enabled?: boolean;
}

const COUNTRY_CODE_RE = /^[A-Z]{2,3}$/;

/** `_validate_country_code`: uppercased, 2–3 letters, else silently ignored. */
export function normalizeCountryCode(value: string | null | undefined): string | null {
    if (!value) return null;
    const upper = String(value).toUpperCase();
    return COUNTRY_CODE_RE.test(upper) ? upper : null;
}

/**
 * Aggregated login geography.
 *
 * Two traps encoded here:
 *   · `login_event.py` reads `request.DATA.get('region')` with NO string
 *     coercion, so the STRING "false" is truthy and would silently drill.
 *     `region=1` is therefore sent ONLY while drilling, never `region=false`.
 *   · `user_id` must parse as an int or the endpoint answers
 *     `{status: false, code: 400}` — a non-numeric id is treated as "no user"
 *     rather than being forwarded.
 */
export function useLoginLocationSummary(args: LoginLocationSummaryArgs) {
    const auth = useAuthSnapshot();
    const userId = Number.isInteger(args.userId) ? Number(args.userId) : null;
    const country = normalizeCountryCode(args.countryCode);
    const path = userId != null ? '/api/account/logins/user' : '/api/account/logins/summary';

    const params: Params = {};
    if (userId != null) params.user_id = userId;
    if (args.drStart) params.dr_start = args.drStart;
    if (args.drEnd) params.dr_end = args.drEnd;
    if (country) {
        params.country_code = country;
        // Only ever sent while drilling — `region=false` would ALSO drill.
        params.region = 1;
    }

    return useQuery({
        queryKey: [path, auth.uid, params] as const,
        queryFn: async (): Promise<LoginLocationSummaryRow[]> => {
            const body = await mojoCall(path, { params });
            const rows = body.data;
            return Array.isArray(rows) ? (rows as LoginLocationSummaryRow[]) : [];
        },
        enabled: args.enabled !== false && auth.authenticated && Boolean(auth.uid),
    });
}

export interface LoginLocationListArgs {
    userId?: number | null;
    drStart?: string | null;
    drEnd?: string | null;
    /** Bounded at 500 — the source's docstring said 500 and its code sent
     *  1000 (LoginLocationMapView.js:208). The docstring is the sane bound. */
    size?: number;
    enabled?: boolean;
}

/** The `list` graph carries lat/lng plus the `basic` user — everything the
 *  "every login" mode plots and every tooltip needs, and nothing more. */
export function useLoginLocationList(args: LoginLocationListArgs) {
    const auth = useAuthSnapshot();
    const userId = Number.isInteger(args.userId) ? Number(args.userId) : null;
    const params: Params = {
        graph: 'list',
        sort: '-created',
        size: Math.min(500, Math.max(1, args.size ?? 500)),
    };
    if (userId != null) params.user = userId;
    // The LIST endpoint uses the dr_field/dr_start/dr_end triple — a different
    // wire from /summary's bare dr_start/dr_end. Always name dr_field.
    if (args.drStart || args.drEnd) {
        params.dr_field = 'created';
        if (args.drStart) params.dr_start = args.drStart;
        if (args.drEnd) params.dr_end = args.drEnd;
    }
    return useQuery({
        queryKey: [LoginEventModel.endpoint, 'list', auth.uid, params] as const,
        queryFn: () => mojoList<LoginEventRow>(LoginEventModel.endpoint, params),
        enabled: args.enabled !== false && auth.authenticated && Boolean(auth.uid),
    });
}

// ── Device presentation helpers (DeviceView.js pure functions) ────────

/** "Chrome 148" — `browserLabel` from DeviceView.js:64-68. */
export function browserLabel(info: UAInfo | null | undefined): string {
    const ua = info?.user_agent;
    const parts = [ua?.family, ua?.major].filter(Boolean);
    return parts.length ? parts.join(' ') : 'Unknown browser';
}

/** "Mac OS X 10.15" — `osLabel` from DeviceView.js:71-75. */
export function osLabel(info: UAInfo | null | undefined): string {
    const os = info?.os;
    if (!os?.family) return 'Unknown OS';
    const version = [os.major, os.minor].filter(Boolean).join('.');
    return `${os.family} ${version}`.trim();
}

/** "Apple iPhone" — `_getDevice` from UserDeviceLocationView.js:123-127. */
export function deviceLabel(info: UAInfo | null | undefined): string {
    const device = info?.device;
    const parts = [device?.brand, device?.family].filter(Boolean);
    return parts.length ? parts.join(' ') : 'Unknown device';
}

/** Full dotted browser version, empty when the UA carried none. */
export function browserVersion(info: UAInfo | null | undefined): string {
    const ua = info?.user_agent;
    return [ua?.major, ua?.minor, ua?.patch].filter((v) => v != null && v !== '').join('.');
}

export function osVersion(info: UAInfo | null | undefined): string {
    const os = info?.os;
    return [os?.major, os?.minor, os?.patch].filter((v) => v != null && v !== '').join('.');
}

/** `pickIcon` from DeviceView.js:78-94, verbatim precedence. */
export function deviceIcon(info: UAInfo | null | undefined): string {
    const browser = (info?.user_agent?.family ?? '').toLowerCase();
    const os = (info?.os?.family ?? '').toLowerCase();
    const device = (info?.device?.family ?? '').toLowerCase();
    if (browser.includes('chrome')) return 'bi-browser-chrome';
    if (browser.includes('firefox')) return 'bi-browser-firefox';
    if (browser.includes('safari')) return 'bi-browser-safari';
    if (browser.includes('edge')) return 'bi-browser-edge';
    if (os.includes('mac') || os.includes('ios')) return 'bi-apple';
    if (os.includes('windows')) return 'bi-windows';
    if (os.includes('android')) return 'bi-android2';
    if (os.includes('linux')) return 'bi-ubuntu';
    if (device.includes('iphone')) return 'bi-phone';
    if (device.includes('ipad')) return 'bi-tablet';
    return 'bi-laptop';
}

/** `daysActive` from DeviceView.js:118-123 — first_seen → last_seen span. */
export function daysActive(row: Pick<UserDeviceRow, 'first_seen' | 'last_seen'> | null | undefined): number | null {
    if (row?.first_seen == null || row.last_seen == null) return null;
    return Math.max(0, Math.floor((row.last_seen - row.first_seen) / 86400));
}

export type DevicePresence = 'online' | 'offline' | 'never';

/** `_buildHeaderAux`'s presence rule: online when last_seen < 5 minutes. */
export function presenceOf(lastSeen: number | null | undefined): DevicePresence {
    if (lastSeen == null) return 'never';
    return Date.now() / 1000 - lastSeen < 300 ? 'online' : 'offline';
}

// ── Cross-account sharing ─────────────────────────────────────────────

/**
 * "Is this device shared across accounts?" — the item's headline question.
 *
 * `UserDevice` is unique on `(user, duid)`, so the SAME physical browser
 * signing into two accounts produces two rows sharing a `muid` (and usually
 * a `duid`). MUID is server-controlled and therefore authoritative; pre-
 * Bouncer rows have an empty `muid` and fall back to `duid`.
 */
export function useDeviceSiblings(device: UserDeviceRow | null | undefined, enabled = true) {
    const muid = device?.muid || '';
    const duid = device?.duid || '';
    const key: Params = muid ? { muid } : duid ? { duid } : {};
    const usable = Boolean(muid || duid);
    const query = UserDeviceModel.useList(
        { ...key, size: 25, sort: '-last_seen' },
        { enabled: enabled && usable },
    );
    const siblings = (query.data?.rows ?? []).filter((row) => row.id !== device?.id);
    return { ...query, siblings };
}
