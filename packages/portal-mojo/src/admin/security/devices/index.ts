// Devices & Logins — the fleet-wide, groupless device and login-location
// triage surfaces. Sibling of Bouncer under Security so the PRE-auth
// (`BouncerDevice.muid`) and POST-auth (`UserDevice.muid`) views of the same
// physical browser sit next to each other.
//
// This module OWNS `/api/user/device`, `/api/user/device/location` and
// `/api/account/logins`; `admin/identity/users` re-exports those models
// rather than defining them a second time.
import type { AdminSection } from '../../index';
import { LoginLocationsPage } from './LoginLocationsPage';
import { UserDevicesPage } from './UserDevicesPage';
import { LOGIN_EVENT_VIEW_PERMS, USER_DEVICE_VIEW_PERMS } from './models';

export * from './models';
export * from './LoginLocationMap';
export * from './LoginLocationsPage';
export * from './UserDevicesPage';
export * from './UserDeviceDetail';
export * from './UserDeviceLocationDetail';
export * from './LoginEventDetail';

/** Section gate = the union of its routes' clauses (each route re-applies its own). */
export const DEVICE_INTEL_ADMIN_SECTION: AdminSection = {
    id: 'device-intel',
    basePath: 'security/devices',
    title: 'Devices & Logins',
    icon: 'bi-laptop',
    navigationGroup: 'security',
    permissions: [...new Set([...USER_DEVICE_VIEW_PERMS, ...LOGIN_EVENT_VIEW_PERMS])],
    routes: [
        {
            path: 'user-devices', label: 'User Devices',
            component: UserDevicesPage, permissions: USER_DEVICE_VIEW_PERMS,
        },
        {
            path: 'login-locations', label: 'Login Locations',
            component: LoginLocationsPage, permissions: LOGIN_EVENT_VIEW_PERMS,
        },
    ],
};
