# UV Region Rearranger

A browser-based tool for rearranging UV map islands using reversible affine
transforms. Built for AI-assisted texture workflows where the source UV
layout is too dense or oddly oriented for a model to work with.

---

## Why

3D models ship with UV atlases laid out for packing efficiency, not for
human or model-friendly editing. Asking an AI to repaint such an atlas
directly tends to fail: islands are tiny, rotated arbitrarily, packed flush
against each other.

The usual workaround is manual: open Photoshop, move islands around, run
the AI, move everything back, pray you didn't miss a pixel. This tool
automates steps 1 and 3 of that loop. The rearrangement is recorded once
as a JSON file; applying its inverse to the AI output is mechanical.

## What it does

Two side-by-side canvases — left is the source UV ("Original"), right is
the rearranged result ("Transformed"). For each island:

1. Outline a polygon over it (lasso or click-to-vertex).
2. Translate / rotate / scale / skew / flip it on the right side.
3. The right side updates in real time. Save the rearranged image.
4. Hand it to your AI of choice. Drop the AI output back on the right side.
5. The left side now shows the AI content back-projected onto the original
   UV layout. Save it, ship it.

The forward and inverse pipelines are exact for 90° rotations + integer
translates. Sub-pixel rotations introduce ~1px of edge softening (standard
canvas bilinear interpolation).

## Quick start

### Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:8765`.

### Build

```bash
npm run build
```

Output is a single self-contained `dist/index.html`. Open it directly
(`file://`) or drop into any static host. CSS, JS, and assets are all
inlined.

### Type-check

```bash
npm run typecheck
```

## Workflow

1. **Drop the source UV** onto the left zone (or use _Load original_).
2. **Outline an island** — `N` to start a region, click around it, `Enter`
   to close. Or **double-click + hold** in the left zone for lasso-style
   outlining (anchor every ~50px).
3. **Apply transforms** — select the region, drag handles in the right
   zone (corner = scale, edge = scale-on-axis, top tether = rotate). Hold
   `Shift` for uniform scale on corners or skew on edges. Drag inside the
   region to translate.
4. **Refine vertices** — drag any vertex in either zone, double-click an
   edge to insert a vertex, right-click a vertex to delete it.
5. **Set output canvas size** (optional) — the _Output: W × H_ inputs in
   the toolbar let you target an arbitrary canvas, e.g. flatten a 2.7:1
   source into a 1:1 layout.
6. **Save the project JSON** for reuse. The JSON is resolution-independent
   (UV-space coords), so it applies to any-resolution version of the same
   atlas.
7. **Download the transformed image** to feed your AI.
8. **Drop the AI output** onto the right zone. The left zone now shows
   the back-projected result — download that as your final UV.

## Hotkeys

| Key                               | Action                               |
| --------------------------------- | ------------------------------------ |
| `N`                               | Start drawing a Region               |
| `M`                               | Start drawing a Mask                 |
| `Enter`                           | Close in-progress polygon            |
| `Escape`                          | Cancel drawing / deselect            |
| `Delete` / `Backspace`            | Delete selected region or mask       |
| `H` / `V`                         | Flip selected region (horiz / vert)  |
| `Ctrl/Cmd + D`                    | Duplicate selected region            |
| `Ctrl/Cmd + Z`                    | Undo                                 |
| `Ctrl/Cmd + Shift + Z` / `Ctrl+Y` | Redo                                 |
| `Shift` (during rotate)           | Snap rotation to 15° increments      |
| `Shift` (during corner scale)     | Lock to uniform scale                |
| `Shift` (during edge scale)       | Skew along the edge axis             |
| `Ctrl + LMB drag` (left zone)     | Quick lasso (no double-click needed) |
| `Right mouse + drag`              | Pan the zone                         |
| `Mouse wheel`                     | Zoom around the cursor               |

## Features

- **Reversible affine transforms** — translate, rotate, non-uniform scale,
  skew, flip, with an explicit pivot point per region.
- **Per-region transform handles** on both source and output sides, with
  the source side automatically compensating the transform so the output
  stays put while you reshape the source polygon.
- **Decoupled output canvas** — source and output canvases can have
  independent sizes (useful for repacking dense UVs into a roomier layout).
  Optional "keep regions stretched" toggle to rescale geometry when you
  resize the output.
- **Lasso drawing** — auto-place vertices at a fixed screen-pixel cadence;
  refine afterwards with the standard vertex tools.
- **Masks** — paint over irrelevant areas of the source so they don't bias
  the AI.
- **Regions-only view** — hide the source image in the live render so the
  AI only sees the rearranged islands on a clean background.
- **Auto-saved local state** — refresh the page and your project is still
  there. Images aren't persisted (size); re-drop them on each session.
- **Resolution-independent project files** — UV-space coordinates work
  on a 4K and an 8K version of the same atlas without re-authoring.

## Architecture

A single React + Zustand single-page app with a Canvas2D render pipeline.
No server. The build artifact is one HTML file with everything inlined.

Layered structure:

```
src/
├── geometry/          # Pure affine + polygon math (no DOM, no React)
├── render/            # Canvas2D pipelines + per-zone draw functions
├── canvas/            # CanvasZone component, viewport math, interactions
├── ui/                # Toolbar, sidebar, panels, NumberInput, hotkeys
├── io/                # File I/O, JSON (de)serialization, localStorage
├── store.ts           # Zustand store + zundo (undo/redo) middleware
└── types.ts           # Shared data model
```

## License

[MIT](LICENSE) © Roman Pekarsky
