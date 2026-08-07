import { useMemo, useState } from 'react';
import { HandlerChainBuilder, parseHandlerChain, runtimeEffectiveHandlerChain, serializeHandlerChain, validateHandlerChain } from 'portal-mojo/admin/security';

const EXAMPLE = 'block://?ttl=3600&fleet_wide=1,notify://perm@manage_security,oncall,ticket://?priority=9&priority=4&future=retain,custom://future?opaque=yes,resolve://?status=resolved';

export function AdminRulesDemo() {
    const [value, setValue] = useState(EXAMPLE);
    const chain = useMemo(() => parseHandlerChain(value), [value]); const issues = useMemo(() => validateHandlerChain(chain), [chain]);
    return <div className="demo-stack"><div className="demo-heading"><div><div className="eyebrow">Admin · Rule Engine</div><h2>Lossless handler-chain builder</h2><p>Supported handlers are structured; duplicate and future content stays ordered and visible. Try move/remove/add, then reset to the empty record-only chain.</p></div><div className="demo-actions"><button type="button" className="btn" onClick={() => setValue(EXAMPLE)}>Reset legacy example</button><button type="button" className="btn" onClick={() => setValue('')}>Empty chain</button></div></div><HandlerChainBuilder value={value} onChange={setValue} /><div className="demo-grid-2"><section className="panel demo-panel"><h3>Exact serialization</h3><pre className="handler-raw">{serializeHandlerChain(chain) || '(empty string)'}</pre><p className="dim">Untouched input round-trips byte-for-byte.</p></section><section className="panel demo-panel"><h3>Runtime-effective projection</h3><ol>{runtimeEffectiveHandlerChain(chain).map((spec) => <li key={spec}><code>{spec}</code></li>)}</ol>{!runtimeEffectiveHandlerChain(chain).length && <p className="dim">No action is dispatched.</p>}</section></div><section className="panel demo-panel"><h3>Validation summary</h3>{issues.length ? <ul>{issues.map((issue, index) => <li key={index}><Badge level={issue.level} /> Step {issue.step + 1}: {issue.message}</li>)}</ul> : <p>No structural issues.</p>}<p className="dim">Targets, Python imports, permissions, Maestro boards, and runtime settings still require server-side validation.</p></section></div>;
}

function Badge({ level }: { level: 'error' | 'warning' }) { return <strong className={`handler-demo-${level}`}>{level.toUpperCase()}</strong>; }
