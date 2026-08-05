import { Outlet } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopNav } from './components/TopNav';
import { ModalHost } from './components/modal';
import { ToastHost } from './components/toast';

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
