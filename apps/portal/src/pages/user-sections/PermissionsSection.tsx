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
import { Eyebrow, FormView } from 'portal-mojo/ui';
import { UserModel, type UserRow } from '../../models';
import { SYSTEM_PERMISSION_TABS, USER_APP_PERMS_TABSET } from './permission-catalog';

export function SysPermsSection({ user }: { user: UserRow }) {
    return (
        <>
            <Eyebrow>System permissions</Eyebrow>
            <p className="dim" style={{ margin: '0 0 12px' }}>Toggles autosave as soon as you flip them.</p>
            <FormView model={UserModel} row={user} tabs={SYSTEM_PERMISSION_TABS} />
        </>
    );
}

export function AppPermsSection({ user }: { user: UserRow }) {
    return (
        <>
            <Eyebrow>App permissions</Eyebrow>
            <p className="dim" style={{ margin: '0 0 12px' }}>Toggles autosave as soon as you flip them.</p>
            {/* Registry NAME (not a snapshot) so late registrations re-render. */}
            <FormView model={UserModel} row={user} tabs={USER_APP_PERMS_TABSET} />
        </>
    );
}
