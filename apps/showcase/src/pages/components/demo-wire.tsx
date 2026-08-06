// Shared playground plumbing for the two demos that teach the WIRE:
// the filters test bed and the expanding-search test bed. Both make the same
// claim — "server-side always" — so both print the exact params object going
// out instead of asserting it in prose.
//
// It also declares the playground's own URL param. `?demo=` rides the same
// query string the params store owns, and everything non-reserved in there is
// a Django lookup: without this line every ModelTable in the playground ships
// `demo=<section>` to the backend (`/api/group?demo=filters` → a lookup on a
// field that does not exist → zero rows on the mock, FieldError live) and the
// "All" preset chip can never match. Module scope, so it lands before any
// table renders — ComponentsPage imports these demo modules at load.
import { useEffect, useState } from 'react';
import {
    formatFilterDisplay, parseFilterKey, registerNonFilterParams, type Params,
} from 'portal-mojo/client';
import type { FilterDef } from 'portal-mojo/ui';

registerNonFilterParams('demo');

type WireRole = 'paging' | 'sort' | 'search' | 'filter' | 'range';

const ROLE_OF: Record<string, WireRole> = {
    start: 'paging', size: 'paging', sort: 'sort', search: 'search',
    dr_field: 'range', dr_start: 'range', dr_end: 'range',
};

const RANGE_WHY: Record<string, string> = {
    dr_field: 'which column the range applies to',
    dr_start: 'inclusive lower bound (canonical YYYY-MM-DD)',
    dr_end: 'inclusive upper bound',
};

/** Option values print as their labels, exactly like the pills do. */
function prettyValue(def: FilterDef | undefined, raw: string): string {
    if (def?.options) {
        return raw.split(',')
            .map((v) => def.options!.find((o) => o.value === v.trim())?.label ?? v.trim())
            .join(', ');
    }
    if (def?.type === 'boolean') return raw === 'true' ? (def.trueLabel ?? 'True') : (def.falseLabel ?? 'False');
    return raw;
}

function why(key: string, value: string, defs: FilterDef[]): string {
    switch (key) {
        case 'start': return 'row OFFSET — django-mojo pages by start/size, never by page number';
        case 'size': return 'rows per response';
        case 'sort': return value.startsWith('-') ? `descending by ${value.slice(1)} (the '-' prefix)` : `ascending by ${value}`;
        case 'search': return "matched server-side against the model's SEARCH_FIELDS";
        default: break;
    }
    if (key in RANGE_WHY) return RANGE_WHY[key]!;
    const { field } = parseFilterKey(key);
    const def = defs.find((d) => d.type !== 'daterange' && d.key === field);
    return formatFilterDisplay(key, prettyValue(def, value), def?.label);
}

/**
 * The live read-out: the request the params store is about to make, split
 * into the four parts of the django-mojo list contract (paging, ordering,
 * search, lookups). It pulses whenever the outgoing params change.
 */
export function WireParams({ endpoint, params, defs = [], matched, total, loading = false, note }: {
    endpoint: string;
    params: Params;
    defs?: FilterDef[];
    matched?: number;
    total?: number;
    loading?: boolean;
    note?: string;
}) {
    const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
    const qs = new URLSearchParams();
    for (const [key, value] of entries) qs.set(key, String(value));
    const query = qs.toString();

    // Remount the request line on every change so the CSS pulse restarts.
    const [nonce, setNonce] = useState(0);
    useEffect(() => { setNonce((n) => n + 1); }, [query]);

    const filterCount = entries.filter(([k]) => (ROLE_OF[k] ?? 'filter') === 'filter' || ROLE_OF[k] === 'range').length;

    return (
        <div className="wirebox">
            <code key={nonce} className="wirebox-req wire-flash">
                <span className="req-verb">GET </span>
                <span className="req-path">{endpoint}</span>
                {query && <span className="req-q">?{query}</span>}
            </code>
            <table className="wire-tbl">
                <thead>
                    <tr>
                        <th>param</th>
                        <th>value</th>
                        <th>part of the contract</th>
                        <th>what the server does with it</th>
                    </tr>
                </thead>
                <tbody>
                    {entries.map(([key, value]) => {
                        const role = ROLE_OF[key] ?? 'filter';
                        return (
                            <tr key={key}>
                                <td className="wire-k">{key}</td>
                                <td className="wire-v">{String(value)}</td>
                                <td><span className={`wire-role wire-role--${role}`}>{role}</span></td>
                                <td className="wire-why">{why(key, String(value), defs)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {filterCount === 0 && (
                <div className="wire-empty">
                    No filter params yet — add one and watch a Django lookup appear above.
                </div>
            )}
            <div className="wire-result">
                {loading ? <span>fetching…</span> : (
                    <>
                        <b>{matched ?? '—'}</b>
                        <span>
                            rows match on the server{total != null ? ` — out of ${total} in the model` : ''}
                            {' '}(the envelope&apos;s <code>count</code>, not the page).
                        </span>
                    </>
                )}
                {note && <span className="dim">{note}</span>}
            </div>
        </div>
    );
}
