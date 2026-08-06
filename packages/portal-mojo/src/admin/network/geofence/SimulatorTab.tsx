// SimulatorTab — what-if decisions via `POST /api/geo/simulate`.
// Port of web-mojo `GeofenceSimulatorView.js`.
//
// `GeoFenceEngine.simulate` (engine.py:446-474) deliberately differs from
// `check`: no bypass shortcut, no cache read or write, no evidence event, and
// it evaluates even while GEOFENCE_ENABLED is false — which is what makes a
// staged-rules preview possible. The copy below says exactly that, verbatim
// from the source, because it is the reason an operator trusts the button.
//
// TWO CORRECTIONS over the source:
//   · the "geofencing is currently off" notice reads `decision.enabled`, which
//     `simulate` sets at the TOP LEVEL of the decision. web-mojo read
//     `decision.posture.enabled` — a key the decision has never carried — so
//     the notice never fired once.
//   · the endpoint-scope row shows the scope the form SENT. The decision does
//     not echo it, so reading it back would always render "—".
import { useMemo, useState, type ReactNode } from 'react';
import { CollectionSelect, toast } from '../../../ui';
import { COUNTRY_OPTIONS, countryName } from '../../../charts/worldmap/countryCentroids';
import { useGeoSimulate } from '../models';
import {
    ABUSE_FLAGS, US_STATES, buildSimulateBody, collectScopes, describeDecision,
    describeWouldBlock, regionName, scopeLabel,
    type AbuseFlagKey, type GeoDecision, type GeoRulesConfig,
} from './geofence-data';

interface SimForm {
    mode: 'geo' | 'ip';
    country: string;
    state: string;
    ip: string;
    flags: Record<AbuseFlagKey, boolean>;
    group_uuid: string | null;
    scope: string;
}

const EMPTY_FORM: SimForm = {
    mode: 'geo',
    country: '',
    state: '',
    ip: '',
    flags: { vpn: false, tor: false, proxy: false, datacenter: false },
    group_uuid: null,
    scope: '',
};

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
    return <span className="geo-sim-meta-item">{label} <b>{value}</b></span>;
}

function ResultCard({ decision, sentScope }: { decision: GeoDecision; sentScope: string }) {
    const exempt = decision.reason === 'ip_allowlisted';
    const allowed = decision.allowed !== false;
    const tone = exempt ? 'exempt' : allowed ? 'allowed' : 'blocked';
    const icon = exempt ? 'bi-shield-check' : allowed ? 'bi-check-circle' : 'bi-x-circle';
    const wouldLine = describeWouldBlock(decision);

    const place = [
        decision.region_code ? regionName(decision.region_code) : (decision.region ?? ''),
        decision.country || countryName(decision.country_code),
    ].filter(Boolean).join(', ');

    return (
        <div className={`geo-sim-result geo-sim-${tone}`}>
            <div className="geo-sim-band">
                <i className={`bi ${icon}`} />
                <span>{describeDecision(decision)}</span>
            </div>
            <div className="geo-sim-body">
                {wouldLine && <p className="geo-sim-would">{wouldLine}</p>}
                {decision.enabled === false && (
                    <div className="netsec-note netsec-note-info">
                        <i className="bi bi-info-circle" />
                        <div>
                            Geofencing is currently <b>off</b> — this shows what would happen once it is
                            turned on. Simulation evaluates the rules regardless of enforcement.
                        </div>
                    </div>
                )}
                <div className="geo-sim-meta">
                    {place && <MetaRow label="Location" value={place} />}
                    {decision.ip && <MetaRow label="IP" value={<code>{decision.ip}</code>} />}
                    {decision.rule_level && (
                        <MetaRow label="Rule level" value={decision.rule_level === 'system' ? 'Platform' : decision.rule_level} />
                    )}
                    {/* The decision does not echo `scope`; this is what we SENT. */}
                    <MetaRow label="Endpoint scope" value={sentScope ? scopeLabel(sentScope) : 'Any endpoint'} />
                    {decision.reason && <MetaRow label="Reason code" value={<code>{decision.reason}</code>} />}
                    {decision.strict_posture && <MetaRow label="Strict posture" value="on" />}
                    {decision.detail && <MetaRow label="Detail" value={decision.detail} />}
                    {exempt && (
                        <>
                            <MetaRow label="Allowlist source" value={decision.allowlist_source ?? '—'} />
                            <MetaRow label="Allowlist reason" value={decision.allowlist_reason ?? '—'} />
                            <MetaRow label="Allowlist until" value={decision.allowlist_until ?? 'Never'} />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export function SimulatorTab({ config }: { config: GeoRulesConfig | null | undefined }) {
    const simulate = useGeoSimulate();
    const [form, setForm] = useState<SimForm>(EMPTY_FORM);
    const [result, setResult] = useState<{ decision: GeoDecision; scope: string } | null>(null);
    const [status, setStatus] = useState<{ text: string; tone: 'muted' | 'bad' }>({ text: '', tone: 'muted' });

    // Scope options come from the LIVE config — scopes are deployment-defined
    // strings, so the select only exists when this server declares any.
    const scopes = useMemo(() => collectScopes(config), [config]);

    const run = async () => {
        if (form.mode === 'ip' && !form.ip.trim()) {
            setStatus({ text: 'Enter an IP address to test.', tone: 'bad' });
            return;
        }
        if (form.mode === 'geo' && !form.country) {
            setStatus({ text: 'Pick a country to test.', tone: 'bad' });
            return;
        }
        setStatus({ text: 'Testing…', tone: 'muted' });
        try {
            const decision = await simulate.mutateAsync(buildSimulateBody({
                mode: form.mode,
                ip: form.ip,
                country: form.country,
                state: form.state,
                flags: form.flags,
                group_uuid: form.group_uuid,
                scope: form.scope || null,
            }));
            setResult({ decision, scope: form.scope });
            setStatus({ text: '', tone: 'muted' });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Simulation failed';
            setStatus({ text: message, tone: 'bad' });
            toast.error(message);
        }
    };

    return (
        <div className="geo-two-col">
            <div className="panel netsec-card">
                <div className="netsec-card-head"><span>Test a scenario</span></div>
                <div className="netsec-card-body geo-sim-form">
                    <div className="field">
                        <span className="field-label">Test by</span>
                        <div className="seg">
                            {([['geo', 'Location'], ['ip', 'IP address']] as const).map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    className={`seg-btn${form.mode === value ? ' seg-active' : ''}`}
                                    onClick={() => setForm({ ...form, mode: value })}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {form.mode === 'geo' ? (
                        <>
                            <label className="field">
                                <span className="field-label">Country</span>
                                <select
                                    className="input"
                                    value={form.country}
                                    onChange={(e) => setForm({ ...form, country: e.target.value })}
                                >
                                    <option value="">Select a country…</option>
                                    {COUNTRY_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="field">
                                <span className="field-label">US state / region</span>
                                <select
                                    className="input"
                                    value={form.state}
                                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                                >
                                    <option value="">— None —</option>
                                    {US_STATES.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </label>
                            <div className="geo-rule-flags">
                                <div className="field-label">Appears to be</div>
                                {ABUSE_FLAGS.map((flag) => (
                                    <label key={flag.key} className="switch-setting">
                                        <span className="field-label">{flag.label}</span>
                                        <input
                                            type="checkbox"
                                            role="switch"
                                            className="switch"
                                            checked={form.flags[flag.key]}
                                            onChange={(e) => setForm({ ...form, flags: { ...form.flags, [flag.key]: e.target.checked } })}
                                        />
                                    </label>
                                ))}
                            </div>
                        </>
                    ) : (
                        <label className="field">
                            <span className="field-label">IP address</span>
                            <input
                                className="input"
                                placeholder="203.0.113.7"
                                value={form.ip}
                                onChange={(e) => setForm({ ...form, ip: e.target.value })}
                            />
                            <span className="field-help">The IP is resolved and checked against exemptions too.</span>
                        </label>
                    )}

                    <CollectionSelect
                        endpoint="/api/group"
                        labelField="name"
                        // The engine takes a group UUID, never an id.
                        valueField="uuid"
                        label="Group (optional)"
                        placeholder="Platform rules only"
                        value={form.group_uuid}
                        onChange={(id) => setForm({ ...form, group_uuid: id == null ? null : String(id) })}
                        help="Include a group to test its extra rules. An INACTIVE group is legal and is evaluated — the result says so."
                    />

                    {scopes.length > 0 && (
                        <label className="field">
                            <span className="field-label">Endpoint type</span>
                            <select
                                className="input"
                                value={form.scope}
                                onChange={(e) => setForm({ ...form, scope: e.target.value })}
                            >
                                <option value="">Any endpoint</option>
                                {scopes.map((scope) => (
                                    <option key={scope} value={scope}>{scopeLabel(scope)}</option>
                                ))}
                            </select>
                            <span className="field-help">Options reflect the endpoint types this server actually gates.</span>
                        </label>
                    )}

                    <div className="geo-save-row">
                        <button
                            type="button"
                            className="btn btn-primary btn-compact"
                            disabled={simulate.isPending}
                            onClick={() => void run()}
                        >
                            <i className="bi bi-play-fill" /> Run test
                        </button>
                        <span className={`geo-status ${status.tone === 'bad' ? 'text-bad' : 'dim'}`}>{status.text}</span>
                    </div>
                    <p className="dim">
                        Tests never affect real traffic, are never cached, and leave no log entries.
                    </p>
                </div>
            </div>

            <div className="geo-side">
                {result
                    ? <ResultCard decision={result.decision} sentScope={result.scope} />
                    : (
                        <div className="panel netsec-card">
                            <div className="netsec-card-body dim">
                                Run a test to see the decision here. Tests never affect real traffic,
                                are never cached, and leave no log entries.
                            </div>
                        </div>
                    )}
            </div>
        </div>
    );
}
