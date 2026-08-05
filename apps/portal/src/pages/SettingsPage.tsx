// Settings — SchemaForm outside a modal: same field language, plain page.
import { SchemaForm } from '../components/FormFields';
import { toast } from '../components/toast';

export function SettingsPage() {
    return (
        <div className="panel panel-pad max-w-xl">
            <div className="eyebrow">Portal</div>
            <h3 className="panel-subtitle">General settings</h3>
            <SchemaForm
                fields={[
                    { name: 'portal_name', type: 'text', label: 'Portal name', required: true },
                    { name: 'support_email', type: 'email', label: 'Support email', required: true, help: 'Shown on error pages and in invite emails.' },
                    { name: 'welcome', type: 'textarea', label: 'Welcome message' },
                    { name: 'allow_signups', type: 'switch', label: 'Allow self-service signups' },
                ]}
                initial={{ portal_name: 'MOJO Portal', support_email: 'support@nativemojo.com', welcome: '', allow_signups: true }}
                submitText="Save settings"
                onSubmit={() => { toast.success('Settings saved'); }}
            />
        </div>
    );
}
