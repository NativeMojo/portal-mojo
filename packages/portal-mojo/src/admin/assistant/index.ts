import type { AdminSection } from '../index';
import { ASSISTANT_PERMISSIONS } from './AssistantPanel';
import { ConversationsPage, MemoriesPage, SkillsPage } from './pages';

export * from './types';
export * from './data';
export * from './api';
export * from './AssistantFeed';
export * from './AssistantPanel';
export * from './launchers';
export * from './pages';

export const ASSISTANT_ADMIN_SECTION: AdminSection = {
    id: 'assistant', basePath: 'assistant', title: 'Assistant', icon: 'bi-stars', navigationGroup: 'assistant', permissions: ASSISTANT_PERMISSIONS,
    routes: [
        { path: 'conversations', label: 'Conversations', component: ConversationsPage, permissions: ASSISTANT_PERMISSIONS },
        { path: 'skills', label: 'Skills', component: SkillsPage, permissions: ASSISTANT_PERMISSIONS },
        { path: 'memories', label: 'Memory', component: MemoriesPage, permissions: ['sys.assistant'] },
    ],
};
