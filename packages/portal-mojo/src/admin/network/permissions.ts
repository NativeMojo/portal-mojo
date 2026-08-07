import { SECURITY_DELETE_PERMS, SECURITY_MANAGE_PERMS, SECURITY_VIEW_PERMS } from '../security-permissions';

/** `IPSet.RestMeta.VIEW_PERMS = ["view_security","security"]`. */
export const IPSET_VIEW_PERMS = SECURITY_VIEW_PERMS;
/** `IPSet.RestMeta.SAVE_PERMS = ["manage_security","security"]`. */
export const IPSET_MANAGE_PERMS = SECURITY_MANAGE_PERMS;
/** `IPSet.RestMeta.DELETE_PERMS = ["manage_security"]` — deliberately narrower. */
export const IPSET_DELETE_PERMS = SECURITY_DELETE_PERMS;
