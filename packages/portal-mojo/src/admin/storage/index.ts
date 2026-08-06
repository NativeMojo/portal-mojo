import type { AdminSection } from '../index';
import { BackendsPage } from './BackendsPage';
import { BucketsPage } from './BucketsPage';
import { FilesPage } from './FilesPage';
import { BUCKET_MANAGE_PERMS, STORAGE_VIEW_PERMS } from './models';

export * from './models';
export * from './file-renditions';
export * from './BucketsPage';
export * from './BucketDetail';
export * from './BackendsPage';
export * from './FileManagerDetail';
export * from './FilesPage';
export * from './FileView';
export * from './FilePreview';
export * from './storage-dialogs';

export const STORAGE_ADMIN_SECTION: AdminSection = {
    id: 'storage',
    basePath: 'storage',
    title: 'Storage',
    icon: 'bi-hdd-stack',
    navigationGroup: 'infrastructure',
    permissions: ['sys.view_fileman', 'sys.manage_files', 'sys.manage_aws', 'sys.files'],
    routes: [
        { path: 'buckets', label: 'Buckets', component: BucketsPage, permissions: BUCKET_MANAGE_PERMS },
        { path: 'backends', label: 'Backends', component: BackendsPage, permissions: STORAGE_VIEW_PERMS },
        { path: 'files', label: 'Files', component: FilesPage, permissions: STORAGE_VIEW_PERMS },
    ],
};
