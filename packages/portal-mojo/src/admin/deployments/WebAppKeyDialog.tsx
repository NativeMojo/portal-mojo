import { useEffect, useRef, useState } from 'react';
import { useMe } from '../../client/runtime';
import { changeKey, getKeyStatus, resolveAppAuthority, getWebApp } from './api';
import { isInteractive } from './permissions';
import { makeReceipt, settleReceipt } from './receipts';
import { useDeploymentOwner } from './useDeploymentObservation';
import { ErrorNotice, useWrite } from './shared';
import type { WebAppObject } from './types';
export function WebAppKeyDialog({ app, action, onClose, onBusy, onChanged }: {
    app: WebAppObject;
    action: 'mint' | 'rotate' | 'revoke';
    onClose: () => void;
    onBusy: (v: boolean) => void;
    onChanged: () => void;
}) {
    const s = useDeploymentOwner(), me = useMe(), w = useWrite(s.owner, s.signal, onBusy), secret = useRef<string | null>(null);
    const [reveal, setReveal] = useState(false), [done, setDone] = useState(false), [unavailable, setUnavailable] = useState(false), [confirmation, setConfirmation] = useState(''), [copied, setCopied] = useState(false);
    useEffect(() => () => { secret.current = null; }, [s.key]);
    const execute = () => w.run(async () => { const object = await getWebApp(s.owner, app.id, s.signal); if (object.group.id !== app.group.id)
        throw new Error('App ownership changed'); const authority = await resolveAppAuthority(s.owner, me.data, object, 'custom', s.signal); if (!isInteractive() || !authority.custom)
        throw new Error('Exact app credential authority is unavailable'); await getKeyStatus(s.owner, app.id, app.group.id, s.signal); const r = makeReceipt(s.owner, 'key', `${app.id}:${action}`, app.id, action); const result = await changeKey(s.owner, r, app.id, app.group.id, action, s.signal); secret.current = result.token; setUnavailable(action !== 'revoke' && !result.token); setDone(true); settleReceipt(r); onChanged(); });
    const close = () => { if (w.busy)
        return; secret.current = null; onClose(); };
    return <div className="modal-pad admin-deployments"><h2 className="modal-title">{action === 'mint' ? 'Create' : action === 'rotate' ? 'Rotate' : 'Revoke'} MOJO_DEPLOY_KEY</h2><p className="modal-message">{app.display_name || app.slug}: {action === 'revoke' ? 'Future CI deployments lose this credential. Existing serving content stays.' : 'The key is delivered once. Store it in your CI secrets as MOJO_DEPLOY_KEY. Rotation requires updating CI before its next deployment.'}</p>{!done ? <label>Type {app.slug} to confirm<input value={confirmation} disabled={w.busy} onChange={e => setConfirmation(e.target.value)}/></label> : unavailable ? <p role="status">Secret unavailable. This receipt was already delivered or its response was lost. No token can be recovered from metadata. Close and explicitly start a new rotation.</p> : action === 'revoke' ? <p role="status">Revocation receipt observed. The serving release remains independent.</p> : <><p>The value clears when this dialog closes.</p><input aria-label="One-time deployment key" type={reveal ? 'text' : 'password'} value={secret.current ?? ''} readOnly autoComplete="off"/><button className="btn" onClick={() => setReveal(v => !v)}>{reveal ? 'Hide' : 'Reveal once'}</button><button className="btn" onClick={() => void navigator.clipboard.writeText(secret.current ?? '').then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? 'Copied' : 'Copy key'}</button></>}{w.error && <ErrorNotice>{w.error}</ErrorNotice>}<div className="modal-actions"><button className="btn" disabled={w.busy} onClick={close}>{done ? 'I saved it · Close' : 'Cancel'}</button>{!done && <button className="btn btn-primary" disabled={w.busy || confirmation !== app.slug} onClick={() => void execute()}>Confirm {action}</button>}</div></div>;
}
