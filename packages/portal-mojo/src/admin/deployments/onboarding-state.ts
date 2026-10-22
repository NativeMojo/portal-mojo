import type { OnboardingOperation } from './types';
export const onboardingTerminal = (o: OnboardingOperation) => ['succeeded', 'failed', 'cancelled'].includes(o.status);
export function onboardingPollable(o: OnboardingOperation): boolean { return !onboardingTerminal(o) && ['app', 'address', 'github', 'verify'].includes(o.cursor) && (o.status === 'active' || (o.status === 'waiting' && !!o.next_attempt_at)); }
export function onboardingGeneration(o: OnboardingOperation): string { return `${o.operation_id}:${o.revision}:${o.cursor}`; }
export function managedChoice(o: OnboardingOperation, domain: number, label: string): Record<string, unknown> | null { switch (o.cursor) {
    case 'app': return {};
    case 'address': return domain > 0 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) ? { domain, label } : null;
    case 'github': return { skip: true };
    case 'verify': return {};
    default: return null;
} }
