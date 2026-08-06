import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { ModalHost, ToastHost } from 'portal-mojo/ui';
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

    return (
        <div className={`app${sidebarCollapsed ? ' app-sidebar-collapsed' : ''}`}>
            <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
            <div className="main">
                <TopNav />
                <main className="content">
                    <Outlet />
                </main>
            </div>
            <ModalHost />
            <ToastHost />
        </div>
    );
}

export default function App() {
    return <AppShell />;
}
