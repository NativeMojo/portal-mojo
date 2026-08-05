// KnownFieldsCard — the "known JSON keys promoted, raw blob below" pattern.
// Blob-shaped fields (`metadata`, `ip_info`, `device_info`, `payload`) carry a
// few keys the framework knows about plus an open-ended bag of extras; detail
// sections want the known ones in a clean label/value grid and the raw JSON
// accessible but subordinated.
// Port of web-mojo src/core/views/data/KnownFieldsCard.js.
//
//   Created by      ian@example.com
//   Reasoning       brute-force from same /24
//   Last resolved   2026-04-21 11:42
//   ▶ Raw metadata
//
// Deviation from source: `formatter` returned TRUSTED HTML — `format` returns
// ReactNode here (architecture rule 6). The string form still works and now
// names an `fmt.*` formatter; an unknown name warns and falls back to the plain
// value rather than rendering nothing (architecture rule 4).
import type { ReactNode } from 'react';
import * as fmt from '../format';

/** The `fmt.*` formatters a spec may name as a string. */
const NAMED_FORMATTERS = {
    date: (v: unknown) => fmt.date(v as string | number | null),
    datetime: (v: unknown) => fmt.datetime(v as string | number | null),
    relative: (v: unknown) => fmt.relative(v as string | number | null),
} satisfies Record<string, (value: unknown) => ReactNode>;

export type NamedFormatter = keyof typeof NAMED_FORMATTERS;

export interface KnownField {
    /** Key in the blob. Dotted paths traverse nested objects (`os.family`). */
    key: string;
    /** Row label; defaults to the key itself. */
    label?: string;
    /** An `fmt.*` name, or a function returning any node. */
    format?: NamedFormatter | ((value: unknown, key: string, data: Record<string, unknown>) => ReactNode);
    /** Drop the row entirely when the value is missing (default: show "—"). */
    hideEmpty?: boolean;
}

/**
 * Dotted-path lookup. An own property wins over traversal, so a blob that
 * literally holds the key `"os.family"` still resolves (source behavior).
 */
function lookup(data: Record<string, unknown>, key: string): unknown {
    if (!key) return undefined;
    if (Object.prototype.hasOwnProperty.call(data, key)) return data[key];
    if (!key.includes('.')) return undefined;
    let cursor: unknown = data;
    for (const part of key.split('.')) {
        if (cursor == null || typeof cursor !== 'object') return undefined;
        cursor = (cursor as Record<string, unknown>)[part];
    }
    return cursor;
}

function formatValue(value: unknown, spec: KnownField, data: Record<string, unknown>): ReactNode {
    const { format } = spec;
    if (typeof format === 'function') return format(value, spec.key, data);
    if (typeof format === 'string') {
        const named = NAMED_FORMATTERS[format];
        if (named) return named(value);
        console.warn(`[KnownFieldsCard] unknown format ${JSON.stringify(format)} for key "${spec.key}" — rendering the raw value. Valid: ${Object.keys(NAMED_FORMATTERS).join(', ')}`);
    }
    // Default: scalars as text, objects as compact JSON in a code span.
    if (value !== null && typeof value === 'object') {
        return <code className="dim">{JSON.stringify(value)}</code>;
    }
    return String(value);
}

export function KnownFieldsCard({ data, known = [], showRaw = true, rawLabel = 'Raw JSON', rawCollapsed = true, emptyText = 'No data.' }: {
    data: Record<string, unknown>;
    known?: KnownField[];
    showRaw?: boolean;
    rawLabel?: string;
    /** `<details>` starts closed (default) or open. */
    rawCollapsed?: boolean;
    emptyText?: string;
}) {
    if (!known.length && Object.keys(data).length === 0) {
        return <div className="dim detail-known-fields-empty">{emptyText}</div>;
    }

    const rows = known
        .map((spec) => ({ spec, value: lookup(data, spec.key) }))
        .filter(({ spec, value }) => !(spec.hideEmpty && (value == null || value === '')));

    let json: string;
    try {
        json = JSON.stringify(data, null, 2);
    } catch {
        // Circular blobs reach here — the grid above is still worth rendering.
        json = String(data);
    }

    return (
        <div className="detail-known-fields-card">
            {rows.length > 0 && (
                <div className="detail-known-fields-grid">
                    {rows.map(({ spec, value }) => {
                        const missing = value == null || value === '';
                        return (
                            <div key={spec.key} className="flat-row detail-known-field-row">
                                <div className="flat-label">{spec.label ?? spec.key}</div>
                                <div className="flat-value">
                                    {missing ? <span className="dim-italic">—</span> : formatValue(value, spec, data)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            {showRaw && Object.keys(data).length > 0 && (
                <details className="detail-known-fields-raw" open={!rawCollapsed}>
                    <summary className="detail-known-fields-raw-summary">{rawLabel}</summary>
                    <pre className="detail-known-fields-raw-body">{json}</pre>
                </details>
            )}
        </div>
    );
}
