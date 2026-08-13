// Phase B — persona presets as DATA. A preset is the grant bundle a persona
// definition carries (`grants`): granular keys plus category NAMES that
// expand through the client's category→granular rollup map.
//
// Ordering contract: apps register their categories FIRST
// (registerPermissionCategories, at boot), then personas reference them by
// name here. An unknown category expands to nothing WITH a console.warn.
//
// The "apply preset" affordance (a button that checks a preset's boxes on a
// member/user permissions form) stays APP-side: presets here are data for
// that UI, never an authority — the server remains authoritative on every
// grant write.
import { getCategoryGranularMap } from '../client/me';
import {
    isEditableMemberPermission, registerMemberPermissions,
    type MemberPermissionDef,
} from '../admin/identity/members/models';
import { getPersonas } from './registry';

export interface PersonaPreset {
    slug: string;
    label: string;
    /** Deduped granular keys: grants.keys ∪ expansion of grants.categories. */
    keys: string[];
}

/** Presets for every defined persona that carries a grant bundle. */
export function personaPresets(): PersonaPreset[] {
    const map = getCategoryGranularMap();
    const out: PersonaPreset[] = [];
    for (const p of getPersonas()) {
        if (!p.grants) continue;
        const keys = new Set<string>(p.grants.keys ?? []);
        for (const category of p.grants.categories ?? []) {
            const granulars = map[category];
            if (!granulars) {
                console.warn(`personaPresets: persona "${p.slug}" references unregistered category "${category}" — expands to nothing`);
                continue;
            }
            for (const key of granulars) keys.add(key);
        }
        out.push({ slug: p.slug, label: p.label, keys: [...keys] });
    }
    return out;
}

/**
 * Feed the union of all preset keys into the admin members permission
 * catalog, so team UIs render a switch per key. `sys.*` and other
 * non-editable names are dropped up front (system-pinned keys can never be
 * member grants; registerMemberPermissions would reject them anyway).
 * Tooltips: per-persona text by slug, default "<label> preset"; a key held
 * by several presets joins their tooltips.
 */
export function registerPersonaMemberPermissions(defs?: { tooltipBySlug?: Record<string, string> }): void {
    const rows = new Map<string, MemberPermissionDef>();
    for (const preset of personaPresets()) {
        const tooltip = defs?.tooltipBySlug?.[preset.slug] ?? `${preset.label} preset`;
        for (const key of preset.keys) {
            if (!isEditableMemberPermission(key)) continue;
            const existing = rows.get(key);
            if (existing) {
                if (existing.tooltip && !existing.tooltip.includes(tooltip)) {
                    existing.tooltip = `${existing.tooltip} · ${tooltip}`;
                }
            } else {
                rows.set(key, { name: key, label: key, tooltip });
            }
        }
    }
    if (rows.size > 0) registerMemberPermissions([...rows.values()]);
}
