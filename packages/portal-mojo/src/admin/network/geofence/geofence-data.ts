// geofence-data — pure data + mapping helpers for BOTH geofence surfaces:
// the platform page (admin/network/geofence/*) and the group-scoped panel
// (apps/portal/src/pages/group-sections/GeofenceSection.tsx).
//
// PROVENANCE. This is the promotion of web-mojo
// `src/extensions/admin/security/geofence/geofenceData.js` (463 lines, read in
// full 2026-08-06) plus the country/US-state tables from
// `GeofenceRuleForm.js`. Wave 4 had already lifted ~13 of those exports into
// `apps/portal/src/pages/group-sections/geofence-data.ts`; that file is now a
// re-export shim over THIS module, so the lossy rule↔form projection is
// defined exactly once (the source file's own docstring warns about precisely
// that duplication).
//
// The module stays framework-free on purpose — no React, no query client, no
// client transport. Its only import is the country table (#1426), which is
// plain data.
//
// Rule DSL (django-mojo services/geofence/dsl.py:20-22 — top keys
// {country, region, abuse}, operators {in, not_in, eq}, abuse flags
// {tor, vpn, datacenter, proxy}):
//   {
//     country: { in: [..] } | { not_in: [..] } | { eq: 'US' },
//     region:  { in: [..] } | { not_in: [..] } | { eq: 'US-CA' },   // ISO 3166-2
//     abuse:   { tor: false, vpn: false, datacenter: false, proxy: false }
//   }
// Abuse flag semantics: false → block when detected; true → require the flag
// (rare — not expressible in the friendly editor); absent/null → don't care.
import { COUNTRY_OPTIONS, countryName } from '../../../charts/worldmap/countryCentroids';

// The country table is #1426's (`portal-mojo/charts`). web-mojo derived its
// picker from the same centroid table; the inline 249-entry copy that wave 4
// carried is DELETED rather than moved — one country-name source, package-wide.
export { COUNTRY_OPTIONS, countryName };
export {
    GEOFENCE_MANAGE_PERMS, GEOFENCE_VIEW_PERMS, GROUP_GEOFENCE_EDIT_PERMS, SECURITY_EVENTS_PERMS,
} from './permissions';

// ── Permissions ───────────────────────────────────────────────────────
// Geofence config is PLATFORM-WIDE. `@md.requires_global_perms` on every
// `/api/geo/*` route authorizes against global `User.permissions` (or
// superuser) ONLY — no group fallback, and a GroupScopedToken is refused
// outright. So every clause here is `sys.`-pinned: a member grant must never
// open platform enforcement config.

// ── US states (ISO 3166-2 region codes) ───────────────────────────────

export const US_STATES: { value: string; label: string }[] = [
    { value: 'US-AL', label: 'Alabama' },
    { value: 'US-AK', label: 'Alaska' },
    { value: 'US-AZ', label: 'Arizona' },
    { value: 'US-AR', label: 'Arkansas' },
    { value: 'US-CA', label: 'California' },
    { value: 'US-CO', label: 'Colorado' },
    { value: 'US-CT', label: 'Connecticut' },
    { value: 'US-DE', label: 'Delaware' },
    { value: 'US-DC', label: 'District of Columbia' },
    { value: 'US-FL', label: 'Florida' },
    { value: 'US-GA', label: 'Georgia' },
    { value: 'US-HI', label: 'Hawaii' },
    { value: 'US-ID', label: 'Idaho' },
    { value: 'US-IL', label: 'Illinois' },
    { value: 'US-IN', label: 'Indiana' },
    { value: 'US-IA', label: 'Iowa' },
    { value: 'US-KS', label: 'Kansas' },
    { value: 'US-KY', label: 'Kentucky' },
    { value: 'US-LA', label: 'Louisiana' },
    { value: 'US-ME', label: 'Maine' },
    { value: 'US-MD', label: 'Maryland' },
    { value: 'US-MA', label: 'Massachusetts' },
    { value: 'US-MI', label: 'Michigan' },
    { value: 'US-MN', label: 'Minnesota' },
    { value: 'US-MS', label: 'Mississippi' },
    { value: 'US-MO', label: 'Missouri' },
    { value: 'US-MT', label: 'Montana' },
    { value: 'US-NE', label: 'Nebraska' },
    { value: 'US-NV', label: 'Nevada' },
    { value: 'US-NH', label: 'New Hampshire' },
    { value: 'US-NJ', label: 'New Jersey' },
    { value: 'US-NM', label: 'New Mexico' },
    { value: 'US-NY', label: 'New York' },
    { value: 'US-NC', label: 'North Carolina' },
    { value: 'US-ND', label: 'North Dakota' },
    { value: 'US-OH', label: 'Ohio' },
    { value: 'US-OK', label: 'Oklahoma' },
    { value: 'US-OR', label: 'Oregon' },
    { value: 'US-PA', label: 'Pennsylvania' },
    { value: 'US-RI', label: 'Rhode Island' },
    { value: 'US-SC', label: 'South Carolina' },
    { value: 'US-SD', label: 'South Dakota' },
    { value: 'US-TN', label: 'Tennessee' },
    { value: 'US-TX', label: 'Texas' },
    { value: 'US-UT', label: 'Utah' },
    { value: 'US-VT', label: 'Vermont' },
    { value: 'US-VA', label: 'Virginia' },
    { value: 'US-WA', label: 'Washington' },
    { value: 'US-WV', label: 'West Virginia' },
    { value: 'US-WI', label: 'Wisconsin' },
    { value: 'US-WY', label: 'Wyoming' },
];

const US_STATE_NAMES: Record<string, string> = Object.fromEntries(US_STATES.map((s) => [s.value, s.label]));
const US_STATE_CODES = new Set(US_STATES.map((s) => s.value));

/** State/region code → display name ('US-WA' → 'Washington'; unknown → code). */
export function regionName(code: string | null | undefined): string {
    if (!code) return '';
    return US_STATE_NAMES[String(code).toUpperCase()] ?? String(code);
}

export const COUNTRY_MODE_OPTS = [
    { value: '', label: 'No country rule' },
    { value: 'block', label: 'Block the listed countries' },
    { value: 'allow', label: 'Allow only the listed countries' },
];

// ── Abuse flags ───────────────────────────────────────────────────────

export const ABUSE_FLAGS = [
    { key: 'vpn', label: 'VPN connections', help: 'Commercial VPN exit addresses.' },
    { key: 'tor', label: 'Tor connections', help: 'Tor exit nodes.' },
    { key: 'proxy', label: 'Open proxies', help: 'Open/anonymous proxies.' },
    { key: 'datacenter', label: 'Datacenter IPs', help: 'Cloud-hosted addresses (AWS, GCP, …) — can affect legitimate automation.' },
] as const;

export type AbuseFlagKey = (typeof ABUSE_FLAGS)[number]['key'];

// ── Endpoint scopes ───────────────────────────────────────────────────
// Scopes are deployment-defined strings — django-mojo core ships only 'auth'.
// Friendly labels for the ones we know; raw name for everything else.

const SCOPE_LABELS: Record<string, string> = { auth: 'Sign-in endpoints (auth)' };

export function scopeLabel(scope: string | null | undefined): string {
    if (!scope) return 'All endpoints';
    return SCOPE_LABELS[scope] ?? `${scope} endpoints`;
}

// ── GET /api/geo/rules — the config-plane payload, key for key ────────
// mojo/apps/account/rest/geofence.py:191-218. Every field below is written by
// the backend; nothing is invented, and nothing the backend writes is dropped.

/** A geofence rule as stored (unknown shapes flip the editor to advanced). */
export type GeofenceRule = Record<string, unknown>;

export interface GeoPosture {
    /** GEOFENCE_ENABLED — the "is it enforcing" answer. Default true. */
    enabled?: boolean;
    /** GEOFENCE_FAIL_CLOSED — global fail posture. Default false. */
    fail_closed?: boolean;
    /** GEOFENCE_FAIL_CLOSED_SCOPES — per-scope override list. */
    fail_closed_scopes?: string[];
    /** GEOFENCE_ALLOW_PRIVATE_IPS. Default true. */
    allow_private_ips?: boolean;
    /**
     * GEOFENCE_STRICT_POSTURE. When true, an empty ruleset DENIES
     * (`no_rules_strict`) rather than passing through.
     */
    strict_posture?: boolean;
    /** GEOFENCE_CACHE_TTL, seconds. Default 300. */
    cache_ttl?: number | null;
}

export interface GeoEnforcedEndpoint {
    /** `<module>.<func>` of the decorated view. */
    endpoint: string;
    scope?: string | null;
    /** Present (and true) only for endpoints gated AFTER credentials. */
    after_auth?: boolean;
}

export interface GeoAllowlistSummary {
    setting_entries?: number;
    geoip_active?: number;
}

/** The platform floor, this group's rule (when asked for), posture, endpoints. */
export interface GeoRulesConfig {
    system?: { rule?: GeofenceRule | null; source?: string | null; modified?: string | null } | null;
    /** Present ONLY when the request carried `group_uuid`. */
    group?: {
        id?: number;
        uuid?: string;
        is_active?: boolean;
        rule?: GeofenceRule | null;
        strict_posture?: boolean | null;
        strict_posture_effective?: boolean;
    } | null;
    posture?: GeoPosture | null;
    allowlist_summary?: GeoAllowlistSummary | null;
    evaluation_order?: string[];
    enforced_endpoints?: GeoEnforcedEndpoint[];
}

/** Unique scope list from a GET /api/geo/rules payload (enforced_endpoints ∪ fail_closed_scopes). */
export function collectScopes(config: GeoRulesConfig | null | undefined): string[] {
    const scopes = new Set<string>();
    for (const entry of config?.enforced_endpoints ?? []) {
        if (entry?.scope) scopes.add(entry.scope);
    }
    for (const scope of config?.posture?.fail_closed_scopes ?? []) {
        if (scope) scopes.add(scope);
    }
    return [...scopes].sort();
}

// ── The decision shape (engine._build_decision + simulate) ────────────

export interface GeoDecision {
    allowed?: boolean;
    reason?: string;
    detail?: string;
    ip?: string | null;
    /** `country` and `country_code` carry the SAME value (engine.py:317-318). */
    country?: string | null;
    country_code?: string | null;
    region?: string | null;
    region_code?: string | null;
    abuse?: Partial<Record<AbuseFlagKey, boolean>>;
    checked_at?: string;
    rule_level?: string | null;
    strict_posture?: boolean;
    /**
     * BACKEND CORRECTION. `enabled` sits at the TOP level of a simulate
     * decision (`engine.py:473 — dec.enabled = enabled`), and is absent from
     * `check()` decisions entirely. web-mojo read `decision.posture.enabled`,
     * a key the decision has never carried, so its "geofencing is currently
     * off" notice could never fire.
     */
    enabled?: boolean;
    /** The next five appear ONLY when the IP matched the allowlist. */
    would_block?: boolean | null;
    would_block_reason?: string | null;
    allowlist_source?: string | null;
    allowlist_reason?: string | null;
    allowlist_until?: string | null;
}

export interface AllowlistEntry {
    /** `norm.cidr || norm.ip` — a bare-string entry normalizes to `{cidr}`. */
    cidr: string;
    reason?: string | null;
    until?: string | null;
    /** Expired entries are LISTED with active=false, never hidden. */
    active?: boolean;
}

export interface GeoIpAllowlistEntry {
    ip: string;
    reason?: string | null;
    until?: string | null;
    active?: boolean;
}

export interface AllowlistPayload {
    setting?: AllowlistEntry[];
    geoip?: GeoIpAllowlistEntry[];
}

export interface BypassHolder {
    id: number;
    username: string;
    is_active: boolean;
    /** 'permission' | 'superuser'. */
    source: string;
    /** The raw `permissions.bypass_geofence` value; not rendered (PII-adjacent). */
    value?: unknown;
}

export interface BypassHoldersPayload {
    holders?: BypassHolder[];
    count?: number;
    capped?: boolean;
}

// ── Decision reasons → plain language ─────────────────────────────────

function countryPhrase(decision: GeoDecision | null | undefined): string {
    return decision?.country || decision?.country_code || 'this country';
}

function regionPhrase(decision: GeoDecision | null | undefined): string {
    const code = decision?.region_code;
    if (code && US_STATE_NAMES[String(code).toUpperCase()]) {
        return US_STATE_NAMES[String(code).toUpperCase()]!;
    }
    return decision?.region || code || 'this region';
}

/**
 * Every key of `GeoFenceEngine._DETAIL_MAP` (engine.py:328-345), in the
 * backend's own order. BACKEND CORRECTION: `no_rules_strict` is the fifth
 * entry there and was MISSING from web-mojo's REASON_TEXT — a strict-posture
 * denial (the one denial an operator most needs explained) fell through to the
 * generic "reason: no rules strict." fallback.
 */
const REASON_TEXT: Record<string, (d: GeoDecision) => string> = {
    no_rules: () => 'Allowed — no geofence rules are configured.',
    disabled: () => 'Allowed — geofencing is turned off.',
    bypass: () => 'Allowed — this user bypasses geofencing.',
    ip_allowlisted: (d) => `Allowed by exemption${d?.allowlist_reason ? ` (${d.allowlist_reason})` : ''}.`,
    no_rules_strict: () => 'Blocked — geofencing is required but no rules are configured (strict posture).',
    passed: () => 'Allowed — no rules match this location.',
    lookup_failed: (d) => (d && d.allowed === false)
        ? 'Blocked — location lookup unavailable (fail-closed endpoint).'
        : 'Allowed while location lookup was unavailable (fail-open).',
    private_ip: () => 'Allowed — private/internal network address.',
    country_not_allowed: (d) => `Blocked — ${countryPhrase(d)} is not allowed by the rules.`,
    region_not_allowed: (d) => `Blocked — ${regionPhrase(d)} is not allowed by the rules.`,
    tor_detected: () => 'Blocked — Tor connection detected.',
    vpn_detected: () => 'Blocked — VPN connection detected.',
    proxy_detected: () => 'Blocked — open proxy detected.',
    datacenter_detected: () => 'Blocked — datacenter IP detected.',
    rule_invalid: () => 'Request denied — an invalid rule reached the engine. Check recent rule edits.',
    group_inactive: () => 'This group is inactive — platform rules were applied.',
};

/** Every reason code this projection knows — the verifier asserts parity. */
export const GEOFENCE_REASON_CODES: readonly string[] = Object.keys(REASON_TEXT);

const warnedReasons = new Set<string>();

/**
 * Plain-language sentence for a decision-ish object `{reason, allowed, …}`.
 * Also used for blocks-log rows, where the event metadata carries the same
 * reason codes. An unknown code degrades to a readable fallback AND warns
 * once — house rule 4: never "render nothing", never silence.
 */
export function describeDecision(decision: GeoDecision | null | undefined): string {
    const reason = decision?.reason;
    const fn = reason ? REASON_TEXT[reason] : null;
    if (fn) return fn(decision ?? {});
    if (reason && !warnedReasons.has(reason)) {
        warnedReasons.add(reason);
        console.warn(`geofence: unknown decision reason "${reason}" — rendering the generic fallback. Add it to REASON_TEXT if the backend introduced it.`);
    }
    const verb = decision?.allowed === false ? 'Blocked' : (decision?.allowed ? 'Allowed' : 'Decision');
    return reason ? `${verb} — reason: ${String(reason).replace(/_/g, ' ')}.` : `${verb}.`;
}

/**
 * "Would otherwise block" line for exempted decisions; '' when not applicable.
 * `would_block` is deliberately NULLABLE on the wire: when the shadow decision
 * was `lookup_failed` the backend sets both shadow fields to null because it
 * genuinely does not know (engine.py:370-373).
 */
export function describeWouldBlock(decision: GeoDecision | null | undefined): string {
    if (!decision || decision.reason !== 'ip_allowlisted' || !decision.would_block) return '';
    const why = decision.would_block_reason
        ? describeDecision({ ...decision, reason: decision.would_block_reason, allowed: false })
        : 'Blocked.';
    return `Without this exemption the request would be blocked: ${why.replace(/^Blocked — /, '').replace(/\.$/, '')}.`;
}

// ── Rule ↔ friendly-form mapping ──────────────────────────────────────

const RULE_TOP_KEYS = ['country', 'region', 'abuse'];
const MATCHER_OPS = ['in', 'not_in', 'eq'];

export interface RuleForm {
    country_mode: '' | 'allow' | 'block';
    countries: string[]; // ISO2 codes
    blocked_states: string[]; // 'US-XX' codes
    block_vpn: boolean;
    block_tor: boolean;
    block_proxy: boolean;
    block_datacenter: boolean;
}

export const EMPTY_RULE_FORM: RuleForm = Object.freeze({
    country_mode: '',
    countries: [],
    blocked_states: [],
    block_vpn: false,
    block_tor: false,
    block_proxy: false,
    block_datacenter: false,
});

function isDict(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * True when a rule uses DSL shapes the friendly editor cannot represent —
 * the editor must flip to advanced-JSON mode instead of silently rewriting:
 *   - unknown top-level keys / non-dict bodies
 *   - country: eq, multiple operators, or an allow+block mix
 *   - region: anything other than a single not_in of US state codes
 *   - abuse: a `true` (require-flag) value or unknown flags
 */
export function isAdvancedRule(rule: unknown): boolean {
    if (rule === null || rule === undefined) return false;
    if (!isDict(rule)) return true;
    for (const key of Object.keys(rule)) {
        if (!RULE_TOP_KEYS.includes(key)) return true;
        const body = rule[key];
        if (!isDict(body)) return true;
        if (key === 'abuse') {
            for (const [flag, val] of Object.entries(body)) {
                if (!ABUSE_FLAGS.some((f) => f.key === flag)) return true;
                if (val !== false && val !== null) return true; // `true` = require-flag → advanced
            }
            continue;
        }
        const ops = Object.keys(body);
        if (ops.some((op) => !MATCHER_OPS.includes(op))) return true;
        if (ops.length > 1) return true;
        if (key === 'country') {
            if (ops[0] === 'eq') return true;
            if (ops.length && !Array.isArray(body[ops[0]!])) return true;
        }
        if (key === 'region') {
            if (ops[0] !== 'not_in') return true;
            if (!Array.isArray(body.not_in)) return true;
            if ((body.not_in as unknown[]).some((c) => !US_STATE_CODES.has(String(c).toUpperCase()))) return true;
        }
    }
    return false;
}

/**
 * Project a representable rule onto the friendly form values. Call
 * `isAdvancedRule` first — unrepresentable shapes project best-effort.
 */
export function ruleToForm(rule: unknown): RuleForm {
    const form: RuleForm = { ...EMPTY_RULE_FORM, countries: [], blocked_states: [] };
    if (!isDict(rule)) return form;

    const country = rule.country;
    if (isDict(country)) {
        if (Array.isArray(country.in)) {
            form.country_mode = 'allow';
            form.countries = country.in.map((c) => String(c).toUpperCase());
        } else if (Array.isArray(country.not_in)) {
            form.country_mode = 'block';
            form.countries = country.not_in.map((c) => String(c).toUpperCase());
        }
    }

    const region = rule.region;
    if (isDict(region) && Array.isArray(region.not_in)) {
        form.blocked_states = region.not_in.map((c) => String(c).toUpperCase());
    }

    const abuse = rule.abuse;
    if (isDict(abuse)) {
        for (const f of ABUSE_FLAGS) {
            form[`block_${f.key}`] = abuse[f.key] === false;
        }
    }
    return form;
}

/** Assemble the canonical rule object from friendly form values. */
export function formToRule(form: RuleForm): GeofenceRule {
    const rule: GeofenceRule = {};
    const countries = (form.countries || []).map((c) => String(c).toUpperCase()).filter(Boolean);
    if (form.country_mode === 'allow' && countries.length) {
        rule.country = { in: countries };
    } else if (form.country_mode === 'block' && countries.length) {
        rule.country = { not_in: countries };
    }

    const states = (form.blocked_states || []).map((c) => String(c).toUpperCase()).filter(Boolean);
    if (states.length) {
        rule.region = { not_in: states };
    }

    const abuse: Record<string, false> = {};
    for (const f of ABUSE_FLAGS) {
        if (form[`block_${f.key}`]) abuse[f.key] = false;
    }
    if (Object.keys(abuse).length) rule.abuse = abuse;
    return rule;
}

// ── Plain-language rule summary ───────────────────────────────────────

export interface RuleClause {
    tone: 'block' | 'warn' | 'ok';
    text: string;
}

function nameList(codes: unknown[], toName: (code: string) => string): string {
    return (codes || []).map((c) => toName(String(c))).join(', ');
}

/**
 * Plain-language clauses for a rule, for read-only display.
 * Returns [] for an empty/absent rule (caller renders its own empty state).
 */
export function describeRule(rule: unknown): RuleClause[] {
    const clauses: RuleClause[] = [];
    if (!isDict(rule)) return clauses;

    const country = isDict(rule.country) ? rule.country : {};
    if (Array.isArray(country.in)) {
        clauses.push({ tone: 'block', text: `Only these countries are allowed: ${nameList(country.in, countryName)}.` });
    } else if (Array.isArray(country.not_in)) {
        clauses.push({ tone: 'block', text: `Blocked countries: ${nameList(country.not_in, countryName)}.` });
    } else if (typeof country.eq === 'string') {
        clauses.push({ tone: 'block', text: `Only allowed country: ${countryName(country.eq)}.` });
    }

    const region = isDict(rule.region) ? rule.region : {};
    if (Array.isArray(region.not_in)) {
        clauses.push({ tone: 'block', text: `Blocked US states / regions: ${nameList(region.not_in, regionName)}.` });
    } else if (Array.isArray(region.in)) {
        clauses.push({ tone: 'block', text: `Only these regions are allowed: ${nameList(region.in, regionName)}.` });
    } else if (typeof region.eq === 'string') {
        clauses.push({ tone: 'block', text: `Only allowed region: ${regionName(region.eq)}.` });
    }

    const abuse = isDict(rule.abuse) ? rule.abuse : {};
    const blockedFlags = ABUSE_FLAGS.filter((f) => abuse[f.key] === false).map((f) => f.label);
    if (blockedFlags.length) {
        clauses.push({ tone: 'block', text: `${blockedFlags.join(', ')} are blocked.` });
    }
    const requiredFlags = ABUSE_FLAGS.filter((f) => abuse[f.key] === true).map((f) => f.label);
    if (requiredFlags.length) {
        clauses.push({ tone: 'warn', text: `Required (unusual): ${requiredFlags.join(', ')}.` });
    }
    return clauses;
}

/**
 * The plain-language DIFF between two rules, for the platform save's armed
 * label — an operator must see what a fleet-wide replace adds and removes
 * before the second click, not after.
 */
export function diffRules(oldRule: unknown, newRule: unknown): { added: string[]; removed: string[] } {
    const before = describeRule(oldRule).map((c) => c.text);
    const after = describeRule(newRule).map((c) => c.text);
    return {
        added: after.filter((text) => !before.includes(text)),
        removed: before.filter((text) => !after.includes(text)),
    };
}

// ── Group-rule save payload (merge-safe) ──────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** Stable ordering so deepEqual doesn't depend on key insertion order. */
function normalizeRule(rule: unknown): unknown {
    if (!isDict(rule)) return rule;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rule).sort()) {
        out[key] = normalizeRule(rule[key]);
    }
    return out;
}

/**
 * Build the `metadata.geofence` payload that makes the stored group rule
 * equal `newRule` under django's JSONField deep merge (objict.merge_dicts):
 * nested dicts merge recursively and a `null` value DELETES the key — nested
 * `__replace` is NOT supported and must never be sent.
 *
 * So: send the new value for every kept key, plus explicit nulls for any
 * top-level constraint or matcher-operator/abuse-flag that existed in
 * `oldRule` but not in `newRule`. Returns null when nothing changed.
 *
 * Sub-keys are ALLOWLISTED (matcher operators for country/region, the four
 * abuse flags for abuse): `newRule` can come from the advanced JSON editor,
 * so anything outside the DSL — a nested `__replace`, `protected`, etc. —
 * is dropped here instead of riding the PATCH into stored metadata.
 *
 * GROUP LAYER ONLY. The platform rule is written by `POST /api/geo/rules`,
 * which is a full replace and never merges — the two surfaces do not share a
 * save path, and the group surface can never write platform rules.
 */
export function buildGroupRulePayload(oldRule: unknown, newRule: unknown): Record<string, unknown> | null {
    const oldR = isDict(oldRule) ? oldRule : {};
    const newR = isDict(newRule) ? newRule : {};
    if (deepEqual(normalizeRule(oldR), normalizeRule(newR))) return null;

    const payload: Record<string, unknown> = {};
    for (const key of RULE_TOP_KEYS) {
        const allowedSubs: readonly string[] = key === 'abuse' ? ABUSE_FLAGS.map((f) => f.key) : MATCHER_OPS;
        const oldBody = isDict(oldR[key]) ? (oldR[key] as Record<string, unknown>) : null;
        const newBody = isDict(newR[key]) ? (newR[key] as Record<string, unknown>) : null;
        if (newBody) {
            const body: Record<string, unknown> = {};
            for (const sub of allowedSubs) {
                if (sub in newBody) body[sub] = newBody[sub];
            }
            // Null out stale sub-keys (a switched operator / cleared abuse
            // flag) so the recursive merge can't leave both behind.
            for (const sub of Object.keys(oldBody ?? {})) {
                if (allowedSubs.includes(sub) && !(sub in body)) body[sub] = null;
            }
            payload[key] = body;
        } else if (oldBody) {
            payload[key] = null;
        }
    }
    return payload;
}

/**
 * Coerce the advanced editor's value into a rule object, or null when
 * invalid. Accepts a parsed object, a JSON string, or ''/null as an empty
 * rule.
 */
export function coerceRuleInput(raw: unknown): GeofenceRule | null {
    if (raw === '' || raw === null || raw === undefined) return {};
    if (isDict(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            const parsed: unknown = JSON.parse(raw);
            return isDict(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
}

// ── Simulate request body ─────────────────────────────────────────────

export interface SimulateInput {
    mode: 'ip' | 'geo';
    ip?: string | null;
    country?: string | null;
    state?: string | null;
    flags?: Partial<Record<AbuseFlagKey, boolean>>;
    group_uuid?: string | null;
    scope?: string | null;
}

/**
 * Build the `POST /api/geo/simulate` body. IP mode sends `ip` (the allowlist
 * is consulted); geo mode sends a geo dict with `is_<flag>` keys — the engine
 * reads `geo.is_vpn` etc. The backend accepts exactly four top-level keys:
 * `ip`, `geo`, `scope`, `group_uuid` (rest/geofence.py:257-275).
 */
export function buildSimulateBody(input: SimulateInput | null | undefined): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (input?.mode === 'ip') {
        body.ip = String(input.ip ?? '').trim();
    } else {
        const geo: Record<string, unknown> = {};
        if (input?.country) geo.country_code = String(input.country).toUpperCase();
        if (input?.state) geo.region_code = String(input.state).toUpperCase();
        for (const f of ABUSE_FLAGS) {
            if (input?.flags?.[f.key]) geo[`is_${f.key}`] = true;
        }
        body.geo = geo;
    }
    if (input?.group_uuid) body.group_uuid = input.group_uuid;
    if (input?.scope) body.scope = input.scope;
    return body;
}
