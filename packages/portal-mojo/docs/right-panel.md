# RightPanel — persistent complementary shell content

```tsx
import { RightPanelProvider, RightPanelSlot, useRightPanel } from 'portal-mojo/ui';
```

RightPanel is an explicit exception for product experiences that need
persistent, complementary shell context while the main route changes. It is
not the default Admin record-detail presentation: Admin table records use
`modal.detail(...)` unless the product specifically asks for a right panel.

Mount one provider above the opted-in application shell and one slot beside
the main route content. Open content with a stable key, visible title, render
callback, and the exact launcher element:

```tsx
panel.open({
    key: `map-layer:${layer.id}`,
    title: layer.name,
    render: ({ close }) => <MapLayerInspector id={layer.id} close={close} />,
}, event.currentTarget);
```

The provider owns one session-only descriptor. Opening a different key replaces
it atomically; opening the same key is idempotent. Closing is idempotent and
restores focus when the captured launcher is still connected.

`RightPanelSlot` renders a non-modal `aside[role=complementary]` with a visible
close control and labelled heading. It moves focus into that control on open.
Escape closes the panel only when no native `dialog[open]` exists, so
`ModalHost` keeps ownership of its top-layer keyboard interaction. There is no
focus trap or backdrop: use `modal.drawer()` when the interaction must be
modal, awaitable, and transient.

Do not add RightPanel to the global Admin shell merely to inspect a selected
row. That changes the application layout and interaction model for every Admin
domain; such a choice requires an explicit product decision.

Panel selection never enters the hash or query string. Route navigation may
replace the main `<Outlet>` while provider state stays mounted, and table params
can never leak a `panel` key into Django filters. The supplied app styles use a
third grid column on wide layouts and a fixed non-modal aside on narrow ones.
