// group-sections/geofence-data.ts — pure data + mapping helpers for the
// GROUP-scoped geofence panel. Port of web-mojo
// @ext/admin/security/geofence/geofenceData.js (read in full 2026-08-05) at
// the subset the group panel needs, plus the country/US-state name tables
// from GeofenceRuleForm.js / countryCentroids.js. The FULL geofence suite
// (simulate, blocks log, scopes, platform editor) belongs to the admin
// program — not recreated here.
//
// Rule DSL (django-mojo services/geofence/dsl.py):
//   {
//     country: { in: [..] } | { not_in: [..] } | { eq: 'US' },
//     region:  { in: [..] } | { not_in: [..] } | { eq: 'US-CA' },   // ISO 3166-2
//     abuse:   { tor: false, vpn: false, datacenter: false, proxy: false }
//   }
// Abuse flag semantics: false → block when detected; true → require the flag
// (rare — not expressible in the friendly editor); absent/null → don't care.

// ── Permissions ───────────────────────────────────────────────────────
// Geofence config is PLATFORM-WIDE: the backend only honors global user
// grants, so the UI gates with `sys.`-prefixed keys (hasPermission pins
// those to the system dict — member/group grants never count).

export const GEOFENCE_VIEW_PERMS = ['sys.view_geofence', 'sys.manage_geofence', 'sys.security'];

// Editing the group layer needs either the global geofence grant or group
// management rights (the group REST enforces its own save perms — a 403
// from it still surfaces inline). GroupGeofenceSection.js:36.
export const GROUP_GEOFENCE_EDIT_PERMS = ['sys.manage_geofence', 'sys.security', 'sys.manage_groups', 'sys.groups'];

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

// ── Countries (ISO2 → name, from web-mojo countryCentroids.js) ────────
// The source table carried duplicate literal keys (BQ ×3, ES ×2, TF ×3);
// JS object parsing silently kept the LAST, so web-mojo displayed
// "Canarias" for ES. Deduped here keeping the FIRST (Spain/Bonaire/…) —
// a data bug not carried forward.

const COUNTRY_NAMES: Record<string, string> = {
    AD: "Andorra",
    AE: "United Arab Emirates",
    AF: "Afghanistan",
    AG: "Antigua and Barbuda",
    AI: "Anguilla",
    AL: "Albania",
    AM: "Armenia",
    AO: "Angola",
    AQ: "Antarctica",
    AR: "Argentina",
    AS: "American Samoa",
    AT: "Austria",
    AU: "Australia",
    AW: "Aruba",
    AZ: "Azerbaijan",
    BA: "Bosnia and Herzegovina",
    BB: "Barbados",
    BD: "Bangladesh",
    BE: "Belgium",
    BF: "Burkina Faso",
    BG: "Bulgaria",
    BH: "Bahrain",
    BI: "Burundi",
    BJ: "Benin",
    BL: "Saint Barthelemy",
    BM: "Bermuda",
    BN: "Brunei Darussalam",
    BO: "Bolivia",
    BQ: "Bonaire",
    BR: "Brazil",
    BS: "Bahamas",
    BT: "Bhutan",
    BV: "Bouvet Island",
    BW: "Botswana",
    BY: "Belarus",
    BZ: "Belize",
    CA: "Canada",
    CC: "Cocos Islands",
    CD: "Congo DRC",
    CF: "Central African Republic",
    CG: "Congo",
    CH: "Switzerland",
    CI: "C\u00f4te d'Ivoire",
    CK: "Cook Islands",
    CL: "Chile",
    CM: "Cameroon",
    CN: "China",
    CO: "Colombia",
    CR: "Costa Rica",
    CU: "Cuba",
    CV: "Cabo Verde",
    CW: "Curacao",
    CX: "Christmas Island",
    CY: "Cyprus",
    CZ: "Czech Republic",
    DE: "Germany",
    DJ: "Djibouti",
    DK: "Denmark",
    DM: "Dominica",
    DO: "Dominican Republic",
    DZ: "Algeria",
    EC: "Ecuador",
    EE: "Estonia",
    EG: "Egypt",
    ER: "Eritrea",
    ES: "Spain",
    ET: "Ethiopia",
    FI: "Finland",
    FJ: "Fiji",
    FK: "Falkland Islands",
    FM: "Micronesia",
    FO: "Faroe Islands",
    FR: "France",
    GA: "Gabon",
    GB: "United Kingdom",
    GD: "Grenada",
    GE: "Georgia",
    GF: "French Guiana",
    GG: "Guernsey",
    GH: "Ghana",
    GI: "Gibraltar",
    GL: "Greenland",
    GM: "Gambia",
    GN: "Guinea",
    GP: "Guadeloupe",
    GQ: "Equatorial Guinea",
    GR: "Greece",
    GS: "South Georgia and South Sandwich Islands",
    GT: "Guatemala",
    GU: "Guam",
    GW: "Guinea-Bissau",
    GY: "Guyana",
    HM: "Heard Island and McDonald Islands",
    HN: "Honduras",
    HR: "Croatia",
    HT: "Haiti",
    HU: "Hungary",
    ID: "Indonesia",
    IE: "Ireland",
    IL: "Israel",
    IM: "Isle of Man",
    IN: "India",
    IO: "British Indian Ocean Territory",
    IQ: "Iraq",
    IR: "Iran",
    IS: "Iceland",
    IT: "Italy",
    JE: "Jersey",
    JM: "Jamaica",
    JO: "Jordan",
    JP: "Japan",
    KE: "Kenya",
    KG: "Kyrgyzstan",
    KH: "Cambodia",
    KI: "Kiribati",
    KM: "Comoros",
    KN: "Saint Kitts and Nevis",
    KP: "North Korea",
    KR: "South Korea",
    KW: "Kuwait",
    KY: "Cayman Islands",
    KZ: "Kazakhstan",
    LA: "Laos",
    LB: "Lebanon",
    LC: "Saint Lucia",
    LI: "Liechtenstein",
    LK: "Sri Lanka",
    LR: "Liberia",
    LS: "Lesotho",
    LT: "Lithuania",
    LU: "Luxembourg",
    LV: "Latvia",
    LY: "Libya",
    MA: "Morocco",
    MC: "Monaco",
    MD: "Moldova",
    ME: "Montenegro",
    MF: "Saint Martin",
    MG: "Madagascar",
    MH: "Marshall Islands",
    MK: "North Macedonia",
    ML: "Mali",
    MM: "Myanmar",
    MN: "Mongolia",
    MP: "Northern Mariana Islands",
    MQ: "Martinique",
    MR: "Mauritania",
    MS: "Montserrat",
    MT: "Malta",
    MU: "Mauritius",
    MV: "Maldives",
    MW: "Malawi",
    MX: "Mexico",
    MY: "Malaysia",
    MZ: "Mozambique",
    NA: "Namibia",
    NC: "New Caledonia",
    NE: "Niger",
    NF: "Norfolk Island",
    NG: "Nigeria",
    NI: "Nicaragua",
    NL: "Netherlands",
    NO: "Norway",
    NP: "Nepal",
    NR: "Nauru",
    NU: "Niue",
    NZ: "New Zealand",
    OM: "Oman",
    PA: "Panama",
    PE: "Peru",
    PF: "French Polynesia",
    PG: "Papua New Guinea",
    PH: "Philippines",
    PK: "Pakistan",
    PL: "Poland",
    PM: "Saint Pierre and Miquelon",
    PN: "Pitcairn",
    PR: "Puerto Rico",
    PS: "Palestinian Territory",
    PT: "Portugal",
    PW: "Palau",
    PY: "Paraguay",
    QA: "Qatar",
    RE: "R\u00e9union",
    RO: "Romania",
    RS: "Serbia",
    RU: "Russian Federation",
    RW: "Rwanda",
    SA: "Saudi Arabia",
    SB: "Solomon Islands",
    SC: "Seychelles",
    SD: "Sudan",
    SE: "Sweden",
    SG: "Singapore",
    SH: "Saint Helena",
    SI: "Slovenia",
    SJ: "Svalbard",
    SK: "Slovakia",
    SL: "Sierra Leone",
    SM: "San Marino",
    SN: "Senegal",
    SO: "Somalia",
    SR: "Suriname",
    SS: "South Sudan",
    ST: "Sao Tome and Principe",
    SV: "El Salvador",
    SX: "Sint Maarten",
    SY: "Syria",
    SZ: "Eswatini",
    TC: "Turks and Caicos Islands",
    TD: "Chad",
    TF: "Juan De Nova Island",
    TG: "Togo",
    TH: "Thailand",
    TJ: "Tajikistan",
    TK: "Tokelau",
    TL: "Timor-Leste",
    TM: "Turkmenistan",
    TN: "Tunisia",
    TO: "Tonga",
    TR: "Turkey",
    TT: "Trinidad and Tobago",
    TV: "Tuvalu",
    TZ: "Tanzania",
    UA: "Ukraine",
    UG: "Uganda",
    UM: "United States Minor Outlying Islands",
    US: "United States",
    UY: "Uruguay",
    UZ: "Uzbekistan",
    VA: "Vatican City",
    VC: "Saint Vincent and the Grenadines",
    VE: "Venezuela",
    VG: "British Virgin Islands",
    VI: "US Virgin Islands",
    VN: "Vietnam",
    VU: "Vanuatu",
    WF: "Wallis and Futuna",
    WS: "Samoa",
    YE: "Yemen",
    YT: "Mayotte",
    ZA: "South Africa",
    ZM: "Zambia",
    ZW: "Zimbabwe",
};

/** Sorted country options for the multiselect (GeofenceRuleForm.COUNTRIES). */
export const COUNTRY_OPTIONS = Object.entries(COUNTRY_NAMES)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

/** ISO2 country code → display name (unknown → raw code). */
export function countryName(code: string | null | undefined): string {
    if (!code) return '';
    return COUNTRY_NAMES[String(code).toUpperCase()] ?? String(code);
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

// ── Rule ↔ friendly-form mapping ──────────────────────────────────────

/** A geofence rule as stored (unknown shapes flip the editor to advanced). */
export type GeofenceRule = Record<string, unknown>;

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

// ── GET /api/geo/rules response (the slice the group panel reads) ─────

/** The platform floor + the server's view of this group's rule. */
export interface GeoRulesConfig {
    system?: { rule?: GeofenceRule | null } | null;
    group?: { rule?: GeofenceRule | null } | null;
}
