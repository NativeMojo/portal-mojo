import { actionReason, drainedNodeReason, nodeRemovalReason, offered } from './data';
import type { CapacityReport, CapacityStep } from './types';

/** Standalone intent identifies every existing member explicitly; the Dashboard compiler is unchanged. */
export interface CapacityDraft {
    addNodes: number; source: string; subnet: string; removeNodes: string[]; terminateNodes: string[];
    databases: Record<string, { addReaders: number; sizes: Record<string, string>; removeReaders: string[] }>;
    caches: Record<string, { replicas: number; size: string }>;
}
export function newCapacityDraft(report: CapacityReport): CapacityDraft {
    return { addNodes: 0, source: '', subnet: '', removeNodes: [], terminateNodes: [], databases: Object.fromEntries(report.databases.map(row => [row.identifier, { addReaders: 0, sizes: {}, removeReaders: [] }])), caches: Object.fromEntries(report.caches.map(row => [row.identifier, { replicas: row.replica_count, size: '' }])) };
}
export function compileCapacityDraft(report: CapacityReport, draft: CapacityDraft): CapacityStep[] {
    if (report.mode !== 'managed') throw new Error('External infrastructure is read-only.');
    const steps: CapacityStep[] = [];
    const add = (step: CapacityStep) => { if (!offered(report, step.action)) throw new Error(`${step.action}: ${actionReason(report, step.action)}`); steps.push(step); };
    const count = (value: number, label: string, min = 0, max = 20) => { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`); };
    const unique = (ids: string[], label: string) => { if (new Set(ids).size !== ids.length) throw new Error(`${label} contains a duplicate target.`); };
    count(draft.addNodes, 'App additions');
    unique(draft.removeNodes, 'Node removals'); unique(draft.terminateNodes, 'Node terminations');
    if (draft.addNodes) {
        if (!report.nodes.inventory_available || !report.nodes.serving_available) throw new Error('Fresh node inventory and serving evidence are required.');
        const source = report.nodes.instances.find(n => n.id === draft.source && n.healthy && n.registered && n.instance_state === 'running' && n.lifecycle_state === 'available');
        if (!source) throw new Error('Choose an explicit healthy source node.');
        if (draft.removeNodes.includes(source.id) || draft.terminateNodes.includes(source.id)) throw new Error('Keep the selected source node while adding nodes.');
        if (draft.subnet && !/^subnet-[A-Za-z0-9]+$/.test(draft.subnet)) throw new Error('Subnet must be a subnet-… identifier.');
        for (let i = 0; i < draft.addNodes; i++) add({ action: 'add_node', source_instance: source.id, ...(draft.subnet ? { subnet_id: draft.subnet } : {}) });
    }
    for (const id of draft.removeNodes) {
        if (draft.terminateNodes.includes(id)) throw new Error('Choose one removal task per node.');
        const node = report.nodes.instances.find(n => n.id === id);
        if (!node) throw new Error('Selected node is absent from the fresh inventory.');
        const reason = nodeRemovalReason(report, node, draft.removeNodes.filter(other => other !== id));
        if (reason) throw new Error(reason);
        add({ action: 'drain_node', resource: id }); add({ action: 'terminate_node', resource: id });
    }
    for (const id of draft.terminateNodes) {
        const node = report.nodes.instances.find(n => n.id === id);
        if (!node) throw new Error('Selected drained node is absent from the fresh inventory.');
        const reason = drainedNodeReason(report, node); if (reason) throw new Error(reason);
        add({ action: 'terminate_node', resource: id });
    }
    for (const [id, d] of Object.entries(draft.databases)) {
        if (!d.addReaders && !d.removeReaders.length && !Object.values(d.sizes).some(Boolean)) continue;
        const row = report.databases.find(r => r.identifier === id);
        if (!row || !report.databases_available || row.blocked_reason) throw new Error(`${id}: ${row?.blocked_reason ?? 'Database inventory unavailable.'}`);
        count(d.addReaders, 'Reader additions'); unique(d.removeReaders, 'Reader removals');
        for (const target of d.removeReaders) {
            const member = row.members.find(m => m.id === target);
            if (!row.readers.includes(target) || !member?.can_remove) throw new Error(`${target}: reader removal is unavailable.`);
            if (d.sizes[target]) throw new Error(`${target}: choose resize or removal.`);
            add({ action: 'remove_reader', resource: target });
        }
        for (let i = 0; i < d.addReaders; i++) add({ action: 'add_reader', resource: id });
        for (const [target, size] of Object.entries(d.sizes)) {
            if (!size) continue;
            const member = row.members.find(m => m.id === target), choice = report.sizes.database.find(s => s.size === size);
            if (!member?.can_resize || !choice) throw new Error(`${target}: choose an available member and curated database size.`);
            if (choice.type !== member.instance_class) add({ action: 'resize_database', resource: target, size, apply_immediately: true });
        }
    }
    for (const [id, d] of Object.entries(draft.caches)) {
        const row = report.caches.find(r => r.identifier === id);
        if (!row) throw new Error(`${id}: Redis group is absent from the fresh inventory.`);
        const choice = d.size ? report.sizes.cache.find(s => s.size === d.size) : null;
        const resizing = !!choice && choice.type !== row.node_type;
        if (d.size && !choice) throw new Error(`${id}: choose a curated Redis size.`);
        count(d.replicas, 'Redis replicas', row.min_replicas, 100);
        if (d.replicas === row.replica_count && !resizing) continue;
        if (!report.caches_available || row.blocked_reason) throw new Error(`${id}: ${row.blocked_reason ?? 'Redis inventory unavailable.'}`);
        if (d.replicas !== row.replica_count && resizing) throw new Error(`${id}: change size or replica count in one plan. Apply, refresh, then review the other change separately.`);
        if (resizing) add({ action: 'resize_cache', resource: id, size: d.size, apply_immediately: true });
        if (d.replicas !== row.replica_count) add({ action: 'set_cache_replicas', resource: id, count: d.replicas, apply_immediately: true });
    }
    if (steps.length > 20) throw new Error(`A plan supports 20 steps; this draft has ${steps.length}. Reduce the changes.`);
    return steps;
}
export function observationAge(value: string | null, now = Date.now()): string {
    const time = value ? Date.parse(value) : NaN;
    if (!Number.isFinite(time)) return 'Observation time unavailable';
    const seconds = Math.max(0, Math.floor((now - time) / 1000));
    return seconds < 60 ? `Observed ${seconds}s ago` : seconds < 3600 ? `Observed ${Math.floor(seconds / 60)}m ago` : `Observed ${Math.floor(seconds / 3600)}h ago`;
}
export function completeAllowlist(report: CapacityReport): boolean {
    const e = report.egress;
    return e.available && e.fleet_available && e.addresses_available && e.policy_available && e.enabled && !e.pending_nodes.length;
}
