import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { mojoCall, useCan } from '../../client/runtime';
import { Badge, FlatRow, modal } from '../../ui';
import { normalizePhoneNumber } from './api';
import { SMS_VIEW_PERMISSIONS, SmsModel, sanitizeSmsRow, type SmsRow } from './models';

// Sending and creating/editing an audit row are separate backend operations.
export const SMS_SEND_PERMISSIONS = ['sys.send_sms', 'sys.comms'];

export function openSmsComposer() {
    let sending = false;
    return modal.open(close => <SmsComposer close={() => close(null)} onSending={value => { sending = value; }} />, {
        canDismiss: () => !sending,
    });
}

export function SmsComposer({ close, onSending }: { close: () => void; onSending: (value: boolean) => void }) {
    const qc = useQueryClient();
    const { can: canSend, me } = useCan(SMS_SEND_PERMISSIONS);
    const canView = useCan(SMS_VIEW_PERMISSIONS).can;
    const actor = useRef(me?.id);
    const allowed = useRef(false);
    allowed.current = canSend && canView && me?.id === actor.current;
    const mounted = useRef(true);
    const inFlight = useRef(false);
    const [recipient, setRecipient] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [receipt, setReceipt] = useState<SmsRow | null>(null);
    const [refreshError, setRefreshError] = useState(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

    const assertAllowed = () => {
        if (!mounted.current || !allowed.current) throw new Error('Your permission to send SMS is no longer available.');
    };
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (inFlight.current || receipt || !recipient.trim() || !message.trim()) return;
        inFlight.current = true;
        onSending(true);
        setBusy(true);
        setError('');
        let attempted = false;
        try {
            assertAllowed();
            const to_number = await normalizePhoneNumber(recipient);
            assertAllowed();
            // Explicit global scope: never copy outer params/group, audit fields,
            // credentials or a provider selector into the sending request.
            const response = await mojoCall('/api/phonehub/sms/send', {
                method: 'POST',
                body: { to_number, body: message },
                beforeSend: () => { assertAllowed(); attempted = true; },
            });
            const data = response.data as SmsRow | undefined;
            if (!data || !Number.isSafeInteger(data.id) || data.id <= 0 || typeof data.status !== 'string' || !data.status) {
                throw new Error('The server returned no message receipt.');
            }
            if (mounted.current) setReceipt(sanitizeSmsRow(data));
        } catch (reason) {
            if (mounted.current) setError(`${reason instanceof Error ? reason.message : 'SMS request failed.'}${attempted ? ' Check SMS Audit before trying again; sending could not be confirmed.' : ''}`);
        } finally {
            if (attempted) {
                try { await qc.invalidateQueries({ queryKey: SmsModel.keys.root }); }
                catch { if (mounted.current) setRefreshError(true); }
            }
            inFlight.current = false;
            onSending(false);
            if (mounted.current) setBusy(false);
        }
    };

    if (receipt) {
        const failed = receipt.status === 'failed' || receipt.status === 'undelivered';
        return <div className="modal-pad">
            <h2 className="modal-title">{failed ? 'SMS failed' : 'SMS request recorded'}</h2>
            <p className="modal-message">{failed ? 'The message was not delivered. Review the error before sending another message.' : 'The status below is reported by Phone Hub. Only a delivered status confirms delivery.'}</p>
            <FlatRow label="To"><code>{receipt.to_number || recipient}</code></FlatRow>
            <FlatRow label="Status"><Badge tone={failed ? 'danger' : receipt.status === 'delivered' ? 'success' : 'info'}>{receipt.status}</Badge></FlatRow>
            <FlatRow label="Audit record">#{receipt.id}</FlatRow>
            {receipt.error_message && <div className="form-alert" role="alert">{receipt.error_message}</div>}
            {refreshError && <p role="alert">Refresh SMS Audit to see the latest message record.</p>}
            <div className="modal-actions"><button className="btn btn-primary" disabled={busy} onClick={close}>Close</button></div>
        </div>;
    }
    return <form className="modal-pad" onSubmit={event => void submit(event)}>
        <h2 className="modal-title">Send SMS</h2>
        <p className="modal-message">Send one message using the system SMS configuration and its default sender. This sends a real message; provider test mode does not prevent delivery.</p>
        {error && <div className="form-alert" role="alert">{error}</div>}
        {!allowed.current && <div className="form-alert" role="alert">You no longer have permission to send SMS.</div>}
        <label className="field"><span className="field-label">Recipient</span><input className="input" type="tel" autoComplete="tel" value={recipient} disabled={busy} onChange={event => setRecipient(event.target.value)} placeholder="+1 415 555 0123" required /><span className="field-help">Include the country code for international numbers.</span></label>
        <label className="field"><span className="field-label">Message</span><textarea className="input" rows={6} value={message} disabled={busy} onChange={event => setMessage(event.target.value)} required /><span className="field-help">{message.length} characters. Long messages may use multiple SMS segments.</span></label>
        <div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || !allowed.current || !recipient.trim() || !message.trim()}>{busy ? 'Sending…' : 'Send message'}</button></div>
    </form>;
}
