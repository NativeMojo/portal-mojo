import { useState } from 'react';
import { EventsPage, IncidentsPage } from 'portal-mojo/admin';
import { RightPanelProvider, RightPanelSlot, useRightPanel } from 'portal-mojo/ui';

function Surface() {
    const [surface, setSurface] = useState<'incidents' | 'events'>('incidents');
    const panel = useRightPanel();
    return <>
        <div className="admin-incidents-demo-tabs" role="group" aria-label="Security operations surface">
            <button className={`btn btn-compact${surface === 'incidents' ? ' btn-primary' : ''}`} onClick={() => { panel.close(); setSurface('incidents'); }}>Incidents</button>
            <button className={`btn btn-compact${surface === 'events' ? ' btn-primary' : ''}`} onClick={() => { panel.close(); setSurface('events'); }}>Events</button>
        </div>
        <p className="dim">Open a row to inspect curated evidence, request context, bounded traces, and incident history. Secret fixtures must render only as [redacted].</p>
        <div className="admin-incidents-demo-shell">
            <div className="admin-incidents-demo-main">{surface === 'incidents' ? <IncidentsPage /> : <EventsPage />}</div>
            <RightPanelSlot />
        </div>
    </>;
}
export function AdminIncidentsDemo() { return <RightPanelProvider><Surface /></RightPanelProvider>; }
