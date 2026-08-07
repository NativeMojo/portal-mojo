import type { AdminSection } from '../core';
import { ASSISTANT_PERMISSIONS } from '../assistant/permissions';

export { ASSISTANT_PERMISSIONS } from '../assistant/permissions';
export const ASSISTANT_ADMIN_SECTION: AdminSection = {
    id: 'assistant', basePath: 'assistant', title: 'Assistant', icon: 'bi-stars', navigationGroup: 'assistant', permissions: ASSISTANT_PERMISSIONS,
    routes: [
        { path: 'conversations', label: 'Conversations', loadComponent: () => import('../assistant/pages').then(({ ConversationsPage }) => ({ default: ConversationsPage })), permissions: ASSISTANT_PERMISSIONS },
        { path: 'skills', label: 'Skills', loadComponent: () => import('../assistant/pages').then(({ SkillsPage }) => ({ default: SkillsPage })), permissions: ASSISTANT_PERMISSIONS },
        { path: 'memories', label: 'Memory', loadComponent: () => import('../assistant/pages').then(({ MemoriesPage }) => ({ default: MemoriesPage })), permissions: ['sys.assistant'] },
    ],
};
export const ASSISTANT_ADMIN_SECTIONS = [ASSISTANT_ADMIN_SECTION] as const;
