// IPSetDetail — the KISS `modal.detail` for one kernel firewall set.
// Port of web-mojo `admin/security/IPSetView.js` (TabView: Configuration +
// CIDR Data, with a fleet-operations kebab), rebuilt on the house detail
// modal with every fleet-affecting action behind an armed confirmation.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    ArmedButton, Badge, DetailView, Eyebrow, FlatRow, StatusPanel,
    fmt, modal, toast,
} from '../../ui';
import { useCan } from '../../client';
import {
    IPSET_CACHE_ONLY_HELP, IPSET_DELETE_PERMS, IPSET_KIND_BADGE_OPTIONS,
    IPSET_MANAGE_PERMS, IPSET_SOURCE_OPTIONS, IPSetModel,
    isCacheOnlyIPSet, useIPSetCidrData, type IPSetRow,
} from './models';
import { promptEditIPSet } from './IPSetEditor';

const DASH = <span className="dim-italic">—</span>;

export function ipSetKindLabel(kind: string): string {
    return IPSET_KIND_BADGE_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

export function ipSetSourceLabel(source: string): string {
    return IPSET_SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source;
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
        if (!clipboard) { toast.error('Clipboard unavailable in this context'); return; }
        try {
            await clipboard.writeText(text);
            setCopied(true);
            toast.success('CIDR list copied to clipboard');
            setTimeout(() => setCopied(false), 1200);
        } catch (error) {
            toast.error(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    return (
        <button type="button" className="btn btn-compact" onClick={() => void copy()}>
            <i className={`bi ${copied ? 'bi-check2' : 'bi-clipboard'}`} /> {copied ? 'Copied' : 'Copy'}
        </button>
    );
}

/**
 * The `graph=detailed` leg. Mounted only while the CIDR Data section is open,
 * and cached with `gcTime: 0` — a country zone file is megabytes of text and
 * has no business sitting in the persistent query cache.
 */
function CidrDataSection({ row }: { row: IPSetRow }) {
    const query = useIPSetCidrData(row.id, true);
    if (query.isPending) return <p className="dim">Loading CIDR data…</p>;
    if (query.error) return <p className="text-bad">{query.error.message}</p>;
    const data = query.data ?? { text: '', lines: [] };

    if (data.lines.length === 0) {
        return (
            <div className="empty-state">
                <i className="bi bi-database" />
                <p>No CIDRs stored on this set.</p>
                <p className="dim">
                    {row.source === 'manual'
                        ? 'A manual set is only ever filled by an explicit edit — “Refresh source” returns immediately for source=manual and changes nothing.'
                        : 'Run “Refresh source” to fetch the list from the configured provider.'}
                </p>
            </div>
        );
    }

    return (
        <>
            <div className="netsec-cidr-head">
                <div>
                    <div className="eyebrow">CIDR data</div>
                    <div className="dim">
                        <b>{data.lines.length.toLocaleString()}</b> entries in the stored blob
                        {data.lines.length !== row.cidr_count && (
                            <>
                                {' · '}
                                <span className="text-warn" title="cidr_count is only recomputed when the list is written — by a source refresh or by saving the list from the editor.">
                                    reported count {row.cidr_count.toLocaleString()}
                                </span>
                            </>
                        )}
                    </div>
                </div>
                <CopyButton text={data.text} />
            </div>
            <pre className="netsec-cidr-block"><code>{data.text}</code></pre>
        </>
    );
}

export function IPSetDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const qc = useQueryClient();
    const { data: row, isPending, error } = IPSetModel.useOne(id);
    const canManage = useCan(IPSET_MANAGE_PERMS).can;
    const canDelete = useCan(IPSET_DELETE_PERMS).can;
    const sync = IPSetModel.useAction('sync');
    const enable = IPSetModel.useAction('enable');
    const disable = IPSetModel.useAction('disable');
    const refresh = IPSetModel.useAction('refresh_source');
    const remove = IPSetModel.useDelete();
    const save = IPSetModel.useSave();

    if (isPending) return <div className="modal-pad dim">Loading IP set…</div>;
    if (!row || error) return <div className="modal-pad text-bad">{error?.message ?? 'IP set not found'}</div>;

    const cacheOnly = isCacheOnlyIPSet(row);

    const run = async (label: string, fn: () => Promise<unknown>) => {
        try {
            await fn();
            toast.success(label);
        } catch (err) {
            // The backend's own message, verbatim — the cache-only rejection
            // explains itself far better than any client copy could.
            toast.error(err instanceof Error ? err.message : `${label} failed`);
        }
    };

    const onEdit = async () => {
        const changes = await promptEditIPSet(row);
        if (!changes) return;
        try {
            await save.mutateAsync({ id, changes });
            // A `data` save re-runs set_data() server-side, so the detailed
            // read must not serve its previous blob.
            await qc.invalidateQueries({ queryKey: [IPSetModel.endpoint] });
            toast.success('IP set updated');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not save the IP set');
        }
    };

    return (
        <DetailView
            icon="bi-hdd-network"
            title={row.name}
            subtitle={row.description || `${ipSetKindLabel(row.kind)} set · ${ipSetSourceLabel(row.source)}`}
            chips={[
                { text: ipSetKindLabel(row.kind), tone: 'muted' },
                { text: row.is_enabled ? 'Enabled' : 'Disabled', tone: row.is_enabled ? 'success' : 'muted' },
                ...(cacheOnly ? [{ icon: 'bi-database-lock', text: 'CACHE-ONLY', tone: 'warning' as const }] : []),
                ...(row.sync_error ? [{ icon: 'bi-exclamation-triangle', text: 'Sync error', tone: 'danger' as const }] : []),
            ]}
            sections={[
                {
                    key: 'config', label: 'Configuration', icon: 'bi-sliders', render: () => (
                        <>
                            <StatusPanel
                                tone={row.sync_error ? 'danger' : row.is_enabled ? 'success' : 'info'}
                                state={row.is_enabled ? 'ENFORCING' : 'NOT ENFORCING'}
                                headline={row.sync_error
                                    ? row.sync_error
                                    : row.is_enabled
                                        ? 'CIDRs from this set are loaded into iptables on every fleet instance.'
                                        : 'This set is stored but is not loaded into any firewall.'}
                                meta={row.last_synced == null
                                    ? 'Never synced to the fleet.'
                                    : `Last synced ${fmt.datetime(row.last_synced)} · ${fmt.relative(row.last_synced)}`}
                                actions={canManage ? (
                                    <div className="netsec-action-row">
                                        {row.is_enabled ? (
                                            <ArmedButton
                                                className="btn-compact"
                                                icon="bi-toggle-off"
                                                label="Disable & remove from fleet"
                                                armedLabel="Click again — every fleet instance drops this set from iptables"
                                                onConfirm={() => run('IP set disabled and removed from the fleet', () => disable.mutateAsync({ id }))}
                                            />
                                        ) : (
                                            <ArmedButton
                                                className="btn-compact"
                                                icon="bi-toggle-on"
                                                label="Enable & sync"
                                                armedLabel={cacheOnly
                                                    ? 'Click again — the server will refuse this (cache-only list)'
                                                    : `Click again — ${row.cidr_count.toLocaleString()} ranges are kernel-blocked fleet-wide`}
                                                onConfirm={() => run('IP set enabled and synced', () => enable.mutateAsync({ id }))}
                                            />
                                        )}
                                        <ArmedButton
                                            className="btn-compact"
                                            icon="bi-broadcast"
                                            label="Sync to fleet"
                                            armedLabel="Click again — pushes this set to every fleet instance now"
                                            onConfirm={() => run('Sync broadcast to the fleet', () => sync.mutateAsync({ id }))}
                                        />
                                        <ArmedButton
                                            className="btn-compact"
                                            icon="bi-arrow-clockwise"
                                            label="Refresh source"
                                            armedLabel="Click again — refetches the provider list and replaces the stored CIDRs"
                                            onConfirm={() => run('Source refresh requested', () => refresh.mutateAsync({ id }))}
                                        />
                                        <button className="btn btn-compact" onClick={() => void onEdit()}>
                                            <i className="bi bi-pencil" /> Edit
                                        </button>
                                        {canDelete && (
                                            <ArmedButton
                                                className="btn-compact btn-danger"
                                                icon="bi-trash"
                                                label="Delete"
                                                armedLabel="Click again — deletes the set and removes it from every fleet instance. This cannot be undone."
                                                onConfirm={() => run('IP set deleted', async () => {
                                                    await remove.mutateAsync({ id });
                                                    onClose();
                                                })}
                                            />
                                        )}
                                    </div>
                                ) : null}
                            />

                            {cacheOnly && (
                                <div className="netsec-note netsec-note-warn">
                                    <i className="bi bi-database-lock" />
                                    <div>
                                        <b>{row.name}</b> is a {IPSET_CACHE_ONLY_HELP}. The backend refuses to
                                        enable it, and a sync request is a silent no-op. It is refreshed by the
                                        threat-list cron and read by GeoIP detection, not by iptables.
                                    </div>
                                </div>
                            )}

                            <Eyebrow>Identity</Eyebrow>
                            <FlatRow label="Name"><code>{row.name}</code></FlatRow>
                            <FlatRow label="Kind">{ipSetKindLabel(row.kind)}</FlatRow>
                            <FlatRow label="Description">{row.description || DASH}</FlatRow>
                            <FlatRow label="Enabled">
                                <Badge tone={row.is_enabled ? 'success' : 'muted'}>{row.is_enabled ? 'Yes' : 'No'}</Badge>
                            </FlatRow>

                            <Eyebrow>Source</Eyebrow>
                            <FlatRow label="Source">{ipSetSourceLabel(row.source)}</FlatRow>
                            <FlatRow label="Source URL">
                                {row.source_url ? <code className="netsec-break">{row.source_url}</code> : DASH}
                            </FlatRow>
                            <FlatRow label="API key">
                                <span className="dim-italic">Write-only — excluded from every serializer graph.</span>
                            </FlatRow>
                            <FlatRow label="CIDRs">
                                {row.cidr_count.toLocaleString()}
                                <span className="dim"> · recorded when the list was last written</span>
                            </FlatRow>
                            <FlatRow label="Last synced">
                                {row.last_synced == null ? <b>Never</b> : <>{fmt.datetime(row.last_synced)} <span className="dim">· {fmt.relative(row.last_synced)}</span></>}
                            </FlatRow>
                            <FlatRow label="Sync status">
                                {row.sync_error
                                    ? <span className="text-bad">{row.sync_error}</span>
                                    : <span className="text-ok"><i className="bi bi-check-circle" /> OK</span>}
                            </FlatRow>

                            <Eyebrow>Record</Eyebrow>
                            <FlatRow label="Created">{fmt.datetime(row.created)}</FlatRow>
                            <FlatRow label="Modified">{fmt.datetime(row.modified)}</FlatRow>
                        </>
                    ),
                },
                {
                    key: 'cidrs', label: 'CIDR Data', icon: 'bi-list-ol',
                    render: () => <CidrDataSection row={row} />,
                },
            ]}
            initialSection="config"
            onClose={onClose}
        />
    );
}

export function showIPSetDetail(id: number): void {
    void modal.detail((close) => <IPSetDetail id={id} onClose={() => close(null)} />);
}
