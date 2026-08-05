// Detail-primitive demos: the six small building blocks admin record pages are
// composed from, each with the kind of data it was built for — an incident
// StatusPanel, a RuleSet FlowStrip, an incident-history Timeline, a device
// metadata blob through KnownFieldsCard, a live editable MetadataSection
// against the mock's /api/user/1, and both a Python and a JavaScript traceback
// through StackTraceView.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { mojoCall, useModel, type User } from 'portal-mojo/client';
import { fmt, toast } from 'portal-mojo/ui';
// MERGE-WIRE: portal-mojo/ui
import {
    FlowStrip, KnownFieldsCard, MetadataSection, StackTraceView, StatusPanel, Timeline,
    type FlowStep, type KnownField, type TimelineItem,
} from '../../../../../packages/portal-mojo/src/ui/detail';

const NOW = Math.floor(Date.now() / 1000);

// ── StatusPanel ───────────────────────────────────────────────────────
// Three states of the same incident — the panel is what the operator reads
// first, so tone/state/headline/meta/actions all move together.
const INCIDENT_STATES = [
    {
        key: 'firing', label: 'Firing', tone: 'danger' as const, state: 'Firing', icon: undefined,
        headline: 'Auth brute-force from 203.0.113.0/24',
        meta: <>Triggered <code>4m ago</code> · 218 events · rule <code>auth.bruteforce.v3</code> · bundle <code>src_ip</code></>,
        actions: ['Acknowledge', 'Escalate'],
    },
    {
        key: 'acked', label: 'Acknowledged', tone: 'warning' as const, state: 'Acknowledged', icon: 'bi-person-check',
        headline: 'Owned by ian@nativemojo.com',
        meta: <>Acknowledged <code>2m ago</code> · re-trigger suppressed for <code>30m</code></>,
        actions: ['Resolve', 'Hand off'],
    },
    {
        key: 'resolved', label: 'Resolved', tone: 'success' as const, state: 'Resolved', icon: 'bi-check-circle',
        headline: 'Blocked at the edge — no further events',
        meta: <>Resolved <code>just now</code> · total duration <code>11m 04s</code></>,
        actions: ['Reopen'],
    },
];

export function StatusPanelDemo() {
    const [idx, setIdx] = useState(0);
    const s = INCIDENT_STATES[idx]!;
    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 12 }}>
                The hero state banner. <code>meta</code> and <code>actions</code> are ReactNode slots — web-mojo
                passed trusted HTML strings with a "caller must escape" contract; that class of bug ends here.
            </p>
            <div className="seg" style={{ marginBottom: 14 }}>
                {INCIDENT_STATES.map((st, i) => (
                    <button key={st.key} className={`seg-btn${i === idx ? ' seg-active' : ''}`} onClick={() => setIdx(i)}>
                        {st.label}
                    </button>
                ))}
            </div>
            <StatusPanel
                tone={s.tone}
                state={s.state}
                icon={s.icon}
                headline={s.headline}
                meta={s.meta}
                actions={s.actions.map((label, i) => (
                    <button key={label} className={`btn btn-compact${i === 0 ? ' btn-primary' : ''}`} onClick={() => toast.info(`${label} clicked`)}>
                        {label}
                    </button>
                ))}
            />
            <div style={{ marginTop: 18 }}>
                <div className="eyebrow">Every tone (muted is the default / unknown-tone fallback)</div>
                {(['primary', 'info', 'muted'] as const).map((tone) => (
                    <div key={tone} style={{ marginTop: 8 }}>
                        <StatusPanel
                            tone={tone}
                            state={tone}
                            headline={`tone="${tone}"`}
                            meta="Tinted surface + colored state eyebrow, both themes."
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── FlowStrip ─────────────────────────────────────────────────────────
// The RuleSet triggering flow this primitive was built for.
const RULESET_STEPS: FlowStep[] = [
    {
        title: 'Match', tone: 'primary',
        value: <><code>category=auth</code> AND <code>level&gt;=warning</code></>,
        hint: 'Every condition under "Conditions" must match the event.',
    },
    {
        title: 'Bundle', tone: 'info',
        value: <>by <code>src_ip</code> · 5m window</>,
        hint: 'Groups events from the same source into one incident.',
    },
    {
        title: 'Threshold', tone: 'warning',
        value: <>12 events / <code>10m</code></>,
        hint: 'Counted within the trigger window.',
    },
    {
        title: 'Re-trigger', empty: true, value: 'Not configured',
        hint: 'Re-fires the handler chain after the suppression window.',
        editTitle: 'Configure re-trigger',
    },
];

export function FlowStripDemo() {
    const [last, setLast] = useState<string>('');
    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 14 }}>
                STEP 1 → N as a strip. Per-step tone caps each column; the pencil is one
                <code> onEditStep(step, index) </code> callback (web-mojo dispatched
                <code> data-action </code> through the global action pipeline). Container queries reflow
                4 → 2 → 1 off the strip's OWN width — narrow this pane to see it.
            </p>
            <FlowStrip
                steps={RULESET_STEPS}
                onEditStep={(step, i) => { setLast(`${step.title} (index ${i})`); toast.info(`Edit ${step.title}`); }}
            />
            <p className="dim" style={{ marginTop: 12 }}>
                Last edit requested: <code>{last || '—'}</code>
            </p>
            <div className="eyebrow" style={{ marginTop: 18 }}>Three steps, no edit affordance</div>
            <FlowStrip steps={RULESET_STEPS.slice(0, 3)} />
        </div>
    );
}

// ── Timeline ──────────────────────────────────────────────────────────
const HISTORY: TimelineItem[] = [
    { tone: 'danger', title: 'Incident opened', meta: fmt.relative(NOW - 664), body: <>Rule <code>auth.bruteforce.v3</code> crossed 12 events in 10m.</> },
    { tone: 'warning', title: 'Notification sent', meta: fmt.relative(NOW - 640), body: 'Slack #security-oncall, PagerDuty P2.' },
    { tone: 'info', title: 'Acknowledged by ian@nativemojo.com', meta: fmt.relative(NOW - 480) },
    { tone: 'primary', title: 'Edge block applied', meta: fmt.relative(NOW - 300), body: <>Prefix <code>203.0.113.0/24</code> denied for 24h.</> },
    { tone: 'muted', title: 'Re-trigger suppressed', meta: fmt.relative(NOW - 180), body: 'No new events during the suppression window.' },
    { tone: 'success', title: 'Resolved', meta: fmt.relative(NOW - 4), body: 'Closed automatically — 30m with zero matching events.' },
];

export function TimelineDemo() {
    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 14 }}>
                The vertical event feed: hairline rail, tone-colored dots, monospace timestamp column.
                <code> body </code> is a ReactNode slot (web-mojo's trusted-HTML <code>detail</code>).
                Timestamps here run through <code>fmt.relative</code> on epoch SECONDS.
            </p>
            <Timeline items={HISTORY} />
            <div className="eyebrow" style={{ marginTop: 20 }}>limit=3 (the "recent activity" mode)</div>
            <Timeline items={HISTORY} limit={3} />
            <div className="eyebrow" style={{ marginTop: 20 }}>Empty state (renders inside the &lt;ol&gt;, rail intact)</div>
            <Timeline items={[]} emptyText="No events yet." />
        </div>
    );
}

// ── KnownFieldsCard ───────────────────────────────────────────────────
// A device/session blob: a few keys the framework knows plus an open bag.
const DEVICE_BLOB: Record<string, unknown> = {
    created_by: 'ian@nativemojo.com',
    reasoning: 'brute-force from same /24',
    last_resolved: NOW - 86400 * 2,
    ip: '203.0.113.42',
    os: { family: 'macOS', version: '15.4' },
    browser: { family: 'Safari', version: '18.3' },
    geo: { city: 'Austin', region: 'TX', country: 'US' },
    session_id: '3f9c1e77-2b40-4b9a-9e6a-1f0a5e1f77aa',
    trust_score: 0.82,
};

const DEVICE_FIELDS: KnownField[] = [
    { key: 'created_by', label: 'Created by' },
    { key: 'last_resolved', label: 'Last resolved', format: 'datetime' },
    { key: 'reasoning', label: 'Reasoning' },
    { key: 'os.family', label: 'OS', format: (v, _k, data) => `${String(v)} ${String((data.os as Record<string, unknown>).version)}` },
    { key: 'geo.city', label: 'City' },
    { key: 'session_id', label: 'Session', format: (v) => <code>{String(v)}</code> },
    { key: 'trust_score', label: 'Trust score', format: (v) => `${Math.round(Number(v) * 100)}%` },
    { key: 'agent_prompt', label: 'Agent prompt' },                     // missing → "—"
    { key: 'never_set', label: 'Hidden when missing', hideEmpty: true }, // row is dropped
];

export function KnownFieldsCardDemo() {
    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 14 }}>
                Known keys promoted to a label/value grid (dotted paths traverse nested objects),
                the raw blob subordinated below in a collapsed <code>&lt;details&gt;</code>.
                <code> format </code> takes an <code>fmt.*</code> name or a function returning any node;
                an unknown name warns and renders the raw value.
            </p>
            <KnownFieldsCard data={DEVICE_BLOB} known={DEVICE_FIELDS} rawLabel="Raw device_info" />
            <div className="eyebrow" style={{ marginTop: 22 }}>No known specs — raw only</div>
            <KnownFieldsCard data={{ ok: true, retries: 2 }} rawLabel="Raw payload" rawCollapsed={false} />
            <div className="eyebrow" style={{ marginTop: 22 }}>Empty blob, no specs</div>
            <KnownFieldsCard data={{}} emptyText="No device information recorded." />
        </div>
    );
}

// ── MetadataSection ───────────────────────────────────────────────────
const SEED: Record<string, unknown> = {
    timezone: 'America/New_York',
    onboarding_step: 4,
    beta_optin: true,
    signup_source: { campaign: 'q3-launch', medium: 'email' },
};

/** Live against the mock: /api/user/1, real POST, real envelope. */
function LiveMetadata() {
    const qc = useQueryClient();
    const { data: user, isLoading } = useModel<User>('/api/user', 1);

    const applyToCache = (next: Record<string, unknown>) =>
        qc.setQueryData<User>(['/api/user', 'one', 1], (prev) => (prev ? { ...prev, metadata: next } : prev));

    const seed = () => {
        mojoCall('/api/user/1', { method: 'POST', body: { metadata: SEED } })
            .then(() => { applyToCache(SEED); toast.success('Seeded 4 entries'); })
            .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)));
    };

    if (isLoading || !user) return <div className="skel skel-block" />;
    return (
        <>
            <div className="demo-row" style={{ marginBottom: 12 }}>
                <button className="btn btn-compact" onClick={seed}>
                    <i className="bi bi-magic" /> Seed demo entries
                </button>
                <span className="dim">
                    Editing <b>{user.display_name ?? user.username}</b> — every save is a real
                    <code> POST /api/user/1 </code> carrying <code>{'{metadata: {…}}'}</code>.
                </span>
            </div>
            <MetadataSection endpoint="/api/user" id={1} metadata={user.metadata} onSaved={applyToCache} />
        </>
    );
}

/** The reject path: no such endpoint, so every save fails at the envelope. */
function FailingMetadata() {
    const [metadata, setMetadata] = useState<Record<string, unknown>>(SEED);
    return (
        <MetadataSection
            endpoint="/api/does-not-exist"
            id={1}
            metadata={metadata}
            onSaved={setMetadata}
            title="Metadata (save always rejects)"
        />
    );
}

export function MetadataSectionDemo() {
    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 14 }}>
                Key/value CRUD over a record's <code>metadata</code>. Editing is inline (web-mojo used modal
                round-trips) because a rejected save has to KEEP what you typed. Values are JSON-parsed when
                they can be — <code>42</code>, <code>true</code>, <code>{'{"a":1}'}</code> land as real types;
                object values then display read-only.
            </p>
            <LiveMetadata />
            <div className="eyebrow" style={{ marginTop: 24 }}>Failure is unmissable</div>
            <p className="dim" style={{ marginBottom: 12 }}>
                Same component pointed at a nonexistent endpoint. Add/edit/delete anything: the save REJECTS,
                the server's own message lands in a persistent banner, and the editor stays open with your text.
            </p>
            <FailingMetadata />
        </div>
    );
}

// ── StackTraceView ────────────────────────────────────────────────────
const PYTHON_TRACE = `Traceback (most recent call last):
  File "/srv/mojo/lib/python3.12/site-packages/django/core/handlers/exception.py", line 55, in inner
    response = get_response(request)
  File "/srv/mojo/lib/python3.12/site-packages/django/core/handlers/base.py", line 197, in _get_response
    response = wrapped_callback(request, *callback_args, **callback_kwargs)
  File "/srv/mojo/mojo/decorators/http.py", line 41, in wrapper
    return func(request, *args, **kwargs)
  File "/srv/mojo/mojo/models/rest.py", line 612, in on_rest_save
    instance.set_metadata(request.DATA.get("metadata"))
  File "/srv/mojo/mojo/models/metadata.py", line 88, in set_metadata
    self.metadata_set.update_or_create(key=key, defaults={"value": value})
  File "/srv/mojo/lib/python3.12/site-packages/django/db/models/query.py", line 933, in update_or_create
    obj = self.create(**params)
  File "/srv/mojo/lib/python3.12/site-packages/django/db/models/query.py", line 671, in create
    obj.save(force_insert=True, using=self.db)
  File "/srv/mojo/lib/python3.12/site-packages/django/db/models/base.py", line 822, in save
    self.save_base(using=using, force_insert=force_insert)
  File "/srv/mojo/lib/python3.12/site-packages/django/db/backends/utils.py", line 89, in _execute
    return self.cursor.execute(sql, params)
  File "/srv/mojo/lib/python3.12/site-packages/django/db/utils.py", line 91, in __exit__
    raise dj_exc_value.with_traceback(traceback) from exc_value

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "/srv/mojo/mojo/tasks/runner.py", line 412, in _execute
    handler(payload)
  File "/srv/mojo/mojo/tasks/handlers/metadata.py", line 27, in sync_metadata
    user.set_metadata(payload["metadata"])
  File "/srv/mojo/mojo/models/metadata.py", line 91, in set_metadata
    raise ValueError(f"metadata value too large for key {key!r}")
ValueError: metadata value too large for key 'signup_source'`;

const JS_TRACE = `TypeError: Cannot read properties of undefined (reading 'metadata')
    at MetadataSection (src/ui/detail/MetadataSection.tsx:118:31)
    at renderWithHooks (node_modules/react-dom/cjs/react-dom-client.development.js:11121:26)
    at updateFunctionComponent (node_modules/react-dom/cjs/react-dom-client.development.js:16290:21)
    at src/pages/UserDetail.tsx:64:11
    at beginWork (node_modules/react-dom/cjs/react-dom-client.development.js:18432:20)
    at flushSyncWorkAcrossRoots_impl (node_modules/react-dom/cjs/react-dom-client.development.js:11960:13)`;

export function StackTraceViewDemo() {
    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 14 }}>
                Both traceback dialects, colorized by the same frame parser: JS
                <code> at fn (file:line:col) </code> and Python
                <code> File "…", line N, in fn</code>. Re-themed onto tokens — the web-mojo original shipped a
                hardcoded light-only <code>&lt;style&gt;</code> block. Long traces collapse behind a toggle.
            </p>
            <div className="eyebrow">Python — django-mojo task runner (collapsed at 24 lines; click to expand)</div>
            <StackTraceView trace={PYTHON_TRACE} />
            <div className="eyebrow" style={{ marginTop: 20 }}>JavaScript — React render</div>
            <StackTraceView trace={JS_TRACE} />
            <div className="eyebrow" style={{ marginTop: 20 }}>Non-string payload (pretty-printed) and empty</div>
            <StackTraceView trace={{ error: 'timeout', attempts: 3, runner: 'worker-04' }} />
            <div style={{ marginTop: 10 }}><StackTraceView trace={null} /></div>
        </div>
    );
}

/** All six, in one playground section. */
export function DetailPrimitivesDemo() {
    return (
        <>
            <StatusPanelDemo />
            <FlowStripDemo />
            <TimelineDemo />
            <KnownFieldsCardDemo />
            <MetadataSectionDemo />
            <StackTraceViewDemo />
        </>
    );
}
