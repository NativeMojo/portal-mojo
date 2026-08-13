// fixedParams — ModelTable's locked request scope (board #1634).
//
// `defaultParams` is the initial state of USER-editable filters: every key
// becomes a removable pill, so tenant scope passed there is one click from
// gone. `fixedParams` is table IDENTITY: merged into every wire request
// AFTER filter state and model normalization, never a pill, immune to
// Clear all, invisible to view persistence and the URL.
//
// The merge runs AFTER `model.normalizeListParams` deliberately: admin
// normalizers are positive-projection (unknown keys dropped), so merging
// before would silently strip an un-allowlisted scope key — the request
// would go out UNSCOPED, which is the fail-open this prop exists to close.
//
// This module is intentionally NOT exported from ui/index.ts — it is
// ModelTable plumbing, kept pure so the verify script can pin it without
// loading ModelTable's router/query graph.
import type { Params } from '../client/types';
import { warnOnce } from './warn-once';

/** Wire keys that cannot be locked — they'd fight the pager/sort/search UI. */
export const RESERVED_FIXED: ReadonlySet<string> = new Set(['start', 'size', 'page', 'sort', 'search']);

function usable(key: string, value: unknown): boolean {
    if (value == null || value === '') return false;
    if (RESERVED_FIXED.has(key)) {
        warnOnce(`ModelTable fixedParams cannot lock "${key}" — it would fight the pager/sort/search UI; ignored`);
        return false;
    }
    return true;
}

/**
 * The effective fixed keys — the scrub set handed to useTableParams so a
 * bookmarked URL (`?group=9`) or a persisted view from before a page was
 * scope-migrated can never re-inject a fixed key as a removable pill.
 */
export function fixedParamKeys(fixed: Params | null | undefined): Set<string> {
    const out = new Set<string>();
    for (const [key, value] of Object.entries(fixed ?? {})) {
        if (usable(key, value)) out.add(key);
    }
    return out;
}

/**
 * Overlay the locked scope on the normalized request params. Passthrough
 * identity when there is nothing to merge; `null`/`''` values and reserved
 * keys are skipped (`0` is a valid scope value and passes).
 */
export function mergeFixedParams(normalized: Params, fixed: Params | null | undefined): Params {
    if (fixed == null) return normalized;
    let out: Params | null = null;
    for (const [key, value] of Object.entries(fixed)) {
        if (!usable(key, value)) continue;
        (out ??= { ...normalized })[key] = value;
    }
    return out ?? normalized;
}
