// Network security — perimeter control as ONE admin section under the
// Security navigation group, beside Security Operations, Bouncer, Devices &
// Logins and IP Intelligence.
//
// The section gate is the ANY-of UNION of the four child gates (the
// MONITORING_ADMIN_SECTION pattern); each route then carries its exact backend
// gate. A geofence-only operator (`sys.view_geofence` alone) therefore reaches
// Geofencing and is denied everywhere else — and the engine's landing redirect
// resolves to the first route they can actually see, so nobody lands on a
// denial page.
import type { AdminSection } from '../index';
import { BlockedIPsPage } from './BlockedIPsPage';
import { FirewallLogPage, FIREWALL_LOG_PERMS } from './FirewallLogPage';
import { IPSetsPage } from './IPSetsPage';
import { GeofencingPage } from './geofence/GeofencingPage';
import { GEOIP_VIEW_PERMS } from '../security/geoip';
import { IPSET_VIEW_PERMS } from './models';
import { GEOFENCE_VIEW_PERMS } from './geofence/geofence-data';

export * from './models';
export * from './BlockedIPsPage';
export * from './BlockedIpDetail';
export * from './FirewallLogPage';
export * from './IPSetsPage';
export * from './IPSetDetail';
export * from './IPSetEditor';
export * from './geofence/geofence-data';
export * from './geofence/RuleEditor';
export * from './geofence/PostureHeader';
export * from './geofence/RulesTab';
export * from './geofence/SimulatorTab';
export * from './geofence/BlocksTab';
export * from './geofence/ExemptionsTab';
export * from './geofence/GeofencingPage';

export const NETWORK_SECURITY_ADMIN_SECTION: AdminSection = {
    id: 'network-security',
    basePath: 'security/network',
    title: 'Network Security',
    icon: 'bi-hdd-network',
    navigationGroup: 'security',
    // The union of the four route gates — deduped so the sidebar's any-of
    // check stays cheap and the verifier can compare it set-wise.
    permissions: [...new Set([
        ...GEOIP_VIEW_PERMS,
        ...FIREWALL_LOG_PERMS,
        ...IPSET_VIEW_PERMS,
        ...GEOFENCE_VIEW_PERMS,
    ])],
    routes: [
        {
            path: 'blocked-ips', label: 'Blocked IPs',
            component: BlockedIPsPage, permissions: GEOIP_VIEW_PERMS,
        },
        {
            path: 'firewall-log', label: 'Firewall Log',
            component: FirewallLogPage, permissions: FIREWALL_LOG_PERMS,
        },
        {
            path: 'ip-sets', label: 'IP Sets',
            component: IPSetsPage, permissions: IPSET_VIEW_PERMS,
        },
        {
            path: 'geofencing', label: 'Geofencing',
            component: GeofencingPage, permissions: GEOFENCE_VIEW_PERMS,
        },
    ],
};
