import type { CapacityAction, CapacityDatabase, CapacityNode, CapacityReport, CapacityStep } from './types';
export interface FleetDraft {
    addNodes: number;
    source: string;
    subnet: string;
    removeNodes: string[];
    terminateNodes: string[];
    databases: Record<string, {
        readers: number;
        writerSize: string;
        readerSize: string;
    }>;
    caches: Record<string, {
        replicas: number;
        size: string;
    }>;
}
export function newFleetDraft(report: CapacityReport): FleetDraft { return { addNodes: 0, source: '', subnet: '', removeNodes: [], terminateNodes: [], databases: Object.fromEntries(report.databases.map(r => [r.identifier, { readers: r.readers.length, writerSize: '', readerSize: '' }])), caches: Object.fromEntries(report.caches.map(r => [r.identifier, { replicas: r.replica_count, size: '' }])) }; }
export const offered = (r: CapacityReport, action: CapacityAction) => r.actions[action]?.offered === true;
export const actionReason = (r: CapacityReport, action: CapacityAction) => r.actions[action]?.blocked_reason ?? 'Unavailable';
export function nodeRemovalReason(report: CapacityReport, node: CapacityNode, selected: readonly string[] = []): string | null {
    if (report.mode !== 'managed')
        return 'Infrastructure is managed externally.';
    if (!report.nodes.serving_available || !report.nodes.inventory_available)
        return 'Node evidence is unavailable.';
    if (report.nodes.self_check !== 'matched')
        return 'The serving node could not identify itself. Refresh before removal.';
    if (node.self || node.id === report.nodes.self)
        return 'This node is answering your request.';
    if (!offered(report, 'drain_node') || !offered(report, 'terminate_node'))
        return actionReason(report, !offered(report, 'drain_node') ? 'drain_node' : 'terminate_node');
    if (!node.can_drain)
        return 'This node cannot currently be drained.';
    const healthy = report.nodes.instances.filter(r => r.healthy);
    if (node.healthy && healthy.filter(r => !selected.includes(r.id) && r.id !== node.id).length < 1)
        return 'Keep at least one currently healthy target. New additions do not count yet.';
    return null;
}
export function drainedNodeReason(report: CapacityReport, node: CapacityNode): string | null {
    if (report.mode !== 'managed' || !offered(report, 'terminate_node'))
        return actionReason(report, 'terminate_node');
    if (!report.identity_available || !report.identity || !report.nodes.serving_available || !report.nodes.inventory_available)
        return 'Fresh owned-node inventory is required.';
    if (report.nodes.self_check !== 'matched' || node.self || node.id === report.nodes.self)
        return 'The serving node must be identified and retained.';
    if (node.registered || node.healthy || node.state !== 'unregistered' || node.lifecycle_state !== 'available' || node.instance_state !== 'running')
        return 'Drain completion is not yet proved. Refresh and inspect.';
    return null;
}
function integer(value: number, label: string, min = 0) { if (!Number.isSafeInteger(value) || value < min)
    throw new Error(`${label} must be a whole number of at least ${min}.`); }
export function databaseRemovals(row: CapacityDatabase, target: number): string[] {
    integer(target, 'Reader count');
    const needed = Math.max(0, row.readers.length - target);
    const removable = row.members.filter(m => row.readers.includes(m.id) && m.can_remove).map(m => m.id).reverse();
    if (removable.length < needed)
        throw new Error(`${row.identifier}: a reader is still transitioning and cannot be removed.`);
    return removable.slice(0, needed);
}
export function compileFleetSteps(report: CapacityReport, draft: FleetDraft): CapacityStep[] {
    if (report.mode !== 'managed')
        throw new Error('External infrastructure is read-only.');
    const steps: CapacityStep[] = [];
    const add = (step: CapacityStep) => { if (!offered(report, step.action))
        throw new Error(`${step.action}: ${actionReason(report, step.action)}`); steps.push(step); };
    integer(draft.addNodes, 'App additions');
    if (draft.addNodes > 20)
        throw new Error('A plan holds at most 20 steps.');
    const source = draft.source.trim(), subnet = draft.subnet.trim();
    if (draft.addNodes && subnet && !/^subnet-[A-Za-z0-9]+$/.test(subnet))
        throw new Error('Subnet must be a subnet-… identifier.');
    if (draft.addNodes && source && !report.nodes.instances.some(n => n.id === source && n.healthy && n.registered && n.instance_state === 'running'))
        throw new Error('Choose a healthy serving source node.');
    for (let i = 0; i < draft.addNodes; i++)
        add({ action: 'add_node', ...(source ? { source_instance: source } : {}), ...(subnet ? { subnet_id: subnet } : {}) });
    for (const id of draft.removeNodes) {
        const node = report.nodes.instances.find(n => n.id === id);
        if (!node)
            throw new Error('Node inventory changed. Refresh.');
        const reason = nodeRemovalReason(report, node, draft.removeNodes.filter(n => n !== id));
        if (reason)
            throw new Error(reason);
        add({ action: 'drain_node', resource: id });
        add({ action: 'terminate_node', resource: id });
    }
    for (const id of draft.terminateNodes) {
        const node = report.nodes.instances.find(n => n.id === id);
        if (!node)
            throw new Error('Drained node is no longer in the inventory.');
        const reason = drainedNodeReason(report, node);
        if (reason)
            throw new Error(reason);
        add({ action: 'terminate_node', resource: id });
    }
    const resize = (resource: string, size: string, current: string | null, ladder: CapacityReport['sizes']['database'], action: 'resize_database' | 'resize_cache') => { if (!size)
        return; const target = ladder.find(s => s.size === size); if (!target)
        throw new Error('Choose a server-provided curated size.'); if (target.type !== current)
        add({ action, resource, size, apply_immediately: true }); };
    for (const row of report.databases) {
        const d = draft.databases[row.identifier];
        if (!d)
            continue;
        integer(d.readers, 'Reader count');
        if (d.readers > 20)
            throw new Error('A plan holds at most 20 steps.');
        const changing = d.readers !== row.readers.length || !!d.writerSize || !!d.readerSize;
        if (changing && (!report.databases_available || row.blocked_reason))
            throw new Error(`${row.identifier}: ${row.blocked_reason ?? 'Database inventory unavailable'}`);
        const removes = databaseRemovals(row, d.readers);
        for (const id of removes)
            add({ action: 'remove_reader', resource: id });
        for (let i = row.readers.length; i < d.readers; i++)
            add({ action: 'add_reader', resource: row.identifier });
        const writer = row.kind === 'aurora' ? row.writer : row.identifier;
        if (d.writerSize) {
            if (!writer || !row.members.find(m => m.id === writer)?.can_resize)
                throw new Error('Writer resizing is unavailable.');
            resize(writer, d.writerSize, row.writer_instance_class ?? row.instance_class, report.sizes.database, 'resize_database');
        }
        if (d.readerSize) {
            if (!row.readers.length)
                throw new Error('Existing-reader sizing requires existing readers.');
            for (const id of row.readers.filter(id => !removes.includes(id))) {
                const member = row.members.find(m => m.id === id);
                if (!member?.can_resize)
                    throw new Error(`${id} cannot currently resize.`);
                resize(id, d.readerSize, row.reader_instance_classes[id] ?? null, report.sizes.database, 'resize_database');
            }
        }
    }
    for (const row of report.caches) {
        const d = draft.caches[row.identifier];
        if (!d)
            continue;
        integer(d.replicas, 'Redis replica count', row.min_replicas);
        if (d.replicas > 100)
            throw new Error('Redis replica count exceeds the supported staging range.');
        if ((d.replicas !== row.replica_count || d.size) && (!report.caches_available || row.blocked_reason))
            throw new Error(`${row.identifier}: ${row.blocked_reason ?? 'Cache inventory unavailable'}`);
        if (d.replicas !== row.replica_count)
            add({ action: 'set_cache_replicas', resource: row.identifier, count: d.replicas, apply_immediately: true });
        resize(row.identifier, d.size, row.node_type, report.sizes.cache, 'resize_cache');
    }
    if (steps.length > 20)
        throw new Error(`A plan holds at most 20 steps; this proposal has ${steps.length}. Reduce the changes.`);
    return steps;
}
export const monthlyPrice = (value: number | null) => value == null ? 'Price unknown' : `${value < 0 ? '−' : value > 0 ? '+' : ''}$${Math.abs(value).toFixed(2)}/month`;
