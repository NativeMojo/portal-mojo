// PasskeyList — one user's passkeys with rename / enable-disable / remove,
// over /api/account/passkeys?user=<id> (the two REST-editable fields are
// friendly_name and is_enabled; delete is real, CAN_DELETE). Generalised
// from the admin User detail's module-private PasskeysModal so the
// self-service AccountModal and the admin modal render ONE list.
//
// Authority: the live owner, or a global user-management grant. It is
// re-read at every confirmation (permission ref) — losing it while a
// confirm is open, or unmounting, refuses the pending write.
import { useEffect, useRef } from 'react';
import { useCan, useMe } from '../client/runtime';
import { Badge, fmt, formModal, modal, toast } from '../ui';
import { PasskeyModel, type PasskeyRow } from './models';

const USER_ADMIN_PERMISSIONS = ['sys.users', 'sys.manage_users'];

export interface PasskeyListProps {
    userId: number;
    /** Offer Disable on enabled rows (admin). Enable on disabled rows is always offered. */
    showDisable?: boolean;
    /** Empty-state copy override. */
    emptyText?: string;
}

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const SHORT_DATE_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "Aug 21" this year, "Aug 21, 2024" otherwise. Epoch seconds in. */
export function shortDate(epochSeconds: number | null | undefined): string {
    if (epochSeconds == null) return '—';
    const d = new Date(epochSeconds * 1000);
    if (Number.isNaN(d.getTime())) return '—';
    return (d.getFullYear() === new Date().getFullYear() ? SHORT_DATE : SHORT_DATE_YEAR).format(d);
}

function passkeyIcon(row: PasskeyRow): string {
    const transports = (row.transports ?? '').split(',');
    if (transports.includes('usb') || transports.includes('nfc')) return 'bi-usb-drive';
    const name = (row.friendly_name ?? '').toLowerCase();
    if (/iphone|android|phone/.test(name)) return 'bi-phone';
    return 'bi-fingerprint';
}

export function PasskeyList({ userId, showDisable = true, emptyText }: PasskeyListProps) {
    const admin = useCan(USER_ADMIN_PERMISSIONS).can;
    const meId = useMe().data?.id;
    const isSelf = meId === userId;
    const allowed = isSelf || admin;
    const permission = useRef(allowed); permission.current = allowed;
    useEffect(() => { permission.current = allowed; return () => { permission.current = false; }; }, [allowed]);
    const { data, isPending, isError, error } = PasskeyModel.useList({ user: userId, size: 25, sort: '-created' });
    const save = PasskeyModel.useSave();
    const del = PasskeyModel.useDelete();
    const rows = data?.rows ?? [];
    const label = (row: PasskeyRow | undefined) => row?.friendly_name || 'Unnamed passkey';

    const rename = async (row: PasskeyRow) => {
        const result = await formModal({
            title: 'Rename passkey',
            submitText: 'Save',
            fields: [{
                name: 'friendly_name', type: 'text', label: 'Name', required: true,
                placeholder: 'MacBook Pro · Touch ID', help: 'It only has to make sense to you.',
            }],
            initial: { friendly_name: row.friendly_name ?? '' },
        });
        const name = result?.friendly_name;
        if (!permission.current || typeof name !== 'string' || !name.trim()) return;
        try {
            await save.mutateAsync({ id: row.id, changes: { friendly_name: name.trim() } });
            toast.success('Passkey renamed');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to rename passkey');
        }
    };

    const setEnabled = async (row: PasskeyRow, next: boolean) => {
        if (!permission.current) return;
        try {
            await save.mutateAsync({ id: row.id, changes: { is_enabled: next } });
            toast.success(next ? 'Passkey enabled' : 'Passkey disabled');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update passkey');
        }
    };

    const remove = async (row: PasskeyRow) => {
        const ok = await modal.confirm({
            title: 'Remove passkey',
            message: isSelf
                ? <>Remove <b>{label(row)}</b> ({row.rp_id || 'unknown site'}) from your account? You&rsquo;ll need to add it again to sign in with it. The device itself is not erased.</>
                : <>Remove <b>{label(row)}</b> for {row.rp_id || 'unknown relying party'}, user #{userId}? Reenrollment is required to restore it. The physical device is not erased.</>,
            confirmText: 'Remove',
            danger: true,
        });
        if (!ok || !permission.current) return;
        try {
            await del.mutateAsync({ id: row.id });
            toast.success('Passkey removed');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to remove passkey');
        }
    };

    if (isPending) return <div className="acct-skel" aria-busy="true"><span className="skel skel-block" /></div>;
    if (isError) return <p className="dim" role="alert">{error instanceof Error ? error.message : 'Failed to load passkeys.'}</p>;
    if (rows.length === 0) {
        return (
            <div className="us-empty">
                <i className="bi bi-fingerprint" />
                <div>{emptyText ?? 'No passkeys registered'}</div>
            </div>
        );
    }
    const busy = !allowed || save.isPending || del.isPending;
    return (
        <ul className="acct-cards" aria-label="Passkeys">
            {rows.map((p) => (
                <li key={p.id} className={`acct-card${p.is_enabled ? '' : ' is-off'}`}>
                    <span className="acct-card-icon" aria-hidden="true"><i className={`bi ${passkeyIcon(p)}`} /></span>
                    <div className="acct-card-info">
                        <span className="acct-card-title">
                            {label(p)}
                            {!p.is_enabled && <Badge tone="muted">Disabled</Badge>}
                        </span>
                        <span className="acct-card-meta">
                            Added {shortDate(p.created)} · {p.last_used ? `last used ${fmt.relative(p.last_used)}` : 'never used'}
                        </span>
                    </div>
                    <div className="acct-card-actions" inert={busy}>
                        <button type="button" className="btn btn-compact" aria-label={`Rename ${label(p)}`} onClick={() => void rename(p)}>Rename</button>
                        {!p.is_enabled && (
                            <button type="button" className="btn btn-compact" aria-label={`Enable ${label(p)}`} onClick={() => void setEnabled(p, true)}>Enable</button>
                        )}
                        {p.is_enabled && showDisable && (
                            <button type="button" className="btn btn-compact" aria-label={`Disable ${label(p)}`} onClick={() => void setEnabled(p, false)}>Disable</button>
                        )}
                        <button type="button" className="btn btn-compact acct-danger" aria-label={`Remove ${label(p)}`} onClick={() => void remove(p)}>Remove</button>
                    </div>
                </li>
            ))}
        </ul>
    );
}
