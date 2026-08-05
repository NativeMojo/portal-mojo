// The system permission catalog — web-mojo's User.CATEGORY_PERMISSIONS +
// GRANULAR_PERMISSION_TABS carried VERBATIM (src/core/models/User.js:76-149,
// read in full 2026-08-05), expressed as FormView tabsets instead of the
// live-mutated arrays the do-not-recreate list retires.
//
// Sys Perms section == User.SYSTEM_PERMISSION_FIELDS: ONE tabset — the
// System category tab + each granular domain tab. App Perms section ==
// User.APP_PERMISSION_FIELDS: whatever the app registered under the
// USER_APP_PERMS_TABSET registry name (registerFormTabs is the portal's
// User.registerPermissions equivalent) — the section renders only when that
// registry is non-empty, mirroring `User.APP_PERMISSION_FIELDS.length > 0`.
//
// Every switch autosaves a dotted `permissions.<name>` key — FormView
// expands it to a partial dict and django-mojo MERGES it into the
// permissions JSONField (rest.py on_rest_update_jsonfield), so absent keys
// keep their grants.
import type { Field } from 'portal-mojo/client';
import type { FormTab } from 'portal-mojo/ui';

interface CatalogPerm {
    name: string;
    label: string;
    tooltip?: string;
}

/** Category permissions (broad domain-level access) — source verbatim. */
export const CATEGORY_PERMISSIONS: CatalogPerm[] = [
    { name: 'admin', label: 'System Admin', tooltip: 'Full access to everything — permission equivalent of superuser' },
    { name: 'view_admin', label: 'Admin Panel', tooltip: 'Access the admin panel, Mojo, and system tools' },
    { name: 'security', label: 'Security', tooltip: 'Incidents, events, rules, tickets, firewall, bouncer, GeoIP, system logs' },
    { name: 'users', label: 'Users', tooltip: 'User records, passkeys, TOTP, API keys, OAuth, devices, locations' },
    { name: 'groups', label: 'Groups', tooltip: 'Groups, members, group API keys, settings' },
    { name: 'comms', label: 'Communications', tooltip: 'Email, phone, SMS, push notifications, chat, notifications' },
    { name: 'jobs', label: 'Jobs', tooltip: 'Jobs, job events, job logs, runners, queue control, system stats' },
    { name: 'metrics', label: 'Metrics', tooltip: 'Metrics recording, fetching, categories, values, permissions' },
    { name: 'files', label: 'Files', tooltip: 'File managers, files, renditions, vault files, vault data, S3 buckets' },
    { name: 'assistant', label: 'Mojo', tooltip: 'Access to Mojo' },
];

/** Granular view/manage pairs by domain tab — source verbatim. */
export const GRANULAR_PERMISSION_TABS: { label: string; permissions: CatalogPerm[] }[] = [
    {
        label: 'Account',
        permissions: [
            { name: 'view_users', label: 'View Users' },
            { name: 'manage_users', label: 'Manage Users' },
            { name: 'view_groups', label: 'View Groups' },
            { name: 'manage_groups', label: 'Manage Groups' },
            { name: 'manage_group', label: 'Manage Own Group' },
            { name: 'view_members', label: 'View Members' },
            { name: 'manage_settings', label: 'Manage Settings' },
        ],
    },
    {
        label: 'Communication',
        permissions: [
            { name: 'manage_chat', label: 'Manage Chat' },
            { name: 'manage_aws', label: 'Manage Email (AWS)' },
            { name: 'view_notifications', label: 'View Notifications' },
            { name: 'manage_notifications', label: 'Manage Notifications' },
            { name: 'send_notifications', label: 'Send Notifications' },
            { name: 'view_devices', label: 'View Push Devices' },
            { name: 'manage_devices', label: 'Manage Push Devices' },
            { name: 'manage_push_config', label: 'Push Config' },
            { name: 'view_phone_numbers', label: 'View Phone Numbers' },
            { name: 'manage_phone_numbers', label: 'Manage Phone Numbers' },
            { name: 'manage_phone_config', label: 'Phone Config' },
            { name: 'view_sms', label: 'View SMS' },
            { name: 'manage_sms', label: 'Manage SMS' },
            { name: 'send_sms', label: 'Send SMS' },
        ],
    },
    {
        label: 'Platform',
        permissions: [
            { name: 'view_security', label: 'View Security' },
            { name: 'manage_security', label: 'Manage Security' },
            { name: 'view_logs', label: 'View Logs' },
            { name: 'manage_logs', label: 'Manage Logs' },
            { name: 'view_jobs', label: 'View Jobs' },
            { name: 'manage_jobs', label: 'Manage Jobs' },
            { name: 'view_metrics', label: 'View Metrics' },
            { name: 'manage_metrics', label: 'Manage Metrics' },
            { name: 'write_metrics', label: 'Write Metrics' },
            { name: 'view_fileman', label: 'View File Managers' },
            { name: 'manage_files', label: 'Manage Files' },
            { name: 'view_vault', label: 'View Vault' },
            { name: 'manage_vault', label: 'Manage Vault' },
            { name: 'manage_docit', label: 'Manage Docs' },
            { name: 'manage_shortlinks', label: 'Manage Shortlinks' },
            { name: 'view_dns', label: 'View DNS' },
            {
                name: 'manage_dns', label: 'Manage DNS',
                tooltip: 'Manage domains, DNS records, provider credentials and certificates. Adopting a hosted zone and reading certificate key material stay restricted to platform superusers.',
            },
            { name: 'view_geofence', label: 'View Geofence Config' },
            { name: 'manage_geofence', label: 'Manage Geofence Config' },
            {
                name: 'bypass_geofence', label: 'Bypass Geofence (Whitelist)',
                tooltip: 'Exempts this user from ALL geofence rules on authenticated requests. Login-time geofencing still applies until backend post-login support lands.',
            },
        ],
    },
];

/** User._permSwitch port: catalog entry → dotted autosave switch field. */
function permSwitch(p: CatalogPerm): Field {
    return {
        name: `permissions.${p.name}`,
        type: 'switch',
        label: p.label,
        columns: 6,
        ...(p.tooltip ? { help: p.tooltip } : {}),
    };
}

/**
 * The "Sys Perms" tabset — System category tab + the granular domain tabs,
 * one row (User.SYSTEM_PERMISSION_FIELDS shape).
 */
export const SYSTEM_PERMISSION_TABS: FormTab[] = [
    { key: 'system', label: 'System', fields: CATEGORY_PERMISSIONS.map(permSwitch) },
    ...GRANULAR_PERMISSION_TABS.map((tab) => ({
        key: tab.label.toLowerCase(),
        label: tab.label,
        fields: tab.permissions.map(permSwitch),
    })),
];

/**
 * Registry name for app-registered permission tabs — the portal equivalent
 * of User.registerPermissions(...). An app calls
 * `registerFormTabs(USER_APP_PERMS_TABSET, [{key, label, fields}])` and the
 * "App Perms" section appears with those tabs; empty registry = no section.
 */
export const USER_APP_PERMS_TABSET = 'user-app-perms';
