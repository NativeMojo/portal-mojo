# RightPanel — persistent complementary shell content

```tsx
import { RightPanelProvider, RightPanelSlot, useRightPanel } from 'portal-mojo/ui';
```

Mount one provider above the application shell and one slot beside the main
route content. Open content with a stable key, visible title, render callback,
and the exact launcher element:

```tsx
panel.open({
    key: `ticket:${ticket.id}`,
    title: `Ticket #${ticket.id}`,
    render: ({ close }) => <TicketPanel id={ticket.id} close={close} />,
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

Panel selection never enters the hash or query string. Route navigation may
replace the main `<Outlet>` while provider state stays mounted, and table params
can never leak a `panel` key into Django filters. The supplied app styles use a
third grid column on wide layouts and a fixed non-modal aside on narrow ones.
