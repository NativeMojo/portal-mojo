// GeofencingPage — posture header over four tabs (Rules · Simulator ·
// Blocks log · Exemptions). Port of web-mojo `GeofencingPage.js`.
//
// This is the ONE surface in this module that stays a PAGE rather than a
// KISS detail modal: the requested presentation is exactly "a config page that
// states what is in force and lets you test it before it bites".
//
// ONE `useGeoConfig()` query feeds the header and every tab. TanStack Query
// replaces the source's manual onEnter/onAfterMount fetch dance entirely — a
// rules save or an override removal invalidates the key and every consumer
// re-reads, with no `config-changed` event plumbing.
import { useState } from 'react';
import { useCan } from '../../../client/runtime';
import type { EventRow } from '../../incidents/models';
import {
    GEOFENCE_API_MISSING_MESSAGE, GEOFENCE_EVENT_CATEGORIES, GeofenceEventModel,
    isGeofenceApiMissing, useGeoConfig,
} from '../models';
import { GEOFENCE_VIEW_PERMS, SECURITY_EVENTS_PERMS } from './geofence-data';
import { PostureHeader } from './PostureHeader';
import { RulesTab } from './RulesTab';
import { SimulatorTab } from './SimulatorTab';
import { BlocksTab } from './BlocksTab';
import { ExemptionsTab } from './ExemptionsTab';

type TabKey = 'rules' | 'simulator' | 'blocks' | 'exemptions';

const TABS: { key: TabKey; label: string; icon: string }[] = [
    { key: 'rules', label: 'Rules', icon: 'bi-sliders' },
    { key: 'simulator', label: 'Simulator', icon: 'bi-play-circle' },
    { key: 'blocks', label: 'Blocks log', icon: 'bi-journal-text' },
    { key: 'exemptions', label: 'Exemptions', icon: 'bi-shield-check' },
];

export function GeofencingPage() {
    const { can: canView } = useCan(GEOFENCE_VIEW_PERMS);
    const { can: canEvents } = useCan(SECURITY_EVENTS_PERMS);
    const config = useGeoConfig();
    const [tab, setTab] = useState<TabKey>('rules');

    // The Last-change chip is OPTIONAL: omitted silently — and with no request
    // issued — for an operator without security-events access.
    const lastChangeQuery = GeofenceEventModel.useList(
        { category: GEOFENCE_EVENT_CATEGORIES.config, size: 1, sort: '-created' },
        { enabled: canView && canEvents },
    );
    const lastChange: EventRow | null = lastChangeQuery.data?.rows[0] ?? null;

    if (!canView) {
        return (
            <div className="geofencing-page">
                <div className="panel">
                    <div className="empty-state">
                        <i className="bi bi-shield-lock" />
                        <h3>Access denied</h3>
                        <p>Geofencing configuration requires a global geofence grant.</p>
                    </div>
                </div>
            </div>
        );
    }

    if (config.error) {
        // A backend without the config plane simply does not register the
        // /api/geo routes, so the wire answer is a 404 — not an error
        // envelope. Anything else is a real failure and shows its own message.
        const missing = isGeofenceApiMissing(config.error);
        return (
            <div className="geofencing-page">
                <div className="panel">
                    <div className="empty-state">
                        <i className={`bi ${missing ? 'bi-plug' : 'bi-exclamation-triangle'}`} />
                        <h3>{missing ? 'Geofencing administration unavailable' : 'Could not load the geofence configuration'}</h3>
                        <p>{missing ? GEOFENCE_API_MISSING_MESSAGE : config.error.message}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="geofencing-page">
            <PostureHeader config={config.data} lastChange={lastChange} loading={config.isPending} />

            <div className="geo-tabs">
                <div className="seg">
                    {TABS.map((entry) => (
                        <button
                            key={entry.key}
                            type="button"
                            className={`seg-btn${tab === entry.key ? ' seg-active' : ''}`}
                            onClick={() => setTab(entry.key)}
                        >
                            <i className={`bi ${entry.icon}`} /> {entry.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="geo-tab-body">
                {config.isPending ? (
                    <div className="panel">
                        <div className="empty-state">
                            <i className="bi bi-hourglass-split" />
                            <p>Waiting for the geofence configuration…</p>
                        </div>
                    </div>
                ) : (
                    <>
                        {tab === 'rules' && <RulesTab config={config.data} />}
                        {tab === 'simulator' && <SimulatorTab config={config.data} />}
                        {tab === 'blocks' && <BlocksTab />}
                        {tab === 'exemptions' && <ExemptionsTab />}
                    </>
                )}
            </div>
        </div>
    );
}
