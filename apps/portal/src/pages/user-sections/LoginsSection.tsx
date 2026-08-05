// Logins — the source's Locations section (read in full 2026-08-05),
// list leg: /api/account/logins?user=<id>, day-grouped rows with the tone
// dot (event_type-keyed with the source's neutral fallthrough — the live
// wire serializes no event_type), city/region/country line, ip + source
// meta, relative time. Server search + pageSize-5 paging.
//
// ── MAP TAB: EXPLICIT DEVIATION ──────────────────────────────────────
// web-mojo's Locations opened on a MapLibre map (LoginLocationMapView) with
// the login list as the second tab. portal-mojo's dependency policy is
// "none" — no map library — so the list ships alone. The SEAM: rows carry
// latitude/longitude (already serialized by the live wire, see
// LoginEventRow), so a future map tab mounts beside this list inside
// LoginsSection with zero wire changes.
import { Eyebrow, fmt } from 'portal-mojo/ui';
import { LoginEventModel, type UserRow } from '../../models';
import { groupRowsByDay, loginTone, Pager, SectionSearch, useSectionList } from './shared';

export function LoginsSection({ user }: { user: UserRow }) {
    const list = useSectionList(5, { user: user.id, sort: '-created' });
    const { data, isPending } = LoginEventModel.useList(list.params);
    const rows = data?.rows ?? [];
    const groups = groupRowsByDay(rows, (l) => l.created);

    return (
        <>
            <Eyebrow>Login history</Eyebrow>
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
                            <div key={l.id} className="us-login-row">
                                <span className={`us-login-dot tone-${loginTone(l.event_type)}`} />
                                <div className="us-row-info">
                                    <div className="us-row-title">
                                        {where}
                                        {l.country_code && <span className="dim"> · {l.country_code}</span>}
                                        {l.is_new_country && <span className="chip chip-warning us-chip-sm">New country</span>}
                                    </div>
                                    <div className="us-row-meta">
                                        {l.ip_address && <code>{l.ip_address}</code>}
                                        {l.source && <> · {l.source}</>}
                                    </div>
                                </div>
                                <span className="us-row-when" title={fmt.datetime(l.created)}>{fmt.relative(l.created)}</span>
                            </div>
                        );
                    })}
                </div>
            ))}
            <Pager state={list} count={data?.count ?? 0} />
        </>
    );
}
