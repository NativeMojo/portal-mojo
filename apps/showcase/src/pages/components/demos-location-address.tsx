import { useState } from 'react';
import { AddressField, SchemaForm } from 'portal-mojo/ui';
import type { Field, FieldValues, FormData } from 'portal-mojo/client';

const ADDRESS_FIELDS: Field[] = [
    {
        name: 'address1', type: 'address', label: 'Street address', columns: 12,
        placeholder: 'Try “1600 Amphitheatre”',
        addressFields: {
            city: 'city', state_code: 'state', postal_code: 'postal_code',
            latitude: 'latitude', longitude: 'longitude', formatted_address: 'formatted_address',
        },
        help: 'Typing is private. Selecting fetches details, then patches every mapped field once.',
    },
    { name: 'city', type: 'text', label: 'City', columns: 6 },
    { name: 'state', type: 'text', label: 'State', columns: 6 },
    { name: 'postal_code', type: 'text', label: 'Postal code', columns: 6 },
    { name: 'latitude', type: 'text', label: 'Latitude', columns: 6 },
    { name: 'longitude', type: 'text', label: 'Longitude', columns: 6 },
    { name: 'formatted_address', type: 'text', label: 'Provider format', columns: 12 },
];

export function LocationAddressDemo() {
    const [direct, setDirect] = useState<FieldValues>({ address1: '', city: '', state: '', postal_code: '' });
    const [submitted, setSubmitted] = useState<FormData | null>(null);

    return (
        <div className="demo-stack">
            <section className="panel panel-pad">
                <div className="eyebrow">Controlled, commit-only</div>
                <p className="dim">
                    The token remains private to LocationClient. Raw typing never changes this JSON;
                    selecting a result applies one details patch.
                </p>
                <AddressField
                    fieldName="address1"
                    value={String(direct.address1 ?? '')}
                    fields={{ city: 'city', state_code: 'state', postal_code: 'postal_code' }}
                    onCommit={(address1) => setDirect((current) => ({ ...current, address1 }))}
                    onPatch={(patch) => setDirect((current) => ({ ...current, ...patch }))}
                />
                <pre className="address-demo-json">{JSON.stringify(direct, null, 2)}</pre>
            </section>

            <section className="panel panel-pad">
                <div className="eyebrow">SchemaForm registry binding</div>
                <p className="dim">Only declared destinations survive the atomic patch. Submit to inspect the final wire payload.</p>
                <SchemaForm fields={ADDRESS_FIELDS} submitText="Inspect payload" onSubmit={setSubmitted} />
                {submitted && <pre className="address-demo-json">{JSON.stringify(submitted, null, 2)}</pre>}
            </section>
        </div>
    );
}
