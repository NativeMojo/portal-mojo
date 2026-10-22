import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAuthSessionRevision, getAuthSnapshot, MojoError, useAuthSnapshot, useCan } from '../../client/runtime';
import { Badge, CollectionSelect, FlatRow, ModelTable, Popover, Tabs, fmt, modal, toast, type Column } from '../../ui';
import { DomainModel } from '../dns/models';
import { deleteVhostRoute, deleteVhost, listVhostRoutes, saveVhostRoute, saveVhost } from './api';
import { EDGE_MANAGE_PERMS, EdgeRouteModel, EdgeUpstreamModel, EdgeVhostModel, quietPathUncovered, validateRoutePrefix, vhostKindTitle, type EdgeRouteRow, type EdgeUpstreamRow, type EdgeVhostRow } from './models';
import { EdgeHelp } from './EdgeHelp';
import { openVhostWizard } from './VhostWizard';

const reason = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';
const refused = (error: unknown) => error instanceof MojoError && (error.status === 200 || error.status >= 400 && error.status < 500);
const identity = () => `${getAuthSnapshot().uid}:${getAuthSessionRevision()}`;
type Operation = { label: string; observe: () => Promise<boolean> };
type Run = (write: () => Promise<void>, operation: Operation) => Promise<boolean>;

function confirmRemoval({ title, message, confirmText, signal }: { title: string; message: string; confirmText: string; danger: boolean; signal?: AbortSignal }) {
    return modal.open<boolean>(close => <div className="modal-pad"><h2 className="modal-title">{title}</h2><p className="modal-message">{message}</p><div className="modal-actions"><button type="button" className="btn" onClick={() => close(false)}>Cancel</button><button type="button" className="btn btn-danger" onClick={() => close(true)}>{confirmText}</button></div></div>, { size: 'sm', signal });
}


function RouteEditor({ route, vhost, run, onDone, signal, beforeWrite }: { route: EdgeRouteRow | null; vhost: EdgeVhostRow; run: Run; onDone: () => void; signal: AbortSignal; beforeWrite: () => void }) {
    const queryClient = useQueryClient();
    const [prefix, setPrefix] = useState(route?.path_prefix ?? '');
    const [upstream, setUpstream] = useState<{ id: number; name: string } | null>(route?.upstream ? { id: route.upstream.id, name: route.upstream.name } : null);
    const [owner, setOwner] = useState<{ group: number | null } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [unknown, setUnknown] = useState(false);
    const pending = useRef(false);
    useEffect(() => {
        let live = true;
        if (vhost.domain) DomainModel.fetchOne(queryClient, vhost.domain.id).then(domain => { if (live) setOwner({ group: typeof domain.group === 'number' ? domain.group : domain.group?.id ?? null }); }).catch(cause => { if (live) setError(`Upstream choices unavailable: ${reason(cause)}`); });
        return () => { live = false; };
    }, [queryClient, vhost.domain?.id]);
    const submit = async () => {
        if (pending.current || unknown || signal.aborted) return;
        const validation = validateRoutePrefix(prefix) ?? (upstream ? null : 'Choose an upstream.');
        if (validation) { setError(validation); return; }
        pending.current = true; setBusy(true); setError('');
        try {
            const target = { path_prefix: prefix, upstream: upstream!.id };
            const routeGuard = () => { beforeWrite(); if (signal.aborted) throw new MojoError('Session or permission changed. Reopen the hostname.', 403); };
            const ok = await run(async () => {
                let current: EdgeRouteRow[], currentVhost: EdgeVhostRow;
                try { current = await listVhostRoutes(vhost.id); await EdgeVhostModel.invalidate(queryClient); currentVhost = await EdgeVhostModel.fetchOne(queryClient, vhost.id); }
                catch (cause) { throw new MojoError(`Could not inspect current routes: ${reason(cause)}`, 400); }
                routeGuard();
                const prefixes = current.filter(item => item.id !== route?.id).map(item => item.path_prefix).concat(prefix);
                const orphan = quietPathUncovered(currentVhost.quiet_paths ?? [], prefixes);
                if (orphan) throw new MojoError(`This change would leave quiet path ${orphan} without a route. Update Quiet paths in the hostname’s Settings first.`, 400);
                const saved = await saveVhostRoute(route?.id ?? null, { ...(route ? {} : { vhost: vhost.id }), ...target }, routeGuard);
                if (!Number.isSafeInteger(saved.id) || saved.id <= 0 || route && saved.id !== route.id || saved.path_prefix !== target.path_prefix || saved.upstream?.id !== target.upstream) throw new TypeError('The route response did not confirm the submitted configuration.');
            }, { label: `Route ${prefix}`, observe: async () => (await listVhostRoutes(vhost.id)).some(item => (!route || item.id === route.id) && item.path_prefix === target.path_prefix && item.upstream?.id === target.upstream) });
            if (ok) onDone(); else setUnknown(true);
        } catch (cause) { setError(reason(cause)); }
        finally { pending.current = false; setBusy(false); }
    };
    // run() owns the parent pending state and the native editor's guard.
    return <div className="modal-pad edge-route-dialog"><h2 className="modal-title">{route ? 'Edit route' : 'Add route'}</h2>{error && <div className="form-alert" role="alert">{error}</div>}{unknown && <p className="text-warn" role="status">Outcome unconfirmed. Close this editor and use Observe outcome in the hostname dialog. This route will not be resubmitted here.</p>}<div className="edge-form-grid"><label className="field"><span className="field-label">Path prefix <em>*</em><EdgeHelp label="About route prefixes">Requests under this prefix go to the chosen upstream. Everything else stays on the site.</EdgeHelp></span><input className="input" aria-label="Path prefix" value={prefix} disabled={busy || unknown} onChange={event => setPrefix(event.target.value.trim())} placeholder="/api" /></label><CollectionSelect<EdgeUpstreamRow> model={EdgeUpstreamModel} value={upstream} onChange={(id, picked) => setUpstream(id == null ? null : { id: Number(id), name: picked?.name ?? '' })} label="Upstream" required disabled={busy || unknown || !owner} defaultParams={{ is_enabled: true, sort: 'name', ...(owner?.group != null ? { group: owner.group } : { group__isnull: true }) }} /></div><div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={onDone}>{unknown ? 'Close' : 'Cancel'}</button><button type="button" className="btn btn-primary" disabled={busy || unknown || !owner} onClick={() => void submit()}>{busy ? 'Saving…' : route ? 'Save route' : 'Add route'}</button></div></div>;
}

export function VhostDetail({ id, onClose, onChanged, onBusyChange }: { id: number; onClose: () => void; onChanged?: () => void; onBusyChange?: (busy: boolean) => void }) {
    const queryClient = useQueryClient();
    const query = EdgeVhostModel.useOne(id);
    const canManage = useCan(EDGE_MANAGE_PERMS).can;
    const auth = useAuthSnapshot();
    const scope = `${auth.uid}:${getAuthSessionRevision()}`;
    const openedScope = useRef(scope);
    const openedManage = useRef(canManage);
    const authority = useRef(canManage); authority.current = canManage;
    const owner = useRef<AbortController | null>(null);
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const [error, setError] = useState('');
    const [active, setActive] = useState('overview');
    const [unknown, setUnknown] = useState<Operation | null>(null);
    const [menu, setMenu] = useState(false);
    const menuAnchor = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        const controller = new AbortController(); owner.current = controller;
        if (scope !== openedScope.current) onClose();
        return () => { controller.abort(); onBusyChange?.(false); };
    }, [scope]);
    useEffect(() => { if (openedManage.current && !canManage) { owner.current?.abort(); onClose(); } }, [canManage]);
    const current = () => !owner.current?.signal.aborted && identity() === openedScope.current;
    const lock = (value: boolean) => { pending.current = value; setBusy(value); onBusyChange?.(value); };
    const guard = () => { if (!authority.current || !current()) throw new MojoError('Session or permission changed. Reopen Serving.', 403); };
    const refresh = async () => { await Promise.allSettled([EdgeVhostModel.invalidate(queryClient), EdgeRouteModel.invalidate(queryClient)]); if (current()) onChanged?.(); };
    const run: Run = async (write, operation) => {
        if (pending.current || unknown || !authority.current || !current()) return false;
        lock(true); setError('');
        try { await write(); if (current()) toast.success(`${operation.label} saved.`); return true; }
        catch (cause) {
            if (!current()) return false;
            if (refused(cause)) { setError(reason(cause)); throw cause; }
            setUnknown(operation); setError(`${operation.label}: outcome unconfirmed. Observe before making another change.`); return false;
        } finally { await refresh(); if (current()) lock(false); }
    };
    const observe = async () => {
        if (!unknown || pending.current || !current()) return;
        lock(true);
        try {
            const confirmed = await unknown.observe();
            if (!current()) return;
            if (confirmed) { setUnknown(null); setError(''); toast.success(`${unknown.label}: submitted result observed.`); }
            else setError('The submitted result was not observed. The outcome remains unconfirmed; no write was replayed.');
        } catch (cause) { if (current()) setError(`Observation unavailable: ${reason(cause)}. No write was replayed.`); }
        finally { await refresh(); if (current()) lock(false); }
    };
    const vhost = query.data;
    if (query.isPending) return <div className="modal-pad"><p className="dim">Loading hostname…</p><button type="button" className="btn" onClick={onClose}>Close</button></div>;
    if (!vhost || query.error) return <div className="modal-pad"><div className="form-alert" role="alert">{query.error?.message ?? 'Hostname unavailable.'}</div><div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Close</button><button type="button" className="btn" onClick={() => void query.refetch()}>Retry</button></div></div>;
    const edit = async (initialTab = 'address') => {
        if (pending.current || unknown || !canManage || !current()) return;
        setMenu(false); lock(true);
        try { const saved = await openVhostWizard(vhost, { initialTab, signal: owner.current?.signal }); if (saved && current()) { queryClient.setQueryData(EdgeVhostModel.keys.one(id), saved); onChanged?.(); } }
        finally { if (current()) lock(false); }
    };
    const setEnabled = async (next: boolean) => {
        try { await run(async () => { const saved = await saveVhost(id, { is_enabled: next }, guard); if (saved.id !== id || saved.is_enabled !== next) throw new TypeError('Enablement was not confirmed.'); }, { label: `${vhost.server_name} configuration`, observe: async () => { await EdgeVhostModel.invalidate(queryClient); return (await EdgeVhostModel.fetchOne(queryClient, id)).is_enabled === next; } }); } catch { /* run exposes the authoritative refusal. */ }
    };
    const remove = async () => {
        if (pending.current || unknown || !canManage || !current()) return;
        setMenu(false); lock(true);
        const ok = await confirmRemoval({ title: `Delete ${vhost.server_name}?`, message: 'This stops serving the hostname and deletes its routes. Linked sites can stop serving. The domain and certificate remain. Disable it instead to keep the configuration.', confirmText: 'Delete hostname', danger: true, signal: owner.current?.signal });
        lock(false);
        if (!ok || !current()) return;
        try { if (await run(() => deleteVhost(id, guard), { label: 'Hostname deletion', observe: async () => { try { await EdgeVhostModel.invalidate(queryClient); await EdgeVhostModel.fetchOne(queryClient, id); return false; } catch (cause) { if (cause instanceof MojoError && cause.status === 404) { onClose(); return true; } throw cause; } } })) onClose(); } catch { /* shown above */ }
    };
    const openRoute = async (route: EdgeRouteRow | null) => {
        if (pending.current || unknown || !canManage || !current()) return;
        let childBusy = false;
        await modal.open(close => <RouteEditor route={route} vhost={vhost} beforeWrite={guard} run={async (write, operation) => { childBusy = true; try { return await run(write, operation); } finally { childBusy = false; } }} signal={owner.current!.signal} onDone={() => { if (!childBusy) close(null); }} />, { size: 'md', canDismiss: () => !childBusy, signal: owner.current?.signal });
    };
    const removeRoute = async (route: EdgeRouteRow) => {
        if (pending.current || unknown || !current()) return;
        lock(true); setError('');
        try {
            const routes = await listVhostRoutes(id);
            await EdgeVhostModel.invalidate(queryClient);
            const observed = await EdgeVhostModel.fetchOne(queryClient, id);
            guard();
            const orphan = quietPathUncovered(observed.quiet_paths ?? [], routes.filter(item => item.id !== route.id).map(item => item.path_prefix));
            if (orphan) { setError(`Removing ${route.path_prefix} would leave quiet path ${orphan} without a route. Edit Quiet paths in Settings first.`); return; }
            const ok = await confirmRemoval({ title: `Remove ${route.path_prefix}?`, message: 'Requests under this prefix will stop being proxied. The site handles them instead.', confirmText: 'Remove route', danger: true, signal: owner.current?.signal });
            lock(false);
            if (!ok || !current()) return;
            await run(() => deleteVhostRoute(route.id, guard), { label: `Removal of ${route.path_prefix}`, observe: async () => !(await listVhostRoutes(id)).some(item => item.id === route.id) });
        } catch (cause) { if (current()) setError(reason(cause)); }
        finally { if (current()) lock(false); }
    };
    const proxies = vhost.kind === 'api' || vhost.kind === 'site_api';
    const frozen = busy || unknown != null;
    return <div className="modal-pad edge-hostname-detail"><header className="edge-detail-header"><div className="edge-detail-identity"><h2 className="modal-title">{vhost.server_name ?? `Hostname #${id}`}</h2><div className="edge-detail-subtitle"><span>{vhostKindTitle(vhost.kind)}</span><Badge tone={vhost.is_enabled ? 'info' : 'muted'}>{vhost.is_enabled ? 'Enabled' : 'Disabled'}</Badge><EdgeHelp label="About hostname status">Enabled is saved configuration intent. Fleet application and live serving are not verified by this record.</EdgeHelp></div></div><div className="edge-detail-actions">{canManage && <><label className="edge-enabled-switch"><input aria-label="Hostname enabled" type="checkbox" checked={vhost.is_enabled} disabled={frozen} onChange={event => void setEnabled(event.target.checked)} /><span>Enabled</span></label><button type="button" className="btn btn-compact" disabled={frozen} onClick={() => void edit()}>Edit</button><button type="button" ref={menuAnchor} className="btn-icon" aria-label="Hostname actions" aria-expanded={menu} disabled={frozen} onClick={() => setMenu(value => !value)}><i className="bi bi-three-dots-vertical" /></button><Popover anchorRef={menuAnchor} open={menu} onClose={() => setMenu(false)} className="edge-action-menu"><button type="button" className="btn text-bad" onClick={() => void remove()}><i className="bi bi-trash" /> Delete hostname</button></Popover></>}<button type="button" className="btn-icon" aria-label="Close hostname" disabled={busy} onClick={onClose}><i className="bi bi-x-lg" /></button></div></header>
        {error && <div className="form-alert" role="alert">{error}{unknown && <button type="button" className="btn btn-compact" disabled={busy} onClick={() => void observe()}>{busy ? 'Observing…' : 'Observe outcome'}</button>}</div>}
        <Tabs ariaLabel="Hostname details" activeKey={active} onActiveKeyChange={setActive} items={[
            { key: 'overview', label: 'Overview', panel: <div className="edge-detail-panel">{vhost.kind === 'api' && <FlatRow label="Upstream">{vhost.upstream?.name ?? 'Missing upstream'}</FlatRow>}{vhost.kind === 'redirect' && <FlatRow label="Redirects to"><code>{vhost.redirect_to ?? 'Missing destination'}</code></FlatRow>}{(vhost.kind === 'site' || vhost.kind === 'site_api') && <FlatRow label="Single-page app">{vhost.spa ? 'Yes' : 'No'}</FlatRow>}<FlatRow label="Domain">{vhost.domain?.name ?? 'Unknown'}</FlatRow>{vhost.kind === 'site_api' && <button type="button" className="btn" onClick={() => setActive('routes')}>View API routes</button>}</div> },
            ...(vhost.kind === 'site_api' ? [{ key: 'routes', label: 'Routes', panel: <RoutesContent id={id} canManage={canManage} disabled={frozen} onEdit={route => void openRoute(route)} onRemove={route => void removeRoute(route)} /> }] : []),
            { key: 'certificate', label: 'Certificate', panel: <div className="edge-detail-panel"><FlatRow label="Certificate">{vhost.certificate?.common_name ?? 'Not configured'}</FlatRow><FlatRow label="Status">{vhost.certificate?.status ?? 'Unknown'}</FlatRow><FlatRow label="Expires">{vhost.certificate?.not_after ? fmt.datetime(vhost.certificate.not_after) : 'Unknown'}</FlatRow><p className="dim">Certificate installation and live serving are unverified.</p>{canManage && <div><button type="button" className="btn" disabled={frozen} onClick={() => void edit('certificate')}>Change certificate</button></div>}</div> },
            { key: 'settings', label: 'Settings', panel: <div className="edge-detail-panel"><FlatRow label="Pool">{vhost.pool}</FlatRow>{vhost.kind !== 'redirect' && <FlatRow label="Maximum body">{vhost.body_size_mb} MB</FlatRow>}{proxies && <><FlatRow label="Static files">{vhost.serve_static ? 'Served at /static/' : 'Not served here'}</FlatRow><FlatRow label="Quiet paths">{vhost.quiet_paths?.length ? vhost.quiet_paths.join(', ') : 'None'}</FlatRow></>}<FlatRow label="Created">{fmt.datetime(vhost.created)}</FlatRow><FlatRow label="Changed">{fmt.datetime(vhost.modified)}</FlatRow>{vhost.mojosec_policy && Object.keys(vhost.mojosec_policy).length > 0 && <FlatRow label="Evidence policy">Platform-managed <EdgeHelp label="About the evidence policy">Version {String(vhost.mojosec_policy.version)} · {String(vhost.mojosec_policy.response_class)}. Not editable here.</EdgeHelp></FlatRow>}{canManage && <div><button type="button" className="btn" disabled={frozen} onClick={() => void edit('settings')}>Edit settings</button></div>}</div> },
        ]} />
    </div>;
}

function RoutesContent({ id, canManage, disabled, onEdit, onRemove }: { id: number; canManage: boolean; disabled: boolean; onEdit: (route: EdgeRouteRow | null) => void; onRemove: (route: EdgeRouteRow) => void }) {
    const columns: Column<EdgeRouteRow>[] = [
        { key: 'path_prefix', label: 'Path prefix', sortable: true, hideable: false, render: row => <code>{row.path_prefix}</code> },
        { key: 'upstream', label: 'Upstream', sortable: false, render: row => row.upstream?.name ?? 'Missing upstream' },
        ...(canManage ? [{ key: 'actions', label: '', sortable: false, render: (row: EdgeRouteRow) => <span className="edge-route-actions"><button type="button" className="btn btn-compact" disabled={disabled} onClick={() => onEdit(row)}>Edit</button><button type="button" className="btn btn-compact" disabled={disabled} onClick={() => onRemove(row)}>Remove</button></span> }] : []),
    ];
    return <div className="edge-detail-panel edge-routes"><div className="edge-serving-heading"><span>Requests under each prefix go to its upstream.</span>{canManage && <button type="button" className="btn btn-primary btn-compact" disabled={disabled} onClick={() => onEdit(null)}><i className="bi bi-plus-lg" /> Add route</button>}</div><ModelTable<EdgeRouteRow> model={EdgeRouteModel} paramsMode="local" fixedParams={{ vhost: id }} title="API routes" searchable={false} columns={columns} defaultSort="path_prefix" /></div>;
}
