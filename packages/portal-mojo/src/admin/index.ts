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
export { ADMIN_SECTIONS } from './registry';
