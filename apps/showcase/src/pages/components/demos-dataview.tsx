// DataView demos — the four things the component has to prove:
//   1. a schemaless django-mojo user record, EVERY field inferred from its name
//   2. the same record under an explicit `fields` schema (labels, paths, types,
//      a ReactNode formatter) plus `exclude`
//   3. a deeply nested object — nested grids, and the depth cap falling back
//      to JSON below it
//   4. a raw-JSON panel on its own: tokenized spans, copy (toast), collapse
import { useState } from 'react';
import { DataView, JsonBlock, inferFieldType, type DataViewField } from 'portal-mojo/ui';

const NOW = Math.floor(Date.now() / 1000);

// ── 1. Schemaless: a record shaped like django-mojo actually sends one ──
// Every value below picks its own renderer off the field NAME. Epoch SECONDS
// on the datetimes, integer cents on the money, 0/1 on one of the booleans.
const USER_RECORD: Record<string, unknown> = {
    id: 4821,
    username: 'ian.starnes',
    display_name: 'ian starnes',                 // .cap — capitalized in CSS, value untouched
    email: 'ian@nativemojo.com',                 // mailto:
    phone: '+15125550142',                       // tel: + fmt.phone
    website: 'https://nativemojo.com',           // new-tab anchor
    created: NOW - 86400 * 412,                  // fmt.date
    modified: NOW - 86400 * 3,                   // fmt.date
    last_login: NOW - 3600 * 27,                 // "last_" → fmt.relative
    resolved_at: NOW - 900,                      // the _at extension → datetime
    is_active: true,                             // Badge yes/no
    has_mfa: 0,                                  // 0/1 wire boolean → Badge "No"
    storage_bytes: 1_610_612_736,                // fmt.filesize
    avatar_size: 48_120,                         // fmt.filesize
    plan_amount: 129_900,                        // integer cents → $1,299.00
    overage_price: 4.75,                         // fractional → already major units
    error_rate: 0.0182,                          // 0–1 ratio → fmt.percent
    session_count: 24_318,                       // ≥1000 → fmt.compact
    login_count: 412,                            // <1000 → fmt.number
    trust_score: 8.4,                            // fmt.number(1)
    api_key: 'mk_live_7f3c91ab55d240e8b6127aa9',  // long → fmt.mask, monospace
    duration: 8040,                              // the "ratio" substring trap — plain number
    bio: 'Builds the mojo portal toolkit. This bio runs past the hundred-character mark on purpose so the generic text branch truncates it and hangs the full value off the title attribute.',
    roles: ['admin', 'billing', 'support'],      // scalar array → joined
    settings: { theme: 'dark', density: 'compact', locale: 'en-US' },   // → nested DataView
    last_error: null,                            // empty → —
};

export function DataViewInferredDemo() {
    const [columns, setColumns] = useState(2);
    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 12 }}>
                No schema at all — <code>&lt;DataView data={'{record}'} /&gt;</code>. Every renderer is picked
                from the field NAME plus its value: <code>*_at</code>/<code>created</code> → dates,
                <code> *email* </code>→ mailto, <code>*_bytes</code>/<code>*_size</code> → filesize,
                <code> is_*</code>/<code>has_*</code> → the house yes/no badge, amounts → currency,
                objects → nested grids. Ordering is the record's own key order.
            </p>
            <div className="demo-row" style={{ marginBottom: 14 }}>
                <span className="dim">Columns</span>
                <div className="seg">
                    {[1, 2, 3].map((n) => (
                        <button key={n} className={`seg-btn${n === columns ? ' seg-active' : ''}`} onClick={() => setColumns(n)}>
                            {n}
                        </button>
                    ))}
                </div>
                <span className="dim">Narrow this pane — the container query stacks to one column on its OWN width.</span>
            </div>
            <DataView data={USER_RECORD} columns={columns} />

            <div className="eyebrow" style={{ marginTop: 24 }}>Inference table (live calls to the exported heuristic)</div>
            <table className="demo-table" style={{ marginTop: 8 }}>
                <tbody>
                    {['created_at', 'last_login', 'contact_email', 'is_email_verified', 'avatar_url', 'mobile_number',
                        'plan_amount', 'file_size', 'error_rate', 'duration', 'hotel_name', 'view_count'].map((k) => (
                            <tr key={k}>
                                <td><code>{k}</code></td>
                                <td><code>{inferFieldType(k.includes('is_') ? true : 1234, k)}</code></td>
                            </tr>
                        ))}
                </tbody>
            </table>
            <p className="dim" style={{ marginTop: 10 }}>
                The last three are the source's substring bugs, fixed: <code>duration</code> contains "ratio"
                (it rendered as 804,000%), <code>hotel_name</code> contains "tel" (a phone link), and
                <code> is_email_verified</code> contains "email" (a <code>mailto:true</code> link).
            </p>
        </div>
    );
}

// ── 2. Explicit schema ────────────────────────────────────────────────
const USER_SCHEMA: DataViewField[] = [
    { name: 'display_name', label: 'Name' },
    { name: 'email', label: 'Contact' },
    { name: 'settings.theme', label: 'Theme' },                       // dotted path
    { name: 'settings.locale', label: 'Locale' },
    { name: 'plan_amount', label: 'Plan', type: 'currency' },
    { name: 'storage_bytes', label: 'Storage', type: 'filesize' },
    { name: 'login_count', label: 'Logins', type: 'number' },
    { name: 'last_login', label: 'Last seen', type: 'datetime' },
    // A ReactNode formatter replaces the renderer entirely.
    {
        name: 'trust_score', label: 'Trust',
        format: (v) => <span className={Number(v) >= 8 ? 'text-ok' : 'dim'}>{Number(v).toFixed(1)} / 10</span>,
    },
    // Rule 4: an unknown type warns to the console and falls back to inference.
    { name: 'roles', label: 'Roles', type: 'chiplist' as never },
    { name: 'last_error', label: 'Last error (hidden when empty)', hideEmpty: true },
    { name: 'bio', label: 'Bio', span: 'full' },
];

export function DataViewSchemaDemo() {
    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 14 }}>
                The same record under an explicit <code>fields</code> schema: labels, dotted paths
                (<code>settings.theme</code>), a declared <code>type</code>, a ReactNode <code>format</code>,
                <code> span:&nbsp;'full'</code>, and <code>hideEmpty</code>. Order follows the schema.
                <code> type: 'chiplist' </code> is deliberately bogus — check the console for the rule-4 warn,
                then note the row still renders (inferred), never nothing.
            </p>
            <DataView data={USER_RECORD} fields={USER_SCHEMA} />

            <div className="eyebrow" style={{ marginTop: 24 }}>exclude — schemaless minus the noisy keys</div>
            <p className="dim" style={{ marginBottom: 10 }}>
                <code>exclude</code> works in BOTH modes; here it drops the ids, secrets and blobs from full inference.
            </p>
            <DataView
                data={USER_RECORD}
                exclude={['id', 'api_key', 'bio', 'settings', 'roles', 'duration', 'avatar_size', 'resolved_at']}
                columns={3}
            />

            <div className="eyebrow" style={{ marginTop: 24 }}>showEmptyValues=false (the source default) + an empty record</div>
            <DataView data={{ name: 'Only field with a value', notes: '', tags: [], meta: {} }} showEmptyValues={false} />
            <div style={{ marginTop: 10 }}>
                <DataView data={{}} emptyText="This record has no fields." />
            </div>
        </div>
    );
}

// ── 3. Deep nesting ───────────────────────────────────────────────────
// `settings`, `profile`, `location`, `stats` all match the source's
// shouldUseDataView key patterns; `raw_payload` does not, so it stays JSON.
const DEEP_RECORD: Record<string, unknown> = {
    name: 'edge-runner-04',
    profile: {
        id: 91,                                   // an `id` makes any object a record grid
        display_name: 'Edge Runner 04',
        contact_email: 'ops@nativemojo.com',
        location: {
            city: 'Austin',
            region: 'TX',
            country: 'US',
            coordinates: { lat: 30.2672, lng: -97.7431, accuracy_meters: 12 },  // depth 3
        },
    },
    stats: {
        request_count: 1_284_912,
        error_rate: 0.0042,
        p95_duration: 184,
        payload_bytes: 9_812_004,
    },
    config: {
        region: 'us-central',
        replicas: 3,
        autoscale: true,
        limits: { cpu: '2000m', memory: '4Gi', ephemeral_storage: '20Gi', pids: 4096, nofile: 65536 },
    },
    members: [
        { id: 1, username: 'ian', role: 'owner' },
        { id: 2, username: 'sam', role: 'admin' },
        { id: 3, username: 'lee', role: 'viewer' },
    ],
    raw_payload: {
        trace_id: '3f9c1e77-2b40-4b9a-9e6a-1f0a5e1f77aa',
        emitted: NOW,
        flags: ['retry', 'idempotent'],
        upstream: { host: 'edge-04.mojo.internal', port: 8443, tls: true, cert_expires: NOW + 86400 * 60 },
        counters: { accepted: 41_002, rejected: 17, deferred: 0 },
    },
};

export function DataViewNestedDemo() {
    const [maxDepth, setMaxDepth] = useState(2);
    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 12 }}>
                Objects become nested DataViews when their key matches the source's
                <code> shouldUseDataView </code> patterns (<code>profile</code>, <code>settings</code>,
                <code> stats</code>, <code>location</code>, <code>config</code>…) or when they carry an
                <code> id </code>— i.e. they're a related record. Everything else, and anything past
                <code> maxDepth</code>, renders as a collapsed JSON block. Arrays of objects lead with their
                count; arrays of scalars join.
            </p>
            <div className="demo-row" style={{ marginBottom: 14 }}>
                <span className="dim">maxDepth</span>
                <div className="seg">
                    {[0, 1, 2, 3].map((n) => (
                        <button key={n} className={`seg-btn${n === maxDepth ? ' seg-active' : ''}`} onClick={() => setMaxDepth(n)}>
                            {n}
                        </button>
                    ))}
                </div>
                <span className="dim">
                    0 = no nesting at all (every object is JSON); 2 is the default.
                    Watch <code>profile → location → coordinates</code> flip at 3.
                </span>
            </div>
            <DataView data={DEEP_RECORD} maxDepth={maxDepth} />
        </div>
    );
}

// ── 4. The JSON block on its own ──────────────────────────────────────
const SMALL_JSON = { ok: true, retries: 2, next: null, ratio: -0.5 };
const BIG_JSON = {
    request: {
        method: 'POST',
        path: '/api/user/4821',
        headers: { 'content-type': 'application/json', 'x-duid': 'a3f0-91cc', authorization: 'Bearer ***' },
        body: { metadata: { onboarding_step: 4, beta_optin: true, note: 'contains a colon: and a "quote"' } },
    },
    response: { status: 200, elapsed_ms: 41.28, data: { id: 4821, modified: 1775481600 } },
    trace: ['rest.on_rest_save', 'metadata.set_metadata', 'db.update_or_create'],
    warnings: [],
    exponent: 1.2e-7,
};

export function JsonBlockDemo() {
    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 14 }}>
                Pretty-printed, tokenized into real React spans — keys, strings, numbers, booleans, null —
                with copy-to-clipboard (toast confirms; the icon flips to a check) and, for anything over
                10 lines or 500 characters, a one-line preview behind Show/Hide. The web-mojo original ran
                five regexes over an HTML-escaped string and injected <code>innerHTML</code> with hardcoded
                light-mode hex colors; note the <code>"contains a colon: and a "quote""</code> value below,
                which that approach mis-colored.
            </p>
            <div className="eyebrow">Small payload — always expanded</div>
            <JsonBlock value={SMALL_JSON} />

            <div className="eyebrow" style={{ marginTop: 20 }}>Large payload — collapsed, click Show</div>
            <JsonBlock value={BIG_JSON} />

            <div className="eyebrow" style={{ marginTop: 20 }}>Forced open, custom caption</div>
            <JsonBlock value={BIG_JSON} label="Request trace" collapsible defaultOpen />

            <div className="eyebrow" style={{ marginTop: 20 }}>Circular payload — degrades, never throws</div>
            <JsonBlock value={(() => { const a: Record<string, unknown> = { name: 'loop' }; a.self = a; return a; })()} />
        </div>
    );
}

/** All four, in one playground section. */
export function DataViewDemo() {
    return (
        <>
            <DataViewInferredDemo />
            <DataViewSchemaDemo />
            <DataViewNestedDemo />
            <JsonBlockDemo />
        </>
    );
}
