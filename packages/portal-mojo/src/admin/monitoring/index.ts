
export * from './models';
export * from './LogInspector';
export * from './LogsPage';
export * from './MetricsPermissionsPage';
export * from './MetricsExplorerPage';
export * from './MetricsSourcePicker';
export * from './metrics-explorer-data';
export * from './metrics-explorer-client';

/**
 * Reusable registry contribution. The section gate is the union needed to see
 * at least one child; each direct route then applies its exact backend gate.
 */
export { MONITORING_ADMIN_SECTION } from '../domains/observability';
