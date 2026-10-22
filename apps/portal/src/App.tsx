import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ModalHost, RightPanelProvider, RightPanelSlot, ToastHost, useRightPanel } from 'portal-mojo/ui/shell';
import { Sidebar } from './components/Sidebar';
import { TopNav } from './components/TopNav';

function AppShell() {
    const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 640px)').matches);
    const { pathname } = useLocation();
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        if (window.matchMedia('(max-width: 640px)').matches) return true;
        try {
            return localStorage.getItem('portal-mojo:admin-sidebar') === 'collapsed';
        } catch {
            return false;
        }
    });

    useEffect(() => {
        const media = window.matchMedia('(max-width: 640px)');
        const update = () => {
            setNarrow(media.matches);
            if (media.matches) setSidebarCollapsed(true);
            else {
                try { setSidebarCollapsed(localStorage.getItem('portal-mojo:admin-sidebar') === 'collapsed'); }
                catch { setSidebarCollapsed(false); }
            }
        };
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    useEffect(() => { if (narrow) setSidebarCollapsed(true); }, [pathname, narrow]);
    useEffect(() => {
        if (!narrow || sidebarCollapsed) return;
        const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') setSidebarCollapsed(true); };
        window.addEventListener('keydown', dismiss);
        return () => window.removeEventListener('keydown', dismiss);
    }, [narrow, sidebarCollapsed]);

    function toggleSidebar(): void {
        setSidebarCollapsed((current) => {
            const next = !current;
            try {
                if (!narrow) localStorage.setItem('portal-mojo:admin-sidebar', next ? 'collapsed' : 'expanded');
            } catch { /* persistence is optional */ }
            return next;
        });
    }

    const rightPanel = useRightPanel();
    return (
        <div className={`app${sidebarCollapsed || narrow ? ' app-sidebar-collapsed' : ''}${narrow ? ' app-admin-mobile' : ''}${rightPanel.isOpen ? ' app-right-panel-open' : ''}`}>
            {narrow && !sidebarCollapsed && <button type="button" className="admin-sidebar-dismiss" aria-label="Close Admin navigation" onClick={() => setSidebarCollapsed(true)} />}
            <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
            <div className="main">
                <TopNav />
                <main className="content">
                    <Outlet />
                </main>
            </div>
            <RightPanelSlot />
            <ModalHost />
            <ToastHost />
        </div>
    );
}

export default function App() {
    return <RightPanelProvider><AppShell /></RightPanelProvider>;
}
