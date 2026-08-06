import { useState } from 'react';
import {
    RightPanelProvider, RightPanelSlot, modal, useRightPanel,
} from 'portal-mojo/ui';

function DemoShell() {
    const panel = useRightPanel();
    const [view, setView] = useState('Queue');

    const open = (ticket: number, launcher: HTMLButtonElement) => {
        panel.open({
            key: `demo-ticket:${ticket}`,
            title: `Ticket #${ticket}`,
            render: ({ close }) => (
                <div className="right-panel-demo-content">
                    <div className="eyebrow">Persistent shell slot</div>
                    <h3>Investigate ticket {ticket}</h3>
                    <p className="dim">Change the simulated route at left: this content stays mounted and the URL remains untouched.</p>
                    <div className="demo-row">
                        <button className="btn" onClick={() => void modal.confirm({
                            title: 'Dialog coexistence',
                            message: 'Escape closes this native dialog before it can close the panel.',
                        })}>Open dialog</button>
                        <button className="btn" onClick={close}>Close panel</button>
                    </div>
                </div>
            ),
        }, launcher);
    };

    return (
        <div className="right-panel-demo-shell">
            <div className={`right-panel-demo-main${panel.isOpen ? '' : ' right-panel-demo-main-only'}`}>
                <div className="eyebrow">Simulated route · {view}</div>
                <h3>Security workspace</h3>
                <p className="dim">The panel is complementary, not modal. Tab remains free to move between both regions.</p>
                <div className="demo-row">
                    <button className="btn" onClick={() => setView((current) => current === 'Queue' ? 'Rules' : 'Queue')}>Navigate-like rerender</button>
                    <button className="btn btn-primary" onClick={(event) => open(1413, event.currentTarget)}>Open #1413</button>
                    <button className="btn" onClick={(event) => open(1414, event.currentTarget)}>Replace with #1414</button>
                </div>
            </div>
            <RightPanelSlot />
        </div>
    );
}

export function RightPanelDemo() {
    return (
        <div className="panel panel-pad">
            <p className="dim">Open, replace, rerender the main region, exercise dialog/Escape ordering, then close to see focus return to the launcher.</p>
            <RightPanelProvider><DemoShell /></RightPanelProvider>
        </div>
    );
}
