// Sys Perms / App Perms — UserPermissionsSection port (read in full
// 2026-08-05): one autosaving FormView wrapping a single tabset. Flip a
// switch → FormView batches `{"permissions.<name>": true}` into ONE save →
// django-mojo dict-MERGES it into the permissions JSONField, so absent keys
// keep their grants.
//
// "Sys Perms" always renders (SYSTEM_PERMISSION_TABS — the framework
// catalog); "App Perms" renders only when the app registered tabs under
// USER_APP_PERMS_TABSET via registerFormTabs — the portal's
// User.registerPermissions equivalent (UserDetail gates the section on the
// registry being non-empty).
//
// Above the catalog, "Custom permissions" lists every granted key the
// catalogs don't know (set by scripts, other apps, older catalogs) with
// add/remove. django-mojo User.set_permissions DELETES a key on a falsy
// value, so remove = `{permissions: {key: false}}`.
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { ArmedButton, Eyebrow, FormView, getFormTabs, subscribeFormTabs, toast } from '../../../../ui';
import { UserModel, type UserRow } from '../models';
import {
    CATEGORY_PERMISSIONS,
    GRANULAR_PERMISSION_TABS,
    SYSTEM_PERMISSION_TABS,
    USER_APP_PERMS_TABSET,
} from './permission-catalog';

const SYSTEM_KEYS = new Set([
    ...CATEGORY_PERMISSIONS.map((p) => p.name),
    ...GRANULAR_PERMISSION_TABS.flatMap((t) => t.permissions.map((p) => p.name)),
]);
const PERM_KEY_RE = /^[a-z][a-z0-9_.:-]{0,63}$/;

/** Every `permissions.<key>` an app registered under the App Perms tabset. */
function useAppPermKeys(): string {
    return useSyncExternalStore(
        subscribeFormTabs,
        () => getFormTabs(USER_APP_PERMS_TABSET)
            .flatMap((t) => t.fields.map((f) => f.name))
            .filter((n) => n.startsWith('permissions.'))
            .map((n) => n.slice('permissions.'.length))
            .join(','),
        () => '',
    );
}

export function SysPermsSection({ user }: { user: UserRow }) {
    const appKeys = new Set(useAppPermKeys().split(',').filter(Boolean));
    const perms = user.permissions ?? {};
    const granted = Object.keys(perms).filter((k) => Boolean(perms[k])).sort();
    const custom = Object.keys(perms).filter((k) => !SYSTEM_KEYS.has(k) && !appKeys.has(k)).sort();
    return (
        <>
            <Eyebrow>Granted ({granted.length})</Eyebrow>
            <div className="perm-granted">
                {granted.length === 0
                    ? <span className="dim">No system-level permissions granted.</span>
                    : granted.map((k) => (
                        <code key={k} className={`perm-key${SYSTEM_KEYS.has(k) ? '' : appKeys.has(k) ? ' perm-key-app' : ' perm-key-custom'}`}>{k}</code>
                    ))}
            </div>

            <Eyebrow>Custom permissions</Eyebrow>
            <CustomPermissions user={user} keys={custom} known={(k) => SYSTEM_KEYS.has(k) || appKeys.has(k)} />

            <Eyebrow>System permissions</Eyebrow>
            <p className="dim" style={{ margin: '0 0 12px' }}>Toggles autosave as soon as you flip them.</p>
            <FormView model={UserModel} row={user} tabs={SYSTEM_PERMISSION_TABS} />
        </>
    );
}

function CustomPermissions({ user, keys, known }: { user: UserRow; keys: string[]; known: (key: string) => boolean }) {
    const save = UserModel.useSave();
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const perms = user.permissions ?? {};

    const write = async (key: string, value: boolean) => {
        setBusy(key);
        try {
            await save.mutateAsync({ id: user.id, changes: { permissions: { [key]: value } } });
            toast.success(value ? `Granted ${key}` : `Removed ${key}`);
            return true;
        } catch (err) {
            toast.error(err instanceof Error ? err.message : `Failed to update ${key}`);
            return false;
        } finally {
            setBusy(null);
        }
    };

    const key = draft.trim().toLowerCase();
    const error = !key ? null
        : !PERM_KEY_RE.test(key) ? 'Use lowercase letters, digits, and _ . : -'
        : key === 'protected' ? 'Reserved key'
        : known(key) ? 'Already in the catalog above — use its toggle'
        : perms[key] ? 'Already granted'
        : null;
    const onAdd = async (e: FormEvent) => {
        e.preventDefault();
        if (!key || error) return;
        if (await write(key, true)) setDraft('');
    };

    return (
        <div className="perm-custom">
            <p className="dim" style={{ margin: '0 0 10px' }}>Keys outside the catalog below — set by other apps, scripts, or older releases.</p>
            {keys.length === 0
                ? null
                : (
                    <div className="perm-custom-list">
                        {keys.map((k) => {
                            const v = perms[k];
                            return (
                                <div key={k} className="perm-custom-row">
                                    <code className="perm-key perm-key-custom">{k}</code>
                                    {v !== true && <span className="dim perm-custom-value" title="Stored value">{JSON.stringify(v)}</span>}
                                    <ArmedButton
                                        className="btn btn-compact"
                                        icon="bi-x-lg"
                                        label="Remove"
                                        armedLabel="Confirm remove"
                                        disabled={busy !== null}
                                        onConfirm={async () => { await write(k, false); }}
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}
            <form className="perm-custom-add" onSubmit={(e) => void onAdd(e)}>
                <input
                    className="input"
                    placeholder="permission_key"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    aria-label="New permission key"
                    aria-invalid={error ? true : undefined}
                    disabled={busy !== null}
                    spellCheck={false}
                    autoCapitalize="off"
                />
                <button className="btn btn-primary" type="submit" disabled={!key || Boolean(error) || busy !== null}>
                    <i className="bi bi-plus-lg" /> Grant
                </button>
            </form>
            {error && <p className="field-error" style={{ margin: '4px 0 0' }}>{error}</p>}
        </div>
    );
}

export function AppPermsSection({ user }: { user: UserRow }) {
    return (
        <>
            <Eyebrow>Product permissions</Eyebrow>
            <p className="dim" style={{ margin: '0 0 12px' }}>User grants can apply across groups. To give access to just one group, edit that membership instead. Changes save automatically.</p>
            {/* Registry NAME (not a snapshot) so late registrations re-render. */}
            <FormView model={UserModel} row={user} tabs={USER_APP_PERMS_TABSET} />
        </>
    );
}
