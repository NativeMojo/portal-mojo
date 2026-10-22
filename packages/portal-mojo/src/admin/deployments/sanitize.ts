import { detectTemporal } from '../../ui/date/fns';
import type { AddressPrecheck, Attempt, Bootstrap, Certificate, Collector, DeploymentStatus, OnboardingOperation, OnboardingOptions, PlatformAttempt, PlatformSnapshot, Proof, Release, WebApp, WebAppList, WebAppObject, WebAppSummary } from './types';
export const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const text = (v: unknown, max = 256): string => typeof v === 'string' ? v.slice(0, max).replace(/[\u0000-\u0008\u000b-\u001f]/g, '') : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
export function dateText(v: unknown): string { const temporal = detectTemporal(v); if (!temporal)
    return text(v); const d = new Date(temporal.ms); return Number.isNaN(d.getTime()) ? text(v) : d.toISOString(); }
export const positiveId = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : 0;
export const count = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
export const list = (v: unknown, max = 128): unknown[] => Array.isArray(v) ? v.slice(0, max) : [];
export function uuid(v: unknown): string { const s = text(v, 36); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : ''; }
function certificate(v: unknown): Certificate | null { if (!v)
    return null; const r = record(v); return { status: text(r.status) || 'unknown', not_after: text(r.not_after) }; }
export function projectRelease(v: unknown): Release { const r = record(v); return {
    id: positiveId(r.id), version: text(r.version), status: text(r.status) || 'unknown', source: text(r.source) || 'unknown', created: text(r.created)
}; }
export function projectWebApp(v: unknown): WebApp { const r = record(v); return {
    id: positiveId(r.id), slug: text(r.slug, 64), display_name: text(r.display_name, 120), environment: text(r.environment), deployment_ref: text(r.deployment_ref), repository: text(r.repository ?? r.github_repository), build_output: text(r.build_output)
}; }
export function projectWebAppObject(v: unknown): WebAppObject { const r = record(v), g = record(r.group); return { ...projectWebApp(r), group: { id: positiveId(g.id), name: text(g.name) } }; }
export function projectAttempt(v: unknown): Attempt { const r = record(v); return {
    id: positiveId(r.id), status: text(r.status) || 'unknown', created: dateText(r.created), finished: dateText(r.finished), release: r.release ? projectRelease(r.release) : null
}; }
export function projectSummary(v: unknown): WebAppSummary { const r = record(v), a = record(r.address), o = record(r.onboarding), k = record(r.deployment_key); return {
    webapp: projectWebApp(r.webapp), address: r.address ? {
        hostname: text(a.hostname), certificate: certificate(a.certificate), aliases: list(a.aliases, 32).map(x => { const v = record(x); return { hostname: text(v.hostname), certificate: certificate(v.certificate) }; })
    } : null, current_release: r.current_release ? projectRelease(r.current_release) : null, latest_deployment: r.latest_deployment ? projectAttempt(r.latest_deployment) : null, onboarding: { status: text(o.status) || 'unknown', cursor: text(o.cursor) }, deployment_key: { linked: k.linked === true, active: k.active === true }
}; }
export function projectSummaries(v: unknown): WebAppList { const r = record(v); if (r.schema_version !== 1)
    throw new Error('Unsupported WebApp summary schema'); return {
    items: list(r.items, 50).map(projectSummary).filter(x => x.webapp.id > 0), count: count(r.count), limit: count(r.limit), truncated: r.truncated === true
}; }
function proof(v: unknown): Proof { const r = record(v), p = record(r.proof), d = record(r.detail); return {
    runner: text(r.runner ?? r.runner_id), status: text(r.status ?? r.state ?? r.kind) || 'unknown', detail: text(typeof r.detail === 'string' ? r.detail : d.message ?? d.reason ?? d.phase ?? r.reason ?? r.message, 1500), sha: text(p.platform_sha), deployment: uuid(p.platform_deployment), stderr_tail: text(d.stderr_tail ?? r.stderr_tail, 2000)
}; }
export function projectPlatformAttempt(v: unknown): PlatformAttempt { const r = record(v), n = record(r.node_summary), d = record(r.detail); return {
    id: uuid(r.id), sha: text(r.sha, 40), framework_version: text(r.framework_version), status: text(r.status) || 'unknown', source: text(r.source), actor: text(r.actor), retry_of: uuid(r.retry_of), created: dateText(r.created), started: dateText(r.started), finished: dateText(r.finished), duration_seconds: typeof r.duration_seconds === 'number' ? r.duration_seconds : null, desired_commit: text(r.desired_commit, 40), current_commits: list(r.current_commits).map(x => text(x, 40)), frozen_roster: list(r.frozen_roster).map(x => text(x)), transitions: list(r.transitions).map(proof), node_evidence: list(r.node_evidence).map(proof), diagnosis: list(r.diagnosis).map(proof), detail: text(typeof r.detail === 'string' ? r.detail : d.message ?? d.reason, 1500), node_summary: {
        expected: count(n.expected), proven: count(n.proven), reported: count(n.reported), failed: count(n.failed), dispatched: count(n.dispatched), other: count(n.other)
    }
}; }
function collector<T>(v: unknown, project: (v: unknown) => T): Collector<T> { const r = record(v); return {
    status: text(r.status) || 'unknown', observed_at: text(r.observed_at ?? r.checked_at), stale_after: dateText(r.stale_after), reason: text(r.reason_detail ?? r.reason, 500), data: r.data && ['healthy', 'degraded', 'unhealthy', 'unknown', 'ok', 'unconfigured', 'stale'].includes(String(r.status)) ? project(r.data) : null
}; }
export function projectPlatform(v: unknown): PlatformSnapshot { const r = record(v), s = record(r.sections); if (r.schema_version !== 1)
    throw new Error('Unsupported platform schema'); return { deployments: collector(s.deployments, v => { const d = record(v), c = record(d.currently_serving), o = record(d.coordination), f = record(d.framework_pin); return {
        items: list(d.items, 50).map(projectPlatformAttempt).filter(x => x.id), limit: count(d.limit), desired_commit: text(d.desired_commit), desired_deployment: uuid(d.desired_deployment), currently_serving: d.currently_serving ? {
            deployment: uuid(c.deployment), sha: text(c.sha, 40), framework_version: text(c.framework_version), converged_at: dateText(c.converged_at)
        } : null, coordination: {
            state: text(o.state), deployment: uuid(o.deployment), sha: text(o.sha, 40), at: text(o.at)
        }, framework_pin: { mode: text(f.mode), resolved: text(f.resolved) }
    }; }), api: collector(s.api, v => { const a = record(v); return { version: text(a.version), commit: text(a.commit) }; }) }; }
export function projectBootstrap(v: unknown): Bootstrap { const r = record(v); return {
    groups: list(r.webapp_groups, 128).map(v => { const g = record(v); return {
        id: positiveId(g.id), name: text(g.name), can_manage_dns: g.can_manage_dns === true
    }; }).filter(x => x.id > 0), can_create_webapp_group: r.can_create_webapp_group === true, setup: record(r.capabilities).setup === true
}; }
export function projectDeployment(v: unknown): DeploymentStatus { const r = record(v), status = text(r.status) || 'unknown'; return {
    deployment: positiveId(r.deployment), webapp: positiveId(r.webapp), release: positiveId(r.release), version: text(r.version), status, terminal: ['live', 'failed', 'rolled_back', 'superseded'].includes(status) && r.terminal === true, success: status === 'live' && r.success === true, detail: text(r.detail, 1500), created: dateText(r.created), started: dateText(r.started), finished: dateText(r.finished), targets: list(r.targets).map(proof), rollback_targets: list(r.rollback_targets).map(proof)
}; }
export function projectOperation(v: unknown): OnboardingOperation { const r = record(v), g = record(r.group), p = record(r.profile), e = record(r.evidence), a = record(e.app), d = record(e.address), h = record(e.github), f = record(e.verify), resources = record(r.resources); if (r.schema_version !== 1 || !uuid(r.operation_id))
    throw new Error('Invalid onboarding operation'); return {
    operation_id: uuid(r.operation_id), group: { id: positiveId(g.id), name: text(g.name) }, status: text(r.status) || 'unknown', cursor: text(r.cursor) || 'unknown', revision: count(r.revision), profile: { slug: text(p.slug, 64), display_name: text(p.display_name, 120) }, evidence: {
        app: { status: text(a.status) }, address: { status: text(d.status), hostname: text(d.hostname) }, github: { status: text(h.status), reason: text(h.reason) }, verify: { status: text(f.status), detail: text(f.detail) }
    }, activity: list(r.activity, 64).map(v => { const x = record(v); return {
        message: text(x.message, 500), kind: text(x.kind), at: dateText(x.at)
    }; }), resources: { webapp: positiveId(resources.webapp) || null }, next_attempt_at: dateText(r.next_attempt_at), last_error: text(r.last_error, 1500), modified: dateText(r.modified)
}; }
export function projectOptions(v: unknown): OnboardingOptions { const r = record(v), d = record(r.apps_domain); if (r.schema_version !== 1)
    throw new Error('Unsupported onboarding options'); return {
    buckets: list(r.buckets, 64).map(x => text(x)).filter(Boolean), environments: list(r.environments, 8).map(x => text(x)), destination: !!r.destination, destination_error: text(r.destination_error, 500), apps_domain: r.apps_domain ? { id: positiveId(d.id), name: text(d.name) } : null, apps_domain_error: text(r.apps_domain_error, 500), github_connected: r.github_connected === true
}; }
export function projectPrecheck(v: unknown): AddressPrecheck { const r = record(v), d = record(r.domain); return {
    verdict: text(r.verdict) || 'unknown', hostname: text(r.hostname ?? record(r.normalized).hostname), reason: text(r.reason, 500), domain: r.domain ? { id: positiveId(d.id), name: text(d.name) } : null, label: text(r.label ?? record(r.normalized).label)
}; }
