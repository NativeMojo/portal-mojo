// Edge — vhosts and upstreams as one section under Infrastructure, and the
// fleet blocklist as a route of Network Security. The blocklist cannot live
// in the Edge section: a section gate composes with its route gates, so a
// security-only operator would be denied by any DNS-gated section.

export * from './permissions';
export * from './models';
export * from './api';
export * from './VhostWizard';
export * from './VhostsPage';
export * from './VhostDetail';
export * from './UpstreamsPage';
export * from './BlocklistPage';

export { EDGE_ADMIN_SECTION } from '../domains/infrastructure';
