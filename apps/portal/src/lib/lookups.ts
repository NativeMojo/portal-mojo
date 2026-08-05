// DjangoLookups — direct port of web-mojo's pure module (PORT-WHOLE tier).
// Parses filter keys like 'role__in' and renders human pill text.

export const LOOKUPS: Record<string, string> = {
    exact: 'is',
    in: 'is one of',
    not: 'is not',
    not_in: 'is not one of',
    gt: '>',
    gte: '≥',
    lt: '<',
    lte: '≤',
    contains: 'contains',
    icontains: 'contains',
    startswith: 'starts with',
    istartswith: 'starts with',
    endswith: 'ends with',
    iendswith: 'ends with',
    isnull: 'is empty',
    range: 'between',
};

export function parseFilterKey(key: string): { field: string; lookup: string } {
    const parts = key.split('__');
    const last = parts[parts.length - 1]!;
    if (parts.length > 1 && last in LOOKUPS) {
        return { field: parts.slice(0, -1).join('__'), lookup: last };
    }
    return { field: key, lookup: 'exact' };
}

export function formatFilterDisplay(key: string, value: string, label?: string): string {
    const { field, lookup } = parseFilterKey(key);
    const name = label ?? field.replace(/_/g, ' ');
    if (lookup === 'isnull') return value === 'true' ? `${name} is empty` : `${name} is set`;
    if (lookup === 'in' || lookup === 'not_in') {
        const items = value.split(',').map((s) => `'${s.trim()}'`).join(', ');
        return `${name} ${LOOKUPS[lookup]} ${items}`;
    }
    return `${name} ${LOOKUPS[lookup]} '${value}'`;
}
