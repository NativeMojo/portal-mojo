import type { CreateProfile, ManifestEntry } from './types';
import { record, text, uuid, positiveId, list } from './sanitize';
import type { DeploymentOwner } from './permissions';
export interface ActionReceipt {
    version: 1;
    actor: string;
    origin: string;
    key: string;
    operation: string;
    kind: 'create' | 'api' | 'key' | 'rollback' | 'upload' | 'profile';
    app: number;
    target: string;
    settled: boolean;
    submitted?: boolean;
    submittedAt?: number;
    acknowledged?: boolean;
    address?: {
        domain: number;
        label: string;
    };
    onboardingGroup?: number;
    profile?: CreateProfile;
    manifest?: ManifestEntry[];
    release?: number;
    deployment?: number;
    uploadPhase?: 'registered' | 'completion_submitted' | 'observing';
    completionSubmittedAt?: number;
    completionBaseline?: number[];
}
const STORAGE = 'mojo.deployment.receipts.v1';
const memory = new Map<string, ActionReceipt>();
const active = new Set<string>();
function project(v: unknown): ActionReceipt | null { const r = record(v); if (r.version !== 1 || !['create', 'api', 'key', 'rollback', 'upload', 'profile'].includes(String(r.kind)) || !uuid(r.operation) || !text(r.actor) || !text(r.origin) || !text(r.key))
    return null; const receipt: ActionReceipt = {
    version: 1, actor: text(r.actor), origin: text(r.origin), key: text(r.key), operation: uuid(r.operation), kind: r.kind as ActionReceipt['kind'], app: positiveId(r.app), target: text(r.target), settled: r.settled === true, submitted: r.submitted === true, submittedAt: typeof r.submittedAt === 'number' ? r.submittedAt : undefined, acknowledged: r.acknowledged === true, release: positiveId(r.release) || undefined, deployment: positiveId(r.deployment) || undefined
}; if(positiveId(r.onboardingGroup))receipt.onboardingGroup=positiveId(r.onboardingGroup);if(r.kind==='upload'){
    if(['registered','completion_submitted','observing'].includes(String(r.uploadPhase)))receipt.uploadPhase=r.uploadPhase as ActionReceipt['uploadPhase'];
    if(typeof r.completionSubmittedAt==='number'&&Number.isFinite(r.completionSubmittedAt))receipt.completionSubmittedAt=r.completionSubmittedAt;
    if(Array.isArray(r.completionBaseline))receipt.completionBaseline=list(r.completionBaseline,100).map(positiveId).filter(Boolean);
} if (r.address) {
    const a = record(r.address);
    receipt.address = { domain: positiveId(a.domain), label: text(a.label, 63) };
} if (r.kind === 'create' && r.profile) {
    const p = record(r.profile);
    receipt.profile = {
        operation_id: receipt.operation, ...(positiveId(p.group) ? { group: positiveId(p.group) } : { group_intent: 'new' as const }), slug: text(p.slug, 64), display_name: text(p.display_name, 120), environment: text(p.environment, 16), bucket: text(p.bucket), github_repository: text(p.github_repository), deployment_ref: text(p.deployment_ref), build_output: text(p.build_output)
    };
} if (r.kind === 'upload' && Array.isArray(r.manifest))
    receipt.manifest = list(r.manifest, 5000).map(v => { const p = record(v); return {
        path: text(p.path, 1024), sha256: text(p.sha256, 64), size: typeof p.size === 'number' ? p.size : 0
    }; }); return receipt; }
function restore() { try {
    for (const raw of JSON.parse(sessionStorage.getItem(STORAGE) ?? '[]')) {
        const r = project(raw);
        if (r && !memory.has(r.key))
            memory.set(r.key, r);
    }
}
catch { /* session-only fallback */ } }
function persist() { try {
    sessionStorage.setItem(STORAGE, JSON.stringify([...memory.values()].slice(-32)));
}
catch { /* receipt remains for this tab */ } }
export function receiptsFor(owner: DeploymentOwner): ActionReceipt[] { restore(); return [...memory.values()].filter(r => r.actor === owner.actor && r.origin === owner.origin).map(r => ({ ...r })); }
export function saveReceipt(receipt: ActionReceipt) { const safe = project(receipt); if (!safe)
    throw new Error('Invalid deployment receipt'); memory.set(safe.key, safe); persist(); return safe; }
export function makeReceipt(owner: DeploymentOwner, kind: ActionReceipt['kind'], scope: string, app = 0, target = ''): ActionReceipt { const key = `${owner.origin}:${owner.actor}:${kind}:${scope}`; const previous = receiptsFor(owner).find(r => r.key === key); return previous && (!previous.settled || (previous.kind==='upload'&&['completion_submitted','observing'].includes(previous.uploadPhase??''))) ? previous : saveReceipt({
    version: 1, actor: owner.actor, origin: owner.origin, key, operation: crypto.randomUUID(), kind, app, target, settled: false
}); }
export function appUnsettled(owner: DeploymentOwner, app: number, except?: string): ActionReceipt | undefined { return receiptsFor(owner).find(r => r.app === app && app > 0 && !r.settled && r.key !== except); }
export function settleReceipt(r: ActionReceipt) { saveReceipt({ ...r, settled: true }); }
export async function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> { if (active.has(key))
    throw new Error('An operation for this target is already pending'); active.add(key); try {
    return await fn();
}
finally {
    active.delete(key);
} }
