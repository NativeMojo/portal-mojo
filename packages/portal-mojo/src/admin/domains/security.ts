import type { AdminRoute, AdminSection } from '../core';
import { BOUNCER_VIEW_PERMS } from '../bouncer/models';
import { LOGS_ADMIN_PERMISSIONS } from '../monitoring/models';
import { GEOIP_VIEW_PERMS } from '../security/geoip/models';
import { LOGIN_EVENT_VIEW_PERMS, USER_DEVICE_VIEW_PERMS } from '../security/devices/models';
import { SECURITY_VIEW_PERMS } from '../security-permissions';
import { IPSET_VIEW_PERMS } from '../network/models';
import { GEOFENCE_VIEW_PERMS } from '../network/geofence/geofence-data';

export const INCIDENTS_ADMIN_ROUTES: AdminRoute[] = [
    { path: 'incidents', label: 'Incidents', loadComponent: () => import('../incidents/IncidentsPage').then(({ IncidentsPage }) => ({ default: IncidentsPage })), permissions: SECURITY_VIEW_PERMS },
    { path: 'events', label: 'Events', loadComponent: () => import('../incidents/EventsPage').then(({ EventsPage }) => ({ default: EventsPage })), permissions: SECURITY_VIEW_PERMS },
];
export const RULES_ADMIN_ROUTES: AdminRoute[] = [
    { path: 'rules', label: 'Rule Engine', loadComponent: () => import('../rules/RuleSetsPage').then(({ RuleSetsPage }) => ({ default: RuleSetsPage })), permissions: SECURITY_VIEW_PERMS },
];

export const SECURITY_OPERATIONS_ADMIN_SECTION: AdminSection = {
    id: 'security-operations', basePath: 'security', title: 'Security Operations', icon: 'bi-shield-check', navigationGroup: 'security', permissions: SECURITY_VIEW_PERMS,
    routes: [
        { path: 'tickets', label: 'Tickets', loadComponent: () => import('../security/tickets').then(({ TicketsPage }) => ({ default: TicketsPage })), permissions: SECURITY_VIEW_PERMS },
        ...INCIDENTS_ADMIN_ROUTES, ...RULES_ADMIN_ROUTES,
    ],
};
export const BOUNCER_ADMIN_SECTION: AdminSection = {
    id: 'bouncer', basePath: 'security/bouncer', title: 'Bouncer', icon: 'bi-shield-check', navigationGroup: 'security', permissions: BOUNCER_VIEW_PERMS,
    routes: [
        { path: 'signals', label: 'Signal Decisions', loadComponent: () => import('../bouncer/signals').then(({ BouncerSignalsPage }) => ({ default: BouncerSignalsPage })), permissions: BOUNCER_VIEW_PERMS },
        { path: 'devices', label: 'Device Reputation', loadComponent: () => import('../bouncer/devices').then(({ BouncerDevicesPage }) => ({ default: BouncerDevicesPage })), permissions: BOUNCER_VIEW_PERMS },
        { path: 'signatures', label: 'Bot Signatures', loadComponent: () => import('../bouncer/signatures').then(({ BotSignaturesPage }) => ({ default: BotSignaturesPage })), permissions: BOUNCER_VIEW_PERMS },
    ],
};
export const DEVICE_INTEL_ADMIN_SECTION: AdminSection = {
    id: 'device-intel', basePath: 'security/devices', title: 'Devices & Logins', icon: 'bi-laptop', navigationGroup: 'security', permissions: [...new Set([...USER_DEVICE_VIEW_PERMS, ...LOGIN_EVENT_VIEW_PERMS])],
    routes: [
        { path: 'user-devices', label: 'User Devices', loadComponent: () => import('../security/devices/UserDevicesPage').then(({ UserDevicesPage }) => ({ default: UserDevicesPage })), permissions: USER_DEVICE_VIEW_PERMS },
        { path: 'login-locations', label: 'Login Locations', loadComponent: () => import('../security/devices/LoginLocationsPage').then(({ LoginLocationsPage }) => ({ default: LoginLocationsPage })), permissions: LOGIN_EVENT_VIEW_PERMS },
    ],
};
export const GEOIP_ADMIN_SECTION: AdminSection = {
    id: 'geoip', basePath: 'security/geoip', title: 'IP Intelligence', icon: 'bi-globe2', navigationGroup: 'security', permissions: GEOIP_VIEW_PERMS,
    routes: [{ path: 'cache', label: 'GeoIP Cache', loadComponent: () => import('../security/geoip/GeoIpCachePage').then(({ GeoIpCachePage }) => ({ default: GeoIpCachePage })), permissions: GEOIP_VIEW_PERMS }],
};
export const NETWORK_SECURITY_ADMIN_SECTION: AdminSection = {
    id: 'network-security', basePath: 'security/network', title: 'Network Security', icon: 'bi-hdd-network', navigationGroup: 'security',
    permissions: [...new Set([...GEOIP_VIEW_PERMS, ...LOGS_ADMIN_PERMISSIONS, ...IPSET_VIEW_PERMS, ...GEOFENCE_VIEW_PERMS])],
    routes: [
        { path: 'blocked-ips', label: 'Blocked IPs', loadComponent: () => import('../network/BlockedIPsPage').then(({ BlockedIPsPage }) => ({ default: BlockedIPsPage })), permissions: GEOIP_VIEW_PERMS },
        { path: 'firewall-log', label: 'Firewall Log', loadComponent: () => import('../network/FirewallLogPage').then(({ FirewallLogPage }) => ({ default: FirewallLogPage })), permissions: LOGS_ADMIN_PERMISSIONS },
        { path: 'ip-sets', label: 'IP Sets', loadComponent: () => import('../network/IPSetsPage').then(({ IPSetsPage }) => ({ default: IPSetsPage })), permissions: IPSET_VIEW_PERMS },
        { path: 'geofencing', label: 'Geofencing', loadComponent: () => import('../network/geofence/GeofencingPage').then(({ GeofencingPage }) => ({ default: GeofencingPage })), permissions: GEOFENCE_VIEW_PERMS },
    ],
};

export const SECURITY_ADMIN_SECTIONS = [SECURITY_OPERATIONS_ADMIN_SECTION, BOUNCER_ADMIN_SECTION, DEVICE_INTEL_ADMIN_SECTION, GEOIP_ADMIN_SECTION, NETWORK_SECURITY_ADMIN_SECTION] as const;

