import { useQueryClient } from '@tanstack/react-query';
import {
    Badge, DetailView, Eyebrow, FlatRow, ModelTable, SchemaForm,
    fmt, modal, toast,
    type BatchAction, type Column, type Field, type FilterDef, type FormData,
} from '../../ui';
import { useCan } from '../../client';
import {
    BOUNCER_MANAGE_PERMS, BOUNCER_SIGNATURE_TYPES, BotSignatureModel,
    type BotSignatureRow, type BotSignatureType,
} from './models';

const SIGNATURE_FIELDS: Field[] = [
    {
        name: 'sig_type', type: 'select', label: 'Signature type', required: true, columns: 6,
        options: BOUNCER_SIGNATURE_TYPES.map((option) => ({ ...option })),
    },
    {
        name: 'value', type: 'text', label: 'Value', required: true, columns: 6,
        help: 'The exact value or pattern evaluated by this signature type.',
    },
    {
        name: 'confidence', type: 'text', label: 'Confidence (0–100)', required: true, columns: 6,
        placeholder: '80',
    },
    {
        name: 'expires_at', type: 'datetimepicker', label: 'Expires', columns: 6,
        help: 'Optional for manual signatures; leave empty for no expiry.',
    },
    { name: 'notes', type: 'textarea', label: 'Notes' },
    { name: 'is_active', type: 'switch', label: 'Active' },
];

function signatureType(value: unknown): BotSignatureType {
    const candidate = String(value ?? '');
    const exact = BOUNCER_SIGNATURE_TYPES.find((option) => option.value === candidate);
    if (!exact) throw new Error('Choose a valid signature type');
    return exact.value;
}

function optionalEpoch(value: unknown): number | null {
    if (value == null || value === '') return null;
    const epoch = Number(value);
    if (!Number.isFinite(epoch) || epoch <= 0) throw new Error('Choose a valid expiry');
    return epoch;
}

function signatureChanges(data: FormData, creating: boolean): Record<string, unknown> {
    const value = String(data.value ?? '').trim();
    if (!value) throw new Error('Value is required');
    const confidence = Number(String(data.confidence ?? '').trim());
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
        throw new Error('Confidence must be a number from 0 to 100');
    }
    return {
        sig_type: signatureType(data.sig_type),
        value,
        confidence,
        expires_at: optionalEpoch(data.expires_at),
        notes: String(data.notes ?? ''),
        is_active: data.is_active === true,
        ...(creating ? { source: 'manual' as const } : {}),
    };
}

function SignatureEditor({ row, close }: {
    row?: BotSignatureRow;
    close: (saved: boolean) => void;
}) {
    const save = BotSignatureModel.useSave();
    const creating = row == null;
    const initial: FormData = creating
        ? { sig_type: 'ip', confidence: 80, expires_at: null, notes: '', is_active: true }
        : {
            sig_type: row.sig_type,
            value: row.value,
            confidence: row.confidence,
            expires_at: row.expires_at,
            notes: row.notes ?? '',
            is_active: row.is_active,
        };
    return (
        <div className="modal-pad">
            <h2 className="modal-title">{creating ? 'Create manual bot signature' : 'Edit bot signature'}</h2>
            {!creating && (
                <p className="dim">
                    Source <Badge tone={row.source === 'auto' ? 'info' : 'primary'}>{row.source.toUpperCase()}</Badge>
                    {' '}· hits {row.hit_count} · blocks {row.block_count ?? 0}
                </p>
            )}
            <SchemaForm
                fields={SIGNATURE_FIELDS}
                initial={initial}
                submitText={creating ? 'Create signature' : 'Save changes'}
                onCancel={() => close(false)}
                onSubmit={async (data) => {
                    await save.mutateAsync({
                        id: row?.id ?? null,
                        changes: signatureChanges(data, creating),
                    });
                    toast.success(creating ? 'Bot signature created' : 'Bot signature updated');
                    close(true);
                }}
            />
        </div>
    );
}

async function openSignatureEditor(row?: BotSignatureRow): Promise<void> {
    await modal.open<boolean>((close) => <SignatureEditor row={row} close={close} />, { size: 'lg' });
}

function SignatureDetail({ row, onClose }: { row: BotSignatureRow; onClose: () => void }) {
    return (
        <DetailView
            icon="bi-shield-check"
            title={row.value}
            subtitle={`Bot signature #${row.id}`}
            chips={[
                { text: row.sig_type, tone: 'info' },
                { text: row.source.toUpperCase(), tone: row.source === 'auto' ? 'info' : 'primary' },
                { text: row.is_active ? 'ACTIVE' : 'INACTIVE', tone: row.is_active ? 'success' : 'muted' },
            ]}
            sections={[
                {
                    key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => (
                        <>
                            <Eyebrow>Signature</Eyebrow>
                            <FlatRow label="Type">{row.sig_type}</FlatRow>
                            <FlatRow label="Value"><code>{row.value}</code></FlatRow>
                            <FlatRow label="Source">{row.source}</FlatRow>
                            <FlatRow label="Confidence">{row.confidence}%</FlatRow>
                            <FlatRow label="Hits">{row.hit_count}</FlatRow>
                            <FlatRow label="Blocks">{row.block_count ?? 0}</FlatRow>
                            <FlatRow label="Expires">{row.expires_at == null ? 'Never' : fmt.datetime(row.expires_at)}</FlatRow>
                            <FlatRow label="Modified">{fmt.datetime(row.modified)}</FlatRow>
                            <Eyebrow>Notes</Eyebrow>
                            <p className={row.notes ? undefined : 'dim-italic'}>{row.notes || 'No notes.'}</p>
                        </>
                    ),
                },
            ]}
            onClose={onClose}
        />
    );
}

const SIGNATURE_COLUMNS: Column<BotSignatureRow>[] = [
    { key: 'sig_type', label: 'Type', sortable: true, render: (row) => <Badge tone="info">{row.sig_type}</Badge> },
    { key: 'value', label: 'Value', hideable: false, render: (row) => <code title={row.value}>{fmt.truncate(row.value, 60)}</code> },
    { key: 'source', label: 'Source', render: (row) => <Badge tone={row.source === 'auto' ? 'info' : 'primary'}>{row.source.toUpperCase()}</Badge> },
    { key: 'confidence', label: 'Confidence', sortable: true, align: 'end', render: (row) => `${row.confidence}%` },
    { key: 'hit_count', label: 'Hits', sortable: true, align: 'end' },
    { key: 'is_active', label: 'Status', render: (row) => <Badge tone={row.is_active ? 'success' : 'muted'}>{row.is_active ? 'ON' : 'OFF'}</Badge> },
    { key: 'expires_at', label: 'Expires', sortable: true, render: (row) => row.expires_at == null ? 'Never' : fmt.datetime(row.expires_at) },
];

const SIGNATURE_FILTERS: FilterDef[] = [
    { key: 'sig_type', label: 'Type', type: 'select', options: BOUNCER_SIGNATURE_TYPES.map((option) => ({ ...option })) },
    { key: 'value', label: 'Value', type: 'text' },
    { key: 'source', label: 'Source', type: 'select', options: [
        { value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Manual' },
    ] },
    { key: 'is_active', label: 'Status', type: 'boolean', trueLabel: 'Active', falseLabel: 'Inactive' },
    { key: 'expires_at', label: 'Expires', type: 'daterange' },
];

export function BotSignaturesPage() {
    const queryClient = useQueryClient();
    const save = BotSignatureModel.useSave();
    const destroy = BotSignatureModel.useDelete();
    const { can: canManage } = useCan(BOUNCER_MANAGE_PERMS);

    const batchActions: BatchAction<BotSignatureRow>[] = canManage ? [
        {
            key: 'enable', label: 'Enable', icon: 'bi-check-circle',
            run: (row) => save.mutateAsync({ id: row.id, changes: { is_active: true } }),
        },
        {
            key: 'disable', label: 'Disable', icon: 'bi-pause-circle',
            run: (row) => save.mutateAsync({ id: row.id, changes: { is_active: false } }),
        },
        {
            key: 'delete', label: 'Delete', icon: 'bi-trash', danger: true,
            confirm: 'Delete the selected bot signatures? This cannot be undone.',
            run: (row) => destroy.mutateAsync({ id: row.id }),
        },
    ] : [];

    const openRow = async (row: BotSignatureRow) => {
        try {
            const detailed = await BotSignatureModel.fetchOne(queryClient, row.id);
            if (canManage) await openSignatureEditor(detailed);
            else await modal.detail((close) => <SignatureDetail row={detailed} onClose={() => close(null)} />);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to load bot signature');
        }
    };

    return (
        <ModelTable<BotSignatureRow>
            model={BotSignatureModel}
            eyebrow="Security · Bouncer"
            title="Bot Signatures"
            searchPlaceholder="Search signature type, value, or source"
            columns={SIGNATURE_COLUMNS}
            filters={SIGNATURE_FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'active', label: 'Active', params: { is_active: 'true' } },
                { key: 'manual', label: 'Manual', params: { source: 'manual' } },
                { key: 'auto', label: 'Auto', params: { source: 'auto' } },
            ]}
            defaultSort="-modified"
            columnChooser
            persistState
            persistKey="admin:bouncer:signatures"
            exportFormats={['csv', 'json']}
            selectable={canManage}
            batchActions={batchActions}
            addLabel="New Signature"
            onAdd={canManage ? () => void openSignatureEditor() : undefined}
            onRowClick={(row) => void openRow(row)}
        />
    );
}
