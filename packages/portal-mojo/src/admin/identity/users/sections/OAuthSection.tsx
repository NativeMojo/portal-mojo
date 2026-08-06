// OAuth section — AdminConnectedSection port (read in full 2026-08-05):
// the user's linked OAuth providers with admin unlink. The same list powers
// the Profile card's "manage linked accounts" modal (source Phase 3 shared
// exactly this list between the section and the modal).
//
// Wire: GET /api/account/oauth_connection?user=<id> → rows
// {id, provider, email, is_active, created} (default graph, measured in
// django-mojo oauth.py); DELETE /api/account/oauth_connection/<id> unlinks.
import { modal, toast, fmt, Eyebrow } from '../../../../ui';
import { OAuthConnectionModel, type UserRow } from '../models';
import { providerIcon } from './shared';

export function OAuthConnectionList({ userId, canManage = true }: { userId: number; canManage?: boolean }) {
    const { data, isPending } = OAuthConnectionModel.useList({ user: userId, size: 25, sort: '-created' });
    const del = OAuthConnectionModel.useDelete();
    const rows = data?.rows ?? [];

    const unlink = async (id: number, provider: string) => {
        const ok = await modal.confirm({
            title: 'Unlink account',
            message: <>Unlink <b>{provider}</b> for this user?</>,
            confirmText: 'Unlink',
            danger: true,
        });
        if (!ok) return;
        try {
            await del.mutateAsync({ id });
            toast.success(`${provider} account unlinked`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to unlink account');
        }
    };

    if (isPending) return <p className="dim">Loading…</p>;
    if (rows.length === 0) {
        return (
            <div className="us-empty">
                <i className="bi bi-plug" />
                <div>No connected accounts</div>
            </div>
        );
    }
    return (
        <>
            {rows.map((c) => (
                <div key={c.id} className="us-oauth-row">
                    <div className="us-row-icon"><i className={`bi ${providerIcon(c.provider)}`} /></div>
                    <div className="us-row-info">
                        <div className="us-row-title us-cap">{c.provider}</div>
                        <div className="us-row-meta">
                            {c.email ?? <span className="dim-italic">no email</span>} · Connected {fmt.relative(c.created)}
                        </div>
                    </div>
                    {canManage && <div className="us-row-actions">
                        <button className="btn btn-compact us-danger" onClick={() => void unlink(c.id, c.provider)}>
                            <i className="bi bi-x-lg" /> Unlink
                        </button>
                    </div>}
                </div>
            ))}
        </>
    );
}

export function OAuthSection({ user, canManage }: { user: UserRow; canManage: boolean }) {
    return (
        <>
            <Eyebrow>Linked accounts</Eyebrow>
            <OAuthConnectionList userId={user.id} canManage={canManage} />
        </>
    );
}
