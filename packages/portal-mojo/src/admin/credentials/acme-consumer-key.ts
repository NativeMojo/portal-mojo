import { choice, flag, label, nullable, object, OperatorError, positive, privateCall, uuid, type PrivateScope } from '../fleet-configuration/shared-validation-data';
import { GroupApiKeyModel } from './models';
export const ACME_RECIPIENT_ENDPOINT = '/api/account/admin/fleet/shared-validation/recipient';
export interface KeyGroup { id: number; name: string; uuid: string | null }
export interface AcmeRecipient { purpose: 'acme_validation_consumer'; consumer_project_uuid: string; consumer_label: string; permission: 'dnsman_acme_federation'; can_issue: boolean; grant_explanation: string }
export interface KeySummary { id: number; name: string; is_active: boolean }
export function projectKeyGroup(v: unknown): KeyGroup { const r = object(v); return { id: positive(r.id), name: label(r.name), uuid: r.uuid == null ? null : label(r.uuid, 36) }; }
export async function readKeyGroup(id: number, scope?: PrivateScope) { const g = projectKeyGroup(await privateCall(`/api/group/${positive(id)}`, null, scope)); if (g.id !== id) throw new OperatorError('invalid'); return g; }
export function parseAcmeRecipient(v: unknown, expected: string): AcmeRecipient {
    const r = object(v); const out = { purpose: choice(r.purpose, ['acme_validation_consumer']), consumer_project_uuid: uuid(r.consumer_project_uuid), consumer_label: label(r.consumer_label), permission: choice(r.permission, ['dnsman_acme_federation']), can_issue: flag(r.can_issue), grant_explanation: label(r.grant_explanation, 300) };
    if (out.consumer_project_uuid !== expected) throw new OperatorError('invalid'); return out;
}
export const readAcmeRecipient = async (consumer: string, scope?: PrivateScope) => parseAcmeRecipient(await privateCall(ACME_RECIPIENT_ENDPOINT, null, scope, { consumer_project_uuid: uuid(consumer) }), consumer);
export async function issueAcmeKey(recipient: AcmeRecipient, name: string, scope?: PrivateScope): Promise<{ key: KeySummary; token: string }> {
    if (!recipient.can_issue || !name.trim()) throw new OperatorError('denied');
    const r = object(await privateCall(ACME_RECIPIENT_ENDPOINT, { consumer_project_uuid: uuid(recipient.consumer_project_uuid), expected_consumer_label: recipient.consumer_label, label: label(name.trim()), purpose: 'acme_validation_consumer' }, scope));
    let secret = r.token; delete r.token;
    try {
        if (r.purpose !== 'acme_validation_consumer' || r.consumer_project_uuid !== recipient.consumer_project_uuid || r.consumer_label !== recipient.consumer_label) throw new OperatorError('invalid');
        const key = object(r.api_key); if (key.permission !== 'dnsman_acme_federation' || key.is_active !== true || typeof secret !== 'string' || !secret || secret.length > 4096 || /\s/.test(secret)) throw new OperatorError('invalid');
        return { key: { id: positive(key.id), name: label(key.name), is_active: true }, token: secret };
    } finally { secret = null; }
}
export async function readRecipientKeyInventory(group: number, scope?: PrivateScope): Promise<KeySummary[]> {
    const rows = await privateCall(GroupApiKeyModel.endpoint, null, scope, { group: positive(group), size: 100, sort: '-created', graph: 'default' });
    if (!Array.isArray(rows) || rows.length > 100) throw new OperatorError('invalid');
    return rows.map((v) => { const r = object(v), g = r.group && typeof r.group === 'object' ? object(r.group).id : r.group; if (g !== group) throw new OperatorError('invalid'); return { id: positive(r.id), name: label(r.name), is_active: flag(r.is_active) }; });
}
/** Same explicit audited graph as the existing Token control; no Query cache. */
export async function revealRecipientKey(id: number, scope?: PrivateScope): Promise<string> {
    const r = object(await privateCall(`${GroupApiKeyModel.endpoint}/${positive(id)}`, null, scope, { graph: 'token' }));
    const value = nullable(r.token, (v) => label(v, 4096)); delete r.token;
    if (!value) throw new OperatorError('unavailable'); return value;
}
