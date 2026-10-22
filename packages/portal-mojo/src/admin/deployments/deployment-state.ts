import type { ApiAction, PlatformAttempt, Release } from './types';
export function apiActions(status: string): ApiAction[] { switch (status) {
    case 'failed': return ['retry', 'verify'];
    case 'verified':
    case 'partial':
    case 'unknown': return ['verify', 'converge'];
    case 'converged': return ['verify'];
    default: return [];
} }
export function rollbackEligible(release: Release, current: Release | null): boolean { return release.id > 0 && release.id !== current?.id && ['uploaded', 'live', 'superseded'].includes(release.status); }
export function platformProof(attempt: PlatformAttempt): string { const n = attempt.node_summary; if (attempt.status === 'converged' && n.expected > 0 && n.proven === n.expected)
    return `${n.proven}/${n.expected} restart proofs at observation`; return `${n.proven}/${n.expected} restart proofs; ${n.reported} reported, ${n.failed} failed (${attempt.status})`; }
export function deploymentTone(status: string): string { return ['live', 'converged'].includes(status) ? 'ok' : ['failed', 'rolled_back'].includes(status) ? 'bad' : ['requested', 'queued', 'deploying', 'canary', 'fleet', 'partial', 'verified'].includes(status) ? 'warn' : 'dim'; }
