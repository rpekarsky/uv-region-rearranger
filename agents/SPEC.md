# UV Region Rearranger — Functional Specification

Status: implemented MVP
Audience: developers picking up or extending this codebase

---

## 1. Overview

A browser-based, single-page editor for rearranging islands of a UV map (or any
similar 2D atlas image) via reversible affine transforms. The user defines
polygonal regions over the source image, applies translations / rotations /
scales / flips, exports the rearranged result for downstream consumption
(typically AI image generation), then applies the inverse transform to a
modified output to recover a valid UV map in the original topology.

The product is a **WYSIWYG split-view editor**: two side-by-side canvases show
the "before" and "after" simultaneously, and either side can act as the source
or the destination depending on which images the user has loaded.

---

## 2. Background & Motivation

3D models ship with a UV atlas — a 2D image whose layout is dictated by mesh
unwrapping algorithms. The result is rarely "human-friendly": islands are
scattered, oriented for packing efficiency, not for editing or AI-assisted
texture generation.

Workflow today, without this tool:

1. Open the UV in Photoshop.
2. Manually move/rotate islands to a more readable layout.
3. Generate or paint a new texture.
4. Manually move everything back to original positions.
5. Pray you didn't shift anything by a pixel.

This tool automates step 2 and step 4 with a guarantee: **the rearrangement is
reversible**. The user records the rearrangement once; the inverse step is
mechanical.

### Primary use cases

1. **Pre-generation rearrange**: User loads a UV atlas, defines regions for
   each island, moves them into a layout suitable for AI generation, exports
   the rearranged image.
2. **Post-generation back-projection**: User loads the AI-generated image,
   re-uses the same region/transform definitions, and obtains a UV map with
   AI content placed at the original topology.

---

## 3. Goals / Non-Goals

### Goals

- Reversible affine transforms per region.
- Visual side-by-side comparison ("before / after") at all times.
- Resolution-independent project files (work the same on a 4K and 8K UV).
- Single-file static HTML build for trivial deployment.
- Browser-only — no server, no signup, no telemetry.
- All edits auto-saved locally so a refresh does not lose work.

### Non-Goals

- Pixel-perfect lossless rotation at arbitrary angles. Standard canvas
  bilinear interpolation is acceptable; users who need lossless behavior
  must use 90°/180°/270° rotations.
- Vector-graphic editing (Bézier paths, smooth curves). Polygons only.
- Multi-image batch processing.
- Cloud storage or sharing.
- Mobile / touch-first UX. Desktop, mouse-driven.
- Built-in AI image generation. Users bring their own AI tool.

---

## 4. Glossary

| Term               | Definition                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Original**       | The user's source UV atlas image.                                                                                                          |
| **Transformed**    | The rearranged image (either freshly forward-rendered, or an externally edited version such as an AI output).                              |
| **Region**         | A polygon over the Original space, with an attached affine `Transform`.                                                                    |
| **Mask**           | A polygon over the Original space that gets painted over with the background color. Used to hide unwanted parts from downstream consumers. |
| **Forward render** | Pixel pipeline: Original + Regions + Masks → Transformed.                                                                                  |
| **Inverse render** | Pixel pipeline: Transformed + Regions → Original (back-projected).                                                                         |
| **Zone**           | One of the two side-by-side editing canvases. The left zone displays the Original; the right zone displays the Transformed.                |
| **Viewport**       | A `{ scale, panX, panY }` triplet, one per zone, controlling display zoom and pan independent of image data.                               |
| **UV coordinates** | Coordinates in `[0..1]` normalized by image dimensions. Used in the on-disk format for resolution independence.                            |

---

## 5. User Workflows

### 5.1 Pre-generation rearrange (typical first session)

1. User drops the original UV atlas onto the left zone. The left zone shows
   the image; the right zone shows a live forward render that initially is
   identical to the original (no regions defined).
2. User presses **N** (or double-clicks an empty area in the left zone) to
   start drawing a region. They click around an island to outline it, then
   press **Enter** to close.
3. The region appears as a colored outline in both zones. The user can
   refine vertices (drag, double-click edges to insert, right-click to
   remove).
4. User selects the region and uses the right zone to apply transforms:
   drag inside the polygon to translate; drag the rotation handle to rotate;
   drag corner/edge handles to scale; press **H** or **V** to flip.
5. The right zone updates in real-time, showing the rearranged result.
6. User repeats for additional islands.
7. (Optional) User presses **M** to draw masks over irrelevant areas; those
   areas are painted over with the background color in the forward render.
8. User clicks `Download transformed` on the right zone to save the
   rearranged image.
9. User saves the project as JSON (Save JSON in the toolbar) for later use.

### 5.2 Post-generation back-projection

1. User loads the project JSON they saved earlier.
2. User drops the AI-generated image onto the right zone (overrides the
   live forward render with the loaded image).
3. The left zone now shows a live inverse render: AI content is back-projected
   onto its original UV positions.
4. User clicks `Download original` on the left zone to save the resulting
   UV map.

### 5.3 Editing an existing project

1. User opens the app. Local-storage state is restored automatically:
   regions and masks reappear (images do not — those must be re-dropped).
2. User drops the same source image. Coordinates align because UV coords
   are stored relative to image size.

---

## 6. Functional Requirements

### 6.1 Image input

- The application MUST accept image files via:
  - Drag-and-drop onto either zone (left = Original, right = Transformed).
  - File picker buttons in the toolbar.
- Supported formats: any format the browser's `<img>` tag decodes (PNG, JPEG,
  WebP at minimum).
- The app MUST NOT enforce identical sizes between Original and Transformed.
  Each renders in its own canvas and viewport.
- Loading an image into a zone overrides whatever was there (loaded image
  or live render). A "clear" button per zone exists in the toolbar.

### 6.2 Region drawing

- Activated by:
  - Toolbar button `+ Region`.
  - Hotkey `N`.
  - Double-click on empty area of the left zone (point becomes the first
    vertex automatically).
- Drawing flow: each left-click adds a vertex. A live preview line connects
  the last vertex to the current cursor and back to the first vertex.
- Closing the polygon: `Enter` or double-click. Minimum 3 vertices required;
  fewer cancels.
- Cancel: `Escape`.
- Drawing happens **only in the left zone** (source space); right-zone
  clicks during drawing mode do nothing.

### 6.3 Region editing

- A region is selected by clicking inside its polygon (in either zone) or
  via the sidebar Region list.
- Selected region exposes:
  - Vertex handles on both zones (left: at source positions, right: at
    transformed positions).
  - Transform manipulator on the right zone (rotation handle, four corner
    handles for uniform scale, four edge handles for axis scale).
- Vertex operations:
  - Drag a vertex to move it. Cursor follows in pixel-perfect screen space
    regardless of which zone it was grabbed in (right-zone drags apply the
    inverse linear transform to derive the source-space delta).
  - Double-click an edge to insert a new vertex at that point.
  - Right-click on a vertex to remove it. Minimum of 3 vertices is enforced.
- Region transform is mutated by:
  - Dragging inside the polygon in the right zone (translates).
  - Dragging the rotation handle (rotates around the pivot).
  - Dragging corner/edge handles (scales; the opposite handle stays fixed).
  - Hotkeys `H` / `V` (flips horizontally / vertically).
  - Numeric inputs in the Property Panel.
  - Rotation Dial widget in the Property Panel (drag to set rotation).
- Hold `Shift` during rotation to snap to 15° increments.
- Hold `Shift` during scale to apply uniform scaling.
- `Reset xform` button clears the transform back to identity.
- `Pivot to centroid` button repositions the pivot to the polygon's centroid
  without visually moving the region (rebases internal translate to compensate).

### 6.4 Mask drawing & editing

- Activated by:
  - Toolbar button `+ Mask`.
  - Hotkey `M`.
- Same drawing flow as regions.
- Vertex editing (drag, insert via edge double-click, remove via right-click)
  works only in the **left zone**. Masks have no transform.
- In the rendering pipeline, masks are painted with the background color
  **after** region cut-outs and **under** transformed region content
  (regions visually sit on top of masks).

### 6.5 Selection & deletion

- Single-select only. Selecting a region or mask clears the other selection.
- `Escape`:
  - In drawing mode: cancels the in-progress polygon.
  - With selection: deselects.
- `Delete` / `Backspace`: deletes the selected region or mask (whichever is
  active). The toolbar `Reset` button (with confirmation) wipes everything.

### 6.6 Per-zone viewport

- Each zone has independent `scale`, `panX`, `panY`.
- Zoom: mouse wheel, centered on the cursor position.
- Pan: right-mouse-button drag (RMB).
- Pan/zoom in one zone MUST NOT affect the other zone.
- On image load (or first time content appears in a zone), the viewport
  fits the image to the zone with a small padding.

#### RMB ambiguity (pan vs context-menu)

- RMB hold + mouse movement > 4 px → pan begins.
- RMB hold + release without significant movement → equivalent to a
  context-menu trigger (currently used for vertex deletion when the
  click landed on a vertex).
- The native browser context menu is always suppressed inside the zones.

### 6.7 Forward render pipeline

Inputs: original image (`I`), region list `R[]`, mask list `M[]`, background
color `bg`.

```
out = canvas of size(I)
out.fill(bg)
out.drawImage(I)

for each region in R[]:
  out.clip(region.polygon)
  out.fill(bg)
  out.unclip()

for each mask in M[]:
  out.clip(mask.polygon)
  out.fill(bg)
  out.unclip()

for each region in R[]:
  Mat = matrix(region.transform)
  out.setTransform(Mat)
  out.clip(region.polygon)
  out.drawImage(I)
  out.reset()
```

Drawing order rationale:

- Cut-outs zero the source so unmoved pixels of moved islands don't show.
- Masks come **before** transformed regions so regions render on top of masks.
  (A region's transformed location may coincide with a mask; the region wins.)

### 6.8 Inverse render pipeline (Variant A — simple back-projection)

Inputs: transformed image (`T`), region list `R[]`, background color `bg`.

```
out = canvas of size(T)
out.drawImage(T)

# 1. Erase the transformed-poly areas (those islands belong to source-poly now).
for each region in R[]:
  Mat = matrix(region.transform)
  poly_t = Mat(region.polygon)
  out.clip(poly_t)
  out.fill(bg)
  out.unclip()

# 2. Back-project content from transformed-poly to source-poly.
for each region in R[]:
  Mat = matrix(region.transform)
  Inv = inverse(Mat)
  out.clip(region.polygon)              # clip in canvas space
  out.setTransform(Inv)
  out.drawImage(T)                      # T pixels at Mat(P) land at P
  out.reset()
```

Areas not covered by any region pass through unchanged from `T` (so AI edits
to non-region areas are preserved). This is intentional and documented as
"variant A" for future reference.

### 6.9 Affine transform model

Each region holds:

```ts
interface Transform {
  translate: [tx, ty]; // image pixels
  rotation: number; // radians, CCW in math sense (= CW visually in canvas)
  scale: [sx, sy]; // negative components flip
  pivot: [px, py]; // image pixels
}
```

Matrix construction order:

```
M = T(translate) · T(pivot) · R(rotation) · S(scale) · T(-pivot)
```

i.e., for each input point `p`:

1. Translate by `-pivot` (move pivot to origin).
2. Apply scale (component-wise; negative flips).
3. Apply rotation.
4. Translate by `+pivot` (move back).
5. Apply global translate.

This is stored as a 6-tuple `[a, b, c, d, e, f]` compatible with
`CanvasRenderingContext2D.setTransform`.

The inverse is computed analytically (closed-form 2×3 affine inverse).

---

## 7. Data Model

### 7.1 In-memory state

Single Zustand store, see `src/store.ts`. Logical groups:

- **Images**: `originalImage`, `transformedImage`, plus filenames.
- **Geometry**: `regions[]`, `masks[]`. Coordinates in image pixels.
- **Selection**: `selectedRegionId`, `selectedMaskId` (mutually exclusive).
- **Mode**: discriminated union (`idle`, `drawing`, `editing`, four `drag*`
  variants) describing the current input phase.
- **Hover**: `hoveredHandle`, `hoveredVertex` for visual feedback.
- **Visual**: `bgFill` (color + transparent flag).
- **Per-zone UI**: `leftViewport`, `rightViewport`.

History (undo/redo) is provided by the `zundo` middleware over a partialized
view of the store: only `regions`, `masks`, `bgFill` are tracked. Bursts of
state changes (drag, typing) collapse into single history entries via a
300 ms debounce on the temporal `handleSet` callback.

### 7.2 On-disk format (project JSON)

```json
{
  "version": 1,
  "imageSize": [W, H],
  "imageSourceFilename": "foo.png" | null,
  "bgFill": { "color": "#000000", "transparent": false },
  "regions": [
    {
      "id": "uuid",
      "name": "rear-wing",
      "polygon": [[u, v], ...],
      "transform": {
        "translate": [u, v],
        "rotation": <radians>,
        "scale": [sx, sy],
        "pivot": [u, v]
      }
    }
  ],
  "masks": [
    { "id": "uuid", "name": "frame", "polygon": [[u, v], ...] }
  ]
}
```

All coordinates and translates are in **UV space (`[0..1]`, relative to
imageSize at save time)**. On load, they are multiplied by the currently
loaded image size (or by `imageSize` from the JSON if no image is loaded yet).

This makes a project file resolution-independent: the same JSON applies
correctly to a 4K and an 8K version of the same atlas.

`rotation` and `scale` are dimensionless and stored as-is.

Saving requires that an image is loaded (we need its size to normalize).
Loading falls back to the JSON's `imageSize` if no image is loaded, so a
fresh page can restore the project before the user re-drops the image.

### 7.3 Local persistence

- The complete project state (`regions`, `masks`, `bgFill`) is auto-saved
  to `localStorage` under the key `uv-region-rearranger:state.v1`.
- Saves are debounced 500 ms.
- Images are NOT persisted (size). Users re-drop them on each session.
- The `Reset` button explicitly clears the local-storage entry and the
  in-memory state.

---

## 8. Coordinate Spaces

Three spaces appear in the codebase. Mixing them causes the most common
class of bugs.

| Space             | Origin                    | Units        | Used for                                                                                                   |
| ----------------- | ------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| **Client**        | Browser viewport top-left | CSS pixels   | Mouse events (`event.clientX/Y`)                                                                           |
| **Canvas screen** | Canvas element top-left   | CSS pixels   | After subtracting `getBoundingClientRect`. What `Viewport` operates on.                                    |
| **Image**         | Image (0,0)               | Image pixels | What everything in `regions`, `masks`, polygon math operates on. Render pipelines also draw in this space. |
| **UV**            | (0,0)                     | `[0..1]`     | Only on-disk. Internally never used.                                                                       |

The conversion is:

```
imagePoint = (canvasScreenPoint - viewport.pan) / viewport.scale
```

Pixel-sized overlays (line widths, vertex radii) are scaled by `1 / viewport.scale`
when drawing, so they remain a fixed number of CSS pixels regardless of zoom.

---

## 9. UI / UX

### 9.1 Layout

```
+---------------------------------------------------------+
| Toolbar                                                 |
+----------------------------------+----------------------+
|                                  |                      |
|  Left zone (Original)            | Sidebar              |
|  - canvas                        |  - Regions list      |
|  - download button (top-right)   |  - Masks list        |
|  - zone label                    |  - Property panel    |
|                                  |    (when selected)   |
+----------------------------------+  - Hints             |
|                                  |                      |
|  Right zone (Transformed)        |                      |
|  - canvas                        |                      |
|  - download button (top-right)   |                      |
|  - zone label                    |                      |
|                                  |                      |
+----------------------------------+----------------------+
| Toaster (notifications, bottom-right)                   |
+---------------------------------------------------------+
```

- Below ~1200 px viewport width, zones stack vertically.
- The sidebar has fixed width.

### 9.2 Toolbar

Groups (left-to-right):

1. **Image inputs**: Load original (×) | Load transformed (×). The `×`
   buttons appear only when an image is loaded and clear it.
2. **Drawing**: + Region (N) | + Mask (M).
3. **Undo/Redo**: ↶ Undo (Ctrl+Z) | ↷ Redo (Ctrl+Shift+Z).
4. **Project**: Load JSON | Save JSON | Reset.
5. **Background**: BG color picker | "transparent" checkbox.

### 9.3 Per-zone UI

- **Zone label** (top-left): "Original" or "Transformed", with a "(live
  inverse)" / "(live forward)" tag when displaying a computed render.
- **Download button** (top-right): "Download original" / "Download transformed".
  Click downloads exactly what is visually shown in the zone (loaded image OR
  live render), serialized to PNG.
- **Empty hint** (centered) when the zone has no content: "Drop original
  image here" / "Drop transformed image here".

### 9.4 Sidebar

- **Regions list**: each item shows a name (editable inline) and a delete
  button. Clicking selects.
- **Masks list**: same but for masks.
- **Property panel** (visible only when a region is selected):
  - Numeric fields for `tx`, `ty`, `rotation°`, `sx`, `sy`, `px`, `py`.
  - Rotation Dial (drag-to-rotate widget with 15° tick marks).
  - Buttons: Flip H, Flip V, Reset xform, Pivot to centroid.
- **Hints**: a list of supported keyboard shortcuts and gestures.

### 9.5 Notifications

- Errors (file decode failed, JSON parse failed, etc.) appear as
  bottom-right toast messages.
- Successful drops and downloads emit success toasts.
- Destructive actions (`Reset`) use a native `confirm()` for explicitness.

### 9.6 Hotkeys

| Key                               | Action                            |
| --------------------------------- | --------------------------------- |
| `N`                               | Start drawing a Region            |
| `M`                               | Start drawing a Mask              |
| `Enter`                           | Close the current polygon         |
| `Escape`                          | Cancel drawing / deselect         |
| `Delete` / `Backspace`            | Delete selected region or mask    |
| `H`                               | Flip selected region horizontally |
| `V`                               | Flip selected region vertically   |
| `Ctrl/Cmd+Z`                      | Undo                              |
| `Ctrl/Cmd+Shift+Z` / `Ctrl/Cmd+Y` | Redo                              |
| `Shift` (held during rotate)      | Snap rotation to 15° increments   |
| `Shift` (held during scale)       | Lock to uniform scale             |

Keyboard shortcuts MUST be auto-disabled while a text input is focused.

---

## 10. Reversibility Constraints

The fundamental promise of the tool is: forward then inverse ≈ original.

Where this fails:

- **Subpixel rotation**: forward rotation by an arbitrary angle uses bilinear
  interpolation; the inverse re-interpolates. ~1 px of edge softening
  inside the region polygon is unavoidable.
- **Non-integer translation**: same issue. Integer translates are lossless.
- **Scale ≠ 1**: each scale pass introduces resampling artifacts.

Where it does NOT fail:

- 90°/180°/270° rotations: exact pixel permutations.
- Integer translates with `scale = [1, 1]`: byte-exact round-trip.
- Pixels OUTSIDE all region polygons: untouched by either pipeline.
- Polygon boundaries: rendered through canvas clipping with anti-aliased
  edges. Polygon **shape** is exact; **content sampling** at the boundary
  has standard canvas anti-aliasing softness.

Documented loud and clear in this spec because it surprises users.

---

## 11. Non-Functional Requirements

### 11.1 Performance budget

- Up to 4096×4096 source images render at interactive speed (>30 FPS) on
  modest hardware (integrated GPU).
- Pan/zoom interactions remain smooth (>50 FPS).
- Drag operations remain smooth on a 4K canvas with up to 20 regions.
- Larger images may degrade — acceptable trade-off; not optimized below
  ~10 FPS for 8K+ inputs.

### 11.2 Browser support

- Chromium-based browsers (Chrome, Edge, Brave) and Firefox, current
  versions.
- Safari is best-effort but should work — no Safari-specific testing.
- No mobile / touch optimization.

### 11.3 Build & deploy

- Vite single-file build: a single `dist/index.html` containing all JS and
  CSS inlined. No external assets, no relative paths. Drag-and-drop into
  any static host (or open as `file://`).
- TypeScript strict mode enabled. CI/PR builds MUST pass typecheck.
- ES2022 target; no transpilation for older browsers.

### 11.4 Privacy

- All processing is local. No network requests are made beyond loading
  the bundle itself.
- `localStorage` is used; users can `Reset` to clear.

---

## 12. Architecture Notes

### 12.1 Module boundaries

```
src/
├── types.ts                # Shared data model types
├── store.ts                # Zustand store + zundo middleware
├── geometry/
│   ├── transform.ts        # Affine matrix math (pure)
│   ├── polygon.ts          # Hit-tests, bbox, centroid (pure)
│   └── handles.ts          # Transform manipulator handle positions (pure)
├── render/
│   ├── pipeline.ts         # renderForward / renderInverse (pure, returns canvas)
│   ├── helpers.ts          # Shared canvas drawing primitives
│   ├── leftPreview.ts      # drawLeftZone — source-space preview
│   └── rightPreview.ts     # drawRightZone — transformed-space preview
├── canvas/
│   ├── CanvasZone.tsx      # React component, one per zone
│   ├── coords.ts           # Event → image-coord conversion
│   ├── viewport.ts         # Viewport math (zoom/pan/fit)
│   └── interactions.ts     # Hit-test, drag-state-machine, mode transitions
├── ui/
│   ├── Toolbar.tsx
│   ├── RegionList.tsx
│   ├── MaskList.tsx
│   ├── PropertyPanel.tsx
│   ├── RotationDial.tsx
│   ├── HintsPanel.tsx
│   └── KeyboardShortcuts.tsx
├── io/
│   ├── storage.ts          # File I/O, JSON (de)serialization with UV scaling
│   └── persist.ts          # localStorage auto-save
├── App.tsx                 # Layout root
└── main.tsx                # React entry
```

Layering rules:

- `geometry/*` and `render/pipeline.ts` are pure: no DOM, no React, no store.
  Test in isolation if/when tests are added.
- `render/leftPreview.ts`, `render/rightPreview.ts` use canvas DOM but have
  no React or store coupling — they take params, draw, return.
- `canvas/CanvasZone.tsx` is the only React component that touches a
  canvas DOM element directly.
- The store may be imported anywhere except `geometry/*` and `render/*`.

### 12.2 State machine

`Mode` is a discriminated union in `types.ts`. Transitions are encapsulated
in `canvas/interactions.ts`. Drag start mutations capture starting positions
so subsequent mousemoves can compute deltas without snap-back errors.

### 12.3 Transform application

Two distinct operations:

1. **Forward**: `point_canvas = M(point_source)`. Used in render pipelines
   and to display the visible polygon in the right zone.
2. **Inverse linear**: `delta_source = M_linear^-1 · delta_canvas`. Used
   when dragging a vertex in the right zone — the cursor moves in canvas
   space but the polygon is stored in source space.

Both go through `geometry/transform.ts`. The inverse case ignores the
translation component (a delta has no anchor).

---

## 13. Out of Scope / Future Work

- **Variant B inverse render**: hold the original in memory and use it as
  the base for the inverse pass, taking AI content only from inside
  transformed polygons (back-projected through `M^-1`). Yields pixel-perfect
  reconstruction outside the regions and crisp polygon boundaries.
- **Brush masking**: paint pixels into a raster mask channel, in addition
  to the current polygon-based masks.
- **Undo of viewport / selection**: currently excluded because it surprises
  users.
- **Multi-select** of regions or masks for batched operations.
- **Vector path editing**: Bézier handles on polygon vertices.
- **Larger color/format support**: HDR, 16-bit, EXR.
- **Project export bundles**: pack the source image, the project JSON, and
  optionally the AI result into one archive.
- **Boolean polygon ops**: split a region in two, merge two regions, etc.
- **Snapping**: vertex-to-vertex, edge-to-edge between regions.

---

## 14. Acceptance Tests

### 14.1 Smoke tests

1. Drop the original UV → it appears in the left zone; right zone shows
   the same content (live forward, no regions yet).
2. Press `N`, click 4 corners, press `Enter` → a region appears in both
   zones.
3. Drag the rotation handle in the right zone → the region rotates only
   in the right zone; left zone unchanged.
4. Click `Save JSON` → a JSON file downloads with `version: 1` and UV
   coordinates in `[0..1]`.
5. Click `Download transformed` on the right zone → a PNG downloads
   showing the rearranged result.
6. Press `Ctrl+Z` after a drag → the region reverts to its pre-drag state.

### 14.2 Reversibility test (lossless)

1. Draw a region. Apply translate `[100, 0]` and rotation `90°`.
2. `Download transformed` → save as `forward.png`.
3. Drop `forward.png` into the right zone (override).
4. Click `×` to clear the original.
5. Click `Download original` on the left zone → save as `recovered.png`.
6. Inside the region polygon, `recovered.png` should be byte-identical to
   the original within sampling tolerance for 90° rotation
   (i.e., pixel-perfect, since 90° is lossless).

### 14.3 Persistence test

1. Draw a region, refresh the page.
2. Region reappears (image does not — re-drop required).
3. Drop the original image → region positions match.

### 14.4 Resolution-independence test

1. Save a project at 4096×4096.
2. Resample the source image to 8192×8192 (external tool).
3. Drop the new image, then load the same JSON → regions cover the same
   visual islands as in the 4K version, just at 2× scale.

---

## 15. Glossary of Implementation Quirks

- **`viaSide` on `dragVertex`**: tracks whether a vertex drag was initiated
  from the left or right zone, because the same store action handles both
  but only the right-zone case needs to apply the inverse linear transform
  to the screen-space delta.
- **Pivot rebasing on scale**: when the user grabs a corner handle, the
  pivot is silently moved to the opposite corner (with a compensating
  translate) so the opposite corner stays fixed while scaling. On
  drag-end, the pivot is _not_ automatically rebased back to the
  centroid — the user can do that explicitly via `Pivot to centroid`.
- **Cache in left/right preview**: derived live renders (forward/inverse)
  are cached by a key composed of region geometry + image src + bg fill,
  so we don't re-render a 4K canvas on every hover event.
- **Debounced history**: zundo's `handleSet` is debounced 300 ms so a
  drag becomes one undo entry, not 60.
