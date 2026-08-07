# Push Notifications admin (#1296)

Import `PushPage`, its individual panels/pages, the canonical push models, API helpers, and `PUSH_ADMIN_SECTION` from `portal-mojo/admin`. The section contributes one global/no-group Communications route at `/push`; there are no record routes. KISS detail modals own record inspection.

## Tabs and URL state

The page has six possible tabs: Your stats, Global metrics, Devices, Deliveries, Templates, and Config. Stats are authenticated caller data. Every other tab is independently filtered by its exact permission clause, and only the active authorized panel mounts, so hidden/inactive surfaces issue no requests.

`push_surface` is registered with `registerNonFilterParams` at module load. It survives table writes but never becomes a Django lookup or filter pill. Changing tabs replaces the flat URL params with only `push_surface`, intentionally clearing search, sort, paging, and filters that belong to the prior model.

## Exact permissions

All UI clauses carry the `sys.` namespace and are ANY-of:

- Devices view: `view_devices | manage_devices | comms | owner | manage_users`; save: `manage_devices | comms | owner`.
- Deliveries view: `view_notifications | manage_notifications | comms | owner | manage_users`; save: `manage_notifications | comms`.
- Templates view: `manage_notifications | manage_groups | comms | owner | manage_users`; save: `manage_notifications | manage_groups | comms`.
- Config view/save: `manage_push_config | manage_groups | comms`.
- Config connection test: `manage_push_config | comms`.
- Global metrics: `view_metrics | metrics`, with `account="global"`.

`sys.users` is deliberately absent: it is not in `RegisteredDevice.RestMeta.VIEW_PERMS`. The Stats endpoint requires authentication only and always scopes all five keys to `request.user`.

## Projection and ownership boundaries

Every model pins a `basic` or `default` graph, allowlists list params, and positively projects rows before Query or Mutation cache reconciliation. RegisteredDevice never retains `device_token`; Delivery never retains `platform_data`, and its arbitrary `data_payload` is not retained by the UI projection. Related users are reduced to id plus a short display label—never email, phone, metadata, or an expanded user graph. Template JSON objects accept only a bounded shallow scalar projection on reads.

`PushDeviceModel` now lives canonically in `admin/messaging/push`. The former `admin/identity/users/models.ts` definition is a compatibility re-export of the same object, so User Detail and the global Push page share one endpoint definition and Query key.

## FCM credentials and actions

FCM writes are imperative and cache-free. A service account textarea is an uncontrolled DOM ref and never prefills. Blank means untouched and is omitted. Replacement must parse to an object with `type="service_account"`, `project_id`, `client_email`, and a PEM `private_key`. Clear sends `null` only after explicit confirmation. Empty replacement is impossible, and server responses are sanitized before cache reconciliation.

Connection testing calls only `POST /api/account/devices/push/config/<id>/test` with an empty body. The backend uses its dummy token to validate credentials. The portal never accepts a device token. It also does not expose `/send`, caller `/test`, delivery retry, device registration/unregistration, or any delete action.

All four REST models have live `CAN_DELETE = false`; the mock returns 403 without removing or cascading anything. Templates/configs can be created and edited under their save clauses. Devices and deliveries remain investigative here.
