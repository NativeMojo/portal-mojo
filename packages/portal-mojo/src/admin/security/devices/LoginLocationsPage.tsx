// Login Locations — the UserDeviceLocationTablePage port: a Map tab over the
// login-location aggregation, and a Logins tab over the raw events.
//
// Clicking a country on the map applies `country_code` to the Logins tab
// through `<ModelTable key={…} defaultParams={…}>` — an honest REMOUNT rather
// than reaching into the params store from outside. The params store stays
// the single source of truth for table state; the key change is what makes
// the new default land.
import { useState } from 'react';
import { ModelTable, fmt, groupByDay, Badge, type Column, type FilterDef, type Preset } from '../../../ui';
import { useCan } from '../../../client/runtime';
import { COUNTRY_OPTIONS, countryName } from '../../../charts';
import { countryFlag } from '../geoip/models';
import { LoginLocationMap } from './LoginLocationMap';
import { showLoginEventDetail } from './LoginEventDetail';
import { showUserDeviceDetailByDuid } from './UserDeviceDetail';
import { LOGIN_SUMMARY_PERMS, LoginEventModel, type LoginEventRow } from './models';

const COLUMNS: Column<LoginEventRow>[] = [
    { key: 'created', label: 'Date', sortable: true, hideable: false, render: (row) => fmt.datetime(row.created) },
    { key: 'user', label: 'User', sortable: true, render: (row) => row.user?.display_name || row.user?.username || '—' },
    { key: 'ip_address', label: 'IP', sortable: true, render: (row) => <code>{row.ip_address || '—'}</code> },
    { key: 'city', label: 'City', render: (row) => row.city || '—' },
    { key: 'region', label: 'Region', render: (row) => row.region || '—' },
    {
        key: 'country_code', label: 'Country', sortable: true,
        render: (row) => {
            if (!row.country_code) return '—';
            const flag = countryFlag(row.country_code);
            return <>{flag && <span className="geoip-flag">{flag}</span>}{row.country_code}</>;
        },
    },
    { key: 'source', label: 'Source', sortable: true, render: (row) => row.source || '—' },
    {
        key: 'is_new_country', label: 'New', sortable: true, align: 'center',
        render: (row) => row.is_new_country
            ? <Badge tone="danger">Country</Badge>
            : row.is_new_region ? <Badge tone="warning">Region</Badge> : <span className="dim">—</span>,
    },
];

const FILTERS: FilterDef[] = [
    { key: 'created', label: 'Date', type: 'daterange' },
    { key: 'country_code', label: 'Country', type: 'select', options: [...COUNTRY_OPTIONS] },
    { key: 'region', label: 'Region', type: 'text' },
    { key: 'city', label: 'City', type: 'text' },
    { key: 'ip_address', label: 'IP address', type: 'text' },
    { key: 'source', label: 'Source', type: 'text' },
    { key: 'user', label: 'User ID', type: 'number', lookup: 'exact', placeholder: 'e.g. 1' },
    { key: 'is_new_country', label: 'New country', type: 'boolean' },
    { key: 'is_new_region', label: 'New region', type: 'boolean' },
];

function presets(): Preset[] {
    const day = (offsetDays: number) => new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
    return [
        { key: 'all', label: 'All', params: {} },
        { key: 'new-country', label: 'New country', params: { is_new_country: 'true' } },
        { key: 'recent', label: 'Last 30 days', params: { dr_field: 'created', dr_start: day(30), dr_end: day(0) } },
    ];
}

export interface LoginLocationsPageProps {
    /** Cross-link seam for the consuming app's user-detail surface. */
    onOpenUser?: (userId: number) => void;
}

export function LoginLocationsPage({ onOpenUser }: LoginLocationsPageProps = {}) {
    const [tab, setTab] = useState<'map' | 'logins'>('map');
    const [country, setCountry] = useState<string | null>(null);
    const canSummary = useCan(LOGIN_SUMMARY_PERMS).can;
    const grouping = groupByDay<LoginEventRow>('created');

    const openLogin = (id: number) => showLoginEventDetail(id, {
        onOpenUser,
        onOpenDeviceByDuid: showUserDeviceDetailByDuid,
    });

    return (
        <div className="login-locations-page">
            <div className="panel panel-pad ll-head">
                <div>
                    <div className="eyebrow">Security · Devices &amp; Logins</div>
                    <h2 className="panel-title">Login Locations</h2>
                    <p className="dim">Where every account signed in from, and which of those places are new.</p>
                </div>
                <div className="us-tabs" role="tablist">
                    <button
                        type="button" role="tab" aria-selected={tab === 'map'}
                        className={`us-tab${tab === 'map' ? ' us-tab-active' : ''}`}
                        onClick={() => setTab('map')}
                    >
                        Map
                    </button>
                    <button
                        type="button" role="tab" aria-selected={tab === 'logins'}
                        className={`us-tab${tab === 'logins' ? ' us-tab-active' : ''}`}
                        onClick={() => setTab('logins')}
                    >
                        Logins
                    </button>
                </div>
            </div>

            {tab === 'map' && (
                <div className="panel panel-pad">
                    <LoginLocationMap
                        height={420}
                        enabled={canSummary}
                        onOpenUser={onOpenUser}
                        onOpenLogin={openLogin}
                        onCountrySelect={(code) => { setCountry(code); setTab('logins'); }}
                    />
                    {!canSummary && (
                        <p className="dim-italic">
                            Aggregated login geography needs a system-level users or security grant.
                        </p>
                    )}
                </div>
            )}

            {tab === 'logins' && (
                <>
                    {country && (
                        <div className="ll-scope">
                            <span className="dim">Scoped to</span>
                            <Badge tone="info">{countryFlag(country)} {countryName(country) || country}</Badge>
                            <button className="btn btn-compact" onClick={() => setCountry(null)}>
                                <i className="bi bi-x-lg" /> Clear
                            </button>
                        </div>
                    )}
                    {/* The key is the remount: a new country means a new table
                        identity, so `defaultParams` genuinely applies instead
                        of being ignored as a stale initial value. */}
                    <ModelTable<LoginEventRow>
                        key={country ?? 'all'}
                        model={LoginEventModel}
                        eyebrow="Security · Devices & Logins"
                        title="Logins"
                        searchPlaceholder="Search IP, country, region, or city"
                        columns={COLUMNS}
                        filters={FILTERS}
                        presets={presets()}
                        // Only real filter keys go here — `defaultParams`
                        // entries render as clearable pills, so a `graph`
                        // default would show up as "Graph: list".
                        defaultParams={country ? { country_code: country } : undefined}
                        defaultSort="-created"
                        {...grouping}
                        groupHeaderStyle="band"
                        columnChooser
                        persistState
                        persistKey="admin:devices:logins"
                        exportFormats={['csv', 'json']}
                        onRowClick={(row) => openLogin(row.id)}
                    />
                </>
            )}
        </div>
    );
}
