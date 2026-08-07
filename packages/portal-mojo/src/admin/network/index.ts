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

export { NETWORK_SECURITY_ADMIN_SECTION } from '../domains/security';
