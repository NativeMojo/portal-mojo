import { useState } from 'react';
import { FormWizard, Tabs, formWizardModal, toast, type FormData, type FormWizardSection } from 'portal-mojo/ui';

const VARIANTS = ['minimal', 'traditional', 'underline', 'underline-all', 'pills', 'pills-solid', 'segmented', 'btn-group', 'mystery'] as const;
const SIMPLE_ITEMS = [
    { key: 'first', label: 'First', panel: <p>First panel</p> },
    { key: 'disabled', label: 'Disabled', panel: <p>Never selected</p>, disabled: true },
    { key: 'last', label: 'Last', panel: <p>Last panel</p> },
];

const SECTIONS: FormWizardSection[] = [
    {
        key: 'identity',
        label: 'Identity',
        description: 'Required and email validation block Next.',
        fields: [
            { name: 'name', type: 'text', label: 'Name', required: true },
            { name: 'email', type: 'email', label: 'Email', required: true },
            { name: 'contact', type: 'select', label: 'Contact preference', options: [{ value: 'none', label: 'None' }, { value: 'phone', label: 'Phone' }] },
        ],
    },
    {
        key: 'details',
        label: 'Details',
        description: 'Phone visibility depends on a value from the first step; Back/Next retains every draft.',
        fields: [
            { name: 'phone', type: 'tel', label: 'Phone', required: true, showWhen: { field: 'contact', value: 'phone' } },
            { name: 'team', type: 'combo', label: 'Team picker', options: [{ value: 'ops', label: 'Operations', description: 'Popover-backed picker inside the wizard' }, { value: 'eng', label: 'Engineering' }] },
            { name: 'notes', type: 'textarea', label: 'Notes' },
        ],
    },
];

const wait = () => new Promise<void>((resolve) => window.setTimeout(resolve, 700));

export function TabsDemo() {
    const [controlled, setControlled] = useState('first');
    return (
        <div className="demo-stack">
            <div className="panel panel-pad">
                <h3>Controlled + disabled</h3>
                <Tabs items={SIMPLE_ITEMS} activeKey={controlled} onActiveKeyChange={setControlled} />
            </div>
            {VARIANTS.map((variant) => (
                <div key={variant} className="panel panel-pad">
                    <h3>{variant}</h3>
                    <Tabs items={SIMPLE_ITEMS} variant={variant} ariaLabel={`${variant} tabs`} />
                </div>
            ))}
        </div>
    );
}

export function FormWizardDemo() {
    const [fail, setFail] = useState(false);
    const [payload, setPayload] = useState<FormData | null>(null);
    const finish = async (data: FormData) => {
        await wait();
        if (fail) throw new Error('Intentional async failure — values stay ready for retry.');
        setPayload(data);
        toast.success('Finished');
    };
    const openModal = async () => {
        const result = await formWizardModal({ title: 'Wizard modal + popover picker', sections: SECTIONS, mode: 'wizard', onFinish: finish });
        toast.info(result ? `modal resolved ${JSON.stringify(result)}` : 'modal cancelled → null');
    };
    return (
        <div className="demo-stack">
            <label className="switch-row">
                <input type="checkbox" role="switch" className="switch" checked={fail} onChange={(event) => setFail(event.target.checked)} />
                <span className="field-label">Reject the next async finish</span>
            </label>
            <div className="panel panel-pad">
                <h3>Ordered wizard</h3>
                <FormWizard sections={SECTIONS} mode="wizard" onFinish={finish} />
            </div>
            <div className="panel panel-pad">
                <h3>Non-linear tabs</h3>
                <FormWizard sections={SECTIONS} mode="tabs" tabVariant="segmented" onFinish={finish} />
            </div>
            <button className="btn" onClick={() => void openModal()}>Open formWizardModal()</button>
            {payload && <pre className="demo-pre">{JSON.stringify(payload, null, 2)}</pre>}
        </div>
    );
}
