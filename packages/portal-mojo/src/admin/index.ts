// Compatibility aggregate: every historical named export remains available
// here. Importing it intentionally installs the legacy DNS and Rule field
// registrations; use admin/core or a domain subpath for a narrow entry.
export * from './core';
export * from './credentials';
export * from './monitoring';
export * from './cloudwatch';
export * from './settings';
export * from './bouncer';
export * from './security-permissions';
export * from './security';
export * from './incidents';
export * from './rules';
export * from './identity';
export * from './jobs';
export * from './network';
export * from './dns';
export * from './storage';
export * from './shortlinks';
export * from './messaging';
export * from './phonehub';
export * from './dashboard';
export * from './assistant';

import type { AdminSection } from './core';
import { DASHBOARD_ADMIN_SECTION, MONITORING_ADMIN_SECTION, CLOUDWATCH_ADMIN_SECTION } from './domains/observability';
import { USERS_ADMIN_SECTION, MEMBERS_ADMIN_SECTION, CREDENTIALS_ADMIN_SECTION } from './domains/identity';
import { SETTINGS_ADMIN_SECTION, JOBS_ADMIN_SECTION } from './domains/operations';
import {
    SECURITY_OPERATIONS_ADMIN_SECTION, BOUNCER_ADMIN_SECTION,
    DEVICE_INTEL_ADMIN_SECTION, GEOIP_ADMIN_SECTION, NETWORK_SECURITY_ADMIN_SECTION,
} from './domains/security';
import { DNS_ADMIN_SECTION, STORAGE_ADMIN_SECTION } from './domains/infrastructure';
import {
    SHORTLINKS_ADMIN_SECTION, EMAIL_ADMIN_SECTION, PUBLIC_MESSAGES_ADMIN_SECTION,
    PUSH_ADMIN_SECTION, PHONE_HUB_ADMIN_SECTION,
} from './domains/communications';
import { ASSISTANT_ADMIN_SECTION } from './domains/assistant';

/** Stable historical order; menus, denied fallback and first-visible routing depend on it. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
    DASHBOARD_ADMIN_SECTION,
    USERS_ADMIN_SECTION,
    MEMBERS_ADMIN_SECTION,
    CREDENTIALS_ADMIN_SECTION,
    MONITORING_ADMIN_SECTION,
    CLOUDWATCH_ADMIN_SECTION,
    SETTINGS_ADMIN_SECTION,
    SECURITY_OPERATIONS_ADMIN_SECTION,
    BOUNCER_ADMIN_SECTION,
    DEVICE_INTEL_ADMIN_SECTION,
    GEOIP_ADMIN_SECTION,
    JOBS_ADMIN_SECTION,
    NETWORK_SECURITY_ADMIN_SECTION,
    DNS_ADMIN_SECTION,
    STORAGE_ADMIN_SECTION,
    SHORTLINKS_ADMIN_SECTION,
    EMAIL_ADMIN_SECTION,
    PUBLIC_MESSAGES_ADMIN_SECTION,
    PUSH_ADMIN_SECTION,
    PHONE_HUB_ADMIN_SECTION,
    ASSISTANT_ADMIN_SECTION,
];
