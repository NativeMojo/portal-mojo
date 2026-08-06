import { useState } from 'react';
import {
    RightPanelProvider, RightPanelSlot, modal, useRightPanel,
} from 'portal-mojo/ui';

function DemoShell() {
    const panel = useRightPanel();
    const [view, setView] = useState('Map');

    const open = (layer: number, launcher: HTMLButtonElement) => {
        panel.open({
            key: `demo-layer:${layer}`,
            title: `Map layer #${layer}`,
            render: ({ close }) => (
                <div className="right-panel-demo-content">
                    <div className="eyebrow">Persistent shell slot</div>
                    <h3>Inspect map layer {layer}</h3>
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
                <h3>Product map workspace</h3>
                <p className="dim">This is an explicit product-specific exception: the panel is complementary, not modal, and Tab remains free to move between both regions. Admin record details use KISS modals.</p>
                <div className="demo-row">
                    <button className="btn" onClick={() => setView((current) => current === 'Map' ? 'Timeline' : 'Map')}>Navigate-like rerender</button>
                    <button className="btn btn-primary" onClick={(event) => open(7, event.currentTarget)}>Open layer #7</button>
                    <button className="btn" onClick={(event) => open(9, event.currentTarget)}>Replace with layer #9</button>
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
