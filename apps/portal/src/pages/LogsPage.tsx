// Compatibility shim until the orchestrator rewires admin-routes.tsx directly
// to portal-mojo/admin. The implementation and model now live in the package.
// MERGE-WIRE: replace this import with `portal-mojo/admin`, then delete shim.
export { LogsPage } from '../../../../packages/portal-mojo/src/admin/monitoring';
