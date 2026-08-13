// Generic persisted-value helpers — the params.ts table-state pattern
// (feature-detected storage, validate-don't-cast, unparseable/invalid blobs
// cleared AND null, silent no-op writes under privacy mode / SSR) extracted
// for any single-key consumer (active persona, view preferences, …).
//
// Contract: JSON is the canonical wire format. `readPersisted` tolerates a
// legacy bare-string value (a raw string that was never JSON-encoded) by
// offering the raw text to the validator when parsing fails — the next
// `writePersisted` self-heals the entry to JSON. A value the validator
// rejects is CLEARED, never returned: stale/garbage storage must not become
// live state.

function storage(): Storage | null {
    try {
        const ls = globalThis.localStorage;
        if (ls && typeof ls.getItem === 'function') return ls;
    } catch { /* access denied (privacy mode) or no window (SSR) */ }
    return null;
}

/**
 * Read + validate one persisted value. `validate` receives the parsed JSON
 * (or, when parsing fails, the raw string) and returns the typed value or
 * null to reject it. Rejected/unparseable entries are cleared and null is
 * returned — callers always see a valid T or nothing.
 */
export function readPersisted<T>(key: string, validate: (raw: unknown) => T | null): T | null {
    const store = storage();
    if (!store) return null;
    let raw: string | null;
    try { raw = store.getItem(key); } catch { return null; }
    if (raw == null) return null;
    let candidate: unknown = raw;
    try { candidate = JSON.parse(raw); } catch { /* legacy bare string — validate as-is */ }
    const value = validate(candidate);
    if (value === null) {
        clearPersisted(key);
        return null;
    }
    return value;
}

/** Persist one value as JSON. Silent no-op when storage is unavailable/full. */
export function writePersisted(key: string, value: unknown): void {
    const store = storage();
    if (!store) return;
    try { store.setItem(key, JSON.stringify(value)); } catch { /* quota / denied */ }
}

export function clearPersisted(key: string): void {
    const store = storage();
    if (!store) return;
    try { store.removeItem(key); } catch { /* denied */ }
}
