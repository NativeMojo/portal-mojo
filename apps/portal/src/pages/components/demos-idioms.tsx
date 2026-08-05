// UX-idiom demos (board #1281): armed button · undo toast · progress toast —
// the maestro workspaces dom.js trio, each exercised end-to-end.
// MERGE-WIRE: rail — add to ComponentsPage under Feedback:
//   { key: 'idioms', title: 'UX idioms', icon: 'bi-hand-index-thumb',
//     blurb: 'Armed two-step confirm for the irreversible; act-now + Undo for the reversible; a persistent progress card for the long-running.',
//     render: () => <IdiomsDemo /> }
import { useRef, useState } from 'react';
import { Badge, toast } from 'portal-mojo/ui';
// MERGE-WIRE: portal-mojo/ui — flip to the package import once index.ts exports ArmedButton
import { ArmedButton } from '../../../../../packages/portal-mojo/src/ui/armed-button';

const INITIAL = ['portal_test', 'jane.cooper', 'devon.lane'];

export function IdiomsDemo() {
    const [destroyed, setDestroyed] = useState(0);
    const [rows, setRows] = useState<string[]>(INITIAL);
    const uploadTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── Undo toast: the action HAPPENS FIRST, Undo restores ──────────
    const archive = (name: string) => {
        setRows((prev) => prev.filter((r) => r !== name));
        toast.undo(`${name} archived`, () => {
            setRows((prev) => (prev.includes(name) ? prev : [...prev, name]));
        });
    };

    // ── Progress toast: caller drives update/done/fail; ✕ aborts ─────
    const startUpload = (failAt?: number) => {
        if (uploadTimer.current) return; // one at a time in the demo
        const handle = toast.progress('Uploading export.csv…', {
            onCancel: () => {
                stop();
                handle.fail('Upload cancelled');
            },
        });
        let pct = 0;
        const stop = () => {
            if (uploadTimer.current) { clearInterval(uploadTimer.current); uploadTimer.current = null; }
        };
        uploadTimer.current = setInterval(() => {
            pct += 4 + Math.random() * 7;
            if (failAt != null && pct >= failAt) {
                stop();
                handle.fail('Network error at 60%');
                return;
            }
            if (pct >= 100) {
                stop();
                handle.done('export.csv uploaded');
                return;
            }
            handle.update(pct);
        }, 180);
    };

    return (
        <div className="panel panel-pad" style={{ display: 'grid', gap: 18 }}>
            <div>
                <div className="eyebrow">Armed button — two-step confirm, no dialog</div>
                <p className="dim" style={{ margin: '4px 0 10px' }}>
                    First click arms it (danger fill + blast-radius label), second click fires.
                    Auto-disarms after 6s; Escape disarms too. For IRREVERSIBLE actions only.
                </p>
                <div className="demo-row">
                    <ArmedButton
                        label="Purge 3 records"
                        armedLabel="Click again — purges 3 records"
                        icon="bi-trash"
                        onConfirm={() => { setDestroyed((n) => n + 3); toast.success('3 records purged (demo)'); }}
                    />
                    <span className="dim">purged so far: <Badge tone="muted">{destroyed}</Badge></span>
                </div>
            </div>

            <div>
                <div className="eyebrow">Undo toast — act immediately, offer a grace window</div>
                <p className="dim" style={{ margin: '4px 0 10px' }}>
                    The archive happens on click — no confirm. Undo restores within 6s;
                    silence lets it stand. The replacement for confirm() on reversible actions.
                </p>
                <div className="demo-row" style={{ flexWrap: 'wrap' }}>
                    {rows.map((r) => (
                        <span key={r} className="chip chip-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {r}
                            <button className="btn-icon btn-icon-sm" title={`Archive ${r}`} onClick={() => archive(r)}>
                                <i className="bi bi-archive" />
                            </button>
                        </span>
                    ))}
                    {rows.length === 0 && <span className="dim-italic">All archived — use Undo (or wait and they stay gone)</span>}
                </div>
            </div>

            <div>
                <div className="eyebrow">Progress toast — persistent, caller-driven, cancellable</div>
                <p className="dim" style={{ margin: '4px 0 10px' }}>
                    Never auto-dismisses while active. update(pct) drives the bar; done()
                    flashes ✓ and leaves; fail() goes red and lingers; ✕ calls the caller's
                    onCancel — the CALLER aborts, then settles the toast.
                </p>
                <div className="demo-row">
                    <button className="btn" onClick={() => startUpload()}>Start upload</button>
                    <button className="btn" onClick={() => startUpload(60)}>Upload that fails at 60%</button>
                </div>
            </div>
        </div>
    );
}
