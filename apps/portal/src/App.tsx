import { Outlet } from 'react-router-dom';
import { ModalHost, ToastHost } from 'portal-mojo/ui';
import { Sidebar } from './components/Sidebar';
import { TopNav } from './components/TopNav';

export default function App() {
    return (
        <div className="app">
            <Sidebar />
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
