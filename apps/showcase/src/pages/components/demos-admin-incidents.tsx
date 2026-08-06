import { useState } from 'react';
import { EventsPage, IncidentsPage } from 'portal-mojo/admin';

function Surface() {
    const [surface, setSurface] = useState<'incidents' | 'events'>('incidents');
    return <>
        <div className="admin-incidents-demo-tabs" role="group" aria-label="Security operations surface">
            <button className={`btn btn-compact${surface === 'incidents' ? ' btn-primary' : ''}`} onClick={() => setSurface('incidents')}>Incidents</button>
            <button className={`btn btn-compact${surface === 'events' ? ' btn-primary' : ''}`} onClick={() => setSurface('events')}>Events</button>
        </div>
        <p className="dim">Open a row to inspect curated evidence, request context, bounded traces, and incident history. Secret fixtures must render only as [redacted].</p>
        <div className="admin-incidents-demo-main">{surface === 'incidents' ? <IncidentsPage /> : <EventsPage />}</div>
    </>;
}
export function AdminIncidentsDemo() { return <Surface />; }
