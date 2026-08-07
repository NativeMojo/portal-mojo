import type { AdminSection } from '../index';
import { EmailDomainsPage } from './EmailDomainsPage';
import { EmailTemplatesPage } from './EmailTemplatesPage';
import { MailboxesPage } from './MailboxesPage';
import { PublicMessagesPage } from './PublicMessagesPage';
import { SentMessagesPage } from './SentMessagesPage';
import { EMAIL_ADMIN_PERMISSIONS, PUBLIC_MESSAGE_VIEW_PERMISSIONS } from './models';
export * from './push';

export * from './models';
export * from './sanitize';
export * from './api';
export * from './data';
export * from './SandboxedEmailPreview';
export * from './EmailDomainWizard';
export * from './EmailDomainsPage';
export * from './MailboxesPage';
export * from './SentMessagesPage';
export * from './EmailTemplatesPage';
export * from './PublicMessagesPage';

export const EMAIL_ADMIN_SECTION:AdminSection={id:'email',basePath:'email',title:'Email',icon:'bi-envelope-at',navigationGroup:'communications',permissions:EMAIL_ADMIN_PERMISSIONS,routes:[{path:'domains',label:'Email Domains',component:EmailDomainsPage,permissions:EMAIL_ADMIN_PERMISSIONS},{path:'mailboxes',label:'Mailboxes',component:MailboxesPage,permissions:EMAIL_ADMIN_PERMISSIONS},{path:'sent',label:'Sent Messages',component:SentMessagesPage,permissions:EMAIL_ADMIN_PERMISSIONS},{path:'templates',label:'Email Templates',component:EmailTemplatesPage,permissions:EMAIL_ADMIN_PERMISSIONS}]};
export const PUBLIC_MESSAGES_ADMIN_SECTION:AdminSection={id:'public-messages',basePath:'messaging',title:'Contact Messages',icon:'bi-chat-left-text',navigationGroup:'communications',permissions:PUBLIC_MESSAGE_VIEW_PERMISSIONS,routes:[{path:'public-messages',label:'Contact Messages',component:PublicMessagesPage,permissions:PUBLIC_MESSAGE_VIEW_PERMISSIONS}]};
