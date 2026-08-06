import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fmt, modal, toast } from '../../ui';
import { BucketDetail } from './BucketDetail';
import { createBucket, useBuckets, type S3BucketRow } from './models';

export function showBucketDetail(bucket: S3BucketRow): void {
    void modal.detail((close) => <BucketDetail bucket={bucket} onClose={() => close(null)} />);
}

export function BucketsPage() {
    const queryClient = useQueryClient();
    const query = useBuckets();
    const [search, setSearch] = useState('');
    const [name, setName] = useState('');
    const [creating, setCreating] = useState(false);
    const rows = useMemo(() => [...(query.data ?? [])]
        .filter((row) => row.name.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)), [query.data, search]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const bucketName = name.trim();
        if (!bucketName) return;
        setCreating(true);
        const outcome = await createBucket(queryClient, bucketName);
        setCreating(false);
        if (outcome.error) {
            toast.error(outcome.error instanceof Error ? outcome.error.message : 'Bucket create failed');
            return;
        }
        setName('');
        toast.success(outcome.data?.created_new === false ? `${bucketName} already exists` : `${bucketName} created private`);
        if (outcome.refreshError) toast.warning('Bucket created, but inventory refresh failed. Retry refresh before another action.');
    };

    return (
        <div className="panel storage-buckets">
            <div className="toolbar">
                <div className="toolbar-heading"><div className="eyebrow">Infrastructure · Storage</div><h1 className="panel-title">Buckets</h1></div>
                <button className="btn-icon" title="Refresh bucket inventory" onClick={() => void query.refetch()}>
                    <i className={`bi bi-arrow-repeat${query.isFetching ? ' spin' : ''}`} />
                </button>
            </div>
            <div className="storage-bucket-tools">
                <label className="field"><span className="field-label">Local name search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search complete inventory" /></label>
                <form className="storage-bucket-create" onSubmit={(event) => void submit(event)}>
                    <label className="field"><span className="field-label">New private bucket</span><input value={name} onChange={(event) => setName(event.target.value)} required placeholder="exact-bucket-name" /></label>
                    <button className="btn btn-primary" disabled={creating || !name.trim()}>{creating ? 'Creating…' : 'Create private'}</button>
                </form>
            </div>
            {query.isError ? (
                <div className="empty storage-error"><i className="bi bi-cloud-slash" /><h2>Bucket inventory unavailable</h2><p>{query.error instanceof Error ? query.error.message : 'AWS did not return a conclusive inventory.'}</p><button className="btn" onClick={() => void query.refetch()}>Retry</button></div>
            ) : query.isLoading ? <div className="empty"><i className="bi bi-hourglass-split" /><p>Loading the complete account inventory…</p></div>
                : rows.length === 0 ? <div className="empty"><i className="bi bi-bucket" /><h2>{query.data?.length ? 'No matching buckets' : 'No buckets'}</h2><p>{query.data?.length ? 'Clear the local name search.' : 'AWS returned a conclusive empty inventory.'}</p></div>
                    : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Created</th><th aria-label="Open" /></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="row-click" onClick={() => showBucketDetail(row)}><td><code>{row.name}</code></td><td>{fmt.datetime(row.created)}</td><td className="text-end"><i className="bi bi-chevron-right" /></td></tr>)}</tbody></table></div>}
            <p className="storage-footnote">This is a bounded complete-list surface. Bucket deletion is not supported.</p>
        </div>
    );
}
