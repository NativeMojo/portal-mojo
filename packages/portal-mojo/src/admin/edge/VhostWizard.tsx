import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '../../client/runtime';
import { CollectionSelect, FormWizard, modal, type FormWizardSection } from '../../ui';
import { CertificateModel, DomainModel, type CertificateRow, type DomainRow } from '../dns/models';
import { listVhostRoutes, saveVhostRoute, saveVhost } from './api';
import {
    EdgeRouteModel, EdgeUpstreamModel, EdgeVhostModel, VHOST_KIND_CARDS,
    buildVhostPayload, certificateCovers, deriveServerName, quietPathUncovered,
    validateBodySizeMb, validatePoolName, validateRedirectTarget, validateRequestPath,
    validateRouteDrafts, validateVhostLabel, vhostKindTitle,
    type EdgeUpstreamRow, type EdgeVhostRow, type RouteDraft, type VhostDraft, type VhostKind,
} from './models';

function reason(error: unknown): string {
    return (error instanceof Error ? error.message : 'save failed').replace(/[.\s]+$/, '');
}

interface RouteRowDraft extends RouteDraft { key: number; upstreamName?: string }

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
    /** Omit to create; pass the `default` graph row to edit. */
    row?: EdgeVhostRow | null;
    onDone: (saved: EdgeVhostRow | null) => void;
    onBusyChange?: (busy: boolean) => void;
}

export function VhostWizard({ row = null, onDone, onBusyChange }: VhostWizardProps) {
    const queryClient = useQueryClient();
    const { data: me } = useMe();
    const superuser = me?.is_superuser === true;
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
    const nextRouteKey = useRef(1);
    // Finish reruns whole on every retry, so what already landed is recorded
    // here and skipped: never a second vhost, never a duplicate route.
    const progress = useRef<{ vhostId: number | null; routes: Map<string, number> }>({ vhostId: null, routes: new Map() });
    const [createdId, setCreatedId] = useState<number | null>(null);

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
        listVhostRoutes(row.id).then((rows) => { if (live) setStoredRoutes(rows.map((route) => route.path_prefix)); }).catch(() => { if (live) setStoredRoutes([]); });
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
        if (!kind) throw new Error('Choose what this address serves.');
        if (editing && row.kind === 'site_api' && kind !== 'site_api' && (storedRoutes?.length ?? 0) > 0) {
            throw new Error(`This vhost has ${storedRoutes!.length} route${storedRoutes!.length === 1 ? '' : 's'}. Delete them in the detail view before changing what it serves.`);
        }
    };
    const checkName = () => {
        if (!domain) throw new Error('Choose a domain.');
        const refusal = validateVhostLabel(label);
        if (refusal) throw new Error(refusal);
    };
    const checkKnobs = () => {
        if (kind === 'redirect') {
            const refusal = validateRedirectTarget(redirectTo.trim().toLowerCase());
            if (refusal) throw new Error(refusal);
            return;
        }
        const size = validateBodySizeMb(/^\d+$/.test(bodySize) ? Number(bodySize) : bodySize);
        if (size) throw new Error(size);
        if (kind === 'api' && upstream == null) throw new Error('Choose the upstream this host proxies to.');
        if (kind === 'site_api' && !editing) {
            const refusal = validateRouteDrafts(routes);
            if (refusal) throw new Error(refusal);
        }
        if (kind === 'api' || kind === 'site_api') {
            for (const path of cleanQuietPaths) {
                const refusal = validateRequestPath(path, 'A quiet path');
                if (refusal) throw new Error(refusal);
            }
            if (new Set(cleanQuietPaths).size !== cleanQuietPaths.length) throw new Error('A quiet path is listed twice.');
            if (kind === 'site_api') {
                const uncovered = quietPathUncovered(cleanQuietPaths, routePrefixes);
                if (uncovered) throw new Error(`Quiet path ${uncovered} is not under any route prefix.`);
            }
        }
    };
    const checkCertificate = () => {
        if (certificateId == null) throw new Error('Choose a certificate.');
        const refusal = validatePoolName(pool.trim());
        if (refusal) throw new Error(refusal);
    };
    const checkAll = () => { checkShape(); checkName(); checkKnobs(); checkCertificate(); };

    const finish = async (): Promise<void> => {
        checkAll();
        const values = draft();
        if (editing) {
            const saved = await saveVhost(row.id, buildVhostPayload(values, { create: false }));
            await EdgeVhostModel.invalidate(queryClient);
            onDone(saved);
            return;
        }
        const state = progress.current;
        let saved: EdgeVhostRow | null = null;
        if (values.kind !== 'site_api') {
            saved = await saveVhost(null, buildVhostPayload(values, { create: true }));
        } else {
            // The server checks a quiet path against the routes of a STORED
            // row, and an enabled row is live at once. So: create disabled
            // and without quiet paths, land the routes, then one update that
            // carries the quiet paths and the real enablement.
            if (state.vhostId == null) {
                const created = await saveVhost(null, buildVhostPayload({ ...values, quiet_paths: [], is_enabled: false }, { create: true }));
                state.vhostId = created.id;
                setCreatedId(created.id);
            }
            for (const route of routes) {
                if (state.routes.has(route.path_prefix)) continue;
                try {
                    const stored = await saveVhostRoute(null, { vhost: state.vhostId, path_prefix: route.path_prefix, upstream: route.upstream! });
                    state.routes.set(route.path_prefix, stored.id);
                } catch (error) {
                    await Promise.allSettled([EdgeVhostModel.invalidate(queryClient), EdgeRouteModel.invalidate(queryClient)]);
                    throw new Error(`Vhost #${state.vhostId} was created disabled, but the route ${route.path_prefix} was refused: ${reason(error)}. Fix it and finish again; nothing is created twice.`);
                }
            }
            try {
                saved = await saveVhost(state.vhostId, buildVhostPayload(values, { create: false }));
            } catch (error) {
                await Promise.allSettled([EdgeVhostModel.invalidate(queryClient), EdgeRouteModel.invalidate(queryClient)]);
                throw new Error(`Vhost #${state.vhostId} and its routes were created, and it is still disabled. The last step was refused: ${reason(error)}. Fix it and finish again; nothing is created twice.`);
            }
        }
        await Promise.allSettled([EdgeVhostModel.invalidate(queryClient), EdgeRouteModel.invalidate(queryClient)]);
        onDone(saved);
    };

    const locked = createdId != null;
    const sections = useMemo<FormWizardSection[]>(() => {
        const shape: FormWizardSection = {
            key: 'shape', label: 'Shape', fields: [], description: 'What should this address do? Each choice shows only the settings it uses.',
            content: ({ busy }) => <div className="edge-kind-cards" role="radiogroup" aria-label="What this address serves">
                {VHOST_KIND_CARDS.map((card) => <label key={card.value} className={`edge-kind-card${kind === card.value ? ' is-selected' : ''}`}>
                    <input type="radio" name="edge-vhost-kind" checked={kind === card.value} disabled={busy || locked} onChange={() => setKind(card.value)} />
                    <i className={`bi ${card.icon}`} />
                    <b>{card.title}</b>
                    <span>{card.description}</span>
                </label>)}
            </div>,
            onNext: checkShape,
        };
        const name: FormWizardSection = {
            key: 'name', label: 'Name', fields: [], description: 'The address is the label joined to a domain you hold. It is never typed whole.',
            content: ({ busy }) => <div className="edge-form-grid">
                <CollectionSelect<DomainRow> model={DomainModel} value={domain} onChange={(_id, picked) => { setDomain(picked ? { id: picked.id, name: picked.name } : null); setCertificate(null); setCertificateId(null); }} label="Domain" required readOnly={editing || locked} disabled={busy} placeholder="Search active domains…"
                    // A house domain would dead-end at the server's platform gate for anyone else.
                    defaultParams={{ status: 'active', sort: 'name', ...(superuser ? {} : { group__isnull: false }) }}
                    help={editing ? 'A vhost cannot be moved to another domain.' : undefined} />
                <label className="field"><span className="field-label">Label</span><input className="input" value={label} disabled={busy} onChange={(event) => setLabel(event.target.value.trim().toLowerCase())} placeholder="www" autoComplete="off" /><span className="field-help">Empty serves the bare domain. * serves every one-label subdomain.</span></label>
                <div className="edge-server-name" aria-live="polite"><span>Address</span><code>{serverName || '—'}</code></div>
            </div>,
            onNext: checkName,
        };
        const knobs: FormWizardSection = {
            key: 'knobs', label: 'Settings', fields: [], description: kind ? `Settings for: ${vhostKindTitle(kind)}.` : undefined,
            content: ({ busy }) => <div className="edge-form-grid">
                {kind === 'api' && <CollectionSelect<EdgeUpstreamRow> model={EdgeUpstreamModel} value={upstream} onChange={(id) => setUpstream(id == null ? null : Number(id))} label="Upstream" required disabled={busy} placeholder="Search enabled upstreams…" defaultParams={{ is_enabled: true, sort: 'name' }} help="Every request on this address goes here. Upstreams are declared by a platform administrator." />}
                {kind === 'redirect' && <label className="field"><span className="field-label">Redirect to <em>*</em></span><input className="input" value={redirectTo} disabled={busy} onChange={(event) => setRedirectTo(event.target.value)} placeholder="www.example.com" autoComplete="off" /><span className="field-help">A host name only: no https://, path or port.</span></label>}
                {(kind === 'site' || kind === 'site_api') && <label className="field switch-field"><input type="checkbox" checked={spa} disabled={busy} onChange={(event) => setSpa(event.target.checked)} /> Single-page app: unknown paths return index.html instead of a 404</label>}
                {kind === 'site_api' && (editing
                    ? <div className="edge-note"><b>Routes</b><span>{storedRoutes == null ? 'Loading…' : storedRoutes.length ? storedRoutes.join(', ') : 'None yet.'} Manage routes in the detail view.</span></div>
                    : <div className="field edge-route-list">
                        <span className="field-label">Routes <em>*</em></span>
                        {routes.map((route) => <div className="edge-route-row" key={route.key}>
                            <input className="input" value={route.path_prefix} disabled={busy || progress.current.routes.has(route.path_prefix)} placeholder="/api" aria-label="Path prefix" onChange={(event) => setRoutes((rows) => rows.map((item) => item.key === route.key ? { ...item, path_prefix: event.target.value.trim() } : item))} />
                            <CollectionSelect<EdgeUpstreamRow> model={EdgeUpstreamModel} value={route.upstream == null ? null : { id: route.upstream, name: route.upstreamName ?? '' }} onChange={(id, picked) => setRoutes((rows) => rows.map((item) => item.key === route.key ? { ...item, upstream: id == null ? null : Number(id), upstreamName: picked?.name } : item))} disabled={busy || progress.current.routes.has(route.path_prefix)} placeholder="Upstream…" defaultParams={{ is_enabled: true, sort: 'name' }} />
                            <button type="button" className="btn btn-compact" disabled={busy || progress.current.routes.has(route.path_prefix)} aria-label={`Remove route ${route.path_prefix}`} onClick={() => setRoutes((rows) => rows.filter((item) => item.key !== route.key))}><i className="bi bi-x-lg" /></button>
                        </div>)}
                        <div><button type="button" className="btn btn-compact" disabled={busy} onClick={() => setRoutes((rows) => [...rows, { key: nextRouteKey.current++, path_prefix: '', upstream: null }])}><i className="bi bi-plus-lg" /> Add route</button></div>
                        <span className="field-help">Requests under each prefix go to its upstream; everything else is served from the site. At least one is required.</span>
                    </div>)}
                {(kind === 'api' || kind === 'site_api') && <label className="field switch-field"><input type="checkbox" checked={serveStatic} disabled={busy} onChange={(event) => setServeStatic(event.target.checked)} /> Serve the fleet's static files at /static/ instead of proxying them</label>}
                {(kind === 'api' || kind === 'site_api') && <PathListEditor label="Quiet paths" help={kind === 'site_api' ? 'Exact paths kept out of the access log, such as health checks. Each must sit under a route prefix.' : 'Exact paths kept out of the access log, such as health checks.'} paths={quietPaths} onChange={setQuietPaths} disabled={busy} />}
                {kind !== 'redirect' && <label className="field"><span className="field-label">Largest request body (MB)</span><input className="input" inputMode="numeric" value={bodySize} disabled={busy} onChange={(event) => setBodySize(event.target.value.trim())} /><span className="field-help">1 to 4096. The default is 50.</span></label>}
            </div>,
            onNext: checkKnobs,
        };
        const serving: FormWizardSection = {
            key: 'certificate', label: 'Certificate', fields: [],
            content: ({ busy }) => <div className="edge-form-grid">
                <CollectionSelect<CertificateRow> key={domain?.id ?? 'none'} model={CertificateModel} labelField="common_name" value={certificateId == null ? null : { id: certificateId, common_name: certificate?.id === certificateId ? certificate.common_name : row?.certificate?.common_name ?? '' }} onChange={(id, picked) => { setCertificateId(id == null ? null : Number(id)); setCertificate(picked ?? null); }} label="Certificate" required disabled={busy || !domain} placeholder={domain ? 'Search this domain’s certificates…' : 'Choose a domain first'} defaultParams={domain ? { domain__exact: domain.id } : {}} />
                {covered === false && <div className="edge-warning" role="status"><i className="bi bi-exclamation-triangle" /> This certificate does not cover <code>{serverName}</code>. The vhost will not enable until it does. Save it disabled to stage it.</div>}
                <label className="field"><span className="field-label">Pool</span><input className="input" value={pool} disabled={busy} onChange={(event) => setPool(event.target.value)} autoComplete="off" /><span className="field-help">Which group of edge nodes serves this address. It must be a pool this deployment declares; most have only “default”.</span></label>
                <label className="field switch-field"><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} /> Enabled: start serving once saved</label>
            </div>,
            onNext: checkCertificate,
        };
        const review: FormWizardSection = {
            key: 'review', label: 'Review', fields: [],
            content: <dl className="edge-review">
                <dt>Address</dt><dd><code>{serverName || '—'}</code></dd>
                <dt>Serves</dt><dd>{kind ? vhostKindTitle(kind) : '—'}</dd>
                {kind === 'redirect' && <><dt>Redirects to</dt><dd><code>{redirectTo || '—'}</code></dd></>}
                {kind === 'site_api' && !editing && <><dt>Routes</dt><dd>{routes.length ? routes.map((route) => `${route.path_prefix} → ${route.upstreamName ?? `#${route.upstream}`}`).join(', ') : 'None'}</dd></>}
                {(kind === 'site' || kind === 'site_api') && <><dt>Single-page app</dt><dd>{spa ? 'Yes' : 'No'}</dd></>}
                {(kind === 'api' || kind === 'site_api') && <><dt>Static files</dt><dd>{serveStatic ? 'Served at /static/' : 'Not served here'}</dd><dt>Quiet paths</dt><dd>{cleanQuietPaths.length ? cleanQuietPaths.join(', ') : 'None'}</dd></>}
                {kind !== 'redirect' && <><dt>Largest body</dt><dd>{bodySize} MB</dd></>}
                <dt>Pool</dt><dd>{pool}</dd>
                <dt>State</dt><dd>{enabled ? 'Enabled' : 'Disabled'}{covered === false && enabled ? ' — the certificate does not cover this address, so the save will be refused' : ''}</dd>
                {locked && <><dt>Progress</dt><dd>Vhost #{createdId} already exists, disabled. Finishing again continues from there.</dd></>}
            </dl>,
        };
        return editing ? [shape, name, knobs, serving] : [shape, name, knobs, serving, review];
        // The check* closures read the same state listed here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bodySize, certificate, certificateId, covered, createdId, domain, editing, enabled, kind, label, locked, pool, quietPaths, redirectTo, routes, serveStatic, serverName, spa, storedRoutes, superuser, upstream]);

    return <FormWizard mode={editing ? 'tabs' : 'wizard'} sections={sections} onBusyChange={onBusyChange} onCancel={() => onDone(null)} onFinish={finish} finishText="Create vhost" saveText="Save changes" busyText="Saving…" />;
}

/** Opens the wizard in a modal; resolves with the saved row, or null when cancelled. */
export function openVhostWizard(row: EdgeVhostRow | null = null): Promise<EdgeVhostRow | null> {
    let pending = false;
    return modal.open<EdgeVhostRow | null>((close) => <div className="modal-pad edge-vhost-wizard">
        <h2 className="modal-title">{row ? `Edit ${row.server_name ?? 'vhost'}` : 'New vhost'}</h2>
        <VhostWizard row={row} onBusyChange={(busy) => { pending = busy; }} onDone={(saved) => close(saved)} />
    </div>, { size: 'lg', canDismiss: () => !pending }).then((value) => value ?? null);
}
