// Display demos: badges + formatters, the expanding search, the skeleton
// silhouette, and permission gates against the live session.
import { useState } from 'react';
import { useCan, useMe, type Me } from 'portal-mojo/client';
import { Badge, ExpandingSearch, Guarded, fmt, type Tone } from 'portal-mojo/ui';

const TONES: Tone[] = ['success', 'warning', 'danger', 'info', 'muted', 'primary'];
const NOW_SEC = Math.floor(Date.now() / 1000);

export function DisplayDemo() {
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Badge tones</div>
            <div className="demo-row" style={{ marginBottom: 16 }}>
                {TONES.map((t) => <Badge key={t} tone={t}>{t}</Badge>)}
                <Badge tone={fmt.inferTone('active')}>inferTone('active')</Badge>
                <Badge tone={fmt.inferTone('banned')}>inferTone('banned')</Badge>
            </div>
            <div className="eyebrow">Formatters (epoch-seconds aware — the django-mojo wire shape)</div>
            <table className="demo-table">
                <tbody>
                    <tr><td><code>fmt.date({NOW_SEC})</code></td><td>{fmt.date(NOW_SEC)}</td></tr>
                    <tr><td><code>fmt.datetime(epoch)</code></td><td>{fmt.datetime(NOW_SEC - 86400 * 3)}</td></tr>
                    <tr><td><code>fmt.relative(epoch − 3w)</code></td><td>{fmt.relative(NOW_SEC - 86400 * 21)}</td></tr>
                    <tr><td><code>fmt.relative(null)</code></td><td>{fmt.relative(null)}</td></tr>
                    <tr><td><code>fmt.initials('Ada Lovelace')</code></td><td>{fmt.initials('Ada Lovelace')}</td></tr>
                    <tr><td><code>fmt.initials(null)</code></td><td>{fmt.initials(null)} (never throws — live rows carry nulls)</td></tr>
                </tbody>
            </table>
        </div>
    );
}

export function SearchDemo() {
    const [term, setTerm] = useState('');
    return (
        <div className="panel panel-pad">
            <div className="demo-row">
                <ExpandingSearch value={term} onChange={setTerm} placeholder="Type, then pause…" />
                <span className="dim">committed (after 300ms debounce): <code>{JSON.stringify(term)}</code></span>
            </div>
            <p className="dim" style={{ marginTop: 12 }}>
                Icon at rest → input on focus → pinned open while it holds text. Press <kbd>/</kbd> anywhere
                to focus it; Enter commits immediately; Escape blurs. In ModelTable the committed value is a
                server wire param.
            </p>
        </div>
    );
}

export function SkeletonDemo() {
    return (
        <div className="panel panel-pad">
            <p className="dim" style={{ marginBottom: 12 }}>
                Shown whenever a load's rows aren't on screen yet — cold loads AND page/sort/filter
                changes. Cached pages render instantly instead; auto-refresh never blanks the table.
            </p>
            <table className="tbl">
                <tbody>
                    {[0, 1, 2].map((i) => (
                        <tr key={i} className="skel-row" aria-hidden="true">
                            <td style={{ width: '40%' }}>
                                <span className="skel-user">
                                    <span className="skel skel-avatar" />
                                    <span className="skel-stack">
                                        <span className="skel skel-w-60" />
                                        <span className="skel skel-w-90" />
                                    </span>
                                </span>
                            </td>
                            <td><span className="skel skel-w-75" /></td>
                            <td><span className="skel skel-w-40" /></td>
                            <td className="text-center"><span className="skel skel-pill" /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function CanChip({ perm }: { perm: string }) {
    const { can } = useCan(perm);
    return <Badge tone={can ? 'success' : 'muted'}>{perm}: {can ? 'yes' : 'no'}</Badge>;
}

export function AccessDemo() {
    const { data: me } = useMe();
    const identity = me ? `${(me as Me).display_name ?? (me as Me).email ?? 'user'} — permissions ${JSON.stringify((me as Me).permissions ?? {})}` : 'signed out';
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">Session</div>
            <p style={{ marginBottom: 14 }}>{identity}</p>
            <div className="eyebrow">useCan — category rollup + member context fold in</div>
            <div className="demo-row" style={{ marginBottom: 16 }}>
                {['view_admin', 'users', 'view_users', 'manage_groups', 'admin'].map((p) => <CanChip key={p} perm={p} />)}
            </div>
            <div className="eyebrow">&lt;Guarded&gt; — fail-closed rendering</div>
            <Guarded permission="view_admin">
                <p><Badge tone="success">visible</Badge> You hold <code>view_admin</code> (directly or via rollup).</p>
            </Guarded>
            <Guarded permission="definitely_not_a_permission">
                <p>You should never see this.</p>
            </Guarded>
            <p className="dim" style={{ marginTop: 10 }}>
                Client gates are UI affordances only — the server re-checks every request.
            </p>
        </div>
    );
}
