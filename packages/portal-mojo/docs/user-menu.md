# UserMenu — the top-nav account menu

```ts
import { UserMenu, type UserMenuItem } from 'portal-mojo/ui';
// also on the narrow shell boundary:
import { UserMenu, type UserMenuItem } from 'portal-mojo/ui/shell';
```

The shared identity menu for every django-mojo portal's top bar — replaces
hand-rolled "user chips" and the separate theme-cycle button. Ported from
web-mojo's TopNav user dropdown (`src/core/views/navigation/TopNav.js`:
avatar-or-icon trigger, end-aligned dropdown, divider rows) and
`PortalApp._injectThemeToggleItems` (theme choice sits just above the
trailing logout); the theme dialog becomes an inline Light/Dark/System
segmented control.

```tsx
<header className="topnav">
    <h2 className="topnav-title">Dashboard</h2>
    <div className="topnav-right">
        <UserMenu
            authMode="inapp"
            items={[
                { label: 'My profile', icon: 'bi-person', to: '/profile' },
                { label: 'Leave organization', icon: 'bi-box-arrow-left', danger: true, divider: true, onSelect: leave },
            ]}
            onSignOut={async () => { await revokeServerSession(); logout(); }}
        />
    </div>
</header>
```

Live demo: showcase → Components → Overlays → **UserMenu**.

## Props

| Prop | Type | Notes |
|---|---|---|
| `items?` | `UserMenuItem[]` | App entries, rendered between the theme control and Sign out. |
| `children?` | `ReactNode` | Rendered after `items`, above Sign out. Elements with `role="menuitem"` (and `tabIndex={-1}`, class `user-menu-item` for the look) join arrow-key navigation, and clicking one closes the menu. |
| `authMode?` | `'inapp' \| 'hosted'` | Signed-out affordance (see matrix). The app knows its mode — the toolkit never imports app config. Unknown values warn once and render the signed-out chip. |
| `onSignOut?` | `() => void \| Promise<void>` | Replaces the default `logout()`. Sign out shows a pending state ("Signing out…", spinner, `aria-busy`) until it settles; repeat clicks are ignored. A rejection toasts `Sign out failed: <message>` and leaves the menu open for a retry. |
| `size?` | `'sm' \| 'md'` | Trigger density: 24px vs 28px avatar. Default `md`; unknown values warn once and fall back. |
| `className?` | `string` | Appended to the trigger (or the signed-out element). |

```ts
interface UserMenuItem {
    label: string;
    icon?: string;          // bootstrap-icons class, e.g. 'bi-person'
    to?: string;            // react-router <Link> destination
    onSelect?: () => void;  // runs after the menu closes (also for `to` items)
    danger?: boolean;       // danger tone
    divider?: boolean;      // separator line ABOVE this item
}
```

`divider` is a flag on the following item, not a standalone row (web-mojo's
`{divider: true}` rows map to `divider: true` on the next entry).

## Anatomy

- **Trigger** — `<button>` with avatar (image, or `fmt.initials(name)` while
  loading / without one / after an image error), display name, caret.
  `aria-haspopup="menu"`, `aria-expanded`, `aria-controls` (while open), and
  `aria-label="Account menu: <name>"` so the avatar-only phone trigger keeps
  an accessible name. Under **720px** the name and caret hide.
- **Popover** (`placement="bottom-end"`, 280px, clamped to the viewport):
  identity header (42px avatar, name, email, `is_superuser` → "System admin"
  chip), then the `role="menu"` list: Theme (three `menuitemradio`s wired to
  `useTheme().setPref`), items, children, Sign out (danger tone).
- Name = `me.display_name || me.email || token email || '…'`.

## Wire contract

- Identity: `useMe()` → `GET /api/user/me` (cache key `['me', uid]`, the row
  is sanitized so `avatar` is `{id} | null`).
- Avatar: when `me.avatar?.id` is set, `mojoCall('/api/fileman/file/<id>')`
  runs **only while mounted** (AbortController on unmount/id change; failures
  silent). The image is `thumbnail ?? url`, each through `safePreviewUrl`
  (`ui/safe-url.ts`, shared with FileField): same-origin `/paths` or
  credential-free `http(s)` only.
- Sign out: `onSignOut()` or `logout()` (client-side; django-mojo has no
  logout endpoint).

## Invariants

- The avatar URL is a **capability**: it lives in component state only and
  is never written into any Query cache (the `me` cache holds `{id}` by
  design). A previous identity's image can never render for the next
  (state is keyed by avatar id).
- No avatar request while signed out or when `avatar` is null.
- Popover is controlled; outside-mousedown closes without moving focus.
- Tokens only — `src/styles/components/user-menu.css`, shipped in
  `portal-mojo/styles.css`; both themes from the token swap. Reuses `.seg`/`.seg-btn`, `.chip-primary`, `.spin`,
  `.btn-primary`/`.btn-compact`, `.chip-muted`.

## Signed-out matrix

`useAuthSnapshot().authenticated === false` renders no menu:

| `authMode` | Renders |
|---|---|
| `'inapp'` | `<Link to="/auth/login">` Sign in button |
| `'hosted'` and `hostedAuthUrl()` resolves | Sign in button → `redirectToHostedAuth()` |
| `'hosted'` with no API origin, or omitted | muted "Signed out" chip |

## Keyboard

| Where | Key | Effect |
|---|---|---|
| Trigger | Enter / Space / click | Toggle; on open focus the first item |
| Trigger | ↓ / ↑ | Open (or enter the open menu) on the first / last item |
| Menu | ↓ / ↑ | Next / previous item (wraps; includes the theme radios) |
| Menu | Home / End | First / last item |
| Theme control | ← / → | Previous / next theme option (wraps) |
| Menu | Enter / Space | Activate (Space also activates `to` links) |
| Menu | Escape | Close, focus back to the trigger (first Escape only closes the menu inside a modal) |
| Menu | Tab / Shift+Tab | Close; focus continues from the trigger |

Selecting an item or a `role="menuitem"` child closes the menu and returns
focus to the trigger before `onSelect` runs (so dialogs opened from
`onSelect` restore focus to a live element). A successful Sign out closes the
menu. Theme picks apply immediately and keep the menu open.

## Pitfalls

- Needs a router context (items with `to`, and the in-app Sign in link) and
  `ThemeProvider` for the theme control; `ToastHost` for the failure toast.
- Don't also render a theme toggle button in the same bar — the menu owns it.
- `onSignOut` that never settles leaves Sign out pending; resolve or reject.
- Apps must import `portal-mojo/styles.css` and declare the tokens; the
  UserMenu styles ship in it.
