// MERGE-WIRE: rail — ComponentsPage.tsx, 'Admin' group, after 'admin-devices'
// (plus the import line):
//   import { AdminNetworkDemo } from './demos-admin-network';
//   { key: 'admin-network', title: 'Network security', icon: 'bi-hdd-network', … }
// MERGE-WIRE: theme.css — @import "./theme/admin-network.css";
//
// Network security demos (board #1287). Every surface the item ships is
// reachable from here so the verifier and a human reviewer see the same set:
// the three tables, the three KISS detail modals, the geofencing page with all
// four tabs, the shared rule editor in isolation, and the two permission-denied
// states (geofence-only and security-events-denied).
import { useState } from 'react';
import {
    BlockedIPsPage,
    FirewallLogPage,
    GeofencingPage,
    GeofenceRuleEditor,
    IPSetsPage,
    makeRuleEditorValue,
    ruleFromEditorValue,
    showBlockedIpDetail,
    showIPSetDetail,
    type RuleEditorValue,
} from 'portal-mojo/admin';
import { Guarded } from 'portal-mojo/ui';

type Surface =
    | 'blocked' | 'firewall' | 'ipsets' | 'geofencing'
    | 'editor' | 'modals' | 'denied';

const TABS: { key: Surface; label: string; icon: string }[] = [
    { key: 'blocked', label: 'Blocked IPs', icon: 'bi-slash-circle' },
    { key: 'firewall', label: 'Firewall Log', icon: 'bi-journal-text' },
    { key: 'ipsets', label: 'IP Sets', icon: 'bi-hdd-network' },
    { key: 'geofencing', label: 'Geofencing', icon: 'bi-globe-americas' },
    { key: 'editor', label: 'Rule editor', icon: 'bi-sliders' },
    { key: 'modals', label: 'Detail modals', icon: 'bi-window-stack' },
    { key: 'denied', label: 'Permission denied', icon: 'bi-shield-lock' },
];

/**
 * The shared editor, standalone. This is the exact component the platform
 * Rules tab and the group-scoped GeofenceSection both render — one projection,
 * two scopes. The JSON round-trip is live: the panel below always shows what
 * `ruleFromEditorValue` would send.
 */
function RuleEditorDemo() {
    const [value, setValue] = useState<RuleEditorValue>(() => makeRuleEditorValue({
        country: { not_in: ['CN', 'RU'] },
        region: { not_in: ['US-CA'] },
        abuse: { tor: false, vpn: false },
    }));
    const [advanced, setAdvanced] = useState<RuleEditorValue>(() => makeRuleEditorValue({
        // A shape the guided form CANNOT represent (a require-flag `true`), so
        // the editor opens forced into JSON with no toggle offered.
        country: { eq: 'US' },
        abuse: { tor: true },
    }));
    const rule = ruleFromEditorValue(value);

    return (
        <div className="geo-two-col">
            <div className="panel netsec-card">
                <div className="netsec-card-head"><span>Representable rule — guided ↔ JSON</span></div>
                <div className="netsec-card-body">
                    <GeofenceRuleEditor value={value} onChange={setValue} />
                </div>
            </div>
            <div className="geo-side">
                <div className="panel netsec-card">
                    <div className="netsec-card-head"><span>What would be sent</span></div>
                    <div className="netsec-card-body">
                        <pre className="netsec-cidr-block">
                            <code>{rule === null ? '// invalid JSON — save and the toggle back to guided are both refused' : JSON.stringify(rule, null, 2)}</code>
                        </pre>
                    </div>
                </div>
                <div className="panel netsec-card">
                    <div className="netsec-card-head"><span>Advanced-forced rule</span></div>
                    <div className="netsec-card-body">
                        <GeofenceRuleEditor value={advanced} onChange={setAdvanced} advancedForced />
                    </div>
                </div>
            </div>
        </div>
    );
}

function ModalsDemo() {
    return (
        <div className="panel netsec-card">
            <div className="netsec-card-head"><span>KISS detail modals (#1425)</span></div>
            <div className="netsec-card-body">
                <p className="dim">
                    Every inspection surface in this module is a <code>modal.detail</code> over a
                    real mock record — no routes, no right panel, no page navigation.
                </p>
                <div className="netsec-action-row">
                    <button type="button" className="btn btn-compact" onClick={() => showBlockedIpDetail(4108)}>
                        <i className="bi bi-slash-circle" /> Blocked IP — permanent block
                    </button>
                    <button type="button" className="btn btn-compact" onClick={() => showBlockedIpDetail(4110)}>
                        <i className="bi bi-hourglass-bottom" /> Blocked IP — EXPIRED block
                    </button>
                    <button type="button" className="btn btn-compact" onClick={() => showBlockedIpDetail(4119)}>
                        <i className="bi bi-shield-check" /> Blocked IP — whitelist beats the block
                    </button>
                    <button type="button" className="btn btn-compact" onClick={() => showIPSetDetail(7100)}>
                        <i className="bi bi-hdd-network" /> IP set — enforcing country zone
                    </button>
                    <button type="button" className="btn btn-compact" onClick={() => showIPSetDetail(7107)}>
                        <i className="bi bi-database-lock" /> IP set — CACHE-ONLY (enable is refused)
                    </button>
                    <button type="button" className="btn btn-compact" onClick={() => showIPSetDetail(7106)}>
                        <i className="bi bi-exclamation-triangle" /> IP set — sync error
                    </button>
                </div>
                <p className="dim">
                    The Firewall Log's inspector is the shipped monitoring <code>LogInspector</code>,
                    reached by clicking any row on that tab.
                </p>
            </div>
        </div>
    );
}

function DeniedDemo() {
    return (
        <div className="panel netsec-card">
            <div className="netsec-card-head"><span>Fail-closed gates</span></div>
            <div className="netsec-card-body">
                <p className="dim">
                    Every geofence clause is <code>sys.</code>-pinned, so a member grant can never
                    satisfy it. A denied surface renders its explanation and issues <b>no</b> request.
                </p>
                <Guarded
                    permission={['sys.this_grant_does_not_exist']}
                    fallback={(
                        <div className="netsec-note netsec-note-info">
                            <i className="bi bi-shield-lock" />
                            <div>
                                Denied — the platform rules editor requires
                                <code> sys.manage_geofence</code> or <code>sys.security</code>.
                            </div>
                        </div>
                    )}
                >
                    <div className="netsec-note">Never rendered.</div>
                </Guarded>
                <p className="dim">
                    The same shape covers the three partial denials inside Geofencing: metrics
                    (<code>view_metrics</code>) hides the KPI strip, chart and country list;
                    security events (<code>view_security</code>) hides the change history, the
                    blocks table and the Last-change chip. None of them fires a request.
                </p>
            </div>
        </div>
    );
}

export function AdminNetworkDemo() {
    const [surface, setSurface] = useState<Surface>('blocked');

    return (
        <>
            <div className="seg" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        type="button"
                        className={`seg-btn${surface === tab.key ? ' seg-active' : ''}`}
                        onClick={() => setSurface(tab.key)}
                    >
                        <i className={`bi ${tab.icon}`} /> {tab.label}
                    </button>
                ))}
            </div>

            {surface === 'blocked' && <BlockedIPsPage />}
            {surface === 'firewall' && <FirewallLogPage />}
            {surface === 'ipsets' && <IPSetsPage />}
            {surface === 'geofencing' && <GeofencingPage />}
            {surface === 'editor' && <RuleEditorDemo />}
            {surface === 'modals' && <ModalsDemo />}
            {surface === 'denied' && <DeniedDemo />}
        </>
    );
}
