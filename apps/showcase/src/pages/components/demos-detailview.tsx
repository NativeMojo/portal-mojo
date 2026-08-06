// DetailView C1 demo — permission-gated sections (fail-closed + orphan-
// divider drop + sticky self-heal), live controlled rail badges, the header
// kebab menu (permissions ∧ when(), separator collapse, close-on-select),
// and keep-alive proof (section state survives switching).
//
// Gating is against the LIVE session, so what you see depends on who is
// signed in (mock: any active seeded user, password "mojo", via
// `__mojo.login(email, 'mojo')` in the console) and on the active group
// (mock: user ian is member-ADMIN of odd-id groups — member admin grants
// every non-sys permission, so switching odd ↔ even flips the gated
// sections live, self-heal included).
import { useState } from 'react';
import { useCan } from 'portal-mojo/client';
import {
    Badge, DetailView, Eyebrow, FlatRow, SecurityItem, toast,
    type DetailMenuEntry,
} from 'portal-mojo/ui';

interface DemoRecord {
    name: string;
    hasSignedIn: boolean;
}

/** Live grant chip — makes the rail state explainable for any session. */
function CanChip({ perm }: { perm: string }) {
    const { can } = useCan(perm);
    return <Badge tone={can ? 'success' : 'muted'}>{perm}: {can ? 'yes' : 'no'}</Badge>;
}

/**
 * The keep-alive proof. Module-level ON PURPOSE: defined inline in the demo
 * body its identity would change every render and React would remount it —
 * the exact state loss keep-alive exists to prevent.
 */
function NotesScratch() {
    const [draft, setDraft] = useState('');
    const [clicks, setClicks] = useState(0);
    return (
        <>
            <Eyebrow>Keep-alive proof</Eyebrow>
            <p className="dim" style={{ marginBottom: 10 }}>
                Type a draft and click the counter, switch to another section, come back —
                both survive. Sections mount on first activation and then hide via CSS;
                they are never unmounted (web-mojo's unmount-not-destroy semantic).
            </p>
            <div className="demo-row">
                <input
                    className="input"
                    style={{ maxWidth: 320 }}
                    placeholder="Draft note — survives section switches"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                />
                <button className="btn" onClick={() => setClicks((n) => n + 1)}>local clicks: {clicks}</button>
            </div>
        </>
    );
}

// Kebab config is data — static entries close over nothing; `when` reads the
// record handed to DetailView as `menuContext`.
const KEBAB: DetailMenuEntry<DemoRecord>[] = [
    { label: 'Copy profile link', icon: 'bi-link-45deg', onSelect: () => toast.success('Link copied (demo)') },
    {
        label: 'Resend invite', icon: 'bi-envelope-paper',
        // Visibility predicate over menuContext — flips live with the toggle.
        when: (ctx) => !ctx?.hasSignedIn,
        onSelect: () => toast.info('Invite sent (demo)'),
    },
    { label: 'Manage roles', icon: 'bi-person-gear', permissions: 'users', onSelect: () => toast.info('Manage roles (demo)') },
    { divider: true },
    {
        label: 'Delete account', icon: 'bi-trash', danger: true,
        // Any-of: the users CATEGORY rollup also covers manage_users.
        permissions: ['manage_users', 'users'],
        onSelect: () => toast.error('Not actually deleting (demo)'),
    },
];

export function DetailViewFullDemo() {
    const [activeOn, setActiveOn] = useState(true);
    const [events, setEvents] = useState(3);
    const [showDot, setShowDot] = useState(true);
    const [includeBilling, setIncludeBilling] = useState(true);
    const [hasSignedIn, setHasSignedIn] = useState(false);

    const record: DemoRecord = { name: 'Demo Person', hasSignedIn };

    return (
        <>
            <div className="panel panel-pad" style={{ marginBottom: 14 }}>
                <div className="eyebrow">Your live grants (they drive the rail and the kebab)</div>
                <div className="demo-row" style={{ marginBottom: 12 }}>
                    <CanChip perm="view_admin" />
                    <CanChip perm="users" />
                    <CanChip perm="manage_users" />
                    <span className="dim">
                        Sign in as a seeded user (<code>__mojo.login(email, 'mojo')</code>) or pick an
                        odd-id group as ian (member admin) to light these up. Fail-closed: signed out,
                        every gated piece is simply absent.
                    </span>
                </div>
                <div className="eyebrow">Demo controls</div>
                <div className="demo-row">
                    <button className="btn" onClick={() => setEvents((n) => n + 1)}>+1 event badge ({events})</button>
                    <button className="btn" onClick={() => setEvents(0)}>clear events</button>
                    <label className="demo-row" style={{ gap: 6 }}>
                        <input type="checkbox" checked={showDot} onChange={(e) => setShowDot(e.target.checked)} />
                        admin dot badge
                    </label>
                    <label className="demo-row" style={{ gap: 6 }}>
                        <input type="checkbox" checked={includeBilling} onChange={(e) => setIncludeBilling(e.target.checked)} />
                        include Billing section (uncheck while it's active → self-heal)
                    </label>
                    <label className="demo-row" style={{ gap: 6 }}>
                        <input type="checkbox" checked={hasSignedIn} onChange={(e) => setHasSignedIn(e.target.checked)} />
                        record has signed in (hides "Resend invite" via <code>when()</code>)
                    </label>
                </div>
            </div>

            <div className="panel" style={{ overflow: 'hidden' }}>
                <DetailView
                    avatarName={record.name}
                    title={record.name}
                    subtitle="demo@nativemojo.com"
                    chips={[{ icon: 'bi-patch-check-fill', text: 'Email', tone: 'success' }, { text: 'C1', tone: 'info' }]}
                    active={{ value: activeOn, onChange: (next) => { setActiveOn(next); toast.info(`active → ${String(next)}`); } }}
                    onClose={() => toast.info('close clicked (demo)')}
                    menuContext={record}
                    contextMenu={KEBAB}
                    badges={{
                        notes: events > 0 ? events : null,
                        billing: 'new',
                        admin: showDot ? <span className="rail-dot" /> : null,
                    }}
                    sections={[
                        {
                            key: 'profile', label: 'Profile', icon: 'bi-person', render: () => (
                                <>
                                    <Eyebrow>Contact</Eyebrow>
                                    <FlatRow label="Email" action={() => toast.info('pencil clicked')}>
                                        demo@nativemojo.com <Badge tone="success">Verified</Badge>
                                    </FlatRow>
                                    <FlatRow label="Signed in before">
                                        <Badge tone={hasSignedIn ? 'success' : 'muted'}>{hasSignedIn ? 'Yes' : 'No'}</Badge>
                                    </FlatRow>
                                    <Eyebrow>What to try</Eyebrow>
                                    <SecurityItem icon="bi-three-dots-vertical" title="Kebab menu" desc="Header three-dot button: permissions ∧ when() filtering, separator collapse, closes on select." />
                                    <SecurityItem icon="bi-shield-lock" title="Gated rail" desc="Admin and Restricted groups below only exist for sessions holding the grants — dividers drop with their sections." />
                                </>
                            ),
                        },
                        { divider: 'Workspace' },
                        {
                            // Keep-alive: state in here survives switching away.
                            key: 'notes', label: 'Notes', icon: 'bi-journal-text', render: () => <NotesScratch />,
                        },
                        ...(includeBilling ? [{
                            key: 'billing', label: 'Billing', icon: 'bi-credit-card', render: () => (
                                <>
                                    <Eyebrow>Self-heal</Eyebrow>
                                    <p className="dim" style={{ marginBottom: 10 }}>
                                        Uncheck "include Billing section" in the controls while you are HERE:
                                        the active section vanishes from the schema and selection heals to the
                                        first visible section. The heal is sticky — re-including Billing does
                                        not steal selection back.
                                    </p>
                                    <FlatRow label="Plan"><Badge tone="primary">Pro</Badge></FlatRow>
                                    <FlatRow label="Renews">2026-09-01</FlatRow>
                                </>
                            ),
                        }] : []),
                        { divider: 'Admin' },
                        {
                            // Any session holding view_admin (directly, via the users
                            // category, superuser, or active-group member admin).
                            key: 'admin', label: 'Admin', icon: 'bi-sliders', permissions: 'view_admin', render: () => (
                                <>
                                    <Eyebrow>Permission self-heal</Eyebrow>
                                    <p className="dim" style={{ marginBottom: 10 }}>
                                        You see this because <code>view_admin</code> resolved true. As ian, stay
                                        HERE and switch the active group odd → even: member admin goes away, the
                                        section disappears, and selection self-heals — fail-closed, live.
                                    </p>
                                    <FlatRow label="Gate"><code>permissions: 'view_admin'</code></FlatRow>
                                </>
                            ),
                        },
                        { divider: 'Restricted' },
                        {
                            // Nobody holds this; only superusers / sys-admin pass every
                            // gate. For everyone else the section AND its divider drop.
                            key: 'secrets', label: 'Secrets', icon: 'bi-incognito', permissions: ['definitely_not_granted'], render: () => (
                                <>
                                    <Eyebrow>Superusers only</Eyebrow>
                                    <p className="dim">
                                        Only a superuser (or sys-level admin) can see this section — everyone
                                        else never mounts it, and the "Restricted" divider drops with it.
                                    </p>
                                </>
                            ),
                        },
                    ]}
                />
            </div>
        </>
    );
}
