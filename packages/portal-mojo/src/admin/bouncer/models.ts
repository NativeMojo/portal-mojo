import { useQuery } from '@tanstack/react-query';
import {
    defineModel, mojoCall,
    type Params,
} from '../../client';
import { SECURITY_VIEW_PERMS } from '../security-permissions';
import { sanitizeIncidentRow } from '../incidents/sanitize';

/** Bouncer data is global. `sys.` prevents an active group grant from opening it. */
export const BOUNCER_VIEW_PERMS = [
    'sys.manage_users',
    'sys.view_security',
    'sys.manage_security',
    'sys.security',
    'sys.users',
];

export const BOUNCER_MANAGE_PERMS = [
    'sys.manage_users',
    'sys.manage_security',
    'sys.security',
    'sys.users',
];

/** Incident rows have their own, narrower model gate. */
export const BOUNCER_INCIDENT_VIEW_PERMS = SECURITY_VIEW_PERMS;

export type BouncerStage = 'assess' | 'submit' | 'event';
export type BouncerDecision = 'allow' | 'monitor' | 'block' | 'log';
export type BouncerRiskTier = 'unknown' | 'low' | 'medium' | 'high' | 'blocked';
export type BotSignatureType =
    | 'ip'
    | 'subnet_24'
    | 'subnet_16'
    | 'user_agent'
    | 'fingerprint'
    | 'signal_set';
export type BotSignatureSource = 'auto' | 'manual';

export interface BouncerGeoIp {
    id: number;
    ip_address: string;
    country_code: string | null;
    country_name: string | null;
    region: string | null;
    city: string | null;
    asn: string | null;
    asn_org: string | null;
    isp: string | null;
    threat_level: string | null;
    is_tor: boolean;
    is_vpn: boolean;
    is_proxy: boolean;
    is_cloud: boolean;
    is_datacenter: boolean;
    is_known_attacker: boolean;
    is_known_abuser: boolean;
    [field: string]: unknown;
}

export interface BouncerDeviceRow {
    id: number;
    muid: string;
    duid: string;
    msid?: string;
    fingerprint_id?: string | null;
    risk_tier: BouncerRiskTier;
    event_count: number;
    block_count: number;
    last_seen_ip: string | null;
    linked_muids?: string[];
    first_seen?: number;
    last_seen: number;
}

export interface BouncerSignalRow {
    id: number;
    device?: BouncerDeviceRow | number | null;
    muid: string;
    duid?: string;
    msid: string;
    mtab?: string;
    session_id?: string;
    stage: BouncerStage;
    ip_address: string | null;
    page_type: string;
    raw_signals?: Record<string, unknown>;
    server_signals?: Record<string, unknown>;
    risk_score: number;
    decision: BouncerDecision;
    triggered_signals?: string[];
    geo_ip?: BouncerGeoIp | null;
    created: number;
}

export interface BotSignatureRow {
    id: number;
    sig_type: BotSignatureType;
    value: string;
    source: BotSignatureSource;
    confidence: number;
    hit_count: number;
    block_count?: number;
    expires_at: number | null;
    is_active: boolean;
    notes?: string;
    created?: number;
    modified: number;
}

export interface BouncerIncidentRow {
    id: number;
    created: number;
    priority: number;
    state: string;
    status: string;
    scope: string;
    category: string;
    country_code: string | null;
    title: string | null;
    details: string | null;
    model_name: string | null;
    model_id: number | null;
    source_ip: string | null;
    hostname: string | null;
    metadata: Record<string, unknown>;
    group_id: number | null;
}

/** Strip a sensitive backend-only field before any list/detail/save cache write. */
export function sanitizeBouncerSignalRow(row: BouncerSignalRow): BouncerSignalRow {
    const safe = { ...row } as BouncerSignalRow & Record<string, unknown>;
    delete safe.token_nonce;
    return safe;
}

function listGraph(params: Params): Params {
    const safe = { ...params };
    delete safe.graph;
    return { ...safe, graph: 'list' };
}

export const BouncerSignalModel = defineModel<BouncerSignalRow>({
    name: 'bouncer_signal',
    endpoint: '/api/account/bouncer/signal',
    permissions: { view: BOUNCER_VIEW_PERMS },
    normalizeListParams: listGraph,
    sanitizeRow: sanitizeBouncerSignalRow,
});

export const BouncerDeviceModel = defineModel<BouncerDeviceRow>({
    name: 'bouncer_device',
    endpoint: '/api/account/bouncer/device',
    permissions: { view: BOUNCER_VIEW_PERMS, manage: BOUNCER_MANAGE_PERMS },
    normalizeListParams: listGraph,
});

export const BotSignatureModel = defineModel<BotSignatureRow>({
    name: 'bot_signature',
    endpoint: '/api/account/bouncer/signature',
    permissions: { view: BOUNCER_VIEW_PERMS, manage: BOUNCER_MANAGE_PERMS },
    normalizeListParams: listGraph,
});

export const BouncerIncidentModel = defineModel<BouncerIncidentRow>({
    name: 'bouncer_incident',
    endpoint: '/api/incident/incident',
    permissions: { view: BOUNCER_INCIDENT_VIEW_PERMS },
    sanitizeRow: sanitizeIncidentRow,
});

/** Graph is part of the key so a sparse default record cannot satisfy detail. */
export function bouncerSignalDetailKey(id: number) {
    return [BouncerSignalModel.endpoint, 'one', id, { graph: 'detail' }] as const;
}

export function useBouncerSignalDetail(id: number | null) {
    return useQuery({
        queryKey: id == null
            ? [BouncerSignalModel.endpoint, 'one', null, { graph: 'detail' }] as const
            : bouncerSignalDetailKey(id),
        queryFn: async () => {
            const body = await mojoCall(`${BouncerSignalModel.endpoint}/${id!}`, {
                params: { graph: 'detail' },
            });
            return sanitizeBouncerSignalRow(body.data as BouncerSignalRow);
        },
        enabled: id != null,
    });
}

export const BOUNCER_SIGNATURE_TYPES: ReadonlyArray<{ value: BotSignatureType; label: string }> = [
    { value: 'ip', label: 'IP Address' },
    { value: 'subnet_24', label: 'Subnet /24' },
    { value: 'subnet_16', label: 'Subnet /16' },
    { value: 'user_agent', label: 'User Agent' },
    { value: 'fingerprint', label: 'Browser Fingerprint' },
    { value: 'signal_set', label: 'Signal Set (Campaign)' },
];
