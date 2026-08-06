// API Keys — UserApiKeysSection port (read in full 2026-08-05): the user's
// key list + caller-only "Generate key" reveal + revoke.
//
// Wire (live-measured):
//   · list — GET /api/account/api_keys?user=<id> (label/allowed_ips/expires/
//     is_active/last_used/created; the owner FK filters but never serializes)
//   · generate — caller-only POST /api/auth/generate_api_key. Another user's
//     detail renders no Generate action because no admin-targetable route exists.
//   · revoke — the `revoke` POST_SAVE_ACTION (POST <id> {revoke:{}} → its
//     own {status:true} payload). Deviation from web-mojo's DELETE: the live
//     model is CAN_DELETE=false (DELETE answers 403, measured) — the action
//     IS the kill switch.
import { Badge, Eyebrow, fmt, formModal, modal, toast } from '../../../../ui';
import { showSecretDialog } from '../../../credentials';
import { ApiKeyModel, useGenerateUserApiKey, type UserRow } from '../models';

export function ApiKeysSection({ user, canManage, isSelf }: { user: UserRow; canManage: boolean; isSelf: boolean }) {
    const { data, isPending } = ApiKeyModel.useList({ user: user.id, size: 25, sort: '-id' });
    const revoke = ApiKeyModel.useAction('revoke');
    const generateKey = useGenerateUserApiKey();
    const rows = data?.rows ?? [];

    const generate = async () => {
        const form = ApiKeyModel.forms.generate!;
        const dataIn = await formModal({
            ...form,
            title: `Generate API key for ${user.display_name || user.email || user.username}`,
        });
        if (!dataIn) return;
        const body: Record<string, unknown> = {
            label: dataIn.label,
            expire_days: parseInt(String(dataIn.expire_days || '90'), 10),
        };
        const ips = String(dataIn.allowed_ips ?? '').trim();
        if (ips) body.allowed_ips = ips.split(',').map((s) => s.trim()).filter(Boolean);
        try {
            await generateKey.mutateAsync({
                changes: body,
                onToken: async (token) => {
                    await showSecretDialog({
                        title: 'API key created',
                        intro: <><b>{String(dataIn.label || 'Unlabeled key')}</b> is ready.</>,
                        warning: 'Save this token now. It will not be shown again.',
                        secret: token,
                        ariaLabel: 'Generated API key',
                    });
                },
            });
            toast.success('API key generated');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to generate API key');
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
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to revoke API key');
        }
    };

    const nowSec = Math.floor(Date.now() / 1000);

    return (
        <>
            <Eyebrow>
                API keys
                {isSelf && (
                    <button className="btn btn-primary btn-compact us-eyebrow-action" onClick={() => void generate()}>
                        <i className="bi bi-plus-lg" /> Generate key
                    </button>
                )}
            </Eyebrow>

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
                            {canManage && k.is_active && (
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
