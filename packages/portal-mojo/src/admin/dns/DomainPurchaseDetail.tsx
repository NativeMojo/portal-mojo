import { useEffect, useState } from 'react';
import { Badge, FlatRow, fmt } from '../../ui';
import { fetchPurchaseDetail } from './api';
import { redactRegistrarError } from './purchase-data';
import type { DomainPurchaseRow } from './models';

export function DomainPurchaseDetail({ id, close }: { id: number; close: () => void }) {
    const [row, setRow] = useState<DomainPurchaseRow | null>(null); const [error, setError] = useState('');
    useEffect(() => { let current = true; void fetchPurchaseDetail(id).then((value) => { if (current) setRow(value); }, (reason) => { if (current) setError(redactRegistrarError(reason)); }); return () => { current = false; setRow(null); setError(''); }; }, [id]);
    return <div className="modal-pad"><div className="eyebrow">Domain purchase ledger</div><h2 className="modal-title">{row?.domain_name ?? `Purchase #${id}`}</h2>{!row && !error && <p className="dim">Loading ledger detail…</p>}{error && <div className="form-alert">{error}</div>}{row && <><div className="chip-row"><Badge tone={row.status === 'completed' ? 'success' : row.status === 'failed' ? 'danger' : 'warning'}>{row.status}</Badge></div><FlatRow label="Purchase"><code>#{row.id}</code></FlatRow><FlatRow label="Kind">{row.kind}</FlatRow><FlatRow label="Price">{row.price ?? '—'} {row.currency}</FlatRow><FlatRow label="Cost">{row.cost ?? '—'} {row.currency}</FlatRow><FlatRow label="Years">{row.years}</FlatRow><FlatRow label="Created">{fmt.datetime(row.created)}</FlatRow><FlatRow label="Quote expiry">{fmt.datetime(row.quote_expires)}</FlatRow><FlatRow label="Operation"><code>{row.operation_id ?? 'Not recorded'}</code></FlatRow>{row.error && <div className="form-alert">{redactRegistrarError(row.error)}</div>}</>}<div className="modal-actions"><button className="btn" onClick={close}>Close</button></div></div>;
}
