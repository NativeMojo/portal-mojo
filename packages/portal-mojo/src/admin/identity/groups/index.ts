export * from './group-permissions';
export * from './models';
export * from './GroupsPage';
export * from './GroupDetail';

export const loadGroupsPage = () => import('./GroupsPage').then(({ GroupsPage }) => ({ default: GroupsPage }));
