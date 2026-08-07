// Personal — AdminPersonalSection port (read in full 2026-08-05): name
// fields, DOB, timezone, address. The source's pencil-prompt-per-row grid
// becomes ONE FormView autosave surface (the C4 house rule: inline autosave,
// no save buttons); dotted metadata.* names merge server-side so editing the
// address never clobbers the rest of the blob.
//
// Deliberate deviation, backend-grounded: the source's force-verify /
// unverify DOB buttons are NOT ported — `is_dob_verified` sits in
// django-mojo's NO_SAVE_FIELDS (user.py RestMeta, read 2026-08-05), so the
// server silently DROPS the write and the source UI toasts a success that
// never happened. The verified badge still renders from the row.
import { Badge, Eyebrow, FlatRow, FormView } from '../../../../ui';
import type { Field } from '../../../../client/runtime';
import { UserModel, type UserRow } from '../models';

const NAME_FIELDS: Field[] = [
    { name: 'display_name', type: 'text', label: 'Display name', columns: 6 },
    { name: 'first_name', type: 'text', label: 'First name', columns: 6 },
    { name: 'last_name', type: 'text', label: 'Last name', columns: 6 },
];

const DETAIL_FIELDS: Field[] = [
    {
        name: 'dob', type: 'datepicker', label: 'Date of birth', columns: 6,
        outputFormat: 'date', // DateField on the wire: canonical YYYY-MM-DD
    },
    { name: 'metadata.timezone', type: 'timezone', label: 'Timezone', columns: 6 },
];

const ADDRESS_FIELDS: Field[] = [
    { name: 'metadata.street', type: 'text', label: 'Street', columns: 12, placeholder: '123 Main St' },
    { name: 'metadata.city', type: 'text', label: 'City', columns: 6 },
    { name: 'metadata.state', type: 'text', label: 'State / Province', columns: 6 },
    { name: 'metadata.zip', type: 'text', label: 'Zip / Postal code', columns: 6 },
    { name: 'metadata.country', type: 'text', label: 'Country', columns: 6 },
];

export function PersonalSection({ user }: { user: UserRow }) {
    return (
        <>
            <Eyebrow>Name</Eyebrow>
            <FormView model={UserModel} row={user} fields={NAME_FIELDS} />

            <Eyebrow>Details</Eyebrow>
            <FlatRow label="DOB status">
                {user.dob
                    ? (
                        <>
                            <code>{user.dob}</code>{' '}
                            <Badge tone={user.is_dob_verified ? 'success' : 'warning'}>
                                {user.is_dob_verified ? 'Verified' : 'Unverified'}
                            </Badge>
                        </>
                    )
                    : <span className="dim-italic">Not set</span>}
            </FlatRow>
            <FormView model={UserModel} row={user} fields={DETAIL_FIELDS} />

            <Eyebrow>Address</Eyebrow>
            <FlatRow label="On file">
                {addressSummary(user) || <span className="dim-italic">Not set</span>}
            </FlatRow>
            <FormView model={UserModel} row={user} fields={ADDRESS_FIELDS} />
        </>
    );
}

function addressSummary(user: UserRow): string {
    const meta = (user.metadata ?? {}) as Record<string, unknown>;
    return [meta.street, meta.city, meta.state, meta.zip, meta.country]
        .filter((v): v is string => typeof v === 'string' && v !== '')
        .join(', ');
}
