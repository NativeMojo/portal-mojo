import type { FileRenditionRow, FileRow } from './models';

export const RENDITION_POLL_DELAY_MS = 5_000;
export const RENDITION_POLL_MAX_ATTEMPTS = 12;
export const MAX_RENDITION_ROLES = 20;

export function normalizeRenditions(
    value: Record<string, FileRenditionRow> | null | undefined,
): FileRenditionRow[] {
    return Object.entries(value ?? {}).map(([role, row]) => ({ ...row, role: row.role || role }))
        .sort((a, b) => a.role.localeCompare(b.role));
}

export function renditionSignature(row: FileRenditionRow | null | undefined): string | null {
    if (!row) return null;
    return JSON.stringify([
        row.role, row.id, row.upload_status, row.modified,
        row.width ?? null, row.height ?? null, row.file_size ?? null,
    ]);
}

export function renditionMapSignature(file: Pick<FileRow, 'renditions'>): string {
    return normalizeRenditions(file.renditions)
        .map((row) => renditionSignature(row))
        .join('|');
}

/** Signature only the roles queued by one regeneration generation can satisfy. */
export function renditionTargetSignature(
    file: Pick<FileRow, 'renditions'>,
    targetRoles: readonly string[] | null,
): string {
    if (targetRoles === null) return renditionMapSignature(file);
    const byRole = new Map(normalizeRenditions(file.renditions).map((row) => [row.role, row]));
    return normalizeRenditionRoles(targetRoles)
        .map((role) => `${role}:${renditionSignature(byRole.get(role)) ?? 'missing'}`)
        .join('|');
}

export function normalizeRenditionRoles(roles: readonly string[]): string[] {
    return [...new Set(roles.map((role) => role.trim()).filter(Boolean))].slice(0, MAX_RENDITION_ROLES);
}

export type RenditionPollStop = 'changed' | 'failed' | 'expired' | 'file-changed' | 'closed' | 'timeout';

export interface RenditionPollDecision {
    done: boolean;
    reason: RenditionPollStop | null;
}

export function decideRenditionPoll(args: {
    expectedFileId: number;
    currentFileId: number | null;
    open: boolean;
    attempt: number;
    beforeSignature: string;
    targetRoles: readonly string[] | null;
    file: Pick<FileRow, 'upload_status' | 'renditions'> | null;
}): RenditionPollDecision {
    if (!args.open) return { done: true, reason: 'closed' };
    if (args.currentFileId !== args.expectedFileId) return { done: true, reason: 'file-changed' };
    if (args.file?.upload_status === 'failed') return { done: true, reason: 'failed' };
    if (args.file?.upload_status === 'expired') return { done: true, reason: 'expired' };
    if (args.file && renditionTargetSignature(args.file, args.targetRoles) !== args.beforeSignature) {
        return { done: true, reason: 'changed' };
    }
    if (args.attempt >= RENDITION_POLL_MAX_ATTEMPTS) return { done: true, reason: 'timeout' };
    return { done: false, reason: null };
}

/** Recursive, non-overlapping convergence polling. */
export async function pollRenditionConvergence(args: {
    fileId: number;
    beforeSignature: string;
    targetRoles: readonly string[] | null;
    isCurrent: () => boolean;
    fetch: () => Promise<FileRow>;
    wait?: (ms: number) => Promise<void>;
    onAttempt?: (attempt: number, file: FileRow) => void;
}): Promise<RenditionPollStop> {
    const wait = args.wait ?? ((ms) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)));
    for (let attempt = 1; attempt <= RENDITION_POLL_MAX_ATTEMPTS; attempt += 1) {
        await wait(RENDITION_POLL_DELAY_MS);
        if (!args.isCurrent()) return 'closed';
        const file = await args.fetch();
        args.onAttempt?.(attempt, file);
        const decision = decideRenditionPoll({
            expectedFileId: args.fileId,
            currentFileId: file.id,
            open: args.isCurrent(),
            attempt,
            beforeSignature: args.beforeSignature,
            targetRoles: args.targetRoles,
            file,
        });
        if (decision.done) return decision.reason!;
    }
    return 'timeout';
}
