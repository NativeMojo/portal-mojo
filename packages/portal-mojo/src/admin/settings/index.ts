import { SETTINGS_PERMISSIONS } from './model';
import { SettingsPage } from './SettingsPage';

export * from './model';
export * from './SettingEditor';
export * from './SettingsPage';
export * from './SettingDetail';

/** Structurally satisfies AdminSection without importing the parent barrel. */
export const SETTINGS_ADMIN_SECTION = {
    id: 'settings',
    title: 'Settings',
    icon: 'bi-gear',
    navigationGroup: 'operations' as const,
    permissions: SETTINGS_PERMISSIONS,
    routes: [
        { path: '', component: SettingsPage, permissions: SETTINGS_PERMISSIONS },
    ],
};
