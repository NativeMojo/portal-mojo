// Devices & Logins — the fleet-wide, groupless device and login-location
// triage surfaces. Sibling of Bouncer under Security so the PRE-auth
// (`BouncerDevice.muid`) and POST-auth (`UserDevice.muid`) views of the same
// physical browser sit next to each other.
//
// This module OWNS `/api/user/device`, `/api/user/device/location` and
// `/api/account/logins`; `admin/identity/users` re-exports those models
// rather than defining them a second time.

export * from './models';
export * from './LoginLocationMap';
export * from './LoginLocationsPage';
export * from './UserDevicesPage';
export * from './UserDeviceDetail';
export * from './UserDeviceLocationDetail';
export * from './LoginEventDetail';

/** Section gate = the union of its routes' clauses (each route re-applies its own). */
export { DEVICE_INTEL_ADMIN_SECTION } from '../../domains/security';
