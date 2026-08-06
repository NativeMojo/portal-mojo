// IP Intelligence — the GeoIP cache surfaces. This module OWNS
// `/api/system/geoip` for the whole toolkit: #1287's network-security section
// imports the model, the permission constants, the enforcement helpers and
// the dossier from here rather than redefining any of them.
import type { AdminSection } from '../../index';
import { GeoIpCachePage } from './GeoIpCachePage';
import { GEOIP_VIEW_PERMS } from './models';

export * from './models';
export * from './geoip-forms';
export * from './GeoIpDossier';
export * from './GeoIpCachePage';

export const GEOIP_ADMIN_SECTION: AdminSection = {
    id: 'geoip',
    basePath: 'security/geoip',
    title: 'IP Intelligence',
    icon: 'bi-globe2',
    navigationGroup: 'security',
    permissions: GEOIP_VIEW_PERMS,
    routes: [
        {
            path: 'cache', label: 'GeoIP Cache',
            component: GeoIpCachePage, permissions: GEOIP_VIEW_PERMS,
        },
    ],
};
