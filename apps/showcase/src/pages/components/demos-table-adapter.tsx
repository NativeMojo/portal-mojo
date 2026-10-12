// Stable adapter component, local rows, the SAME ModelTable URL controls.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { mojoCall, registerNonFilterParams, type Params } from 'portal-mojo/client/runtime';
import { ModelTable, toast, type ModelTableQuery, type ModelTableQueryAdapterProps } from 'portal-mojo/ui';

registerNonFilterParams('demo');
type Row = { id: number; name: string; kind: string };
const FailureContext = createContext(false);

function PrivateGroupQuery({ params, enabled, children }: ModelTableQueryAdapterProps<Row>) {
    const failure = useContext(FailureContext);
    const [revision, refresh] = useState(0);
    const [state, setState] = useState<{ key: string; query: Omit<ModelTableQuery<Row>, 'refetch'> }>();
    const key = JSON.stringify(params);
    const current = useRef({ key, enabled });
    current.current = { key, enabled };
    useEffect(() => {
        if (!enabled) { setState(undefined); return; }
        const controller = new AbortController();
        const check = () => {
            controller.signal.throwIfAborted();
            if (!current.current.enabled || current.current.key !== key) throw new Error('Table scope changed');
        };
        setState(previous => ({ key, query: { data: previous?.key === key ? previous.query.data : undefined, status: previous?.key === key && previous.query.data ? 'success' : 'pending', isFetching: true } }));
        void (async () => {
            try {
                if (failure) throw new Error('Demo connection is offline. Current rows remain available.');
                const result = await mojoCall('/api/group', { params: JSON.parse(key) as Params, signal: controller.signal, beforeSend: check });
                check();
                setState({ key, query: { data: { rows: (result.data ?? []) as Row[], count: result.count ?? 0 }, status: 'success', isFetching: false } });
            } catch (error) {
                if (controller.signal.aborted || current.current.key !== key || !current.current.enabled) return;
                setState(previous => ({ key, query: { data: previous?.key === key ? previous.query.data : undefined, status: 'error', error, isFetching: false } }));
            }
        })();
        return () => controller.abort();
    }, [key, enabled, revision, failure]);
    const query = enabled && state?.key === key ? state.query : { status: 'pending' as const, isFetching: false };
    return children({ ...query, refetch: () => refresh(value => value + 1) });
}

export function TableAdapterDemo() {
    const [scope, setScope] = useState<'team' | 'org' | null>('team');
    const [failure, setFailure] = useState(false);
    return <div className="demo-stack">
        <div className="panel panel-pad">
            <p>Rows live in this component. Search, sort, filters and paging use the shared table controls. Focus a row and press Enter or Space to open it.</p>
            <div className="toolbar-controls">
                <button className="btn" onClick={() => setScope('team')}>Teams</button>
                <button className="btn" onClick={() => setScope('org')}>Organizations</button>
                <button className="btn" onClick={() => setScope(null)}>Clear scope</button>
                <button className="btn" aria-pressed={failure} onClick={() => setFailure(value => !value)}>{failure ? 'Restore connection' : 'Simulate background failure'}</button>
            </div>
        </div>
        <FailureContext.Provider value={failure}>
            <ModelTable<Row>
                endpoint="/api/group" title="Private groups" queryAdapter={PrivateGroupQuery}
                fixedParams={scope === null ? null : { kind: scope }} defaultSort="name" defaultParams={{ size: 25 }}
                columns={[
                    { key: 'name', label: 'Name' },
                    { key: 'kind', label: 'Kind' },
                    { key: 'action', label: 'Action', sortable: false, render: row => <button className="btn btn-compact" onClick={() => toast.success(`Button opened ${row.name}`)}>Open button</button> },
                ]}
                onRowClick={row => toast.success(`Row opened ${row.name}`)}
            />
        </FailureContext.Provider>
    </div>;
}
