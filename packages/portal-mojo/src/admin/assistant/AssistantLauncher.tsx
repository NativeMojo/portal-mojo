import { useEffect, useState, type MouseEvent } from 'react';
import { useCan } from '../../client/runtime';
import { useRightPanel } from '../../ui/RightPanel';
import { ASSISTANT_PERMISSIONS } from './permissions';

export function AssistantLauncher() {
    const { can } = useCan(ASSISTANT_PERMISSIONS);
    const panel = useRightPanel();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => { if (!can && panel.descriptor?.key.startsWith('assistant:')) panel.close(); }, [can, panel]);
    if (!can) return null;
    const open = async (event: MouseEvent<HTMLButtonElement>) => {
        const launcher = event.currentTarget;
        setLoading(true); setError('');
        try {
            const { AssistantPanel } = await import('./AssistantPanel');
            panel.open({ key: 'assistant:new', title: 'Assistant', render: (context) => <AssistantPanel context={context} /> }, launcher);
        } catch { setError('Assistant could not load. Click to retry.'); }
        finally { setLoading(false); }
    };
    return <button type="button" className="btn-icon" title={error || 'Open Assistant'} aria-label={error || 'Open Assistant'} aria-pressed={panel.descriptor?.key === 'assistant:new'} disabled={loading} onClick={(event) => void open(event)}><i className="bi bi-stars" aria-hidden="true" /></button>;
}
