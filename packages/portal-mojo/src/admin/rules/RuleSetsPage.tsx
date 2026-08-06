import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCan } from '../../client';
import { Badge, ModelTable, fmt, type Column, type FilterDef } from '../../ui';
import { parseHandlerChain } from './handler-dsl';
import { openRuleSetEditor } from './editors';
import { BUNDLE_BY_OPTIONS, RULESET_MANAGE_PERMS, RuleSetModel, type RuleSetRow } from './models';

function handlerSummary(value: string | null) {
    const chain = parseHandlerChain(value);
    if (!chain.steps.length) return <span className="dim">Record only</span>;
    return <span className="handler-chip-row">{chain.steps.map((step, index) => <Badge key={`${index}:${step.raw}`} tone={step.supported && step.runtime === 'effective' ? 'info' : 'warning'}>{step.scheme ?? 'malformed'}{step.runtime === 'effective' ? '' : ' ⚠'}</Badge>)}</span>;
}

export function RuleSetsPage() {
    const navigate = useNavigate(); const { can: canManage } = useCan(RULESET_MANAGE_PERMS);
    const inventory = RuleSetModel.useList({ size: 500, sort: 'priority' });
    const ties = useMemo(() => {
        const counts = new Map<string, number>();
        for (const row of inventory.data?.rows ?? []) { const key = `${row.category}\u0000${row.priority}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
        return [...counts].filter(([, count]) => count > 1).map(([key]) => { const [category, priority] = key.split('\u0000'); return `${category} priority ${priority}`; });
    }, [inventory.data]);
    const columns: Column<RuleSetRow>[] = [
        { key: 'priority', label: 'Priority', sortable: true, align: 'center', render: (row) => <Badge tone="primary">{row.priority}</Badge> },
        { key: 'is_active', label: 'State', sortable: true, render: (row) => <Badge tone={row.is_active ? 'success' : 'muted'}>{row.is_active ? 'Active' : 'Inactive'}</Badge> },
        { key: 'name', label: 'Rule set', sortable: true, hideable: false, render: (row) => <span><strong>{row.name || `Rule set #${row.id}`}</strong><small className="table-cell-subtitle"><code>{row.category}</code> · first active match wins</small></span> },
        { key: 'bundle_by', label: 'Triggering', sortable: true, render: (row) => <span>{BUNDLE_BY_OPTIONS.find((option) => Number(option.value) === row.bundle_by)?.label ?? `Unknown (${row.bundle_by})`}<small className="table-cell-subtitle">{row.trigger_count == null ? 'Immediate' : `${row.trigger_count} events${row.trigger_window == null ? '' : ` / ${row.trigger_window}m`}`} · bundle {row.bundle_minutes == null ? 'unbounded' : `${row.bundle_minutes}m`}</small></span> },
        { key: 'handler', label: 'Dispatch chain', render: (row) => handlerSummary(row.handler) },
        { key: 'modified', label: 'Modified', sortable: true, render: (row) => fmt.datetime(row.modified) },
    ];
    const filters: FilterDef[] = [{ key: 'is_active', label: 'Active', type: 'boolean' }, { key: 'category', label: 'Category', type: 'text' }, { key: 'priority', label: 'Priority', type: 'number' }, { key: 'bundle_by', label: 'Bundle mode', type: 'select', options: BUNDLE_BY_OPTIONS.map((option) => ({ value: String(option.value), label: option.label })) }];
    return <div className="admin-rules-page">{ties.length > 0 && <div className="rule-priority-warning"><strong>Undefined tie order:</strong> {ties.join(', ')}. Edit one priority; multi-row reorder is intentionally unavailable.</div>}<ModelTable model={RuleSetModel} title="Rule Engine" eyebrow="Security operations" columns={columns} filters={filters} searchable searchPlaceholder="Search rule-set names" defaultParams={{ sort: 'priority' }} presets={[{ key: 'all', label: 'All', params: {} }, { key: 'active', label: 'Active', params: { is_active: 'true' } }, { key: 'inactive', label: 'Inactive', params: { is_active: 'false' } }]} columnChooser persistState persistKey="admin-security-rules" onRowClick={(row) => navigate(String(row.id))} {...(canManage ? { addLabel: 'New inactive rule set', onAdd: () => void openRuleSetEditor() } : {})} /></div>;
}
