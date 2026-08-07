import { useState } from 'react';
import {
    BotSignaturesPage,
    BouncerDevicesPage,
    BouncerSignalsPage,
} from 'portal-mojo/admin/security';

type Surface = 'signals' | 'devices' | 'signatures';

export function AdminBouncerDemo() {
    const [surface, setSurface] = useState<Surface>('signals');
    return (
        <div className="bouncer-demo">
            <div className="bouncer-demo-tabs" role="group" aria-label="Bouncer admin surface">
                <button className={`btn btn-compact${surface === 'signals' ? ' btn-primary' : ''}`} onClick={() => setSurface('signals')}>
                    <i className="bi bi-activity" /> Signal Decisions
                </button>
                <button className={`btn btn-compact${surface === 'devices' ? ' btn-primary' : ''}`} onClick={() => setSurface('devices')}>
                    <i className="bi bi-fingerprint" /> Device Reputation
                </button>
                <button className={`btn btn-compact${surface === 'signatures' ? ' btn-primary' : ''}`} onClick={() => setSurface('signatures')}>
                    <i className="bi bi-shield-check" /> Bot Signatures
                </button>
            </div>
            <p className="dim bouncer-demo-hint">
                Open a signal or device row for the investigation view. Signatures exercise supported create, edit, enable, and disable saves.
            </p>
            {surface === 'signals' && <BouncerSignalsPage />}
            {surface === 'devices' && <BouncerDevicesPage />}
            {surface === 'signatures' && <BotSignaturesPage />}
        </div>
    );
}
