// Logins — the source's Locations section (read in full 2026-08-05).
//
// ── THE MAP TAB IS NOW SHIPPED (#1291) ───────────────────────────────
// This file previously carried an explicit deviation note: web-mojo's
// Locations section opened on a MapLibre map with the login list as the
// second tab, and portal-mojo shipped the list alone because "no map
// library". That seam is CLOSED — #1426's WorldMap is a dependency-free SVG
// rebuild, so the Map tab mounts here exactly as the source had it, with the
// same wire (`/api/account/logins/user?user_id=`) and zero new dependencies.
//
// The Map tab is present only when the caller can read the aggregation
// endpoint; absent, it issues NO request at all rather than a denied one.
import { useState } from 'react';
import { Eyebrow, fmt } from '../../../../ui';
import { useCan } from '../../../../client/runtime';
import { LoginLocationMap } from '../../../security/devices/LoginLocationMap';
import { showLoginEventDetail } from '../../../security/devices/LoginEventDetail';
import { showUserDeviceDetailByDuid } from '../../../security/devices/UserDeviceDetail';
import { LOGIN_SUMMARY_PERMS, loginRiskTone } from '../../../security/devices/models';
import { LoginEventModel, type UserRow } from '../models';
import { groupRowsByDay, Pager, SectionSearch, SectionTabs, useSectionList } from './shared';

/** WorldMap tone → the `tone-*` class the login dot is styled with. */
const DOT_CLASS: Record<string, string> = { bad: 'danger', warn: 'warning', ok: 'success' };

function LoginList({ user }: { user: UserRow }) {
    const list = useSectionList(5, { user: user.id, sort: '-created' });
    const { data, isPending } = LoginEventModel.useList(list.params);
    const rows = data?.rows ?? [];
    const groups = groupRowsByDay(rows, (l) => l.created);

    return (
        <>
            <div className="us-list-head">
                <SectionSearch state={list} placeholder="Search logins…" />
            </div>
            {isPending && <p className="dim">Loading…</p>}
            {!isPending && rows.length === 0 && (
                <div className="us-empty"><i className="bi bi-geo-alt" /><div>No login events on file.</div></div>
            )}
            {groups.map((g) => (
                <div key={g.label}>
                    <div className="us-day-head">{g.label}</div>
                    {g.rows.map((l) => {
                        const where = [
                            l.city ?? '—',
                            l.region && l.region !== l.city ? l.region : null,
                        ].filter(Boolean).join(', ');
                        return (
                            <button
                                key={l.id}
                                type="button"
                                className="us-login-row"
                                onClick={() => showLoginEventDetail(l.id, { onOpenDeviceByDuid: showUserDeviceDetailByDuid })}
                            >
                                <span className={`us-login-dot tone-${DOT_CLASS[loginRiskTone(l)] ?? 'muted'}`} />
                                <span className="us-row-info">
                                    <span className="us-row-title">
                                        {where}
                                        {l.country_code && <span className="dim"> · {l.country_code}</span>}
                                        {l.is_new_country && <span className="chip chip-warning us-chip-sm">New country</span>}
                                    </span>
                                    <span className="us-row-meta">
                                        {l.ip_address && <code>{l.ip_address}</code>}
                                        {l.source && <> · {l.source}</>}
                                    </span>
                                </span>
                                <span className="us-row-when" title={fmt.datetime(l.created)}>{fmt.relative(l.created)}</span>
                            </button>
                        );
                    })}
                </div>
            ))}
            <Pager state={list} count={data?.count ?? 0} />
        </>
    );
}

export function LoginsSection({ user }: { user: UserRow }) {
    const canMap = useCan(LOGIN_SUMMARY_PERMS).can;
    const [tab, setTab] = useState(canMap ? 'map' : 'logins');
    const active = canMap ? tab : 'logins';

    return (
        <>
            <Eyebrow>Login history</Eyebrow>
            {canMap && (
                <SectionTabs
                    tabs={[{ key: 'map', label: 'Map' }, { key: 'logins', label: 'Logins' }]}
                    active={active}
                    onSelect={setTab}
                />
            )}
            {/* The map is scoped to this user and mounts only when it can be
                read — no denied background request when the grant is absent. */}
            {canMap && (
                <div hidden={active !== 'map'}>
                    <LoginLocationMap userId={user.id} height={280} enabled={canMap} />
                </div>
            )}
            {/* Kept mounted-but-hidden so page/search state survives a tab
                switch (web-mojo TabView keep-alive semantic). */}
            <div hidden={active !== 'logins'}><LoginList user={user} /></div>
        </>
    );
}
