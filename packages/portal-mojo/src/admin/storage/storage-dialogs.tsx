import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CollectionSelect, modal } from '../../ui';
import { useCan } from '../../client';
import {
    GROUP_DIRECTORY_PERMS, USER_DIRECTORY_PERMS, SUPPORTED_FILE_MANAGER_BACKENDS,
    saveFileManagerAtomic, type FileManagerRow, type RelationRow, relationId,
} from './models';

type ManagerEditorMode = 'create' | 'general' | 'credentials' | 'owner';

function ManagerEditor({ row, mode, close }: { row: FileManagerRow | null; mode: ManagerEditorMode; close: (value: FileManagerRow | null) => void }) {
    const queryClient = useQueryClient();
    const groupDirectory = useCan(GROUP_DIRECTORY_PERMS).can;
    const userDirectory = useCan(USER_DIRECTORY_PERMS).can;
    const me = useCan([]).me;
    const inFlight = useRef(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [name, setName] = useState(row?.name ?? '');
    const [use, setUse] = useState(row?.use ?? 'uploads');
    const [backendType, setBackendType] = useState(row?.backend_type && ['file', 's3'].includes(row.backend_type) ? row.backend_type : 'file');
    const [backendUrl, setBackendUrl] = useState(row?.backend_url ?? '');
    const [active, setActive] = useState(row?.is_active ?? true);
    const [isDefault, setDefault] = useState(row?.is_default ?? false);
    const [isPublic, setPublic] = useState(row?.is_public ?? false);
    const [region, setRegion] = useState(row?.aws_region ?? '');
    const [key, setKey] = useState('');
    const [secret, setSecret] = useState('');
    const [origins, setOrigins] = useState((row?.allowed_origins ?? []).join('\n'));
    const [group, setGroup] = useState<number | null>(relationId(row?.group));
    const [user, setUser] = useState<number | null>(relationId(row?.user));
    const canSystem = Boolean(me?.is_superuser);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (inFlight.current) return;
        setError('');
        const ownerMode = mode === 'create' || mode === 'owner';
        if (ownerMode && !canSystem && group == null && user == null) { setError('Choose an authorized group or user owner.'); return; }
        if ((mode === 'create' || mode === 'general') && row && row.is_public !== isPublic) {
            const ok = await modal.confirm({ title: isPublic ? 'Make backend public?' : 'Make backend private?', message: 'This changes prefix policy on the backing storage provider. Continue only after reviewing the blast radius.', confirmText: isPublic ? 'Make public' : 'Make private', danger: isPublic });
            if (!ok) return;
        }
        const changes: Record<string, unknown> = mode === 'credentials'
            ? { aws_region: region || null, aws_key: key, aws_secret: secret, allowed_origins: origins.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) }
            : mode === 'owner'
                ? { group, user }
                : { name, use, backend_type: backendType, backend_url: backendUrl, is_active: active, is_default: isDefault, is_public: mode === 'create' ? false : isPublic, allowed_origins: origins.split(/\r?\n/).map((value) => value.trim()).filter(Boolean), ...(ownerMode ? { group, user } : {}) };
        inFlight.current = true; setBusy(true);
        try {
            const saved = await saveFileManagerAtomic({ queryClient, id: row?.id ?? null, changes, ...(ownerMode ? { expectedOwner: { group, user } } : {}) });
            close(saved);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Backend save failed');
        } finally { inFlight.current = false; setBusy(false); }
    };

    return <div className="modal-pad storage-manager-editor"><h2 className="modal-title">{mode === 'create' ? 'Create storage backend' : mode === 'credentials' ? 'Update credentials' : mode === 'owner' ? 'Change owner scope' : 'Edit storage backend'}</h2>{error && <div className="form-alert">{error}</div>}<form onSubmit={(event) => void submit(event)}>
        {(mode === 'create' || mode === 'general') && <div className="form-grid">
            <label className="field"><span className="field-label">Name</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
            <label className="field"><span className="field-label">Use</span><input value={use} onChange={(event) => setUse(event.target.value)} required /></label>
            <label className="field"><span className="field-label">Backend</span><select value={backendType} disabled={mode !== 'create'} onChange={(event) => setBackendType(event.target.value)}>{SUPPORTED_FILE_MANAGER_BACKENDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="field"><span className="field-label">Backend URL</span><input value={backendUrl} onChange={(event) => setBackendUrl(event.target.value)} required /></label>
            <label className="field switch-field"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Active</label>
            <label className="field switch-field"><input type="checkbox" checked={isDefault} onChange={(event) => setDefault(event.target.checked)} /> Default</label>
            {mode === 'general' && <label className="field switch-field"><input type="checkbox" checked={isPublic} onChange={(event) => setPublic(event.target.checked)} /> Public prefix</label>}
        </div>}
        {mode === 'credentials' && <div className="form-grid"><p className="storage-span"><b>Current key:</b> {row?.aws_key_masked || 'Not configured'} · <b>Current secret:</b> {row?.aws_secret_masked || 'Not configured'}. Blank values preserve the existing secret.</p><label className="field"><span className="field-label">AWS region</span><input value={region} onChange={(event) => setRegion(event.target.value)} /></label><label className="field"><span className="field-label">New access key</span><input value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" /></label><label className="field"><span className="field-label">New secret key</span><input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="new-password" /></label><label className="field storage-span"><span className="field-label">Allowed origins, one per line</span><textarea value={origins} onChange={(event) => setOrigins(event.target.value)} rows={4} /></label></div>}
        {(mode === 'create' || mode === 'owner') && <div className="storage-owner-grid">{groupDirectory && <CollectionSelect<RelationRow> endpoint="/api/group" value={group} onChange={(id) => { setGroup(id == null ? null : Number(id)); if (id != null) setUser(null); }} label="Group owner" placeholder="Search authorized groups" />}{userDirectory && <CollectionSelect<RelationRow> endpoint="/api/user" value={user} onChange={(id) => { setUser(id == null ? null : Number(id)); if (id != null) setGroup(null); }} label="User owner" labelField="display_name" placeholder="Search authorized users" />}{canSystem && <button type="button" className="btn" onClick={() => { setGroup(null); setUser(null); }}>Use System scope</button>}</div>}
        <div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
    </form></div>;
}

export function openFileManagerEditor(mode: ManagerEditorMode, row: FileManagerRow | null = null): Promise<FileManagerRow | null> {
    return modal.open<FileManagerRow>((close) => <ManagerEditor row={row} mode={mode} close={(value) => close(value as FileManagerRow)} />).then((value) => value ?? null);
}
