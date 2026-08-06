// PostureHeader — the read-only "is geofencing actually enforcing" answer.
// Port of web-mojo `GeofencePostureHeader.js`.
//
// Read-only ON PURPOSE. Everything it shows (GEOFENCE_ENABLED,
// GEOFENCE_FAIL_CLOSED, GEOFENCE_FAIL_CLOSED_SCOPES, GEOFENCE_CACHE_TTL,
// GEOFENCE_STRICT_POSTURE) is a plain `Setting` row with no validated
// geofence-specific endpoint. Writing them through the generic settings path
// would bypass the validation seam the config plane exists to provide, so the
// header points at Runtime Settings instead. Same call web-mojo made.
import type { ReactNode } from 'react';
import { fmt } from '../../../ui';
import type { EventRow } from '../../incidents/models';
import { configChangedBy } from '../models';
import { collectScopes, scopeLabel, type GeoRulesConfig } from './geofence-data';

type ChipTone = '' | 'warn' | 'bad' | 'ok';

interface PostureChip {
    label: string;
    value: ReactNode;
    tone: ChipTone;
    title?: string;
}

const SOURCE_LABELS: Record<string, string> = {
    setting: 'Portal (database)',
    conf: 'Deploy file',
    none: 'No rules configured',
};

/** `cache_ttl` is seconds; 0 or negative means the decision cache is off. */
export function ttlLabel(ttl: number | null | undefined): string {
    const n = Number(ttl);
    if (!Number.isFinite(n) || n <= 0) return 'off';
    if (n % 60 === 0) return `${n / 60} min`;
    return `${n}s`;
}

export function buildPostureChips(
    config: GeoRulesConfig | null | undefined,
    lastChange: EventRow | null,
): PostureChip[] {
    const posture = config?.posture ?? {};
    const chips: PostureChip[] = [];

    const source = config?.system?.source || 'none';
    chips.push({
        label: 'Rules source',
        value: SOURCE_LABELS[source] ?? source,
        tone: source === 'conf' ? 'warn' : '',
        title: source === 'conf'
            ? 'These rules come from the deployment file. Saving in the portal creates an override that takes precedence.'
            : undefined,
    });

    // One chip per scope the config ACTUALLY DECLARES — scopes are
    // deployment-defined strings and are never hardcoded here.
    const failClosedScopes = posture.fail_closed_scopes ?? [];
    for (const scope of collectScopes(config)) {
        const closed = Boolean(posture.fail_closed) || failClosedScopes.includes(scope);
        chips.push({
            label: scopeLabel(scope),
            value: closed ? 'fail closed' : 'fail open',
            tone: closed ? 'warn' : '',
            title: closed
                ? 'A failed location lookup DENIES the request on this scope.'
                : 'A failed location lookup lets the request through on this scope.',
        });
    }

    // Not in the source. `strict_posture` is what turns an EMPTY ruleset into
    // a denial (`no_rules_strict`), so an operator staring at "no rules
    // configured" needs to know which of the two worlds they are in.
    if (posture.strict_posture) {
        chips.push({
            label: 'Strict posture',
            value: 'on',
            tone: 'warn',
            title: 'With no rules configured, requests are DENIED rather than passed through.',
        });
    }

    if (posture.cache_ttl !== undefined && posture.cache_ttl !== null) {
        chips.push({ label: 'Decision cache', value: ttlLabel(posture.cache_ttl), tone: '' });
    }

    const summary = config?.allowlist_summary ?? {};
    const ranges = summary.setting_entries ?? 0;
    const ips = summary.geoip_active ?? 0;
    chips.push({
        label: 'Exemptions',
        value: `${ranges} range${ranges === 1 ? '' : 's'} · ${ips} IP${ips === 1 ? '' : 's'}`,
        tone: '',
    });

    if (lastChange) {
        // BACKEND CORRECTION: `evidence.report_config_change` writes
        // `changed_by`; `reporter._create_event_dict` writes `user_name`.
        // web-mojo read `metadata.username`, which neither writes — the chip
        // rendered blank on every deployment.
        const who = configChangedBy(lastChange.metadata);
        const when = fmt.datetime(lastChange.created);
        chips.push({ label: 'Last change', value: who ? `${when} · ${who}` : when, tone: '' });
    }

    return chips;
}

export function PostureHeader({ config, lastChange, loading }: {
    config: GeoRulesConfig | null | undefined;
    lastChange: EventRow | null;
    loading?: boolean;
}) {
    if (loading) {
        return (
            <div className="panel geo-posture">
                <div className="dim"><i className="bi bi-hourglass-split" /> Loading geofencing status…</div>
            </div>
        );
    }

    const enabled = Boolean(config?.posture?.enabled);
    const chips = buildPostureChips(config, lastChange);
    const endpoints = (config?.enforced_endpoints ?? []).map((entry) => ({
        // Strip the framework prefix so the list scans; keep enough of the
        // path to stay unambiguous in a compliance screenshot.
        endpoint: String(entry.endpoint ?? '').replace(/^mojo\.apps\./, ''),
        scope: entry.scope || '—',
        afterAuth: entry.after_auth === true,
    }));

    return (
        <div className="panel geo-posture">
            <div className="geo-posture-head">
                <span className="geo-posture-icon"><i className="bi bi-globe-americas" /></span>
                <div className="geo-posture-title">
                    <h2>Geofencing</h2>
                    <p className="dim">Location-based access rules for this deployment’s protected endpoints.</p>
                </div>
                <span className={`chip ${enabled ? 'chip-success' : 'chip-muted'} geo-status-pill`}>
                    <i className={`bi ${enabled ? 'bi-shield-check' : 'bi-shield-slash'}`} />
                    {enabled ? 'Enforcing' : 'Off — rules staged, not enforcing'}
                </span>
            </div>

            <div className="geo-chip-row">
                {chips.map((chip, index) => (
                    <span key={`${chip.label}-${index}`} className={`geo-chip ${chip.tone}`} title={chip.title}>
                        {chip.label} <b>{chip.value}</b>
                    </span>
                ))}
            </div>

            {endpoints.length > 0 ? (
                <details className="geo-endpoints">
                    <summary>{endpoints.length} protected endpoint{endpoints.length === 1 ? '' : 's'}</summary>
                    <div className="geo-endpoint-list">
                        {endpoints.map((entry) => (
                            <div key={entry.endpoint} className="geo-endpoint">
                                <span className="chip chip-muted">{entry.scope}</span>
                                <code>{entry.endpoint}</code>
                                {entry.afterAuth && (
                                    <span className="chip chip-warning" title="This endpoint is gated AFTER credentials are verified.">
                                        enforced after credentials
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </details>
            ) : (
                <p className="dim geo-endpoints-empty">
                    <i className="bi bi-info-circle" /> No endpoints on this server are gated by geofencing.
                </p>
            )}

            <p className="dim geo-posture-foot">
                Posture values (enforcement, fail-closed scopes, cache TTL, strict posture) are
                deployment settings and are edited in Runtime Settings, not here — this page owns
                the rules, exemptions and evidence.
            </p>
        </div>
    );
}
