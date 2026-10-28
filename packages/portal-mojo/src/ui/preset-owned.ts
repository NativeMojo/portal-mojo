// presetOwnedFilters — the filter keys the selected segment already shows.
//
// A preset is a param bundle with DERIVED active state: its keys live in the
// params store like any filter. Rendering them as pills as well says the
// same thing twice, and the pill's × (or Clear all) flips the segment behind
// the operator's back — a default "Staff" preset cleared to "All users", or
// a raw lookup like `user__player_profiles__group__not` shown as a filter.
// So the segment is the one control for the keys it owns: no pill, no count
// on the Filter button, and Clear all keeps them. A filter the operator adds
// on top still pills; editing an owned key through the Filter menu changes
// the value, the preset stops matching, and the pill comes back.
//
// This module is intentionally NOT exported from ui/index.ts — it is
// ModelTable plumbing, kept pure so the verify script can pin it without
// loading ModelTable's router/query graph.
import type { ActiveFilter } from '../client/params';

interface PresetParams { params: Record<string, string> }

/**
 * Union of the params of every active preset. Matching is the params
 * store's own `presetActive`, so a segment highlights exactly when it owns
 * its keys. The empty "All" preset owns nothing.
 */
export function presetOwnedFilters(
    presets: readonly PresetParams[],
    isActive: (params: Record<string, string>) => boolean,
): Record<string, string> {
    const owned: Record<string, string> = {};
    for (const { params } of presets) {
        if (Object.keys(params).length > 0 && isActive(params)) Object.assign(owned, params);
    }
    return owned;
}

/** True when a segment owns this filter. A daterange is owned through its `dr_field`. */
export function isPresetOwned(f: ActiveFilter, owned: Readonly<Record<string, string>>): boolean {
    return f.kind === 'daterange' ? owned.dr_field === f.id : owned[f.id] !== undefined;
}
