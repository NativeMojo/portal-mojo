export type FleetFacts = Record<string, unknown>;
export interface FleetSource {
    status: string;
    observed_at: string | null;
    stale_after: string | null;
    reason: string | null;
    data: FleetFacts;
}
export interface FleetDashboard {
    schema_version: 2;
    observed_at: string;
    availability: {
        state: 'ok' | 'down' | 'unknown';
        message: string;
        down: string[];
    };
    attention: {
        message: string | null;
    };
    sources: Record<string, FleetSource>;
}
export type CapacityAction = 'add_node' | 'drain_node' | 'terminate_node' | 'add_reader' | 'remove_reader' | 'set_cache_replicas' | 'resize_cache' | 'resize_database';
export interface CapacityStep {
    action: CapacityAction;
    resource?: string;
    size?: string;
    count?: number;
    apply_immediately?: true;
    source_instance?: string;
    subnet_id?: string;
}
export interface CapacityNode {
    id: string;
    name: string;
    state: string;
    instance_state: string | null;
    lifecycle_state: string;
    instance_type: string | null;
    zone: string | null;
    subnet_id: string | null;
    public_ip: string | null;
    healthy: boolean;
    registered: boolean;
    can_drain: boolean;
    self: boolean;
    primary: boolean;
    added_by_capacity: boolean;
    stable_ip: boolean;
    groups: string[];
}
export interface DatabaseMember {
    id: string;
    role: string;
    status: string | null;
    lifecycle_state: string;
    instance_class: string | null;
    can_resize: boolean;
    can_remove: boolean;
}
export interface CapacityDatabase {
    identifier: string;
    kind: 'aurora' | 'standalone';
    engine: string;
    status: string;
    writer: string | null;
    readers: string[];
    instance_class: string | null;
    writer_instance_class: string | null;
    reader_instance_classes: Record<string, string | null>;
    members: DatabaseMember[];
    blocked_reason: string | null;
}
export interface CapacityCache {
    identifier: string;
    status: string;
    node_type: string;
    replica_count: number;
    min_replicas: number;
    resize_impact: 'rolling' | 'downtime';
    blocked_reason: string | null;
    members: {
        id: string;
        role: string;
        status: string;
        lifecycle_state: string;
    }[];
}
export interface CapacitySize {
    size: string;
    label: string;
    type: string;
    monthly_usd: number | null;
}
export interface CapacityReport {
    schema_version: 2;
    mode: string;
    region: string;
    generated_at: string;
    identity_available: boolean;
    identity: {
        project: string;
        environment: string;
    } | null;
    node_id_pinned: boolean;
    nodes: {
        self: string | null;
        self_check: string;
        serving_available: boolean;
        inventory_available: boolean;
        instances: CapacityNode[];
    };
    databases_available: boolean;
    caches_available: boolean;
    databases: CapacityDatabase[];
    caches: CapacityCache[];
    sizes: {
        database: CapacitySize[];
        cache: CapacitySize[];
    };
    actions: Record<string, {
        offered: boolean;
        blocked_reason: string | null;
    }>;
    warnings: {
        code: string;
        message: string;
        iam_action: string | null;
    }[];
    reader_routing: {
        database: {
            active: boolean;
            host: string | null;
            skip_reason: string | null;
            matches_reader_endpoint: boolean | null;
        };
        redis: {
            active: boolean;
        };
    };
    egress: {
        available: boolean;
        fleet_available: boolean;
        addresses_available: boolean;
        policy_available: boolean;
        enabled: boolean;
        addresses: string[];
        attached: {
            instance: string;
            public_ip: string;
            managed: boolean;
        }[];
        fallback_attached: {
            instance: string;
            public_ip: string;
            managed: boolean;
        }[];
        reserved: {
            public_ip: string;
        }[];
        pending_nodes: string[];
    };
}
export interface CapacityPlanStep {
    index: number;
    action: CapacityAction;
    resource: string;
    description: string;
    kind: string;
    params: FleetFacts;
    warnings: string[];
    monthly_delta_usd: number | null;
}
export interface CapacityPlan {
    schema_version: 2;
    id: string;
    actor: number;
    created: number | string;
    expires_at: string;
    expires_in: number;
    steps: CapacityPlanStep[];
    total_monthly_delta_usd: number | null;
    estimate_complete: boolean;
    order_note: string;
}
export interface CapacityBatchStep {
    index: number;
    action: CapacityAction;
    resource: string;
    description: string;
    state: string;
    operation: string | null;
    phase: string | null;
    message: string | null;
    error_code: string | null;
}
export interface CapacityBatch {
    schema_version: 2;
    id: string;
    plan_id: string;
    actor: number;
    state: string;
    started: number | string;
    current_index: number;
    message: string | null;
    error_code: string | null;
    stalled: boolean;
    steps: CapacityBatchStep[];
}
