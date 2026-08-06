import type { AdminRoute } from '../index';
import { SECURITY_VIEW_PERMS } from '../security-permissions';
import { RuleSetDetailPage } from './RuleSetDetailPage';
import { RuleSetsPage } from './RuleSetsPage';

// Importing the bundle also installs the namespaced SchemaForm field renderer.
export * from './models';
export * from './handler-dsl';
export * from './HandlerChainBuilder';
export * from './editors';

export const RULES_ADMIN_ROUTES: AdminRoute[] = [
    { path: 'rules', label: 'Rule Engine', component: RuleSetsPage, permissions: SECURITY_VIEW_PERMS },
    { path: 'rules/:id', component: RuleSetDetailPage, permissions: SECURITY_VIEW_PERMS },
];
