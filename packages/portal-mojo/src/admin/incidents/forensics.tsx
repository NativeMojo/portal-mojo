import type { ReactNode } from 'react';
import { Eyebrow, FlatRow, KnownFieldsCard, StackTraceView } from '../../ui';
import { boundedSecurityText, sanitizeSecurityValue } from './sanitize';

export function metadataOf(row: { metadata?: Record<string, unknown> }): Record<string, unknown> {
    return sanitizeSecurityValue(row.metadata ?? {});
}

export function first(metadata: Record<string, unknown>, ...keys: string[]): unknown {
    for (const key of keys) if (metadata[key] != null && metadata[key] !== '') return metadata[key];
    return null;
}

function text(value: unknown): string { return value == null || value === '' ? '—' : boundedSecurityText(value, 8_000); }

export function RequestResponseForensics({ metadata }: { metadata: Record<string, unknown> }) {
    const fields: Array<[string, unknown]> = [
        ['Method', first(metadata, 'http_method', 'request_method', 'method')],
        ['Status', first(metadata, 'http_status', 'response_status', 'status_code')],
        ['Host', first(metadata, 'http_host', 'request_host', 'host')],
        ['Path / URL', first(metadata, 'http_url', 'http_path', 'request_path', 'url')],
        ['Protocol', first(metadata, 'http_protocol', 'protocol')],
        ['Query string', first(metadata, 'http_query_string', 'query_string')],
        ['User agent', first(metadata, 'http_user_agent', 'user_agent')],
        ['Request headers', first(metadata, 'request_headers', 'headers')],
        ['Request body', first(metadata, 'request_body', 'request_data', 'body')],
        ['Response headers', first(metadata, 'response_headers')],
        ['Response body', first(metadata, 'response_body', 'response_data')],
    ].filter(([, value]) => value != null && value !== '');
    if (!fields.length) return <p className="dim-italic">No request or response context was recorded.</p>;
    return <div className="incident-forensic-list">{fields.map(([label, value]) => (
        <FlatRow key={label} label={label}><pre className="incident-forensic-value">{text(value)}</pre></FlatRow>
    ))}</div>;
}

export function EvidenceCard({ metadata, extra }: { metadata: Record<string, unknown>; extra?: ReactNode }) {
    return <>
        <Eyebrow>Trigger and evidence</Eyebrow>
        <KnownFieldsCard
            data={metadata}
            showRaw={false}
            known={[
                { key: 'trigger', label: 'Trigger', hideEmpty: true },
                { key: 'action', label: 'Action', hideEmpty: true },
                { key: 'rule_id', label: 'Rule ID', hideEmpty: true },
                { key: 'risk_score', label: 'Risk score', hideEmpty: true },
                { key: 'decision', label: 'Decision', hideEmpty: true },
                { key: 'model_name', label: 'Model', hideEmpty: true },
                { key: 'model_id', label: 'Model ID', hideEmpty: true },
            ]}
        />
        {extra}
    </>;
}

export function TraceForensics({ metadata }: { metadata: Record<string, unknown> }) {
    const trace = first(metadata, 'stack_trace', 'traceback');
    return <StackTraceView trace={trace ? boundedSecurityText(trace) : ''} collapseAfter={24} />;
}

export const INCIDENT_METADATA_FIELDS = [
    { key: 'source_ip', label: 'Source IP', hideEmpty: true },
    { key: 'hostname', label: 'Hostname', hideEmpty: true },
    { key: 'country_code', label: 'Country', hideEmpty: true },
    { key: 'region', label: 'Region', hideEmpty: true },
    { key: 'city', label: 'City', hideEmpty: true },
    { key: 'rule_id', label: 'Rule ID', hideEmpty: true },
    { key: 'risk_score', label: 'Risk score', hideEmpty: true },
    { key: 'decision', label: 'Decision', hideEmpty: true },
    { key: 'muid', label: 'MUID', hideEmpty: true },
    { key: 'duid', label: 'DUID', hideEmpty: true },
] as const;
