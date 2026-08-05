// API Keys — UserApiKeysSection port (read in full 2026-08-05): the user's
// key list + "Generate key" + the show-once token banner + revoke.
//
// Wire (live-measured):
//   · list — GET /api/account/api_keys?user=<id> (label/allowed_ips/expires/
//     is_active/last_used/created; the owner FK filters but never serializes)
//   · generate — POST /api/auth/manage/generate_api_key {uid, label,
//     allowed_ips[], expire_days} → {id, jti, expires, token} — the ONE time
//     the token is visible (show-once banner). NOTE the manage route is the
//     workspec/web-mojo target; today's django-mojo mounts only the
//     caller-scoped /api/auth/generate_api_key — MERGE-WIRE note filed.
//   · revoke — the `revoke` POST_SAVE_ACTION (POST <id> {revoke:{}} → its
//     own {status:true} payload). Deviation from web-mojo's DELETE: the live
//     model is CAN_DELETE=false (DELETE answers 403, measured) — the action
//     IS the kill switch.
import { useState } from 'react';
import { mojoCall } from 'portal-mojo/client';
import { Badge, Eyebrow, fmt, formModal, modal, toast } from 'portal-mojo/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ApiKeyModel, type UserRow } from '../../models';
import { useAdminCaller } from './shared';

export function ApiKeysSection({ user }: { user: UserRow }) {
    const qc = useQueryClient();
    const isAdmin = useAdminCaller();
    const { data, isPending } = ApiKeyModel.useList({ user: user.id, size: 25, sort: '-id' });
    const revoke = ApiKeyModel.useAction('revoke');
    // Show-once token — lives only in this mount's state, exactly the
    // source's `generatedToken` (revoking clears it).
    const [generated, setGenerated] = useState<string | null>(null);
    const rows = data?.rows ?? [];

    const generate = async () => {
        const form = ApiKeyModel.forms.generate!;
        const dataIn = await formModal({
            ...form,
            title: `Generate API key for ${user.display_name || user.email || user.username}`,
        });
        if (!dataIn) return;
        const body: Record<string, unknown> = {
            uid: user.id,
            label: dataIn.label,
            expire_days: parseInt(String(dataIn.expire_days || '90'), 10),
        };
        const ips = String(dataIn.allowed_ips ?? '').trim();
        if (ips) body.allowed_ips = ips.split(',').map((s) => s.trim()).filter(Boolean);
        try {
            const resp = await mojoCall('/api/auth/manage/generate_api_key', { method: 'POST', body });
            const token = (resp.data as { token?: string } | undefined)?.token;
            if (token) setGenerated(token);
            toast.success('API key generated');
            await ApiKeyModel.invalidate(qc);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to generate API key');
        }
    };

    const copyToken = async () => {
        if (!generated) return;
        try {
            await navigator.clipboard.writeText(generated);
            toast.success('Token copied to clipboard');
        } catch {
            toast.error('Failed to copy token');
        }
    };

    const revokeKey = async (id: number, label: string) => {
        const ok = await modal.confirm({
            title: 'Revoke API key',
            message: <>Revoke <b>{label || 'this API key'}</b>? Any applications using it will lose access immediately.</>,
            confirmText: 'Revoke',
            danger: true,
        });
        if (!ok) return;
        try {
            await revoke.mutateAsync({ id });
            toast.success('API key revoked');
            setGenerated(null);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to revoke API key');
        }
    };

    const nowSec = Math.floor(Date.now() / 1000);

    return (
        <>
            <Eyebrow>
                API keys
                {isAdmin && (
                    <button className="btn btn-primary btn-compact us-eyebrow-action" onClick={() => void generate()}>
                        <i className="bi bi-plus-lg" /> Generate key
                    </button>
                )}
            </Eyebrow>

            {generated && (
                <div className="us-token-banner" role="status">
                    <div className="us-token-title">Generated API key</div>
                    <div className="us-token-row">
                        <code className="us-token">{generated}</code>
                        <button className="btn-icon btn-icon-sm" title="Copy token" aria-label="Copy token" onClick={() => void copyToken()}>
                            <i className="bi bi-clipboard" />
                        </button>
                    </div>
                    <div className="us-token-warn">
                        <i className="bi bi-exclamation-circle" /> This token will not be shown again. Copy it now.
                    </div>
                </div>
            )}

            {isPending && <p className="dim">Loading…</p>}
            {!isPending && rows.length === 0 && (
                <div className="us-empty">
                    <i className="bi bi-key" />
                    <div>No API keys for this user.</div>
                </div>
            )}
            {rows.map((k) => {
                const expired = k.expires != null && k.expires < nowSec;
                return (
                    <div key={k.id} className="us-key-row">
                        <div className="us-row-icon"><i className="bi bi-key" /></div>
                        <div className="us-row-info">
                            <div className="us-row-title">{k.label || 'Unlabeled key'}</div>
                            <div className="us-row-meta">
                                Created {fmt.date(k.created)} · Expires {fmt.date(k.expires, 'never')} · Last used {fmt.relative(k.last_used, 'never')}
                                {' · '}
                                {k.allowed_ips.length > 0 ? <>IPs <code>{k.allowed_ips.join(', ')}</code></> : 'Any IP'}
                            </div>
                        </div>
                        <div className="us-row-actions">
                            <Badge tone={!k.is_active ? 'muted' : expired ? 'warning' : 'success'}>
                                {!k.is_active ? 'Revoked' : expired ? 'Expired' : 'Active'}
                            </Badge>
                            {isAdmin && k.is_active && (
                                <button className="btn btn-compact us-danger" onClick={() => void revokeKey(k.id, k.label)}>
                                    Revoke
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </>
    );
}
