import type { AdminSection } from '../core';
import { EMAIL_ADMIN_PERMISSIONS, PUBLIC_MESSAGE_VIEW_PERMISSIONS } from '../messaging/models';
import { PUSH_ADMIN_PERMISSIONS } from '../messaging/push/models';
import { PHONE_HUB_ADMIN_PERMISSIONS } from '../phonehub/models';
import { SHORTLINK_MANAGE_PERMISSIONS } from '../shortlinks/models';

export const SHORTLINKS_ADMIN_SECTION: AdminSection = {
    id: 'shortlinks', basePath: 'shortlinks', title: 'Shortlinks', icon: 'bi-link-45deg', navigationGroup: 'communications', permissions: SHORTLINK_MANAGE_PERMISSIONS,
    routes: [
        { path: 'links', label: 'Links', loadComponent: () => import('../shortlinks/ShortlinksPage').then(({ ShortlinksPage }) => ({ default: ShortlinksPage })), permissions: SHORTLINK_MANAGE_PERMISSIONS },
        { path: 'history', label: 'Click history', loadComponent: () => import('../shortlinks/ShortlinkHistoryPage').then(({ ShortlinkHistoryPage }) => ({ default: ShortlinkHistoryPage })), permissions: SHORTLINK_MANAGE_PERMISSIONS },
    ],
};
export const EMAIL_ADMIN_SECTION: AdminSection = {
    id: 'email', basePath: 'email', title: 'Email', icon: 'bi-envelope-at', navigationGroup: 'communications', permissions: EMAIL_ADMIN_PERMISSIONS,
    routes: [
        { path: 'domains', label: 'Email Domains', loadComponent: () => import('../messaging/EmailDomainsPage').then(({ EmailDomainsPage }) => ({ default: EmailDomainsPage })), permissions: EMAIL_ADMIN_PERMISSIONS },
        { path: 'mailboxes', label: 'Mailboxes', loadComponent: () => import('../messaging/MailboxesPage').then(({ MailboxesPage }) => ({ default: MailboxesPage })), permissions: EMAIL_ADMIN_PERMISSIONS },
        { path: 'sent', label: 'Sent Messages', loadComponent: () => import('../messaging/SentMessagesPage').then(({ SentMessagesPage }) => ({ default: SentMessagesPage })), permissions: EMAIL_ADMIN_PERMISSIONS },
        { path: 'templates', label: 'Email Templates', loadComponent: () => import('../messaging/EmailTemplatesPage').then(({ EmailTemplatesPage }) => ({ default: EmailTemplatesPage })), permissions: EMAIL_ADMIN_PERMISSIONS },
    ],
};
export const PUBLIC_MESSAGES_ADMIN_SECTION: AdminSection = {
    id: 'public-messages', basePath: 'messaging', title: 'Contact Messages', icon: 'bi-chat-left-text', navigationGroup: 'communications', permissions: PUBLIC_MESSAGE_VIEW_PERMISSIONS,
    routes: [{ path: 'public-messages', label: 'Contact Messages', loadComponent: () => import('../messaging/PublicMessagesPage').then(({ PublicMessagesPage }) => ({ default: PublicMessagesPage })), permissions: PUBLIC_MESSAGE_VIEW_PERMISSIONS }],
};
export const PUSH_ADMIN_SECTION: AdminSection = {
    id: 'push', basePath: 'push', title: 'Push Notifications', icon: 'bi-bell', navigationGroup: 'communications', permissions: PUSH_ADMIN_PERMISSIONS,
    routes: [{ path: '', label: 'Push Notifications', loadComponent: () => import('../messaging/push/PushPage').then(({ PushPage }) => ({ default: PushPage })), permissions: PUSH_ADMIN_PERMISSIONS }],
};
export const PHONE_HUB_ADMIN_SECTION: AdminSection = {
    id: 'phonehub', basePath: 'phonehub', title: 'Phone Hub', icon: 'bi-phone', navigationGroup: 'communications', permissions: PHONE_HUB_ADMIN_PERMISSIONS,
    routes: [{ path: '', label: 'Phone Hub', loadComponent: () => import('../phonehub/PhoneHubPage').then(({ PhoneHubPage }) => ({ default: PhoneHubPage })), permissions: PHONE_HUB_ADMIN_PERMISSIONS }],
};
export const COMMUNICATIONS_ADMIN_SECTIONS = [SHORTLINKS_ADMIN_SECTION, EMAIL_ADMIN_SECTION, PUBLIC_MESSAGES_ADMIN_SECTION, PUSH_ADMIN_SECTION, PHONE_HUB_ADMIN_SECTION] as const;

