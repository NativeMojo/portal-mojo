# TagInput — chip tags over a CSV string

```ts
import { TagInput } from 'portal-mojo/ui';
```

Free-text tags as removable chips with a full keyboard flow. Ported from
web-mojo's `TagInputView` (`src/core/forms/inputs/TagInput.js`).

**The value is a CSV string, both directions.** django-mojo models store the
joined string and split it server-side, so `onChange` hands back the string
FIRST and the array second. A parent that persists the array instead has
changed the wire shape.

```tsx
const [csv, setCsv] = useState(record.tags ?? '');   // "prod,us-east-1,pci"

<TagInput
    name="tags"
    value={csv}
    onChange={(next) => setCsv(next)}
    maxTags={10}
/>
```

## API

| Prop | Default | Notes |
|---|---|---|
| `name` | — | also renders a hidden input carrying the CSV, for native form posts |
| `value` | `''` | CSV string **or** array; both parse to the same tags |
| `onChange` | — | `(csv: string, tags: string[]) => void` — fires on commit/removal only |
| `placeholder` | `'Add tags...'` | |
| `maxTags` | `50` | caps interactive adds; the counter's denominator |
| `allowDuplicates` | `false` | duplicate check is CASE-SENSITIVE (`Design` ≠ `design`) |
| `separator` | `','` | exactly one character; joins the CSV, splits input, and commits on keypress |
| `trimTags` | `true` | |
| `minLength` / `maxLength` | `1` / `50` | per tag |
| `disabled` | `false` | field stays, every add/removal refused |
| `readonly` | `false` | chips only — no input, no remove icons |
| `className` | — | appended to the root |

## Keyboard + commit routes

| Key | In the text field | On a focused chip |
|---|---|---|
| `Enter` | commit (preventDefault; an empty field still submits an enclosing form) | — |
| `Tab` | commit **and move focus on** | — |
| separator (`,`) | commit (always preventDefault) | — |
| `Backspace` | empty field → drop the last chip | remove it, focus the previous chip (or the field) |
| `Delete` | — | same as Backspace |
| `←` | empty field → focus the last chip | chip 0 → field, else previous chip |
| `→` | empty field → focus chip 0 | last chip → field, else next chip |
| `Escape` | clear the draft text | — |

Two more commit routes that are not keydowns:

- **input-change**: text ending in the separator or a newline commits. This is
  what catches pastes and soft keyboards, which never fire a usable keydown.
- **blur**: a pending draft commits rather than vanishing (the house commit set
  is select/Enter/blur).

Every route funnels through one `commitText`, which splits on the separator and
on newlines first — so pasting `a,b,c,` yields three tags, never one tag
containing commas that would re-split on the next load.

## Invariants

1. **No committed tag contains the separator.** Enforced at commit AND on parse
   (array entries are split too). This is what keeps the CSV round-trip exact.
2. **`separator` must be one character** — anything else falls back to `,` with
   a `console.warn` (the house rule for unknown option values; an empty
   separator would split every tag into characters).
3. **Controlled.** Tags derive from `value` on every render — the chips can
   never show something the parent's state doesn't hold. With no `onChange` (and
   not `readonly`/`disabled`) the component warns once at mount instead of
   silently swallowing adds.
4. **Parsing `value` does NOT apply `minLength`/`maxLength`/`maxTags`.** Those
   cap what a user may add; silently dropping stored values would lose backend
   data on the next save. A record with 7 tags under `maxTags={5}` honestly
   reads `7/5 tags` and refuses further adds.
5. **Rejected adds are never silent** — a transient inline error (~3s,
   `role="status"`) says why: `Tag "x" already exists`,
   `Maximum N tags allowed`, or the length messages.

## Deliberate deviations from web-mojo

| web-mojo | here | why |
|---|---|---|
| `Tab` calls `preventDefault` | Tab commits, focus still moves | the source trapped focus in the field for as long as it held text |
| commits on `,` even when `separator` is something else | commits on the separator key | otherwise a `\|`-separated field could never hold a comma |
| length violations rejected silently | inline error | "silent failure as policy" is on the do-not-recreate list |
| `Delete` promised by the chip's aria-label, only Backspace wired | both work | the label was lying |
| `Escape` also blurs | clears the draft only | Escape inside a modal still reaches the dialog once there is nothing to clear |
| wrapper `role="combobox" aria-expanded="false"` | `role="group"` | there is no popup; a permanently-false `aria-expanded` misleads AT |
| `escapeHtml()` on every tag before HTML-string render | plain JSX | React escapes; the "caller must escape" contract class is gone |
| `console.log` in `focusTag` | dropped | |
| `tag:added` / `tag:removed` / `tags:cleared` events | `onChange` only | it already carries the full next list |

## Styling

Classes are styled by the consuming app (`apps/portal/src/theme/taginput.css`,
tokens only, light + dark): `.tag-input`, `.tag-input-wrap` (wears the `.input`
field look, accent ring on `:focus-within`), `.tag-chip` / `.tag-chip-text` /
`.tag-chip-x`, `.tag-input-field`, `.tag-input-foot` / `.tag-input-count` /
`.tag-input-error`, plus `.tag-input-disabled` / `.tag-input-readonly` on the
root. Chips show a focus ring on pointer focus too — they are only focusable to
drive the arrow/Backspace flow, and Backspace must never delete a chip whose
focus is invisible.

## Pitfalls

- Don't store the `tags` array and rebuild the string with a different
  separator on save — pass through the CSV the component emits.
- Clicking the wrapper's padding focuses the field without blurring it
  (mousedown default is swallowed); don't add a competing focus handler.
- The remove `×` is `aria-hidden` on purpose: it duplicates the chip's own
  keyboard removal, and nesting an interactive element inside `role="button"`
  is invalid ARIA.
- Live demo: portal → **Develop → Components → TagInput**.
