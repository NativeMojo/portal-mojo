// Global DNS administration foundation (#1429). The live leg below is the
// shipped page against the central mock; the other two legs document the
// fail-closed states reviewers need to exercise with the stable identities.
import { useMemo, useState } from 'react';
import {
    DNS_MANAGE_PERMISSIONS,
    DNS_VIEW_PERMISSIONS,
    ProviderCredentialsPage,
    parseDnsCapabilities,
} from 'portal-mojo/admin';

type Leg = 'manager' | 'viewer' | 'unavailable';

const LEGS: Array<{ key: Leg; label: string }> = [
    { key: 'manager', label: 'Manager — live' },
    { key: 'viewer', label: 'Viewer contract' },
    { key: 'unavailable', label: 'Capability unavailable' },
];

export function AdminDnsDemo() {
    const [leg, setLeg] = useState<Leg>('manager');
    const malformedMessage = useMemo(() => {
        try {
            parseDnsCapabilities({ providers: [] });
            return 'Unexpectedly accepted';
        } catch (reason) {
            return reason instanceof Error ? reason.message : 'DNS administration unavailable';
        }
    }, []);

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            <div className="seg" style={{ flexWrap: 'wrap' }}>
                {LEGS.map((entry) => (
                    <button
                        key={entry.key}
                        type="button"
                        className={`seg-btn${leg === entry.key ? ' seg-active' : ''}`}
                        onClick={() => setLeg(entry.key)}
                    >
                        {entry.label}
                    </button>
                ))}
            </div>

            {leg === 'manager' && (
                <>
                    <div className="panel panel-pad">
                        <div className="eyebrow">Executable manager leg</div>
                        <p className="dim" style={{ marginBottom: 0 }}>
                            Link with <code>invalid</code> in either secret to see first-link rejection;
                            use any other pair for a verified row. Open a row to rotate (failed rotation
                            preserves both masks), retire/activate, inspect masked detail, or arm deletion.
                        </p>
                    </div>
                    <ProviderCredentialsPage />
                </>
            )}

            {leg === 'viewer' && (
                <div className="panel panel-pad">
                    <div className="eyebrow">Read-only contract</div>
                    <h3>Viewer sees safe rows and masked detail</h3>
                    <p className="dim">
                        Sign in as <code>dns.viewer@nativemojo.com</code> (password <code>mojo</code>).
                        The table and KISS detail modal remain available; link, rotation, state changes,
                        and deletion do not render. View gate: <code>{DNS_VIEW_PERMISSIONS.join(' | ')}</code>.
                    </p>
                </div>
            )}

            {leg === 'unavailable' && (
                <div className="panel panel-pad">
                    <div className="eyebrow">Fail-closed capability leg</div>
                    <h3>DNS administration unavailable</h3>
                    <p className="text-bad">{malformedMessage}</p>
                    <p className="dim">
                        Missing or malformed fields never receive client defaults. Management remains
                        system-pinned to <code>{DNS_MANAGE_PERMISSIONS.join(' | ')}</code>.
                    </p>
                </div>
            )}
        </div>
    );
}
