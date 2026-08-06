import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, JsonBlock, fmt, toast, type Tone } from '../../ui';
import type { LogRow } from './models';

export type StoredLogKind = 'request' | 'response' | 'message';

const LEVEL_TONE: Record<string, Tone> = {
    error: 'danger',
    critical: 'danger',
    warning: 'warning',
    info: 'info',
};

/** Classify only explicit backend kind tokens; prose is never guessed. */
export function storedLogKind(row: Pick<LogRow, 'kind'>): StoredLogKind {
    const kind = (row.kind ?? '').toLowerCase();
    if (/(^|[:._-])response($|[:._-])/.test(kind)) return 'response';
    if (/(^|[:._-])request($|[:._-])/.test(kind)) return 'request';
    return 'message';
}

export function storedLogContentLabel(kind: StoredLogKind): string {
    if (kind === 'request') return 'Stored request content';
    if (kind === 'response') return 'Stored response content';
    return 'Message';
}

interface StoredContent {
    raw: string;
    json: unknown | null;
}

function storedContent(value: string | null): StoredContent | null {
    if (value == null || value === '') return null;
    try {
        return { raw: value, json: JSON.parse(value) as unknown };
    } catch {
        return { raw: value, json: null };
    }
}

function CopyTextButton({ text, label }: { text: string; label: string }) {
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const copy = async () => {
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
        if (!clipboard) {
            toast.error('Clipboard unavailable in this context');
            return;
        }
        try {
            await clipboard.writeText(text);
            setCopied(true);
            toast.success(`${label} copied to clipboard`);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1200);
        } catch (error) {
            toast.error(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    return (
        <button type="button" className="btn btn-compact" onClick={() => void copy()}>
            <i className={`bi ${copied ? 'bi-check2' : 'bi-clipboard'}`} /> {copied ? 'Copied' : 'Copy'}
        </button>
    );
}

function ContentBlock({ label, content }: { label: string; content: StoredContent | null }) {
    if (!content) {
        return (
            <section className="monitoring-inspector-block">
                <div className="eyebrow">{label}</div>
                <p className="dim">Not stored on this record.</p>
            </section>
        );
    }
    return (
        <section className="monitoring-inspector-block">
            {content.json !== null
                ? <JsonBlock value={content.json} label={label} defaultOpen />
                : (
                    <>
                        <div className="monitoring-inspector-block-head">
                            <div className="eyebrow">{label}</div>
                            <CopyTextButton text={content.raw} label={label} />
                        </div>
                        <pre className="monitoring-plain"><code>{content.raw}</code></pre>
                    </>
                )}
        </section>
    );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="monitoring-fact">
            <span>{label}</span>
            <strong>{children}</strong>
        </div>
    );
}

/** Focused viewer for exactly one stored log row; it never invents a pair. */
export function LogInspector({ log, onClose }: { log: LogRow; onClose?: () => void }) {
    const recordKind = storedLogKind(log);
    const message = storedContent(log.log);
    const payload = storedContent(log.payload);
    const route = [log.method, log.path].filter(Boolean).join(' ') || 'No request route';

    return (
        <div className="monitoring-inspector">
            <header className="monitoring-inspector-head">
                <div>
                    <div className="eyebrow">Stored {recordKind} record</div>
                    <h2>{route}</h2>
                    <p>{fmt.datetime(log.created)} · log #{log.id}</p>
                </div>
                <div className="monitoring-inspector-actions">
                    <Badge tone={LEVEL_TONE[log.level.toLowerCase()] ?? 'muted'}>{log.level}</Badge>
                    {onClose && (
                        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close inspector" title="Close">
                            <i className="bi bi-x-lg" />
                        </button>
                    )}
                </div>
            </header>

            <div className="monitoring-facts">
                <Fact label="Kind">{log.kind || 'message'}</Fact>
                <Fact label="User">{log.username || (log.uid ? `#${log.uid}` : '—')}</Fact>
                <Fact label="Group">{log.gid || '—'}</Fact>
                <Fact label="IP">{log.ip || '—'}</Fact>
                <Fact label="Browser ID"><code>{log.duid || '—'}</code></Fact>
                <Fact label="Related record">{log.model_name ? `${log.model_name}#${log.model_id}` : '—'}</Fact>
            </div>

            <ContentBlock label={storedLogContentLabel(recordKind)} content={message} />
            <ContentBlock label="Auxiliary payload" content={payload} />

            {log.user_agent && (
                <section className="monitoring-inspector-block">
                    <div className="monitoring-inspector-block-head">
                        <div className="eyebrow">User agent</div>
                        <CopyTextButton text={log.user_agent} label="User agent" />
                    </div>
                    <p className="monitoring-break">{log.user_agent}</p>
                </section>
            )}
            {(recordKind === 'request' || recordKind === 'response') && (
                <p className="monitoring-pairing-note">
                    <i className="bi bi-info-circle" /> This is one independently stored {recordKind} record.
                    The API exposes no request/response correlation key, so no paired record is claimed.
                </p>
            )}
        </div>
    );
}
