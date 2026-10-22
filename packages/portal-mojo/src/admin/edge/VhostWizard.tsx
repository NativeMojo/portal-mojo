import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAuthSessionRevision, getAuthSnapshot, MojoError, useAuthSnapshot, useCan, useMe } from '../../client/runtime';
import { CollectionSelect, Tabs, modal } from '../../ui';
import { EdgeHelp } from './EdgeHelp';
import { CertificateModel, DomainModel, type CertificateRow, type DomainRow } from '../dns/models';
import { listVhostRoutes, saveVhostRoute, saveVhost } from './api';
import {
    EDGE_MANAGE_PERMS, EdgeRouteModel, EdgeUpstreamModel, EdgeVhostModel, VHOST_KIND_CARDS,
    buildVhostPayload, certificateCovers, deriveServerName, quietPathUncovered,
    validateBodySizeMb, validatePoolName, validateRedirectTarget, validateRequestPath,
    validateRouteDrafts, validateVhostLabel, vhostKindTitle,
    type EdgeUpstreamRow, type EdgeVhostRow, type RouteDraft, type VhostDraft, type VhostKind,
} from './models';

function reason(error: unknown): string {
    return (error instanceof Error ? error.message : 'save failed').replace(/[.\s]+$/, '');
}

interface RouteRowDraft extends RouteDraft { key: number; upstreamName?: string }

const submittedFieldNames: Record<string, string> = { label: 'Label', kind: 'Serving type', certificate: 'Certificate', pool: 'Pool', is_enabled: 'Enabled', upstream: 'Upstream', redirect_to: 'Redirect destination', spa: 'Single-page app', serve_static: 'Static files', quiet_paths: 'Quiet paths', body_size_mb: 'Maximum request body' };
function observedDifferences(submitted: Record<string, unknown>, row: EdgeVhostRow): string[] {
    const fields = row as unknown as Record<string, unknown>;
    const relation = (key: string, value: unknown) => ['domain', 'certificate', 'upstream'].includes(key) && value != null && typeof value === 'object' ? (value as { id?: unknown }).id : value;
    const display = (value: unknown) => value === undefined ? 'unknown' : JSON.stringify(value).slice(0, 120);
    return Object.entries(submitted).flatMap(([key, expected]) => {
        const observed = relation(key, fields[key]);
        return JSON.stringify(observed) === JSON.stringify(expected) ? [] : [`${submittedFieldNames[key] ?? key}: expected ${display(expected)}, observed ${display(observed)}`];
    });
}


/** One path per row; the server takes a list of exact request paths. */
function PathListEditor({ label, help, paths, onChange, disabled }: { label: string; help: string; paths: string[]; onChange: (paths: string[]) => void; disabled: boolean }) {
    return <div className="field edge-path-list">
        <span className="field-label">{label}</span>
        {paths.map((path, index) => <div className="edge-path-row" key={index}>
            <input className="input" value={path} disabled={disabled} placeholder="/health" aria-label={`${label} ${index + 1}`} onChange={(event) => onChange(paths.map((value, at) => at === index ? event.target.value : value))} />
            <button type="button" className="btn btn-compact" disabled={disabled} aria-label={`Remove ${path || 'path'}`} onClick={() => onChange(paths.filter((_value, at) => at !== index))}><i className="bi bi-x-lg" /></button>
        </div>)}
        <div><button type="button" className="btn btn-compact" disabled={disabled} onClick={() => onChange([...paths, ''])}><i className="bi bi-plus-lg" /> Add path</button></div>
        <span className="field-help">{help}</span>
    </div>;
}

export interface VhostWizardProps {
    initialTab?: string;
    signal?: AbortSignal;
    /** Omit to create; pass the `default` graph row to edit. */
    row?: EdgeVhostRow | null;
    onDone: (saved: EdgeVhostRow | null) => void;
    onBusyChange?: (busy: boolean) => void;
}

export function VhostWizard({ row = null, onDone, onBusyChange, initialTab = 'address', signal }: VhostWizardProps) {
    const queryClient = useQueryClient();
    const { data: me } = useMe();
    const superuser = me?.is_superuser === true;
    const canManage = useCan(EDGE_MANAGE_PERMS).can;
    const authority = useRef(canManage); authority.current = canManage;
    const auth = useAuthSnapshot();
    const scope = `${auth.uid}:${getAuthSessionRevision()}`;
    const openedScope = useRef(scope);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const current = () => mounted.current && !signal?.aborted && `${getAuthSnapshot().uid}:${getAuthSessionRevision()}` === openedScope.current;
    const guard = () => { if (!current() || !authority.current) throw new MojoError('Session or permission changed. Reopen Serving before changing this hostname.', 403); };

    const editing = row != null;

    const [kind, setKind] = useState<VhostKind | null>((row?.kind as VhostKind | undefined) ?? null);
    const [domain, setDomain] = useState<{ id: number; name: string } | null>(row?.domain ? { id: row.domain.id, name: row.domain.name } : null);
    const [label, setLabel] = useState(row?.label ?? '');
    const [upstream, setUpstream] = useState<number | null>(row?.upstream?.id ?? null);
    const [serveStatic, setServeStatic] = useState(row?.serve_static ?? false);
    const [quietPaths, setQuietPaths] = useState<string[]>(row?.quiet_paths ?? []);
    const [bodySize, setBodySize] = useState(String(row?.body_size_mb ?? 50));
    const [spa, setSpa] = useState(row?.spa ?? false);
    const [redirectTo, setRedirectTo] = useState(row?.redirect_to ?? '');
    const [routes, setRoutes] = useState<RouteRowDraft[]>([]);
    const [certificate, setCertificate] = useState<Pick<CertificateRow, 'id' | 'common_name' | 'sans'> | null>(null);
    const [certificateId, setCertificateId] = useState<number | null>(row?.certificate?.id ?? null);
    const [pool, setPool] = useState(row?.pool ?? 'default');
    const [enabled, setEnabled] = useState(row?.is_enabled ?? true);
    const [storedRoutes, setStoredRoutes] = useState<string[] | null>(editing ? null : []);
    const [routesUnread, setRoutesUnread] = useState(false);
    const nextRouteKey = useRef(1);
    // Explicit continuation retains acknowledged steps rather than duplicating them
    // here and skipped: never a second vhost, never a duplicate route.
    const progress = useRef<{ vhostId: number | null; routes: Map<string, number> }>({ vhostId: null, routes: new Map() });
    const [createdId, setCreatedId] = useState<number | null>(null);
    const [active, setActive] = useState(initialTab);
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const body = useRef<HTMLDivElement>(null);
    const [error, setError] = useState('');
    const [domainOwner, setDomainOwner] = useState<{ id: number; group: number | null } | null>(null);
    const [ownerError, setOwnerError] = useState('');
    const submitted = useRef<Record<string, unknown> | null>(null);
    const uncertain = useRef<{ step: 'create' | 'route' | 'finish' | 'edit'; prefix?: string } | null>(null);
    const [unconfirmed, setUnconfirmed] = useState('');
    const reveal = (message: string, tab = 'settings', selector = 'input:not(:disabled):not([readonly]):not([type=radio]):not([type=checkbox]),select:not(:disabled),textarea:not(:disabled)'): never => {
        setActive(tab);
        setTimeout(() => body.current?.querySelector<HTMLElement>(selector)?.focus(), 0);
        throw new Error(message);
    };
    // A server 4xx / explicit envelope rejection proves refusal. Network,
    // malformed responses and 5xx responses cannot prove the write did not land.
    const refused = (error: unknown) => error instanceof MojoError && (error.status === 200 || (error.status >= 400 && error.status < 500));
    const unknown = (step: 'create' | 'route' | 'finish' | 'edit', prefix?: string): never => {
        uncertain.current = { step, prefix };
        const text = step === 'create'
            ? 'Create outcome unconfirmed. The hostname may already exist. Close this wizard and inspect Serving before starting another create; this wizard will not replay it.'
            : `Hostname #${progress.current.vhostId ?? row?.id}: ${step === 'route' ? `route ${prefix}` : 'final save / enablement'} outcome unconfirmed. Observe the saved configuration before continuing. It may already have applied.`;
        setUnconfirmed(text);
        throw new Error(text);
    };
    const observe = async () => {
        const pending = uncertain.current;
        if (!pending || pending.step === 'create') return;
        const observedId = progress.current.vhostId ?? row?.id;
        if (observedId == null) return;
        try {
            // Observe outcome shares the submit lifecycle and never sends a write.
            if (pending.step === 'route') {
                const observed = await listVhostRoutes(observedId);
                const expected = routes.find(route => route.path_prefix === pending.prefix);
                const match = observed.find(route => route.path_prefix === pending.prefix && route.upstream?.id === expected?.upstream);
                if (!match) throw new Error('The submitted route was not found in this bounded observation. Inspect the hostname’s routes before starting another create; no route is replayed here.');
                progress.current.routes.set(match.path_prefix, match.id);
            } else {
                await EdgeVhostModel.invalidate(queryClient);
                const observed = await EdgeVhostModel.fetchOne(queryClient, observedId);
                if (!current()) return;
                const differences = submitted.current ? observedDifferences(submitted.current, observed) : ['The submitted configuration receipt is missing.'];
                if (observed.id !== observedId) differences.unshift(`Hostname ID: expected ${observedId}, observed ${observed.id ?? 'unknown'}`);
                if (differences.length) {
                    setUnconfirmed(`Outcome still unconfirmed. ${differences.slice(0, 3).join('; ')}${differences.length > 3 ? `; ${differences.length - 3} more differences` : ''}. No write was replayed.`);
                    return;
                }
                setUnconfirmed(`The exact submitted configuration was observed. Select ${editing ? 'Save changes' : 'Add hostname'} again to continue. Fleet application remains unverified.`);
            }
            if (!current()) return;
            uncertain.current = null;
            if (pending.step === 'route') setUnconfirmed('Route observed. Select Add hostname again to continue from acknowledged progress.');
        } catch (error) { throw new Error(`Observation unavailable: ${reason(error)}. No write was replayed.`); }
    };

    // The row embeds `certificate: basic`, which has no `sans`; the coverage
    // check needs the certificate's own graph.
    useEffect(() => {
        if (certificateId == null || certificate?.id === certificateId) return;
        let live = true;
        CertificateModel.fetchOne(queryClient, certificateId).then((full) => { if (live) setCertificate(full); }).catch(() => undefined);
        return () => { live = false; };
    }, [certificate, certificateId, queryClient]);

    useEffect(() => {
        if (!row || row.kind !== 'site_api') { if (editing) setStoredRoutes([]); return; }
        let live = true;
        listVhostRoutes(row.id).then((rows) => { if (live) setStoredRoutes(rows.map((route) => route.path_prefix)); }).catch(() => { if (live) setRoutesUnread(true); });
        return () => { live = false; };
    }, [editing, row]);

    const serverName = domain ? deriveServerName(domain.name, label) : '';
    const covered = certificate != null && certificate.id === certificateId && serverName ? certificateCovers(certificate, serverName) : null;
    const cleanQuietPaths = quietPaths.map((path) => path.trim()).filter(Boolean);
    const routePrefixes = editing ? storedRoutes ?? [] : routes.map((route) => route.path_prefix);

    const draft = (): VhostDraft => ({
        kind: kind!, domain: domain?.id ?? null, label, certificate: certificateId, pool: pool.trim(), is_enabled: enabled,
        upstream, serve_static: serveStatic, quiet_paths: cleanQuietPaths, body_size_mb: Number(bodySize), spa, redirect_to: redirectTo.trim().toLowerCase(),
    });

    const checkShape = () => {
        if (!kind) reveal('Choose what this address serves.', 'routing', 'input[type=radio]');
        if (editing && row.kind === 'site_api' && kind !== 'site_api' && (storedRoutes?.length ?? 0) > 0) {
            reveal(`This hostname has ${storedRoutes!.length} route${storedRoutes!.length === 1 ? '' : 's'}. Delete them in the detail view before changing what it serves.`, 'routing', 'input[type=radio]');
        }
    };
    const checkName = () => {
        if (!domain) reveal('Choose a domain.', 'address', 'input[role=combobox]');
        const refusal = validateVhostLabel(label);
        if (refusal) reveal(refusal, 'address', '[aria-label="Hostname label"]');
    };
    const checkKnobs = () => {
        if (kind === 'redirect') {
            const refusal = validateRedirectTarget(redirectTo.trim().toLowerCase());
            if (refusal) reveal(refusal, 'routing', '[placeholder="www.example.com"]');
            return;
        }
        const size = validateBodySizeMb(/^\d+$/.test(bodySize) ? Number(bodySize) : bodySize);
        if (size) reveal(size, 'settings', '[aria-label="Maximum request body (MB)"]');
        if (kind === 'api' && upstream == null) reveal('Choose an upstream.', 'routing', 'input[role=combobox]');
        if (kind === 'site_api' && !editing) {
            const refusal = validateRouteDrafts(routes);
            if (refusal) reveal(refusal, 'routing', '[aria-label="Path prefix"],input[role=combobox]');
        }
        if (kind === 'api' || kind === 'site_api') {
            for (const path of cleanQuietPaths) {
                const refusal = validateRequestPath(path, 'A quiet path');
                if (refusal) reveal(refusal, 'settings', '[aria-label^="Quiet paths"]');
            }
            if (new Set(cleanQuietPaths).size !== cleanQuietPaths.length) reveal('A quiet path is listed twice.', 'settings', '[aria-label^="Quiet paths"]');
            // Stored routes not read yet, or unreadable: the server checks.
            if (kind === 'site_api' && !(editing && storedRoutes == null)) {
                const uncovered = quietPathUncovered(cleanQuietPaths, routePrefixes);
                if (uncovered) reveal(`Quiet path ${uncovered} is not under any route prefix.`, 'settings', '[aria-label^="Quiet paths"]');
            }
        }
    };
    const checkCertificate = () => {
        if (certificateId == null) reveal('Choose a certificate.', 'certificate', 'input[role=combobox]');
        const refusal = validatePoolName(pool.trim());
        if (refusal) reveal(refusal, 'settings', '[aria-label="Fleet pool"]');
    };
    const checkAll = () => { checkShape(); checkName(); checkKnobs(); checkCertificate(); };

    const finish = async (): Promise<void> => {
        if (uncertain.current) {
            if (uncertain.current.step === 'create') throw new Error(unconfirmed);
            await observe();
            return;
        }
        guard();
        checkAll();
        const values = draft();
        if (editing) {
            let saved: EdgeVhostRow;
            submitted.current = buildVhostPayload(values, { create: false });
            try { saved = await saveVhost(row.id, submitted.current, guard); }
            catch (error) { if (!refused(error)) unknown('edit'); throw error; }
            if (saved.id !== row.id || saved.kind !== values.kind || saved.is_enabled !== values.is_enabled) unknown('edit');
            await EdgeVhostModel.invalidate(queryClient);
            if (current()) onDone(saved);
            return;
        }
        const state = progress.current;
        let saved: EdgeVhostRow | null = null;
        if (values.kind !== 'site_api') {
            try { saved = await saveVhost(null, buildVhostPayload(values, { create: true }), guard); }
            catch (error) { if (!refused(error)) unknown('create'); throw error; }
            if (!Number.isSafeInteger(saved.id) || saved.id <= 0 || saved.kind !== values.kind || saved.is_enabled !== values.is_enabled) unknown('create');
        } else {
            // The server checks a quiet path against the routes of a STORED
            // row, and an enabled row is live at once. So: create disabled
            // and without quiet paths, land the routes, then one update that
            // carries the quiet paths and the real enablement.
            if (state.vhostId == null) {
                let created: EdgeVhostRow;
                try { created = await saveVhost(null, buildVhostPayload({ ...values, quiet_paths: [], is_enabled: false }, { create: true }), guard); }
                catch (error) { if (!refused(error)) unknown('create'); throw error; }
                if (!Number.isSafeInteger(created.id) || created.id <= 0 || created.kind !== 'site_api' || created.is_enabled !== false) unknown('create');
                guard();
                state.vhostId = created.id;
                setCreatedId(created.id);
            }
            for (const route of routes) {
                if (state.routes.has(route.path_prefix)) continue;
                try {
                    const stored = await saveVhostRoute(null, { vhost: state.vhostId, path_prefix: route.path_prefix, upstream: route.upstream! }, guard);
                    if (!Number.isSafeInteger(stored.id) || stored.id <= 0 || stored.path_prefix !== route.path_prefix || stored.upstream?.id !== route.upstream) unknown('route', route.path_prefix);
                    guard();
                    state.routes.set(route.path_prefix, stored.id);
                } catch (error) {
                    await Promise.allSettled([EdgeVhostModel.invalidate(queryClient), EdgeRouteModel.invalidate(queryClient)]);
                    if (!refused(error)) unknown('route', route.path_prefix);
                    throw new Error(`Hostname #${state.vhostId} was created disabled, but the route ${route.path_prefix} was refused: ${reason(error)}. Fix it and finish again; nothing is created twice.`);
                }
            }
            submitted.current = buildVhostPayload(values, { create: false });
            try {
                saved = await saveVhost(state.vhostId, submitted.current, guard);
                if (saved.id !== state.vhostId || saved.kind !== values.kind || saved.is_enabled !== values.is_enabled) unknown('finish');
            } catch (error) {
                await Promise.allSettled([EdgeVhostModel.invalidate(queryClient), EdgeRouteModel.invalidate(queryClient)]);
                if (!refused(error)) unknown('finish');
                throw new Error(`Hostname #${state.vhostId} and its routes were created disabled. The last step was refused: ${reason(error)}. Fix it and finish again; nothing is created twice.`);
            }
        }
        await Promise.allSettled([EdgeVhostModel.invalidate(queryClient), EdgeRouteModel.invalidate(queryClient)]);
        if (current()) onDone(saved);
    };

    useEffect(() => {
        if (!domain) { setDomainOwner(null); return; }
        let live = true;
        setDomainOwner(null); setOwnerError('');
        DomainModel.fetchOne(queryClient, domain.id).then(full => {
            if (!live) return;
            const group = typeof full.group === 'number' ? full.group : full.group?.id ?? null;
            setDomainOwner({ id: full.id, group });
        }).catch(cause => { if (live) setOwnerError(reason(cause)); });
        return () => { live = false; };
    }, [domain?.id, queryClient]);
    const ownerReady = domainOwner?.id === domain?.id;
    const upstreamParams = { is_enabled: true, sort: 'name', ...(domainOwner?.group != null ? { group: domainOwner.group } : { group__isnull: true }) };
    const locked = createdId != null || !!uncertain.current;
    const disabled = busy || !!uncertain.current || !canManage || scope !== openedScope.current;
    const proxies = kind === 'api' || kind === 'site_api';
    const tabs = editing ? ['address', 'routing', 'certificate', 'settings'] : ['address', 'routing', 'certificate', 'review'];
    const titles: Record<string, string> = { address: 'Address', routing: 'Routing', certificate: 'Certificate', settings: 'Settings', review: 'Review' };
    const submit = async () => {
        if (pending.current || !current()) return;
        pending.current = true; setBusy(true); onBusyChange?.(true); setError('');
        try { await finish(); }
        catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'The configuration could not be saved.'); }
        finally { pending.current = false; if (mounted.current) { setBusy(false); onBusyChange?.(false); } }
    };
    const next = () => {
        try {
            if (active === 'address') checkName();
            if (active === 'routing') { checkShape(); checkKnobs(); }
            if (active === 'certificate') checkCertificate();
            setError(''); setActive(tabs[tabs.indexOf(active) + 1]!);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check these fields.'); }
    };
    const settings = <div className="edge-form-grid">
        <label className="field"><span className="field-label">Pool <EdgeHelp label="About fleet pools">The server must declare this pool. The default is <code>default</code>.</EdgeHelp></span><input className="input" aria-label="Fleet pool" value={pool} disabled={disabled} onChange={event => setPool(event.target.value)} autoComplete="off" /></label>
        {kind !== 'redirect' && <label className="field"><span className="field-label">Maximum request body (MB)</span><input className="input" aria-label="Maximum request body (MB)" inputMode="numeric" value={bodySize} disabled={disabled} onChange={event => setBodySize(event.target.value.trim())} /><span className="field-help">1–4096 MB</span></label>}
        {proxies && <><label className="field switch-field"><input type="checkbox" checked={serveStatic} disabled={disabled} onChange={event => setServeStatic(event.target.checked)} /> Serve static files <EdgeHelp label="About static files">Serve the fleet's files at /static/ rather than proxying them.</EdgeHelp></label><PathListEditor label="Quiet paths" help={kind === 'site_api' ? 'Each exact path must be under a route prefix.' : 'Exact paths omitted from the access log.'} paths={quietPaths} onChange={setQuietPaths} disabled={disabled} /></>}
    </div>;
    const panels: Record<string, ReactNode> = {
        address: <div className="edge-form-grid">
            <CollectionSelect<DomainRow> model={DomainModel} value={domain} onChange={(_id, picked) => { setDomain(picked ? { id: picked.id, name: picked.name } : null); setCertificate(null); setCertificateId(null); setUpstream(null); setRoutes([]); }} label="Domain" required readOnly={editing || locked} disabled={disabled} placeholder="Search active domains…" defaultParams={{ status: 'active', sort: 'name', ...(superuser ? {} : { group__isnull: false }) }} />
            <label className="field"><span className="field-label">Label <EdgeHelp label="About hostname labels">Leave empty for the bare domain. Use * for every one-label subdomain.</EdgeHelp></span><input className="input" aria-label="Hostname label" value={label} disabled={disabled || locked} onChange={event => setLabel(event.target.value.trim().toLowerCase())} placeholder="www" autoComplete="off" /></label>
            <div className="edge-server-name" aria-live="polite"><span>Hostname</span><code>{serverName || 'Choose a domain'}</code></div>
        </div>,
        routing: <div className="edge-form-grid">
            <fieldset className="edge-kind-picker" disabled={disabled || locked}><legend className="field-label">Serves <EdgeHelp label="About serving types">API proxies every request. Site serves published files. Site + API proxies chosen prefixes. Redirect sends requests to another hostname.</EdgeHelp></legend><div className="edge-kind-options">{VHOST_KIND_CARDS.map(card => <label key={card.value} className={`edge-kind-option${kind === card.value ? ' is-selected' : ''}`}><input type="radio" name="edge-vhost-kind" checked={kind === card.value} onChange={() => setKind(card.value)} /><i className={`bi ${card.icon}`} aria-hidden="true" />{card.title}</label>)}</div></fieldset>
            {ownerError && proxies && <div className="form-alert" role="alert">Could not load the domain's upstream scope: {ownerError}</div>}
            {kind === 'api' && <CollectionSelect<EdgeUpstreamRow> model={EdgeUpstreamModel} value={upstream} onChange={id => setUpstream(id == null ? null : Number(id))} label="Upstream" required disabled={disabled || !ownerReady} placeholder="Search enabled upstreams…" defaultParams={upstreamParams} />}
            {kind === 'redirect' && <label className="field"><span className="field-label">Redirect to <em>*</em> <EdgeHelp label="About redirect destinations">Enter a hostname only, without https://, a path or port. The redirect preserves the request path.</EdgeHelp></span><input className="input" value={redirectTo} disabled={disabled} onChange={event => setRedirectTo(event.target.value)} placeholder="www.example.com" autoComplete="off" /></label>}
            {kind === 'site_api' && (editing ? <div className="edge-note"><b>API routes</b><span>{storedRoutes == null ? routesUnread ? 'Unavailable. The server will validate existing routes.' : 'Loading…' : storedRoutes.length ? storedRoutes.join(', ') : 'No routes yet.'} Add or change routes from the hostname's Routes tab after saving.</span></div> : <div className="field edge-route-list"><span className="field-label">API routes <em>*</em></span>{routes.map(route => <div className="edge-route-row" key={route.key}><input className="input" value={route.path_prefix} disabled={disabled || progress.current.routes.has(route.path_prefix)} placeholder="/api" aria-label="Path prefix" onChange={event => setRoutes(rows => rows.map(item => item.key === route.key ? { ...item, path_prefix: event.target.value.trim() } : item))} /><CollectionSelect<EdgeUpstreamRow> model={EdgeUpstreamModel} value={route.upstream == null ? null : { id: route.upstream, name: route.upstreamName ?? '' }} onChange={(id, picked) => setRoutes(rows => rows.map(item => item.key === route.key ? { ...item, upstream: id == null ? null : Number(id), upstreamName: picked?.name } : item))} disabled={disabled || !ownerReady || progress.current.routes.has(route.path_prefix)} label="Upstream" placeholder="Upstream…" defaultParams={upstreamParams} /><button type="button" className="btn btn-compact" disabled={disabled || progress.current.routes.has(route.path_prefix)} aria-label={`Remove route ${route.path_prefix}`} onClick={() => setRoutes(rows => rows.filter(item => item.key !== route.key))}><i className="bi bi-x-lg" /></button></div>)}<div><button type="button" className="btn btn-compact" disabled={disabled} onClick={() => setRoutes(rows => [...rows, { key: nextRouteKey.current++, path_prefix: '', upstream: null }])}><i className="bi bi-plus-lg" /> Add route</button></div></div>)}
            {(kind === 'site' || kind === 'site_api') && <label className="field switch-field"><input type="checkbox" checked={spa} disabled={disabled} onChange={event => setSpa(event.target.checked)} /> Single-page app <EdgeHelp label="About single-page apps">Unknown paths return index.html instead of a 404.</EdgeHelp></label>}
        </div>,
        certificate: <div className="edge-form-grid"><CollectionSelect<CertificateRow> key={domain?.id ?? 'none'} model={CertificateModel} labelField="common_name" value={certificateId == null ? null : { id: certificateId, common_name: certificate?.id === certificateId ? certificate.common_name : row?.certificate?.common_name ?? '' }} onChange={(id, picked) => { setCertificateId(id == null ? null : Number(id)); setCertificate(picked ?? null); }} label="Certificate" required disabled={disabled || !domain} placeholder={domain ? 'Search this domain’s certificates…' : 'Choose a domain first'} defaultParams={domain ? { domain__exact: domain.id } : {}} />
            <p className={covered === false ? 'text-warn' : 'dim'} role="status">{covered == null ? 'Certificate coverage unknown.' : covered ? 'Certificate covers this hostname.' : 'This certificate does not cover the hostname. Save disabled to stage it.'}</p>
            <label className="field switch-field"><input type="checkbox" checked={enabled} disabled={disabled} onChange={event => setEnabled(event.target.checked)} /> Enabled <EdgeHelp label="About enabled configuration">Enabled is saved intent. It does not prove that the fleet has applied this configuration.</EdgeHelp></label>
        </div>,
        settings,
        review: <div className="edge-form-grid"><dl className="edge-review"><dt>Hostname</dt><dd><code>{serverName}</code></dd><dt>Serves</dt><dd>{kind ? vhostKindTitle(kind) : '—'}</dd>{kind === 'redirect' && <><dt>Destination</dt><dd>{redirectTo}</dd></>}{kind === 'api' && <><dt>Upstream</dt><dd>{upstream == null ? 'None' : `#${upstream}`}</dd></>}{kind === 'site_api' && <><dt>Routes</dt><dd>{routes.map(route => `${route.path_prefix} → ${route.upstreamName ?? `#${route.upstream}`}`).join(', ')}</dd></>}<dt>Certificate</dt><dd>{certificate?.common_name ?? row?.certificate?.common_name ?? 'Unknown'}</dd><dt>State</dt><dd>{enabled ? 'Enabled intent' : 'Disabled'}</dd></dl><button type="button" className="btn edge-settings-button" disabled={busy} onClick={() => setActive('settings')}>Other settings <i className="bi bi-sliders" /></button></div>,
    };
    const inspect = async () => {
        if (pending.current || createdId == null) return;
        pending.current = true; setBusy(true); onBusyChange?.(true);
        try { await EdgeVhostModel.invalidate(queryClient); const observed = await EdgeVhostModel.fetchOne(queryClient, createdId); if (current()) onDone(observed); }
        catch (cause) { setError(`Could not inspect saved hostname #${createdId}: ${reason(cause)}`); }
        finally { pending.current = false; if (mounted.current) { setBusy(false); onBusyChange?.(false); } }
    };
    return <div className="edge-vhost-editor" aria-busy={busy || undefined}>
        {error && <div className="form-alert" role="alert">{error}</div>}
        {unconfirmed && <div className="edge-warning" role="status">{unconfirmed}</div>}
        {editing ? <Tabs ariaLabel="Hostname settings" activeKey={active} onActiveKeyChange={key => { if (!busy) { setActive(key); setError(''); } }} items={tabs.map(key => ({ key, label: titles[key], disabled: busy && key !== active, panel: <div className="edge-editor-panel" ref={body}>{panels[key]}</div> }))} /> : <><ol className="edge-create-progress" aria-label="Setup progress">{tabs.map((key, index) => <li key={key} aria-current={key === active ? 'step' : undefined}><span>{index + 1}</span>{titles[key]}</li>)}</ol><div className="edge-editor-panel" ref={body}>{active === 'settings' ? <><button type="button" className="btn btn-compact" onClick={() => setActive('review')}>Back to review</button>{settings}</> : panels[active]}</div></>}
        <div className="modal-actions edge-editor-actions"><button type="button" className="btn" disabled={busy} onClick={() => onDone(null)}>Cancel</button>{createdId != null && <button type="button" className="btn" disabled={busy} onClick={() => void inspect()}>Inspect saved hostname</button>}{!editing && tabs.indexOf(active) > 0 && <button type="button" className="btn" disabled={busy} onClick={() => { setError(''); setActive(tabs[tabs.indexOf(active) - 1]!); }}>Back</button>}{!editing && active !== 'review' && active !== 'settings' && !uncertain.current ? <button type="button" className="btn btn-primary" disabled={busy} onClick={next}>Next</button> : <button type="button" className="btn btn-primary" disabled={busy || uncertain.current?.step === 'create'} onClick={() => { if (active === 'settings' && !editing && !uncertain.current) { try { checkKnobs(); checkCertificate(); setActive('review'); } catch (cause) { setError(reason(cause)); } } else void submit(); }}>{busy ? 'Saving…' : uncertain.current ? 'Observe outcome' : editing ? 'Save changes' : active === 'settings' ? 'Back to review' : 'Add hostname'}</button>}</div>
    </div>;
}

/** Native focused editor; no generic record rail. */
export function openVhostWizard(row: EdgeVhostRow | null = null, options: { initialTab?: string; signal?: AbortSignal } = {}): Promise<EdgeVhostRow | null> {
    let pending = false;
    return modal.open<EdgeVhostRow | null>(close => <div className="modal-pad edge-vhost-wizard"><h2 className="modal-title">{row ? `Edit ${row.server_name ?? 'hostname'}` : 'Add hostname'}</h2><VhostWizard row={row} initialTab={options.initialTab} signal={options.signal} onBusyChange={value => { pending = value; }} onDone={saved => { if (!pending) close(saved); else if (saved) close(saved); }} /></div>, { size: 'md', canDismiss: () => !pending, signal: options.signal }).then(value => value ?? null);
}
