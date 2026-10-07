import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCan } from '../../client/runtime';
import { ArmedButton, Badge, CollectionSelect, ModelTable, fmt, modal, toast, type Column, type FilterDef } from '../../ui';
import { declareUpstream, retireUpstream, setUpstreamEnabled, type DeclareUpstreamInput } from './api';
import { EDGE_MANAGE_PERMS, EdgeUpstreamModel, upstreamTarget, type EdgeUpstreamRow } from './models';

const RETIRE_CONSEQUENCE = 'Vhosts and routes that reach this upstream stop being served. They are not repointed. The upstream stays listed, disabled, so its history is kept.';

function DeclareUpstreamDialog({ close }: { close: (row: EdgeUpstreamRow | null) => void }) {
    const [name, setName] = useState('');
    const [kind, setKind] = useState<'http' | 'unix'>('http');
    const [host, setHost] = useState('');
    const [port, setPort] = useState('');
    const [socketPath, setSocketPath] = useState('');
    const [group, setGroup] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy) return;
        if (kind === 'http' && !/^\d+$/.test(port)) { setError('Enter the port as a number.'); return; }
        // Only the chosen kind's destination is sent; the other branch's values vanish.
        const input: DeclareUpstreamInput = kind === 'http'
            ? { name: name.trim(), kind, host: host.trim().toLowerCase(), port: Number(port), group }
            : { name: name.trim(), kind, socket_path: socketPath.trim(), group };
        setBusy(true); setError('');
        try {
            close(await declareUpstream(input));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'The upstream was not declared');
        } finally {
            setBusy(false);
        }
    };

    return <div className="modal-pad edge-upstream-dialog"><h2 className="modal-title">Declare upstream</h2>
        <p className="dim">An upstream is a destination vhosts may proxy to. Only platform administrators can declare one, and its destination cannot be changed afterwards.</p>
        {error && <div className="form-alert" role="alert">{error}</div>}
        <form onSubmit={(event) => void submit(event)}><div className="form-grid">
            <label className="field"><span className="field-label">Name <em>*</em></span><input className="input" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} required autoComplete="off" placeholder="orders-api" /><span className="field-help">Lowercase letters, digits, '-' or '_'.</span></label>
            <label className="field"><span className="field-label">Reached over</span><select className="input" value={kind} disabled={busy} onChange={(event) => setKind(event.target.value === 'unix' ? 'unix' : 'http')}><option value="http">HTTP: host and port</option><option value="unix">Unix socket</option></select></label>
            {kind === 'http' && <label className="field"><span className="field-label">Host <em>*</em></span><input className="input" value={host} disabled={busy} onChange={(event) => setHost(event.target.value)} required autoComplete="off" placeholder="10.0.4.12" /></label>}
            {kind === 'http' && <label className="field"><span className="field-label">Port <em>*</em></span><input className="input" inputMode="numeric" value={port} disabled={busy} onChange={(event) => setPort(event.target.value.trim())} required placeholder="8080" /></label>}
            {kind === 'unix' && <label className="field"><span className="field-label">Socket path <em>*</em></span><input className="input" value={socketPath} disabled={busy} onChange={(event) => setSocketPath(event.target.value)} required autoComplete="off" placeholder="/run/mojo/app.sock" /><span className="field-help">Must sit under the deployment's socket directory.</span></label>}
            <CollectionSelect<{ id: number; name: string }> endpoint="/api/group" value={group} onChange={(id) => setGroup(id == null ? null : Number(id))} label="Owning group" disabled={busy} placeholder="Shared with every group" help="Leave empty for a shared upstream. Choose a group to keep it to that group's vhosts." />
        </div>
        <div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Declaring…' : 'Declare upstream'}</button></div></form>
    </div>;
}

export function openDeclareUpstream(): Promise<EdgeUpstreamRow | null> {
    return modal.open<EdgeUpstreamRow | null>((close) => <DeclareUpstreamDialog close={close} />).then((value) => value ?? null);
}

const FILTERS: FilterDef[] = [
    { key: 'is_enabled', label: 'State', type: 'boolean', trueLabel: 'Enabled', falseLabel: 'Disabled' },
    { key: 'kind', label: 'Reached over', type: 'select', options: [{ value: 'http', label: 'HTTP' }, { value: 'unix', label: 'Unix socket' }] },
];

export function UpstreamsPage() {
    const queryClient = useQueryClient();
    const { can: canManage, me } = useCan(EDGE_MANAGE_PERMS);
    // Declare and retire are `require_platform_admin` on the server.
    const superuser = me?.is_superuser === true;

    const run = async (work: () => Promise<EdgeUpstreamRow>, done: (row: EdgeUpstreamRow) => string) => {
        try {
            toast.success(done(await work()));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'The change was refused');
        } finally {
            await EdgeUpstreamModel.invalidate(queryClient);
        }
    };
    const retire = async (row: EdgeUpstreamRow) => {
        const ok = await modal.confirm({ title: `Retire ${row.name}?`, message: RETIRE_CONSEQUENCE, confirmText: 'Retire upstream', danger: true });
        if (ok) await run(() => retireUpstream(row.id), (saved) => `${saved.name} retired.`);
    };
    const declare = async () => {
        const row = await openDeclareUpstream();
        if (!row) return;
        await EdgeUpstreamModel.invalidate(queryClient);
        toast.success(`${row.name} declared.`);
    };

    const columns: Column<EdgeUpstreamRow>[] = [
        { key: 'name', label: 'Name', sortable: true, hideable: false, render: (row) => <code>{row.name}</code> },
        { key: 'kind', label: 'Reached over', sortable: true, render: (row) => row.kind === 'unix' ? 'Unix socket' : 'HTTP' },
        { key: 'target', label: 'Destination', sortable: false, render: (row) => <code>{upstreamTarget(row)}</code> },
        { key: 'group', label: 'Scope', sortable: false, render: (row) => row.group ? <Badge tone="info">{row.group.name}</Badge> : <Badge tone="primary">Shared</Badge> },
        { key: 'is_enabled', label: 'State', sortable: true, render: (row) => row.is_enabled ? <Badge tone="success">Enabled</Badge> : <Badge tone="muted">Disabled</Badge> },
        { key: 'created', label: 'Declared', sortable: true, render: (row) => fmt.date(row.created) },
        ...(canManage ? [{
            key: 'actions', label: '', sortable: false, hideable: false, align: 'end' as const,
            render: (row: EdgeUpstreamRow) => <span className="edge-row-actions" onClick={(event) => event.stopPropagation()}>
                <button type="button" className="btn btn-compact" onClick={() => void run(() => setUpstreamEnabled(row.id, !row.is_enabled), (saved) => `${saved.name} ${saved.is_enabled ? 'enabled' : 'disabled'}.`)}>{row.is_enabled ? 'Disable' : 'Enable'}</button>
                {superuser && row.is_enabled && <ArmedButton className="btn-compact" label="Retire" armedLabel="Click again to review" onConfirm={() => retire(row)} />}
            </span>,
        }] : []),
    ];

    return <ModelTable<EdgeUpstreamRow>
        model={EdgeUpstreamModel} eyebrow="Infrastructure · Edge" title="Upstreams"
        searchable searchPlaceholder="Search name or kind"
        columns={columns} filters={FILTERS} defaultSort="name"
        columnChooser persistState persistKey="admin:edge:upstreams"
        {...(superuser ? { addLabel: 'Declare upstream', onAdd: () => void declare() } : {})}
    />;
}
