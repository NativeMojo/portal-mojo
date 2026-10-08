import { SECURITY_MANAGE_PERMS } from '../security-permissions';

// Imported by the security domain's section file, so this module stays free
// of the DNS models; the vhost clauses are re-exported from ./models.

/**
 * `BlocklistEntry.RestMeta.VIEW_PERMS = ["view_security","manage_security","security"]`.
 * Wider than `SECURITY_VIEW_PERMS`, which omits `manage_security`: manage does
 * not imply view on the client, so the server's own clause is spelled out.
 */
export const EDGE_BLOCKLIST_VIEW_PERMS = ['sys.view_security', 'sys.manage_security', 'sys.security'];
/** SAVE_PERMS and DELETE_PERMS are both `["manage_security","security"]`. */
export const EDGE_BLOCKLIST_MANAGE_PERMS = SECURITY_MANAGE_PERMS;
