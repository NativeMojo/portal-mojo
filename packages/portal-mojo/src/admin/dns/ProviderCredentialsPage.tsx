import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCan } from '../../client';
import {
    ArmedButton, Badge, CollectionSelect, FlatRow, ModelTable, fmt, modal, toast,
    type Column, type FilterDef, type Tone,
} from '../../ui';
import {
    DNS_GROUP_CHOICE_ENDPOINT, invalidateDnsCredentials, linkDnsCredential,
    rotateDnsCredential, useDnsCapabilities,
} from './api';
import { linkableProviders, providerLabel } from './data';
import {
    DNS_MANAGE_PERMISSIONS, DNS_VIEW_PERMISSIONS, DnsCredentialModel,
    type DnsCapabilities, type DnsCredentialRow, type DnsGroupChoice,
} from './models';

function groupId(group: DnsCredentialRow['group']): number | null {
    if (group == null) return null;
    return typeof group === 'number' ? group : group.id;
}

function groupLabel(group: DnsCredentialRow['group']): string {
    if (group == null) return 'Platform';
    return typeof group === 'number' ? `Group #${group}` : group.name;
}

function verificationTone(row: DnsCredentialRow): Tone {
    return row.verified ? 'success' : row.last_error ? 'danger' : 'warning';
}

function CredentialSecretForm({ row, caps, close }: {
    row?: DnsCredentialRow;
    caps: DnsCapabilities;
    close: (saved: DnsCredentialRow | null) => void;
}) {
    const queryClient = useQueryClient();
    const providers = linkableProviders(caps);
    const keyRef = useRef<HTMLInputElement>(null);
    const secretRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState(row?.name ?? '');
    const [provider, setProvider] = useState(row?.provider ?? providers[0]?.name ?? '');
    const [group, setGroup] = useState<DnsGroupChoice | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const fixedGroup = row ? groupLabel(row.group) : null;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const apiKey = keyRef.current?.value ?? '';
        const apiSecret = secretRef.current?.value ?? '';
        if (!apiKey || !apiSecret) { setError('Enter both the API key and API secret'); return; }
        if (!row && !group) { setError('Choose a group'); return; }
        if (!provider) { setError('Choose a provider'); return; }
        setBusy(true);
        setError('');
        try {
            const saved = row
                ? await rotateDnsCredential(row, { name, api_key: apiKey, api_secret: apiSecret })
                : await linkDnsCredential({
                    group: group!.id, provider, name,
                    api_key: apiKey, api_secret: apiSecret,
                });
            queryClient.setQueryData(DnsCredentialModel.keys.one(saved.id), saved);
            toast.success(row ? 'Credential rotated and verified' : 'Credential linked and verified');
            close(saved);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'The provider rejected those credentials');
        } finally {
            if (keyRef.current) keyRef.current.value = '';
            if (secretRef.current) secretRef.current.value = '';
            await invalidateDnsCredentials(queryClient);
            setBusy(false);
        }
    };

    return (
        <form className="modal-pad" onSubmit={submit} noValidate>
            <h2 className="modal-title">{row ? `Rotate ${row.name}` : 'Link provider credential'}</h2>
            <p className="dim">
                The provider verifies this pair before it is stored. Values are never returned after submission.
            </p>
            {error && <div className="form-alert">{error}</div>}
            <div className="form-grid">
                <div className="col-12">
                    <label className="field">
                        <span className="field-label">Label</span>
                        <input className="input" value={name} placeholder="Acme GoDaddy" onChange={(event) => setName(event.target.value)} />
                    </label>
                </div>
                <div className="col-12">
                    {row ? (
                        <div className="field">
                            <span className="field-label">Group</span>
                            <div className="input" aria-readonly="true">{fixedGroup}</div>
                            <span className="field-help">Rotation keeps the existing credential scope.</span>
                        </div>
                    ) : (
                        <CollectionSelect<DnsGroupChoice>
                            endpoint={DNS_GROUP_CHOICE_ENDPOINT}
                            value={group}
                            onChange={(_id, selected) => { setGroup(selected ?? null); setError(''); }}
                            label="Group"
                            placeholder="Search eligible groups…"
                            help="Only active groups authorized for DNS credential assignment appear."
                            required
                            maxItems={25}
                            defaultParams={{ start: 0 }}
                        />
                    )}
                </div>
                <div className="col-12">
                    <label className="field">
                        <span className="field-label">Provider <em>*</em></span>
                        {row ? (
                            <div className="input" aria-readonly="true">{providerLabel(provider)}</div>
                        ) : (
                            <select className="input" value={provider} onChange={(event) => setProvider(event.target.value)}>
                                {providers.map((entry) => <option key={entry.name} value={entry.name}>{providerLabel(entry.name)}</option>)}
                            </select>
                        )}
                    </label>
                </div>
                <div className="col-12">
                    <label className="field">
                        <span className="field-label">API key <em>*</em></span>
                        <input ref={keyRef} className="input" type="password" autoComplete="new-password" spellCheck={false} />
                    </label>
                </div>
                <div className="col-12">
                    <label className="field">
                        <span className="field-label">API secret <em>*</em></span>
                        <input ref={secretRef} className="input" type="password" autoComplete="new-password" spellCheck={false} />
                    </label>
                </div>
            </div>
            <div className="modal-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy || !provider || (!row && !group)}>
                    {busy ? 'Verifying…' : row ? 'Rotate and verify' : 'Link and verify'}
                </button>
            </div>
        </form>
    );
}

async function showCredentialEditor(caps: DnsCapabilities, row?: DnsCredentialRow): Promise<DnsCredentialRow | null> {
    return modal.open<DnsCredentialRow | null>((close) => (
        <CredentialSecretForm caps={caps} row={row} close={close} />
    ), { size: 'md' });
}

function CredentialDetail({ id, caps, close }: { id: number; caps: DnsCapabilities; close: () => void }) {
    const queryClient = useQueryClient();
    const { data: row, isPending, error } = DnsCredentialModel.useOne(id);
    const { can: canManage } = useCan(DNS_MANAGE_PERMISSIONS);
    const save = DnsCredentialModel.useSave();
    const destroy = DnsCredentialModel.useDelete();
    if (isPending) return <div className="modal-pad dim">Loading credential…</div>;
    if (!row || error) return <div className="modal-pad text-bad">{error?.message ?? 'Credential not found'}</div>;

    const toggle = async () => {
        try {
            await save.mutateAsync({ id: row.id, changes: { is_active: !row.is_active } });
            toast.success(row.is_active ? 'Credential retired' : 'Credential activated');
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Credential could not be updated');
        }
    };

    const remove = async () => {
        try {
            await destroy.mutateAsync({ id: row.id });
            toast.success('Credential deleted');
            close();
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Credential could not be deleted');
        }
    };

    return (
        <div className="modal-pad">
            <div className="eyebrow">Provider credential</div>
            <h2 className="modal-title">{row.name || `Credential #${row.id}`}</h2>
            <div className="chip-row" style={{ marginBottom: 14 }}>
                <Badge tone={verificationTone(row)}>{row.verified ? 'Verified' : 'Unverified'}</Badge>
                <Badge tone={row.is_active ? 'success' : 'muted'}>{row.is_active ? 'Active' : 'Inactive'}</Badge>
                <Badge tone="warning">{providerLabel(row.provider)}</Badge>
            </div>
            <FlatRow label="Group">{groupLabel(row.group)}</FlatRow>
            <FlatRow label="API key"><code>{row.api_key_masked || '—'}</code></FlatRow>
            <FlatRow label="API secret"><code>{row.api_secret_masked || '—'}</code></FlatRow>
            <FlatRow label="Domains at verification">{row.domain_count}</FlatRow>
            <FlatRow label="Verified at">{row.verified_at ? fmt.datetime(row.verified_at) : 'Never'}</FlatRow>
            <FlatRow label="Created">{fmt.datetime(row.created)}</FlatRow>
            {row.last_error && <div className="form-alert" style={{ marginTop: 14 }}>{row.last_error}</div>}
            <p className="dim">
                The linked-domain count is a health signal only. Provider account domains are never enumerated here.
            </p>
            {canManage && (
                <div className="modal-actions">
                    <button type="button" className="btn" onClick={() => void showCredentialEditor(caps, row)}>
                        <i className="bi bi-arrow-repeat" /> Rotate
                    </button>
                    <button type="button" className="btn" disabled={save.isPending} onClick={() => void toggle()}>
                        <i className={`bi ${row.is_active ? 'bi-pause-circle' : 'bi-play-circle'}`} /> {row.is_active ? 'Retire' : 'Activate'}
                    </button>
                    <ArmedButton
                        label="Delete"
                        armedLabel="Click again — linked domains lose provider-backed DNS"
                        disabled={destroy.isPending}
                        onConfirm={remove}
                    />
                    <button type="button" className="btn" onClick={close}>Close</button>
                </div>
            )}
            {!canManage && <div className="modal-actions"><button type="button" className="btn" onClick={close}>Close</button></div>}
        </div>
    );
}

const COLUMNS: Column<DnsCredentialRow>[] = [
    {
        key: 'name', label: 'Label', sortable: true, hideable: false, render: (row) => (
            <div className="cell-user">
                <span className="cell-avatar"><i className="bi bi-key" /></span>
                <span><span className="cell-name">{row.name}</span><span className="cell-sub">#{row.id}</span></span>
            </div>
        ),
    },
    { key: 'group', label: 'Group', render: (row) => groupLabel(row.group) },
    { key: 'provider', label: 'Provider', sortable: true, render: (row) => <Badge tone="warning">{providerLabel(row.provider)}</Badge> },
    { key: 'verified', label: 'Verified', sortable: true, align: 'center', render: (row) => <Badge tone={verificationTone(row)}>{row.verified ? 'Verified' : 'Unverified'}</Badge> },
    { key: 'is_active', label: 'Active', sortable: true, align: 'center', render: (row) => <Badge tone={row.is_active ? 'success' : 'muted'}>{row.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'domain_count', label: 'Domains', sortable: true, align: 'end' },
    { key: 'last_error', label: 'Last error', render: (row) => row.last_error ? <span className="text-bad" title={row.last_error}><i className="bi bi-exclamation-triangle" /> Error</span> : '—' },
    { key: 'created', label: 'Created', sortable: true, render: (row) => fmt.date(row.created) },
];

function CredentialsTable({ caps }: { caps: DnsCapabilities }) {
    const queryClient = useQueryClient();
    const { can: canManage } = useCan(DNS_MANAGE_PERMISSIONS);
    const providers = caps.providers.map((entry) => ({ value: entry.name, label: providerLabel(entry.name) }));
    const filters: FilterDef[] = [
        { key: 'group', label: 'Group ID', type: 'number', lookup: 'exact' },
        { key: 'provider', label: 'Provider', type: 'select', options: providers },
        { key: 'verified', label: 'Verification', type: 'boolean', trueLabel: 'Verified', falseLabel: 'Unverified' },
        { key: 'is_active', label: 'Status', type: 'boolean', trueLabel: 'Active', falseLabel: 'Inactive' },
    ];
    const openDetail = (row: DnsCredentialRow) => {
        void DnsCredentialModel.fetchOne(queryClient, row.id).catch(() => undefined);
        void modal.open((done) => (
            <CredentialDetail id={row.id} caps={caps} close={() => done(null)} />
        ), { size: 'md' });
    };
    const canLink = canManage && linkableProviders(caps).length > 0;
    return (
        <>
            {canManage && !canLink && (
                <div className="panel panel-pad form-alert">
                    This deployment reports no provider that accepts linked credentials.
                </div>
            )}
            <ModelTable<DnsCredentialRow>
                model={DnsCredentialModel}
                eyebrow="Infrastructure"
                title="Provider Credentials"
                searchPlaceholder="Search label or provider…"
                columns={COLUMNS}
                filters={filters}
                presets={[
                    { key: 'all', label: 'All', params: {} },
                    { key: 'verified', label: 'Verified', params: { verified: 'true' } },
                    { key: 'attention', label: 'Needs attention', params: { verified: 'false' } },
                    { key: 'active', label: 'Active', params: { is_active: 'true' } },
                ]}
                defaultSort="name"
                columnChooser
                persistState
                persistKey="admin-dns-credentials"
                onRowClick={openDetail}
                {...(canLink ? { addLabel: 'Link Credential', onAdd: () => void showCredentialEditor(caps) } : {})}
            />
        </>
    );
}

export function ProviderCredentialsPage() {
    const { can: canView } = useCan(DNS_VIEW_PERMISSIONS);
    const caps = useDnsCapabilities(null, { enabled: canView });
    if (!canView) return <div className="panel panel-pad"><h2>DNS administration unavailable</h2><p className="dim">A global DNS authority is required.</p></div>;
    if (caps.isPending) return <div className="panel panel-pad dim">Loading DNS capabilities…</div>;
    if (caps.error || !caps.data) {
        return (
            <div className="panel panel-pad">
                <h2>DNS administration unavailable</h2>
                <p className="text-bad">{caps.error?.message ?? 'The server did not return a usable DNS capability contract.'}</p>
                <button type="button" className="btn" onClick={() => void caps.refetch()}><i className="bi bi-arrow-clockwise" /> Retry</button>
            </div>
        );
    }
    return <CredentialsTable caps={caps.data} />;
}

export const dnsCredentialGroupId = groupId;
