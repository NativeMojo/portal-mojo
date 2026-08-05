// Model definitions for the base portal — the defineModel proving ground.
// A definition carries what web-mojo scattered across Model subclasses and
// *Forms statics: endpoint, UI permission gates, form configs, and the
// POST_SAVE_ACTIONS the backend RestMeta declares. Stabilized definitions
// migrate into portal-mojo/admin section bundles alongside their pages.
import { defineModel, type User } from 'portal-mojo/client';

export const UserModel = defineModel<User>({
    name: 'user',
    endpoint: '/api/account/user',
    // Category-or-granular pairs, exactly the any-of lists the backend gates
    // its user actions with (account/models/user.py: ["users", "manage_users"]).
    permissions: {
        view: ['users', 'view_users'],
        manage: ['users', 'manage_users'],
    },
    forms: {
        create: {
            title: 'Add user',
            submitText: 'Create',
            fields: [
                { name: 'display_name', type: 'text', label: 'Display name', required: true, placeholder: 'Jane Cooper' },
                { name: 'email', type: 'email', label: 'Email', required: true, placeholder: 'jane@example.com' },
                { name: 'phone', type: 'tel', label: 'Phone', columns: 6 },
                {
                    name: 'role', type: 'select', label: 'Role', columns: 6, options: [
                        { value: 'user', label: 'User' },
                        { value: 'staff', label: 'Staff' },
                        { value: 'admin', label: 'Admin' },
                    ],
                },
            ],
        },
        // Disable collects the reason the backend REQUIRES (services/disable.py
        // USER_REST_REASONS) + an optional audit note.
        disable: {
            title: 'Disable user',
            submitText: 'Disable',
            fields: [
                {
                    name: 'reason', type: 'select', label: 'Reason', required: true, options: [
                        { value: 'admin', label: 'Admin — block / policy violation' },
                        { value: 'abuse', label: 'Abuse — banned' },
                    ],
                },
                { name: 'note', type: 'textarea', label: 'Note', placeholder: 'Optional note about why this user is being disabled.' },
            ],
        },
    },
    // django-mojo account/models/user.py RestMeta.POST_SAVE_ACTIONS (the
    // change_username / TOTP actions join when their screens land).
    actions: {
        disable: { permissions: ['users', 'manage_users'] },
        reactivate: { permissions: ['users', 'manage_users'] },
        send_invite: {},
        revoke_sessions: { response: 'payload' },
    },
});
