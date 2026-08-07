import type { AdminSection } from '../index';
import { PhoneHubPage } from './PhoneHubPage';
import { PHONE_HUB_ADMIN_PERMISSIONS } from './models';

export * from './models';
export * from './api';
export * from './data';
export * from './PhoneHubPage';

export const PHONE_HUB_ADMIN_SECTION:AdminSection={id:'phonehub',basePath:'phonehub',title:'Phone Hub',icon:'bi-phone',navigationGroup:'communications',permissions:PHONE_HUB_ADMIN_PERMISSIONS,routes:[{path:'',label:'Phone Hub',component:PhoneHubPage,permissions:PHONE_HUB_ADMIN_PERMISSIONS}]};
