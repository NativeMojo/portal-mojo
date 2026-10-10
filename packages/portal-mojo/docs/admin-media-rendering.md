# Media rendering admin

```ts
import {
    MediaRenderingPage, readRenditionOptions, findCategoryRows, valueToDraft, draftToValue,
    validateDraft, routeRenditionError, saveCategoryValue, resetCategory, fieldType,
    renditionRoleLabel,
} from 'portal-mojo/admin/infrastructure';
```

Storage → Media rendering edits how django-mojo's fileman builds thumbnails,
previews and transcodes, and which of those run after an upload. It is a form
over three ordinary `Setting` rows — `FILEMAN_RENDITIONS_IMAGE`, `_VIDEO`,
`_DOCUMENT` — built entirely from the backend's descriptor (django-mojo #7728,
`docs/web_developer/fileman/renditions.md`). Nothing about roles, defaults,
fields, choices or limits is hardcoded: a role the framework adds appears
without a portal release.

## Route and access

`STORAGE_ADMIN_SECTION` registers `storage/rendering` (label "Media
rendering") with the Settings page's gate, `sys.manage_settings | sys.groups`
— the page writes Setting rows, so it carries the Setting write audience, not
the storage one. The section audience includes those two grants so a
settings-only operator can reach the page; the other storage routes keep their
own clauses. Member grants never satisfy the gate.

The descriptor itself (`GET /api/fileman/renditions/options`) is readable by
`manage_settings | manage_files | files | groups`; a `files`-only operator can
read it elsewhere but cannot open this editor.

Global scope only. There is no group selector; group-scoped overrides stay on
the generic Settings page.

## Wire contract

**Read:** `GET /api/fileman/renditions/options` → `data.categories.<image|video|document>`:

| Field | Used for |
|---|---|
| `key` | the Setting key to write |
| `defaults` | one row per role, in served order; the greyed values |
| `automatic_default` | the "runs on upload" default set |
| `override` | the global **database** row, parsed, or `null`. A deployment-file value is applied but not reported here |
| `effective` | defaults with the override (and any file value) applied; shown only as a read-only "In effect: …" hint where it differs from the draft |
| `role_kinds`, `fields`, `choices`, `limits` | which fields a role renders, their enum values and inclusive numeric bounds |

`data.engine` is read-only on this page (`ffmpeg`; the key stays on Settings
until a second engine exists).

**Row lookup:** `findCategoryRows(key)` lists `/api/settings?key=<KEY>&group__isnull=true`
with raw `mojoList` — `SettingModel.normalizeListParams` strips `key`, so the
model's list hook cannot do this. More than one global row for a key disables
Save and Reset with a notice naming the ids: `Setting.Meta.ordering = ["key"]`
leaves the server's `.first()` undefined among duplicates, so editing one could
change a row the renderer never reads.

**Write:** the whole category as one object — `POST /api/settings` to create
(`{key, is_secret: false, group: null, value}`) or `POST /api/settings/<id>`
to update (`{value}`). The value is sent as an object; the server stores it as
JSON text. Imperative `mojoSave` under `withFreshAuth`; a failure rejects.

**Reset = write `{}`.** The live `Setting` model declares no `CAN_DELETE`, so
`DELETE /api/settings/<id>` answers 403 — the backend doc's DELETE instruction
does not work live. `{}` is the documented "defaults" value and the endpoint
reports it as `override: null`; the row stays, harmlessly. Reset is disabled
when there is no row or the override is already null.

## Mapper invariants (`rendition-settings.ts`)

- **Draft seeds from `defaults ⊕ override`**, never from `effective`. Seeding
  from `effective` would mark a deployment-file value as changed on an
  untouched form and copy it into a DB row on the first Save.
- **`draftToValue` emits deltas against the defaults**, not against the
  previous override: a field restored to its default disappears from the row.
  Empty role objects are omitted; `{}` means defaults. Save is disabled when
  the emitted value equals the current override.
- **One typing rule, `fieldType(category, kind, name)`**: `choice` when
  `choices[kind][name]` exists, else `number` when the name is in `limits`
  (checked in that order — the server lists a bound for every option name it
  limits anywhere in the category, so document `quality`, a choice on pdf
  roles, also appears under `limits`), `boolean`
  when a default of that kind holds a boolean (today `audio`), else `string`.
  Inputs coerce on change through `coerceFieldValue`; `<input type=number>`
  strings never reach the payload (the server refuses `"300"`).
- **`_automatic`** is compared as a set and emitted only when it differs from
  `automatic_default`, in default order with additions appended in `defaults`
  key order (the renderer runs roles in list order). Roles the defaults do not
  declare are dropped on read, as the server's `merge` does.
- **The mp4-only trio** (`codec`, `crf`, `preset`) is the one rule not in the
  descriptor: it is hidden and stripped from the payload while a role's format
  (draft, else default) is not `mp4`. Switching the format back restores the
  draft values. Format wins over codec, exactly as the server validates.
- A field with no default (image `format`/`quality` — renderer class
  attributes, not `default_renditions`) renders unset with a "renderer
  default" placeholder; setting it emits it, clearing it omits it again.

## Validation and the 400 slot

`validateDraft` mirrors the server's checks with the server's wording (whole
number / between min and max / one of … / `2000k or 2M` / `HH:MM:SS`). It is
**advisory**: inputs carry `min`/`max`/`step`, the hint shows inline as the
admin types, but Save stays enabled and the server decides. Gating on the
client copy would make the 400 path unreachable and drift from the server.

A refused save routes through `routeRenditionError(message, knownRoles)`:

| Message | Lands |
|---|---|
| `<role>.<option>: …` | under that field, same slot as the hint |
| `<role>: …` | under that role's row |
| `_automatic: …` | beside the "runs on upload" switches |
| anything else, or a role not on screen | the panel-level alert |

Never a generic toast.

## Mock

`client/renditions-mock.ts` copies the renderers' `default_renditions`,
automatic roles, `OPTION_SCHEMA`, limits and the error grammar verbatim.
`describeRenditions(globalRows)` serves the descriptor from the mock's global
Setting rows; `validateRenditionSetting(key, value)` runs on every
`/api/settings` create/update whose key is a rendition key and answers
`{status: false, error, error_code: 400}` before the row mutates. DELETE stays
403. The mock seeds `FILEMAN_RENDITIONS_VIDEO = {"video_hevc": {"crf": 24}}`
so a changed field sits beside greyed defaults on first load. Personas with
the gate: `security.manager@nativemojo.com`, `showcase.operator@nativemojo.com`
(password `mojo`).

## Pitfalls

- `DocumentRenderer` on django-mojo `main` (2026-10-10) has no
  `config_category`, so `FILEMAN_RENDITIONS_DOCUMENT` is validated and
  described but not yet applied by the renderer. The Documents tab ships per
  contract; the override takes effect once the renderer honours it.
- Changing options never touches existing files: open a file under Storage →
  Files and use **Regenerate renditions** to see the result.
- `video_hevc` is never automatic unless `_automatic` names it; H.265 costs
  several times the H.264 encode time and does not play in every browser, so
  keep `video_mp4` as the compatibility rendition (the Video tab says so).

Verification: `npm run verify:admin-media-rendering`.
