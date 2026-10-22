import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCan } from '../../client/runtime';
import { ArmedButton, CollectionSelect, DetailView, Eyebrow, FlatRow, fmt, modal, toast } from '../../ui';
import { deleteVhostRoute, deleteVhost, saveVhostRoute, saveVhost } from './api';
import {
    EDGE_MANAGE_PERMS, EdgeRouteModel, EdgeUpstreamModel, EdgeVhostModel, validateRoutePrefix, vhostKindTitle,
    type EdgeRouteRow, type EdgeUpstreamRow, type EdgeVhostRow,
} from './models';
import { openVhostWizard } from './VhostWizard';

function message(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

/** Route CRUD lives here: the wizard creates routes, the detail owns them after. */
function VhostRoutes({ vhost, canManage, onChanged, onBusyChange }: { vhost: EdgeVhostRow; canManage: boolean; onChanged?: () => void; onBusyChange?: (busy: boolean) => void }) {
    const queryClient = useQueryClient();
    const query = EdgeRouteModel.useList({ vhost: vhost.id, sort: 'path_prefix', size: 200 });
    const [editing, setEditing] = useState<number | 'new' | null>(null);
    const [prefix, setPrefix] = useState('');
    const [upstream, setUpstream] = useState<{ id: number; name: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
    const [error, setError] = useState('');
    const rows = query.data?.rows ?? [];

    const begin = (route: EdgeRouteRow | null) => {
        setEditing(route ? route.id : 'new');
        setPrefix(route?.path_prefix ?? '');
        setUpstream(route?.upstream ? { id: route.upstream.id, name: route.upstream.name } : null);
        setError('');
    };
    const refresh = () => Promise.allSettled([EdgeRouteModel.invalidate(queryClient), EdgeVhostModel.invalidate(queryClient)]);
    const submit = async () => {
        if (pending.current) return;
        const refusal = validateRoutePrefix(prefix) ?? (upstream ? null : 'Choose an upstream.');
        if (refusal) { setError(refusal); return; }
        pending.current = true; setBusy(true); setError('');
        try {
            await saveVhostRoute(editing === 'new' ? null : editing, { ...(editing === 'new' ? { vhost: vhost.id } : {}), path_prefix: prefix, upstream: upstream!.id });
            setEditing(null);
            onChanged?.();
        } catch (cause) {
            setError(message(cause, 'The route was not saved'));
        } finally {
            await refresh();
            pending.current = false; setBusy(false);
        }
    };
    const remove = async (route: EdgeRouteRow) => {
        if (pending.current) return;
        pending.current = true; setBusy(true);
        try {
            await deleteVhostRoute(route.id);
            onChanged?.();
            toast.success(`Route ${route.path_prefix} deleted.`);
        } catch (cause) {
            toast.error(message(cause, 'The route was not deleted'));
        } finally {
            await refresh();
            pending.current = false; setBusy(false);
        }
    };

    return <div className="edge-routes">
        <Eyebrow>Proxied paths</Eyebrow>
        <p className="dim">Requests under each prefix go to its upstream. Everything else is served from the site.</p>
        {query.isPending && <div className="dim">Loading routes…</div>}
        {query.error && <div className="text-bad">{query.error.message}</div>}
        {!query.isPending && !query.error && rows.length === 0 && <div className="edge-warning"><i className="bi bi-exclamation-triangle" /> No routes. This address proxies nothing until one is added.</div>}
        {rows.map((route) => <div className="edge-route-item" key={route.id}>
            <code>{route.path_prefix}</code>
            <span><i className="bi bi-arrow-right" /> {route.upstream?.name ?? '—'}</span>
            {canManage && <span className="edge-route-actions">
                <button type="button" className="btn btn-compact" disabled={busy} onClick={() => begin(route)}>Edit</button>
                <ArmedButton className="btn-compact" label="Delete" armedLabel={`Click again to stop proxying ${route.path_prefix}`} disabled={busy} onConfirm={() => remove(route)} />
            </span>}
        </div>)}
        {canManage && editing == null && <div><button type="button" className="btn" onClick={() => begin(null)}><i className="bi bi-plus-lg" /> Add route</button></div>}
        {canManage && editing != null && <div className="edge-route-editor">
            {error && <div className="form-alert" role="alert">{error}</div>}
            <label className="field"><span className="field-label">Path prefix <em>*</em></span><input className="input" value={prefix} disabled={busy} onChange={(event) => setPrefix(event.target.value.trim())} placeholder="/api" autoComplete="off" /></label>
            <CollectionSelect<EdgeUpstreamRow> model={EdgeUpstreamModel} value={upstream} onChange={(id, picked) => setUpstream(id == null ? null : { id: Number(id), name: picked?.name ?? '' })} label="Upstream" required disabled={busy} placeholder="Search enabled upstreams…" defaultParams={{ is_enabled: true, sort: 'name' }} />
            <div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : editing === 'new' ? 'Add route' : 'Save route'}</button></div>
        </div>}
    </div>;
}

export function VhostDetail({ id, onClose, onChanged, onBusyChange }: { id: number; onClose: () => void; onChanged?: () => void; onBusyChange?: (busy: boolean) => void }) {
    const queryClient = useQueryClient();
    const query = EdgeVhostModel.useOne(id);
    const canManage = useCan(EDGE_MANAGE_PERMS).can;
    const [busy, setBusy] = useState(false);
    const [routeBusy, setRouteBusy] = useState(false);
    const pending = useRef(false);
    useEffect(() => { onBusyChange?.(busy || routeBusy); }, [busy, routeBusy, onBusyChange]);
    const [error, setError] = useState('');
    const vhost = query.data;
    if (query.isPending) return <div className="modal-pad dim">Loading hostname…</div>;
    if (!vhost || query.error) return <div className="modal-pad text-bad">{query.error?.message ?? 'Hostname not found'}</div>;

    const setEnabled = async (next: boolean) => {
        if (pending.current || routeBusy) return;
        pending.current = true;
        setBusy(true); setError('');
        try {
            const saved = await saveVhost(vhost.id, { is_enabled: next });
            onChanged?.();
            queryClient.setQueryData(EdgeVhostModel.keys.one(vhost.id), saved);
            toast.success(`${saved.server_name ?? 'Hostname'} configuration saved: ${next ? 'enabled intent; readiness separate' : 'disabled'}.`);
        } catch (cause) {
            // The server's own words: coverage, a duplicate name, an orphaned quiet path.
            setError(message(cause, 'The change was refused'));
        } finally {
            await EdgeVhostModel.invalidate(queryClient);
            pending.current = false; setBusy(false);
        }
    };
    const edit = async () => {
        const saved = await openVhostWizard(vhost);
        if (saved) { onChanged?.(); queryClient.setQueryData(EdgeVhostModel.keys.one(vhost.id), saved); toast.success(`${saved.server_name ?? 'Hostname'} configuration saved.`); }
    };
    const remove = async () => {
        const name = vhost.server_name ?? 'this address';
        const ok = await modal.confirm({
            title: `Delete ${name}?`,
            message: `${name} stops being served and its routes are deleted with it. This cannot be undone. To take it out of service and keep it, disable it instead.`,
            confirmText: 'Delete hostname', danger: true,
        });
        if (!ok) return;
        try {
            await deleteVhost(vhost.id);
            await Promise.allSettled([EdgeVhostModel.invalidate(queryClient), EdgeRouteModel.invalidate(queryClient)]);
            toast.success(`${vhost.server_name ?? 'Hostname'} deleted.`);
            onChanged?.();
            onClose();
        } catch (cause) {
            setError(message(cause, 'The hostname was not deleted'));
        }
    };
    const proxies = vhost.kind === 'api' || vhost.kind === 'site_api';
    const policy = vhost.mojosec_policy && Object.keys(vhost.mojosec_policy).length ? vhost.mojosec_policy : null;

    return <DetailView
        icon="bi-hdd-network" title={vhost.server_name ?? `Hostname #${vhost.id}`} subtitle={`${vhostKindTitle(vhost.kind)} · ${vhost.domain?.name ?? ''}`}
        chips={[{ text: vhost.is_enabled ? 'Enabled · readiness separate' : 'Disabled', tone: vhost.is_enabled ? 'info' : 'muted' }]}
        {...(canManage ? { active: { value: vhost.is_enabled, onChange: (next: boolean) => void setEnabled(next), disabled: busy || routeBusy } } : {})}
        contextMenu={[
            { label: 'Edit hostname', icon: 'bi-pencil', permissions: EDGE_MANAGE_PERMS, disabled: busy || routeBusy, onSelect: () => void edit() },
            { divider: true },
            { label: 'Delete hostname', icon: 'bi-trash', permissions: EDGE_MANAGE_PERMS, danger: true, disabled: busy || routeBusy, onSelect: () => void remove() },
        ]}
        sections={[
            { key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => <div className="edge-vhost-overview">
                {error && <div className="form-alert" role="alert">{error}</div>}
                <Eyebrow>Hostname</Eyebrow>
                <FlatRow label="Server name"><code>{vhost.server_name ?? '—'}</code></FlatRow>
                <FlatRow label="Domain">{vhost.domain?.name ?? '—'}</FlatRow>
                <FlatRow label="Label">{vhost.label === '' ? 'Apex (bare domain)' : vhost.label === '*' ? 'Wildcard (*)' : <code>{vhost.label}</code>}</FlatRow>
                <FlatRow label="Serves">{vhostKindTitle(vhost.kind)}</FlatRow>
                <FlatRow label="Certificate">{vhost.certificate ? <>{vhost.certificate.common_name} · {vhost.certificate.status}{vhost.certificate.not_after ? ` · expires ${fmt.date(vhost.certificate.not_after)}` : ''}</> : '—'}</FlatRow>
                <p className="dim">Enabled is configuration intent. Saving does not prove the fleet has applied it.</p>
                <details className="edge-advanced"><summary>Advanced</summary>
                {vhost.kind === 'api' && <FlatRow label="Upstream">{vhost.upstream?.name ?? '—'}</FlatRow>}
                {vhost.kind === 'redirect' && <FlatRow label="Redirects to"><code>{vhost.redirect_to ?? '—'}</code></FlatRow>}
                {(vhost.kind === 'site' || vhost.kind === 'site_api') && <FlatRow label="Single-page app">{vhost.spa ? 'Yes: unknown paths return index.html' : 'No'}</FlatRow>}
                {proxies && <FlatRow label="Static files">{vhost.serve_static ? 'Served at /static/' : 'Not served here'}</FlatRow>}
                {proxies && <FlatRow label="Quiet paths">{vhost.quiet_paths?.length ? vhost.quiet_paths.map((path) => <code key={path} className="edge-inline-code">{path}</code>) : 'None'}</FlatRow>}
                {vhost.kind !== 'redirect' && <FlatRow label="Largest request body">{vhost.body_size_mb} MB</FlatRow>}
                {policy && <FlatRow label="Edge evidence policy"><span title="Set by the platform. Not editable here.">Version {String(policy.version)} · {String(policy.response_class)} · {Array.isArray(policy.impossible_path_families) && policy.impossible_path_families.length ? policy.impossible_path_families.join(', ') : 'no path families'}</span></FlatRow>}
                <FlatRow label="Pool">{vhost.pool}</FlatRow>
                </details>
                <FlatRow label="Created">{fmt.datetime(vhost.created)}</FlatRow>
                <FlatRow label="Changed">{fmt.datetime(vhost.modified)}</FlatRow>
            </div> },
            ...(vhost.kind === 'site_api' ? [{ key: 'routes', label: 'Routes', icon: 'bi-diagram-3', render: () => <VhostRoutes vhost={vhost} canManage={canManage} onChanged={onChanged} onBusyChange={setRouteBusy} /> }] : []),
        ]}
        initialSection="overview" onClose={onClose}
    />;
}
