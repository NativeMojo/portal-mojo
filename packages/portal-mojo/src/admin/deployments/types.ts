/** Safe display DTOs. Raw server objects and upload/key material never reach Query. */
export interface Release {
    id: number;
    version: string;
    status: string;
    source: string;
    created: string;
}
export interface WebApp {
    id: number;
    slug: string;
    display_name: string;
    environment: string;
    deployment_ref: string;
    repository: string;
    build_output: string;
}
export interface WebAppObject extends WebApp {
    group: {
        id: number;
        name: string;
    };
}
export interface Certificate {
    status: string;
    not_after: string;
}
export interface Attempt {
    id: number;
    status: string;
    created: string;
    finished: string;
    release: Release | null;
}
export interface WebAppSummary {
    webapp: WebApp;
    address: {
        hostname: string;
        certificate: Certificate | null;
        aliases: {
            hostname: string;
            certificate: Certificate | null;
        }[];
    } | null;
    current_release: Release | null;
    latest_deployment: Attempt | null;
    onboarding: {
        status: string;
        cursor: string;
    };
    deployment_key: {
        linked: boolean;
        active: boolean;
    };
}
export interface WebAppList {
    items: WebAppSummary[];
    count: number;
    limit: number;
    truncated: boolean;
}
export interface Proof {
    runner: string;
    status: string;
    detail: string;
    sha: string;
    deployment: string;
    stderr_tail: string;
}
export interface PlatformAttempt {
    id: string;
    sha: string;
    framework_version: string;
    status: string;
    source: string;
    actor: string;
    retry_of: string;
    created: string;
    started: string;
    finished: string;
    duration_seconds: number | null;
    desired_commit: string;
    current_commits: string[];
    frozen_roster: string[];
    transitions: Proof[];
    node_evidence: Proof[];
    diagnosis: Proof[];
    detail: string;
    node_summary: Record<'expected' | 'proven' | 'reported' | 'failed' | 'dispatched' | 'other', number>;
}
export interface Collector<T> {
    status: string;
    observed_at: string;
    stale_after: string;
    reason: string;
    data: T | null;
}
export interface PlatformSnapshot {
    deployments: Collector<{
        items: PlatformAttempt[];
        limit: number;
        desired_commit: string;
        desired_deployment: string;
        currently_serving: {
            deployment: string;
            sha: string;
            framework_version: string;
            converged_at: string;
        } | null;
        coordination: {
            state: string;
            deployment: string;
            sha: string;
            at: string;
        };
        framework_pin: {
            mode: string;
            resolved: string;
        };
    }>;
    api: Collector<{
        version: string;
        commit: string;
    }>;
}
export interface Bootstrap {
    groups: {
        id: number;
        name: string;
        can_manage_dns: boolean;
    }[];
    can_create_webapp_group: boolean;
    setup: boolean;
}
export interface DeploymentStatus {
    deployment: number;
    webapp: number;
    release: number;
    version: string;
    status: string;
    terminal: boolean;
    success: boolean;
    detail: string;
    created: string;
    started: string;
    finished: string;
    targets: Proof[];
    rollback_targets: Proof[];
}
export interface CreateProfile {
    operation_id: string;
    group?: number;
    group_intent?: 'new';
    slug: string;
    display_name: string;
    environment: string;
    bucket: string;
    github_repository: string;
    deployment_ref: string;
    build_output: string;
}
export interface OnboardingOperation {
    operation_id: string;
    group: {
        id: number;
        name: string;
    };
    status: string;
    cursor: string;
    revision: number;
    profile: {
        slug: string;
        display_name: string;
    };
    evidence: {
        app: {
            status: string;
        };
        address: {
            status: string;
            hostname: string;
        };
        github: {
            status: string;
            reason: string;
        };
        verify: {
            status: string;
            detail: string;
        };
    };
    activity: {
        message: string;
        kind: string;
        at: string;
    }[];
    resources: {
        webapp: number | null;
    };
    next_attempt_at: string;
    last_error: string;
    modified: string;
}
export interface OnboardingOptions {
    buckets: string[];
    environments: string[];
    destination: boolean;
    destination_error: string;
    apps_domain: {
        id: number;
        name: string;
    } | null;
    apps_domain_error: string;
    github_connected: boolean;
}
export interface AddressPrecheck {
    verdict: string;
    hostname: string;
    reason: string;
    domain: {
        id: number;
        name: string;
    } | null;
    label: string;
}
export interface ManifestEntry {
    path: string;
    sha256: string;
    size: number;
}
export type ApiAction = 'retry' | 'verify' | 'converge';
/** Registered router paths supplied by the host, already checked against its section roster. */
export interface DeploymentsDestinations {
    domains?: string;
    serving?: string;
}
