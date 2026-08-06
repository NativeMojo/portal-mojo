import type { AdminSection } from '../index';
import { BOUNCER_VIEW_PERMS } from './models';
import { BouncerSignalsPage } from './signals';
import { BouncerDevicesPage } from './devices';
import { BotSignaturesPage } from './signatures';

export * from './models';
export * from './signals';
export * from './devices';
export * from './signatures';

/** Mount-point-relative Bouncer contribution for standalone or embedded admin. */
export const BOUNCER_ADMIN_SECTION: AdminSection = {
    id: 'bouncer',
    basePath: 'security/bouncer',
    title: 'Bouncer',
    icon: 'bi-shield-check',
    navigationGroup: 'security',
    permissions: BOUNCER_VIEW_PERMS,
    routes: [
        {
            path: 'signals', label: 'Signal Decisions',
            component: BouncerSignalsPage, permissions: BOUNCER_VIEW_PERMS,
        },
        {
            path: 'devices', label: 'Device Reputation',
            component: BouncerDevicesPage, permissions: BOUNCER_VIEW_PERMS,
        },
        {
            path: 'signatures', label: 'Bot Signatures',
            component: BotSignaturesPage, permissions: BOUNCER_VIEW_PERMS,
        },
    ],
};
