// Persona gate audit — the generalized form of wmx-admin-v2's
// scripts/lens-audit.mjs, as a pure function over data (no source parsing).
//
// The defect class it exists for: a ROLE persona gated on a shared
// capability key leaks portals — `players.view` means "may read player
// records" (several roles need it), not "you are a support agent". Audited
// in wmx 2026-08-09, the old gates handed Support the Marketing portal and
// Owner+Compliance the Support portal. The fix is SIGNATURE gating: every
// gate key held by exactly one preset — which the strict mode enforces.
//
// Ungated personas (hats) are skipped: with no gate there is nothing to leak.
import type { PersonaDef } from './registry';
import type { PersonaPreset } from './presets';

export interface PersonaAuditResult {
    /** Human-readable problems; empty = pass. */
    findings: string[];
}

function gateKeys(def: PersonaDef): string[] {
    if (!def.gate) return [];
    return Array.isArray(def.gate) ? def.gate : [def.gate];
}

/**
 * Cross-check persona gates against grant presets.
 *
 * Default: report every accidental cross-persona hit — a persona's gate key
 * held by ANOTHER persona's preset (that preset's holders see a persona that
 * isn't theirs). Intentional role combinations should grant the signature
 * key deliberately, not inherit it from a bundle.
 *
 * `strict: 'signature-diagonal'` additionally requires, for every gated
 * persona with a same-slug preset: each gate key held by EXACTLY one preset,
 * and the persona's own preset to satisfy its own gate (the diagonal).
 */
export function auditPersonas(
    personas: readonly PersonaDef[],
    presets: readonly PersonaPreset[],
    opts?: { strict?: 'signature-diagonal' },
): PersonaAuditResult {
    const findings: string[] = [];
    const holders = (key: string): PersonaPreset[] => presets.filter((p) => p.keys.includes(key));

    for (const persona of personas) {
        const gate = gateKeys(persona);
        if (gate.length === 0) continue; // hat — nothing to leak

        for (const preset of presets) {
            if (preset.slug === persona.slug) continue;
            const hit = gate.filter((key) => preset.keys.includes(key));
            if (hit.length > 0) {
                findings.push(`preset "${preset.slug}" reaches the "${persona.slug}" persona via ${hit.join(', ')}`);
            }
        }

        if (opts?.strict === 'signature-diagonal') {
            for (const key of gate) {
                const held = holders(key);
                if (held.length === 0) {
                    findings.push(`gate key "${key}" of persona "${persona.slug}" is held by no preset`);
                } else if (held.length > 1) {
                    findings.push(`gate key "${key}" of persona "${persona.slug}" is held by ${held.length} presets (${held.map((p) => p.slug).join(', ')}) — not a signature key`);
                }
            }
            const own = presets.find((p) => p.slug === persona.slug);
            if (own && !gate.some((key) => own.keys.includes(key))) {
                findings.push(`preset "${own.slug}" does not satisfy its own persona's gate (${gate.join(', ')})`);
            }
        }
    }
    return { findings };
}
