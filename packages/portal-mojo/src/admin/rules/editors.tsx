import { useCallback, useMemo, useState } from 'react';
import { SchemaForm, modal, toast, type Field, type FormData } from '../../ui';
import { HandlerChainBuilder } from './HandlerChainBuilder';
import {
    BUNDLE_BY_OPTIONS, COMPARATOR_OPTIONS, MATCH_BY_OPTIONS, RuleModel, RuleSetModel, VALUE_TYPE_OPTIONS,
    optionsWithUnknownValue, ruleChanges, ruleSetChanges, type RuleRow, type RuleSetRow,
} from './models';

const RULESET_FIELDS = (row?: RuleSetRow): Field[] => [
    { name: 'name', type: 'text', label: 'Name', required: true }, { name: 'category', type: 'text', label: 'Event category', required: true },
    { name: 'priority', type: 'text', label: 'Priority', required: true, columns: 6 },
    { name: 'match_by', type: 'select', label: 'Match mode', columns: 6, options: optionsWithUnknownValue(MATCH_BY_OPTIONS, row?.match_by) },
    { name: 'bundle_by', type: 'select', label: 'Bundle by', columns: 6, options: optionsWithUnknownValue(BUNDLE_BY_OPTIONS, row?.bundle_by) },
    { name: 'bundle_minutes', type: 'text', label: 'Bundle minutes (0 disables, blank is unbounded)', columns: 6 },
    { name: 'trigger_count', type: 'text', label: 'Trigger count', columns: 6 }, { name: 'trigger_window', type: 'text', label: 'Trigger window (minutes)', columns: 6 },
    { name: 'retrigger_every', type: 'text', label: 'Re-trigger every', columns: 6 }, { name: 'bundle_by_rule_set', type: 'switch', label: 'Include rule set in bundle key', columns: 6 },
    { name: 'metadata.agent_prompt', type: 'textarea', label: 'Agent prompt', help: 'Merged into metadata without replacing unknown metadata keys.' },
];

function RuleSetEditor({ row, close }: { row?: RuleSetRow; close: (saved: boolean) => void }) {
    const save = RuleSetModel.useSave(); const creating = !row;
    const initial: FormData = row ? { name: row.name ?? '', category: row.category, priority: row.priority, match_by: row.match_by, bundle_by: row.bundle_by, bundle_minutes: row.bundle_minutes, trigger_count: row.trigger_count, trigger_window: row.trigger_window, retrigger_every: row.retrigger_every, bundle_by_rule_set: row.bundle_by_rule_set, 'metadata.agent_prompt': typeof row.metadata.agent_prompt === 'string' ? row.metadata.agent_prompt : '' } : { name: '', category: '', priority: 10, match_by: 0, bundle_by: 4, bundle_minutes: 30, trigger_count: null, trigger_window: null, retrigger_every: null, bundle_by_rule_set: true, 'metadata.agent_prompt': '' };
    return <div className="modal-pad"><h2 className="modal-title">{creating ? 'Create inactive rule set' : 'Edit rule set'}</h2>{creating && <div className="form-alert form-alert-info">New rule sets are always inactive. Add conditions and review the handler before enabling.</div>}<SchemaForm fields={RULESET_FIELDS(row)} initial={initial} submitText={creating ? 'Create inactive rule set' : 'Save changes'} onCancel={() => close(false)} onSubmit={async (data) => { await save.mutateAsync({ id: row?.id ?? null, changes: ruleSetChanges(data, creating, row) }); toast.success(creating ? 'Inactive rule set created' : 'Rule set updated'); close(true); }} /></div>;
}

export async function openRuleSetEditor(row?: RuleSetRow): Promise<boolean> { return (await modal.open<boolean>((close) => <RuleSetEditor row={row} close={close} />, { size: 'lg' })) ?? false; }

function RuleEditor({ parent, row, nextIndex, close }: { parent: number; row?: RuleRow; nextIndex: number; close: (saved: boolean) => void }) {
    const save = RuleModel.useSave(); const creating = !row;
    const fields: Field[] = [
        { name: 'name', type: 'text', label: 'Condition name', required: true }, { name: 'index', type: 'text', label: 'Evaluation index', required: true, columns: 6 },
        { name: 'field_name', type: 'text', label: 'Event or metadata field', required: true, columns: 6 },
        { name: 'comparator', type: 'select', label: 'Comparator', options: optionsWithUnknownValue(COMPARATOR_OPTIONS, row?.comparator), columns: 6 },
        { name: 'value_type', type: 'select', label: 'Value type', options: optionsWithUnknownValue(VALUE_TYPE_OPTIONS, row?.value_type), columns: 6, help: row?.value_type === 'bool' ? 'Legacy bool values are visible, but cannot be changed safely until the backend conversion is fixed.' : undefined },
        { name: 'value', type: 'textarea', label: 'Comparison value', required: true }, { name: 'is_required', type: 'switch', label: 'Required condition' },
    ];
    const initial: FormData = row ? { name: row.name ?? '', index: row.index, field_name: row.field_name ?? '', comparator: row.comparator, value_type: row.value_type, value: row.value, is_required: row.is_required === 1 } : { name: '', index: nextIndex, field_name: '', comparator: '==', value_type: 'str', value: '', is_required: false };
    return <div className="modal-pad"><h2 className="modal-title">{creating ? 'Add condition' : 'Edit condition'}</h2><SchemaForm fields={fields} initial={initial} onCancel={() => close(false)} onSubmit={async (data) => { await save.mutateAsync({ id: row?.id ?? null, changes: ruleChanges({ ...data, parent }, creating, row) }); toast.success(creating ? 'Condition added' : 'Condition updated'); close(true); }} /></div>;
}
export async function openRuleEditor(parent: number, row?: RuleRow, nextIndex = 0): Promise<boolean> { return (await modal.open<boolean>((close) => <RuleEditor parent={parent} row={row} nextIndex={nextIndex} close={close} />, { size: 'lg' })) ?? false; }

function HandlerEditor({ row, close }: { row: RuleSetRow; close: (saved: boolean) => void }) {
    const save = RuleSetModel.useSave(); const [value, setValue] = useState(row.handler ?? ''); const [valid, setValid] = useState(true); const [messages, setMessages] = useState<string[]>([]);
    const changed = value !== (row.handler ?? '');
    const summary = useMemo(() => [...new Set(messages)], [messages]);
    const validationChanged = useCallback((next: boolean, nextMessages: string[]) => { setValid(next); setMessages(nextMessages); }, []);
    return <form className="modal-pad" onSubmit={async (event) => { event.preventDefault(); if (!valid || !changed) return; try { await save.mutateAsync({ id: row.id, changes: { handler: value } }); toast.success('Handler chain updated'); close(true); } catch (error) { toast.error(error instanceof Error ? error.message : 'Handler save failed'); } }}><h2 className="modal-title">Edit handler dispatch chain</h2><HandlerChainBuilder value={value} onChange={setValue} onValidationChange={validationChanged} />{summary.length > 0 && <p className="dim">{summary.length} validation note{summary.length === 1 ? '' : 's'} shown inline. Structural errors must be resolved before save.</p>}<div className="modal-actions"><button type="button" className="btn" onClick={() => close(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!changed || !valid || save.isPending}>{save.isPending ? 'Saving…' : 'Save handler chain'}</button></div></form>;
}
export async function openHandlerChainEditor(row: RuleSetRow): Promise<boolean> { return (await modal.open<boolean>((close) => <HandlerEditor row={row} close={close} />, { size: 'lg' })) ?? false; }

export async function confirmCatchAllEnable(row: RuleSetRow, conditionCount: number): Promise<boolean> {
    if (conditionCount > 0) return window.confirm(`Enable “${row.name}” in category ${row.category} at priority ${row.priority}?`);
    return window.confirm(`PREEMPTION WARNING\n\n“${row.name}” has zero conditions. Enabling it creates a catch-all for category “${row.category}” at priority ${row.priority}; it can preempt every later active rule set. Enable anyway?`);
}
