# Image editor

Import from `portal-mojo/ui`:

```tsx
import { ImageEditor, imageEditorModal, type ImageEditorResult } from 'portal-mojo/ui';
```

`ImageEditor` is the dependency-free crop/transform/filter editor. It accepts a
controlled `source` (`Blob`, `File`, or URL), reports only through `onSave`, and
never triggers a browser file download. A URL source is fetched before decode:
same-origin requests include same-origin credentials, while cross-origin URLs
remain subject to CORS and receive no credentials. Source/capability URLs are
never echoed in editor errors. `imageEditorModal(source, options)` is the
awaitable native dialog form: it resolves an `ImageEditorResult` on save and
`null` on Cancel, Escape, backdrop dismissal, or owner-signal abort.

```ts
interface ImageEditorResult {
  blob: Blob;                 // image/png, alpha preserved
  filename: string;
  width: number;
  height: number;
  cropData: CropData | null;  // logical pixels at the crop's input stage
  operations: readonly ImageEditorOperation[];
}
```

```tsx
const result = await imageEditorModal(file, {
  startMode: 'crop',
  filename: file.name,
  crop: { aspectRatio: 1, cropAndScale: { width: 200, height: 200 } },
});
if (result) upload(new File([result.blob], result.filename, { type: 'image/png' }));
```

Options are `filename`, `startMode`, `modes`, `crop`, `initialOperations`,
`maxHistory` (1–20), and `saveText`. Modal use additionally accepts `title`,
`size` (`sm`, `md`, or `lg`), and an `AbortSignal` as `signal`; abort resolves
the modal with `null`. Embedded use additionally supplies `onSave`, optional
`onCancel`, `disabled`, and `onBusyChange`.

## Low-level exports

The framework-free math and raster contracts are intentionally public from the
same `portal-mojo/ui` subpath for non-React composition and deterministic
verification:

- Geometry/state types include `ImageSize`, `ImagePoint`, `ImageRect`,
  `CropData`, `CropOptions`, `TransformState`, `FilterState`,
  `ImageEditorOperation`, and `ImageEditorSnapshot`. The corresponding defaults,
  limits, crop handles, presets, and filter order are exported constants.
- Geometry helpers cover canvas/image mapping, crop initialize/constrain/move/
  resize, transform clamp/rotate/zoom/output sizing, filter composition,
  operation output/crop inspection, and immutable history commits.
- Raster helpers expose `PixelSurface`, `filterPixels`,
  `applyOperationsToPixels`, `decodeImageSource`, `drawPixelSurface`,
  `pixelSurfaceToBlob`, and `renderImageOperations`. `decodeImageSource`, canvas
  drawing, and Blob encoding require browser APIs; callers that retain a
  returned `DecodedImage` must call its `dispose()`.

These helpers operate on logical pixels and do not mount UI, upload Files,
persist state, or initiate a browser download. `decodeImageSource` is the one
exception that performs the URL fetch described above.

## Composition and history

Operations are immutable and chronological. Transform creates a logical
full-resolution output canvas; pan is measured in logical image pixels and is
unchanged by a preview resize. Crop consumes the current working bitmap in
source-pixel coordinates and either retains its natural crop dimensions or
emits exact `cropAndScale` dimensions. Filters consume the current full working
bitmap after every prior operation. The preview's CSS size and device-pixel
ratio never participate in export.

Apply commits one snapshot. Switching modes commits only a dirty mode. Pointer
drags and slider movement update one draft, so they coalesce into one history
entry. Undo/redo crosses committed operations, a divergent commit truncates
redo, Reset returns to the decoded source, and at most 20 snapshots are kept.

## Source-derived invariants

- Crop defaults to the centered 80% box; the minimum is 50 source pixels.
- Transform scale is clamped to 0.1–5 with the legacy 0.02 step; rotations
  normalize to 0–359 degrees.
- Filter defaults, preset values, and application order are carried from
  web-mojo: brightness → contrast → saturation → hue → blur → grayscale →
  sepia. Unknown modes/presets warn and fall back.
- Invalid/non-finite ratios, dimensions, histories, and operations reject at
  the React boundary. Decode/CORS/encoding failures use generic errors that do
  not echo source or capability URLs and retain the prior decoded source and
  history.
- Owned object URLs and image bitmaps are released on replacement/unmount;
  async decode/save work is generation guarded. PNG encoding is explicit and
  preserves alpha. Crop overlays never enter the output bitmap.

For image relations, `ImageField` can opt into `edit={{ crop: ... }}`. Editing
runs before the existing upload queue: Cancel or editor failure keeps the
selected original available, and no File id or owner attachment exists until
the edited PNG File enters that queue.
