import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TagInput, modal, toast } from '../../ui';
import {
    clearMetricsPermissions,
    listMetricsPermissions,
    metricsPermissionKeys,
    normalizeMetricPermissions,
    saveMetricsPermissions,
    type MetricsPermissionRow,
} from './models';

function samePermissions(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function PermissionRow({ row }: { row: MetricsPermissionRow }) {
    const queryClient = useQueryClient();
    const [view, setView] = useState(row.view_permissions);
    const [write, setWrite] = useState(row.write_permissions);

    useEffect(() => {
        setView(row.view_permissions);
        setWrite(row.write_permissions);
    }, [row.view_permissions, row.write_permissions]);

    const refresh = () => queryClient.refetchQueries({ queryKey: metricsPermissionKeys.all });
    const save = useMutation({
        mutationFn: saveMetricsPermissions,
        onSuccess: async () => {
            await refresh();
            toast.success(`Permissions for ${row.account} saved`);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : 'Save failed'),
    });
    const clear = useMutation({
        mutationFn: clearMetricsPermissions,
        onSuccess: async () => {
            // DELETE clears the two permission keys, not the account registry.
            // Refetch the authoritative row rather than removing it locally.
            await refresh();
            toast.success(`Permissions for ${row.account} cleared`);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : 'Clear failed'),
    });

    const normalizedView = normalizeMetricPermissions(view);
    const normalizedWrite = normalizeMetricPermissions(write);
    const dirty = !samePermissions(normalizedView, row.view_permissions)
        || !samePermissions(normalizedWrite, row.write_permissions);
    const busy = save.isPending || clear.isPending;

    const confirmClear = async () => {
        const confirmed = await modal.confirm({
            title: 'Clear permissions',
            message: <>Clear all metric view and write permissions for <code>{row.account}</code>? The account remains listed.</>,
            confirmText: 'Clear permissions',
            danger: true,
        });
        if (confirmed) clear.mutate(row.account);
    };

    return (
        <tr>
            <th scope="row"><code>{row.account}</code></th>
            <td>
                <TagInput
                    value={view}
                    onChange={(_, tags) => setView(tags)}
                    placeholder="Add view permission…"
                    disabled={busy}
                />
            </td>
            <td>
                <TagInput
                    value={write}
                    onChange={(_, tags) => setWrite(tags)}
                    placeholder="Add write permission…"
                    disabled={busy}
                />
            </td>
            <td>
                <div className="monitoring-row-actions">
                    <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        disabled={!dirty || busy}
                        onClick={() => save.mutate({
                            account: row.account,
                            view_permissions: normalizedView,
                            write_permissions: normalizedWrite,
                        })}
                    >
                        {save.isPending ? 'Saving…' : 'Save'}
                    </button>
                    <button
                        type="button"
                        className="btn btn-danger btn-compact"
                        disabled={busy || (row.view_permissions.length === 0 && row.write_permissions.length === 0)}
                        onClick={() => void confirmClear()}
                    >
                        {clear.isPending ? 'Clearing…' : 'Clear permissions'}
                    </button>
                </div>
            </td>
        </tr>
    );
}

export function MetricsPermissionsPage() {
    const query = useQuery({
        queryKey: metricsPermissionKeys.all,
        queryFn: listMetricsPermissions,
    });

    return (
        <div className="monitoring-page">
            <header className="monitoring-page-head">
                <div>
                    <div className="eyebrow">System</div>
                    <h1>Metrics permissions</h1>
                    <p>Per-account slug-family gates for reading and writing metrics.</p>
                </div>
                <button
                    type="button"
                    className="btn btn-compact"
                    disabled={query.isFetching}
                    onClick={() => void query.refetch()}
                >
                    <i className={`bi bi-arrow-clockwise${query.isFetching ? ' spin' : ''}`} /> Refresh
                </button>
            </header>

            <div className="panel monitoring-table-panel">
                {query.isPending && <div className="monitoring-state">Loading metrics permissions…</div>}
                {query.isError && (
                    <div className="monitoring-state monitoring-state-error">
                        <p>{query.error instanceof Error ? query.error.message : 'Failed to load metrics permissions.'}</p>
                        <button type="button" className="btn" onClick={() => void query.refetch()}>Retry</button>
                    </div>
                )}
                {!query.isPending && !query.isError && query.data.length === 0 && (
                    <div className="monitoring-state">No metrics permission accounts found.</div>
                )}
                {!query.isPending && !query.isError && query.data.length > 0 && (
                    <div className="monitoring-table-scroll">
                        <table className="monitoring-table">
                            <caption className="sr-only">Metrics permissions by immutable account</caption>
                            <thead>
                                <tr>
                                    <th scope="col">Account</th>
                                    <th scope="col">View permissions</th>
                                    <th scope="col">Write permissions</th>
                                    <th scope="col">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {query.data.map((row) => <PermissionRow key={row.account} row={row} />)}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
