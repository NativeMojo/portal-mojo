// Audit — UserAuditSection port (read in full 2026-08-05): the
// disable-history accordion (metadata.protected.disable.history — ISO `at`
// stamps per services/disable.py) over three day-grouped, searchable,
// pageSize-5 feeds:
//   Activity  — /api/logs?uid=<id>            (everything the user did)
//   Events    — /api/incident/event?model_name=account.User&model_id=<id>
//   Audit Log — /api/logs?model_name=account.User&model_id=<id>
//               (changes made TO the record)
// The whole section is view_logs-gated at the rail (UserDetail); incident
// events additionally need view_security live — a denial there surfaces as
// the tab's error text, not a crash.
import { useState } from 'react';
import { Badge, Eyebrow, fmt } from 'portal-mojo/ui';
import { LogModel, type LogRow } from 'portal-mojo/admin';
import { IncidentEventModel, type UserRow } from '../../models';
import {
    DISABLE_REASON_BADGES, disableBlock, groupRowsByDay,
    LOG_LEVEL_ICON, LOG_LEVEL_TONE,
    Pager, SectionSearch, SectionTabs, useSectionList,
} from './shared';

// ── Disable-history accordion ─────────────────────────────────────────

function DisableHistory({ user }: { user: UserRow }) {
    const history = disableBlock(user)?.history;
    if (!Array.isArray(history) || history.length === 0) return null;
    return (
        <>
            <Eyebrow>Disable history</Eyebrow>
            <div className="us-history">
                {history.map((entry, idx) => {
                    const badge = (entry.reason && DISABLE_REASON_BADGES[entry.reason]) || { label: 'Inactive', tone: 'muted' as const };
                    return (
                        <details key={idx} className="us-history-item">
                            <summary>
                                <Badge tone={badge.tone}>{badge.label}</Badge>
                                <span className="dim">{entry.at ? fmt.relative(entry.at) : ''}</span>
                                {entry.by_username && <span>by <code>{entry.by_username}</code></span>}
                                {entry.reactivated_at && <span className="chip chip-muted us-history-flag">Reactivated</span>}
                                <i className="bi bi-chevron-down us-history-chev" />
                            </summary>
                            <div className="us-history-body">
                                <div><strong>Disabled:</strong> {entry.at ? fmt.datetime(entry.at) : '—'}</div>
                                {entry.note && <div><strong>Note:</strong> {entry.note}</div>}
                                {entry.reactivated_at && (
                                    <div className="us-history-react">
                                        <div>
                                            <strong>Reactivated:</strong> {fmt.datetime(entry.reactivated_at)}
                                            {entry.reactivated_by_username && <> by <code>{entry.reactivated_by_username}</code></>}
                                        </div>
                                        {entry.reactivated_note && <div><strong>Note:</strong> {entry.reactivated_note}</div>}
                                    </div>
                                )}
                            </div>
                        </details>
                    );
                })}
            </div>
        </>
    );
}

// ── Feed rows ─────────────────────────────────────────────────────────

function LogFeedRow({ log, showPath }: { log: LogRow; showPath: boolean }) {
    const tone = LOG_LEVEL_TONE[(log.level ?? '').toLowerCase()] ?? 'muted';
    const icon = LOG_LEVEL_ICON[(log.level ?? '').toLowerCase()] ?? 'bi-circle';
    return (
        <div className={`us-audit-row tone-${tone}`}>
            <div className="us-row-icon"><i className={`bi ${icon}`} /></div>
            <div className="us-row-info">
                <div className="us-row-title">{log.kind || log.level || 'event'}</div>
                <div className="us-row-meta">{log.log || '(no message)'}</div>
                {showPath && log.path && <div className="us-row-path"><code>{log.path}</code></div>}
            </div>
            <span className="us-row-when" title={fmt.datetime(log.created)}>{fmt.relative(log.created)}</span>
        </div>
    );
}

function LogsTab({ params, placeholder, empty, showPath }: {
    params: Record<string, string | number>;
    placeholder: string;
    empty: string;
    showPath: boolean;
}) {
    const list = useSectionList(5, { ...params, sort: '-created' });
    const { data, isPending, isError, error } = LogModel.useList(list.params);
    const rows = data?.rows ?? [];
    const groups = groupRowsByDay(rows, (l) => l.created);
    return (
        <>
            <div className="us-list-head">
                <SectionSearch state={list} placeholder={placeholder} />
            </div>
            {isPending && <p className="dim">Loading…</p>}
            {isError && <p className="dim">{error instanceof Error ? error.message : 'Failed to load.'}</p>}
            {!isPending && !isError && rows.length === 0 && (
                <div className="us-empty"><i className="bi bi-clock-history" /><div>{empty}</div></div>
            )}
            {groups.map((g) => (
                <div key={g.label}>
                    <div className="us-day-head">{g.label}</div>
                    {g.rows.map((l) => <LogFeedRow key={l.id} log={l} showPath={showPath} />)}
                </div>
            ))}
            <Pager state={list} count={data?.count ?? 0} />
        </>
    );
}

function EventsTab({ user }: { user: UserRow }) {
    const list = useSectionList(5, { model_name: 'account.User', model_id: user.id, sort: '-created' });
    const { data, isPending, isError, error } = IncidentEventModel.useList(list.params);
    const rows = data?.rows ?? [];
    const groups = groupRowsByDay(rows, (e) => e.created);
    return (
        <>
            <div className="us-list-head">
                <SectionSearch state={list} placeholder="Search events…" />
            </div>
            {isPending && <p className="dim">Loading…</p>}
            {isError && <p className="dim">{error instanceof Error ? error.message : 'Failed to load.'}</p>}
            {!isPending && !isError && rows.length === 0 && (
                <div className="us-empty"><i className="bi bi-shield-exclamation" /><div>No events for this user.</div></div>
            )}
            {groups.map((g) => (
                <div key={g.label}>
                    <div className="us-day-head">{g.label}</div>
                    {g.rows.map((e) => (
                        <div key={e.id} className="us-audit-row tone-info">
                            <div className="us-row-icon"><i className="bi bi-shield-exclamation" /></div>
                            <div className="us-row-info">
                                <div className="us-row-title">{e.title || e.category || 'event'}</div>
                                {e.details && <div className="us-row-meta">{e.details}</div>}
                                {e.category && <div className="us-row-path"><span className="chip chip-muted">{e.category}</span></div>}
                            </div>
                            <span className="us-row-when" title={fmt.datetime(e.created)}>{fmt.relative(e.created)}</span>
                        </div>
                    ))}
                </div>
            ))}
            <Pager state={list} count={data?.count ?? 0} />
        </>
    );
}

// ── The section ───────────────────────────────────────────────────────

export function AuditSection({ user }: { user: UserRow }) {
    const [tab, setTab] = useState('activity');
    return (
        <>
            <DisableHistory user={user} />
            <Eyebrow>Audit</Eyebrow>
            <SectionTabs
                tabs={[
                    { key: 'activity', label: 'Activity' },
                    { key: 'events', label: 'Events' },
                    { key: 'audit', label: 'Audit Log' },
                ]}
                active={tab}
                onSelect={setTab}
            />
            {/* Tabs stay mounted-but-hidden so page/search state survives a
                tab switch (web-mojo TabView keep-alive semantic). */}
            <div hidden={tab !== 'activity'}>
                <LogsTab
                    params={{ uid: user.id }}
                    placeholder="Search activity…"
                    empty="No activity recorded yet."
                    showPath
                />
            </div>
            <div hidden={tab !== 'events'}><EventsTab user={user} /></div>
            <div hidden={tab !== 'audit'}>
                <LogsTab
                    params={{ model_name: 'account.User', model_id: user.id }}
                    placeholder="Search audit log…"
                    empty="No record changes logged."
                    showPath={false}
                />
            </div>
        </>
    );
}
