// Devices — UserDevicesSection port (read in full 2026-08-05): two tabs,
// each a searchable pageSize-5 server list.
//
//   Browser — /api/user/device?user=<id>: rows carry the ua-parser
//     device_info block (user_agent.family+major · os.family+major), a
//     day-relative last_seen and the DUID truncated in the middle — the
//     source row template, verbatim.
//   Push — /api/account/devices/push?user=<id>: the REAL RegisteredDevice
//     shape (platform / device_name / os_version / app_version /
//     push_enabled) — web-mojo's template bound a device_info block that
//     this backend never serializes; the row binds the live fields instead.
import { useState } from 'react';
import { Badge, Eyebrow, fmt } from 'portal-mojo/ui';
import { DeviceModel, PushDeviceModel, type UserRow } from '../../models';
import { lastSeenLabel, Pager, SectionSearch, SectionTabs, useSectionList } from './shared';

const PLATFORM_ICON: Record<string, string> = {
    ios: 'bi-apple',
    android: 'bi-android2',
    web: 'bi-globe2',
};

function BrowserTab({ user }: { user: UserRow }) {
    const list = useSectionList(5, { user: user.id, sort: '-last_seen' });
    const { data, isPending } = DeviceModel.useList(list.params);
    const rows = data?.rows ?? [];
    return (
        <>
            <div className="us-list-head">
                <SectionSearch state={list} placeholder="Search browser devices…" />
            </div>
            {isPending && <p className="dim">Loading…</p>}
            {!isPending && rows.length === 0 && (
                <div className="us-empty"><i className="bi bi-laptop" /><div>No browser devices on file.</div></div>
            )}
            {rows.map((d) => {
                const ua = d.device_info;
                const browser = ua?.user_agent.family || 'Unknown browser';
                const browserMajor = ua?.user_agent.major ?? '';
                const os = ua?.os.family || 'Unknown OS';
                const osMajor = ua?.os.major ?? '';
                return (
                    <div key={d.id} className="us-device-row">
                        <div className="us-row-icon"><i className="bi bi-laptop" /></div>
                        <div className="us-row-info">
                            <div className="us-row-title">
                                {browser} {browserMajor} · {os} {osMajor}
                            </div>
                            <div className="us-row-meta">
                                {lastSeenLabel(d.last_seen)}
                                {d.duid && <> · <code title={d.duid}>{fmt.truncateMiddle(d.duid, 8, '…')}</code></>}
                                {d.last_ip && <> · {d.last_ip}</>}
                            </div>
                        </div>
                        <Badge tone="info">Browser</Badge>
                    </div>
                );
            })}
            <Pager state={list} count={data?.count ?? 0} />
        </>
    );
}

function PushTab({ user }: { user: UserRow }) {
    const list = useSectionList(5, { user: user.id, sort: '-last_seen' });
    const { data, isPending } = PushDeviceModel.useList(list.params);
    const rows = data?.rows ?? [];
    return (
        <>
            <div className="us-list-head">
                <SectionSearch state={list} placeholder="Search push devices…" />
            </div>
            {isPending && <p className="dim">Loading…</p>}
            {!isPending && rows.length === 0 && (
                <div className="us-empty"><i className="bi bi-bell" /><div>No push devices on file.</div></div>
            )}
            {rows.map((d) => (
                <div key={d.id} className="us-device-row">
                    <div className="us-row-icon"><i className={`bi ${PLATFORM_ICON[d.platform] ?? 'bi-bell'}`} /></div>
                    <div className="us-row-info">
                        <div className="us-row-title">
                            {d.device_name || d.device_id}
                            {d.os_version && <span className="dim"> · {d.platform} {d.os_version}</span>}
                        </div>
                        <div className="us-row-meta">
                            {lastSeenLabel(d.last_seen)}
                            {d.app_version && <> · app {d.app_version}</>}
                            {' · '}<code title={d.device_id}>{fmt.truncateMiddle(d.device_id, 8, '…')}</code>
                        </div>
                    </div>
                    <Badge tone={d.push_enabled ? 'primary' : 'muted'}>
                        <i className="bi bi-bell" /> {d.push_enabled ? 'Push' : 'Push off'}
                    </Badge>
                </div>
            ))}
            <Pager state={list} count={data?.count ?? 0} />
        </>
    );
}

export function DevicesSection({ user, counts }: { user: UserRow; counts: { browser: number; push: number } }) {
    const [tab, setTab] = useState('browser');
    return (
        <>
            <Eyebrow>Devices &amp; sessions</Eyebrow>
            <SectionTabs
                tabs={[
                    { key: 'browser', label: 'Browser', badge: counts.browser || null },
                    { key: 'push', label: 'Push', badge: counts.push || null },
                ]}
                active={tab}
                onSelect={setTab}
            />
            {/* Tabs stay mounted-but-hidden so page/search state survives a
                tab switch (web-mojo TabView keep-alive semantic). */}
            <div hidden={tab !== 'browser'}><BrowserTab user={user} /></div>
            <div hidden={tab !== 'push'}><PushTab user={user} /></div>
        </>
    );
}
