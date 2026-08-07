import { SECURITY_VIEW_PERMS } from '../../security-permissions';

/** `@md.requires_global_perms("view_geofence","manage_geofence","security")`. */
export const GEOFENCE_VIEW_PERMS = ['sys.view_geofence', 'sys.manage_geofence', 'sys.security'];

/** `@md.requires_global_perms("manage_geofence","security")` — POST/DELETE. */
export const GEOFENCE_MANAGE_PERMS = ['sys.manage_geofence', 'sys.security'];

/** Event-backed geofence views retain the stricter security permission gate. */
export const SECURITY_EVENTS_PERMS = SECURITY_VIEW_PERMS;

/** Group-layer editing also accepts the group-management grants. */
export const GROUP_GEOFENCE_EDIT_PERMS = ['sys.manage_geofence', 'sys.security', 'sys.manage_groups', 'sys.groups'];
