import { useSyncExternalStore } from 'react';
import { ownerKey, type DeploymentOwner } from './permissions';
const refused = new Set<string>();
const listeners = new Set<() => void>();
const key = (owner: DeploymentOwner, app: number) => `${ownerKey(owner)}:${app}`;
export function refuseAppActions(owner: DeploymentOwner, app: number): void { refused.add(key(owner, app)); for (const fn of listeners)
    fn(); }
export function appActionsRefused(owner: DeploymentOwner, app: number): boolean { return refused.has(key(owner, app)); }
export function useAppActionsRefused(owner: DeploymentOwner, app: number): boolean { return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => appActionsRefused(owner, app), () => true); }
