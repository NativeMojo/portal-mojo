// group-sections/IdentitySection.tsx — GroupIdentitySection port
// (GroupView.js:354-731) at source fidelity, in the house autosave idiom:
// web-mojo's pencil-prompt-per-row grid collapses into ONE FormView autosave
// surface carrying the safely editable fields — name, kind (combo over
// the full known-kind catalog + free entry), uuid, and the metadata.*
// settings (timezone / short_name / domain /
// auth_domain / portal / email_template). Dotted names → partial dicts →
// the backend's JSONField dict-merge, so editing one key never clobbers the
// rest of metadata.
//
// Parent assignment stays read-only until the backend can reject hierarchy
// cycles. Existing parents may only be cleared to the top level. EOD hour
// lives outside FormView because the source saved a NUMBER (0–23, or null
// to clear) and
//     select values ride the form pipeline as strings.
//
// UUID extras (source onActionGenerateUuid): when unset, a Generate button
// mints backend-shaped `uuid4().hex` (32 lowercase hex chars, no hyphens)
// after a confirm.
import {
    Badge, Eyebrow, FlatRow, FormView,
    fmt, modal, toast, type Field,
} from 'portal-mojo/ui';
import { GroupModel, type GroupRow } from '../../models';
import { EOD_HOUR_OPTIONS, GROUP_KIND_COMBO_OPTIONS, kindLabel } from './models';

const IDENTITY_FIELDS: Field[] = [
    { name: 'name', type: 'text', label: 'Name', columns: 6 },
    {
        name: 'kind', type: 'combo', label: 'Kind', columns: 6,
        options: GROUP_KIND_COMBO_OPTIONS, placeholder: 'Type or pick a kind…',
        help: 'Drives sidebar context; free-typed kinds are allowed.',
    },
    {
        name: 'uuid', type: 'text', label: 'UUID', columns: 6,
        placeholder: '32-character hex string',
    },
];

const SETTINGS_FIELDS: Field[] = [
    { name: 'metadata.timezone', type: 'timezone', label: 'Timezone', columns: 6 },
    { name: 'metadata.short_name', type: 'text', label: 'Short name', columns: 6 },
    { name: 'metadata.domain', type: 'text', label: 'Domain', columns: 6, placeholder: 'example.com' },
    {
        name: 'metadata.auth_domain', type: 'text', label: 'Auth domain', columns: 6,
        placeholder: 'auth.example.com', help: 'Used for white-label login pages.',
    },
    { name: 'metadata.portal', type: 'text', label: 'Portal URL', columns: 6, placeholder: 'https://…' },
    {
        name: 'metadata.email_template', type: 'text', label: 'Email template', columns: 6,
        placeholder: 'Template prefix',
    },
];

/** Backend-shaped uuid4().hex: 32 lowercase hex chars, no hyphens. */
function generateUuidHex(): string | null {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID().replace(/-/g, '');
        }
        if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
        }
    } catch {
        // fall through
    }
    return null;
}

function shown(value: unknown): string {
    return value == null || value === '' ? 'Not set' : String(value);
}

export function IdentitySection({ group, editable }: { group: GroupRow; editable: boolean }) {
    const save = GroupModel.useSave();

    const eodRaw = group.metadata?.eod_hour;
    const eodHour = typeof eodRaw === 'number' ? eodRaw
        : typeof eodRaw === 'string' && eodRaw !== '' ? Number(eodRaw)
        : null;
    const eodValid = eodHour !== null && Number.isFinite(eodHour) && eodHour >= 0 && eodHour <= 23;
    if (eodHour !== null && !eodValid) {
        console.warn(`IdentitySection: metadata.eod_hour ${JSON.stringify(eodRaw)} is not 0–23 — showing "Not set"`);
    }

    const saveEod = async (raw: string) => {
        // '' clears (null deletes the key under the JSONField merge); numbers
        // ride the wire as real numbers (source parity — never "17" strings).
        const next = raw === '' ? null : Math.max(0, Math.min(23, Number(raw)));
        try {
            await save.mutateAsync({ id: group.id, changes: { metadata: { eod_hour: next } } });
            toast.success('EOD hour updated');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update EOD hour');
        }
    };

    const clearParent = async () => {
        try {
            await save.mutateAsync({ id: group.id, changes: { parent: null } });
            toast.success('Parent cleared — now a top-level group');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update parent');
        }
    };

    const generateUuid = async () => {
        const generated = generateUuidHex();
        if (!generated) {
            toast.error('UUID generation not supported in this browser');
            return;
        }
        const ok = await modal.confirm({
            title: 'Generate UUID',
            message: <>Generate a new UUID for this group?<br /><code>{generated}</code></>,
            confirmText: 'Generate',
        });
        if (!ok) return;
        try {
            await save.mutateAsync({ id: group.id, changes: { uuid: generated } });
            toast.success('UUID updated');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update UUID');
        }
    };

    return (
        <>
            <Eyebrow>Profile</Eyebrow>
            {editable ? (
                <>
                    <p className="dim" style={{ margin: '0 0 12px' }}>Edits save on commit — no save button.</p>
                    <FormView model={GroupModel} row={group} fields={IDENTITY_FIELDS} />
                </>
            ) : (
                <>
                    <FlatRow label="Name">{group.name}</FlatRow>
                    <FlatRow label="Kind">{shown(group.kind)}</FlatRow>
                    <FlatRow label="UUID"><code>{shown(group.uuid)}</code></FlatRow>
                </>
            )}
            {editable && !group.uuid && (
                <button className="btn btn-compact" style={{ marginTop: 4 }} onClick={() => void generateUuid()}>
                    <i className="bi bi-shuffle" /> Generate UUID
                </button>
            )}
            <div className="ga-parent-row">
                <FlatRow label="Parent group">
                    <span>{group.parent?.name ?? 'None — top-level group'}</span>
                    {editable && group.parent?.id && (
                        <button className="btn btn-compact" style={{ marginLeft: 10 }} onClick={() => void clearParent()}>
                            <i className="bi bi-x-circle" /> Clear to top-level
                        </button>
                    )}
                </FlatRow>
                {editable && group.parent?.id && (
                    <p className="field-help">Assigning or changing a parent is unavailable until the server validates hierarchy cycles.</p>
                )}
            </div>

            <Eyebrow>Settings</Eyebrow>
            {editable ? (
                <FormView model={GroupModel} row={group} fields={SETTINGS_FIELDS} />
            ) : (
                <>
                    <FlatRow label="Timezone">{shown(group.metadata?.timezone)}</FlatRow>
                    <FlatRow label="Short name">{shown(group.metadata?.short_name)}</FlatRow>
                    <FlatRow label="Domain">{shown(group.metadata?.domain)}</FlatRow>
                    <FlatRow label="Auth domain">{shown(group.metadata?.auth_domain)}</FlatRow>
                    <FlatRow label="Portal URL">{shown(group.metadata?.portal)}</FlatRow>
                    <FlatRow label="Email template">{shown(group.metadata?.email_template)}</FlatRow>
                </>
            )}
            <div className="ga-eod-row">
                {editable ? (
                    <label className="field">
                        <span className="field-label">EOD hour</span>
                        <select
                            className="input"
                            value={eodValid ? String(eodHour) : ''}
                            onChange={(e) => void saveEod(e.target.value)}
                        >
                            <option value="">Not set</option>
                            {EOD_HOUR_OPTIONS.map((o) => (
                                <option key={o.value} value={String(o.value)}>
                                    {String(o.value).padStart(2, '0')}:00 — {o.label}
                                </option>
                            ))}
                        </select>
                        <span className="field-help">Hour of the day (24h) when this group rolls over.</span>
                    </label>
                ) : (
                    <FlatRow label="EOD hour">{eodValid ? `${String(eodHour).padStart(2, '0')}:00` : 'Not set'}</FlatRow>
                )}
            </div>

            <Eyebrow>Record</Eyebrow>
            <FlatRow label="ID"><code>{group.id}</code></FlatRow>
            <FlatRow label="Status">
                <Badge tone={group.is_active ? 'success' : 'muted'}>{group.is_active ? 'Active' : 'Inactive'}</Badge>
            </FlatRow>
            <FlatRow label="Kind">
                {group.kind ? <Badge tone="primary">{kindLabel(group.kind)}</Badge> : <span className="dim-italic">Not set</span>}
            </FlatRow>
            <FlatRow label="Created"><code>{fmt.datetime(group.created)}</code></FlatRow>
            <FlatRow label="Modified"><code>{fmt.datetime(group.modified)}</code></FlatRow>
        </>
    );
}
