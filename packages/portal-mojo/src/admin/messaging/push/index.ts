import type { AdminSection } from '../../index';
import { PushPage } from './PushPage';
import { PUSH_ADMIN_PERMISSIONS } from './models';

export * from './models';
export * from './api';
export * from './PushPage';

export const PUSH_ADMIN_SECTION:AdminSection={id:'push',basePath:'push',title:'Push Notifications',icon:'bi-bell',navigationGroup:'communications',permissions:PUSH_ADMIN_PERMISSIONS,routes:[{path:'',label:'Push Notifications',component:PushPage,permissions:PUSH_ADMIN_PERMISSIONS}]};
