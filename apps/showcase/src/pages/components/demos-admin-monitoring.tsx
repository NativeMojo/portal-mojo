import { useState } from 'react';
// MERGE-WIRE: switch to `portal-mojo/admin` after the orchestrator adds the
// monitoring barrel to the shared admin entry point.
import {
    LogInspector,
    type LogRow,
} from '../../../../../packages/portal-mojo/src/admin/monitoring';

const NOW = Math.floor(Date.now() / 1000);

const EXAMPLES: Array<{ label: string; row: LogRow }> = [
    {
        label: 'Request JSON',
        row: {
            id: 8101, created: NOW - 75, level: 'info', kind: 'request', method: 'POST',
            path: '/api/incident/ticket/501', payload: '{"source":"showcase","attempt":1}',
            ip: '203.0.113.22', duid: 'browser-demo-8a9e', uid: 42, gid: 7, username: 'operator@example.com',
            user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            log: '{"title":"Latency <script>alert(1)</script>","severity":3}',
            model_name: 'incident.Ticket', model_id: 501,
        },
    },
    {
        label: 'Response JSON',
        row: {
            id: 8102, created: NOW - 74, level: 'warning', kind: 'http:response', method: 'POST',
            path: '/api/incident/ticket/501', payload: '{"elapsed_ms":184,"worker":"api-2"}',
            ip: '203.0.113.22', duid: 'browser-demo-8a9e', uid: 42, gid: 7, username: 'operator@example.com',
            user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            log: '{"status":false,"error":"Validation failed","fields":{"title":["Required"]}}',
            model_name: 'incident.Ticket', model_id: 501,
        },
    },
    {
        label: 'Plain message',
        row: {
            id: 8103, created: NOW - 20, level: 'error', kind: 'worker:error', method: null,
            path: null, payload: '<img src=x onerror=alert("never executes")>', ip: null, duid: null,
            uid: 0, gid: 0, username: null, user_agent: null,
            log: 'Delivery failed\nRetry budget exhausted.\n<script>alert("still text")</script>',
            model_name: null, model_id: 0,
        },
    },
];

export function AdminMonitoringDemo() {
    const [selected, setSelected] = useState(0);
    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <div className="panel panel-pad">
                <div className="eyebrow">Static safety cases</div>
                <p className="dim" style={{ margin: '3px 0 10px' }}>
                    Switch among request, response, and HTML-looking plain text. The primary <code>log</code> content and
                    auxiliary <code>payload</code> stay visibly distinct, and response records claim no paired request.
                </p>
                <div className="seg" aria-label="Inspector record">
                    {EXAMPLES.map((example, index) => (
                        <button
                            type="button"
                            key={example.label}
                            className={`seg-btn${selected === index ? ' seg-active' : ''}`}
                            onClick={() => setSelected(index)}
                        >
                            {example.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="panel" style={{ overflow: 'hidden' }}>
                <LogInspector log={EXAMPLES[selected].row} />
            </div>
        </div>
    );
}
