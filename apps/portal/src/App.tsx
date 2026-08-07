import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { ModalHost, RightPanelProvider, RightPanelSlot, ToastHost, useRightPanel } from 'portal-mojo/ui/shell';
import { Sidebar } from './components/Sidebar';
import { TopNav } from './components/TopNav';

function AppShell() {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        try {
            return localStorage.getItem('portal-mojo:admin-sidebar') === 'collapsed';
        } catch {
            return false;
        }
    });

    function toggleSidebar(): void {
        setSidebarCollapsed((current) => {
            const next = !current;
            try {
                localStorage.setItem('portal-mojo:admin-sidebar', next ? 'collapsed' : 'expanded');
            } catch { /* persistence is optional */ }
            return next;
        });
    }

    const rightPanel = useRightPanel();
    return (
        <div className={`app${sidebarCollapsed ? ' app-sidebar-collapsed' : ''}${rightPanel.isOpen ? ' app-right-panel-open' : ''}`}>
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
