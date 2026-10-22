import { namedPage } from './lazy-page';
import type { AdminSection } from '../core';
import { ASSISTANT_PERMISSIONS } from '../assistant/permissions';

export { ASSISTANT_PERMISSIONS } from '../assistant/permissions';
export const ASSISTANT_ADMIN_SECTION: AdminSection = {
    id: 'assistant', basePath: 'assistant', title: 'Assistant', icon: 'bi-stars', navigationGroup: 'assistant', permissions: ASSISTANT_PERMISSIONS,
    routes: [
        { path: 'setup', label: 'Setup', requireSuperuser: true, loadComponent: () => import('../assistant/AssistantSetupPage').then(namedPage('AssistantSetupPage')) },
        { path: 'conversations', label: 'Conversations', loadComponent: () => import('../assistant/pages').then(namedPage('ConversationsPage')), permissions: ASSISTANT_PERMISSIONS },
        { path: 'skills', label: 'Skills', loadComponent: () => import('../assistant/pages').then(namedPage('SkillsPage')), permissions: ASSISTANT_PERMISSIONS },
        { path: 'memories', label: 'Memory', loadComponent: () => import('../assistant/pages').then(namedPage('MemoriesPage')), permissions: ['sys.assistant'] },
    ],
};
export const ASSISTANT_ADMIN_SECTIONS = [ASSISTANT_ADMIN_SECTION] as const;
