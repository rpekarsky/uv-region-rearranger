import { create } from 'zustand';
import { temporal } from 'zundo';
import type {
  BgFill,
  HandleKey,
  Mode,
  Region,
  SerializedConfig,
  Transform,
  Vec2,
  Viewport,
  ZoneSide,
} from './types';
import { bbox, centroid } from './geometry/polygon';
import { cacheImage, clearCachedImage } from './io/imageCache';
import { applyPoint, buildRegionMatrix, compensateSourceScale } from './geometry/transform';

const IDENTITY_VIEWPORT: Viewport = { scale: 1, panX: 0, panY: 0 };

// Debounce helper — collapses bursts of state updates (drag, typing) into
// a single history entry captured ~300ms after the last change.
function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: number | null = null;
  return ((...args: never[]) => {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }) as T;
}

// History snapshot shape — only persistent edit-relevant fields.
export interface HistorySnapshot {
  regions: Region[];
  bgFill: BgFill;
}

export interface EditorStore {
  // images
  originalImage: HTMLImageElement | null;
  originalFilename: string | null;
  transformedImage: HTMLImageElement | null;
  transformedFilename: string | null;

  // per-zone viewport (UI state, not serialized)
  leftViewport: Viewport;
  rightViewport: Viewport;

  // regions
  regions: Region[];
  selectedRegionId: string | null;
  // Tracks WHICH zone the region was selected from. Persists across selection
  // changes that don't specify a side (e.g. RegionList clicks) so the user's
  // last expressed context survives. Default 'right' since that's the
  // transform-focused default workflow.
  selectedSide: ZoneSide;

  // input mode
  mode: Mode;

  // hover feedback
  hoveredHandle: HandleKey | null;
  hoveredVertex: number | null;
  hoveredZone: ZoneSide | null;

  // visual settings
  bgFill: BgFill;
  // When true, derived live renders (forward / inverse) skip drawing the
  // underlying source image and use bgFill as the backdrop — useful for
  // generating an AI prompt input where only the rearranged islands are visible.
  regionsOnlyView: boolean;
  loupeAlwaysOn: boolean;
  showRegionNames: boolean;
  // Per-session guard: when false, vertex edits on the right (transformed) zone
  // are blocked — handles still work, vertices are not drawn or hit-tested.
  // Re-locks automatically on every region selection change. Not persisted.
  rightVertexEditUnlocked: boolean;

  // Splitter ratio between left and right zones, 0..1 (left's share).
  zonesRatio: number;

  // The image dimensions that current region/mask polygon coords are normalized
  // against. Set by loadConfig (from cfg.imageSize) and by image-set actions.
  // Used to rescale geometry when an image of different dimensions loads after
  // a config-only load — otherwise regions land in stale pixel space.
  regionImageSize: [number, number] | null;
  // Output canvas size for the right zone — independent of source canvas.
  // null = match source size (regionImageSize). Auto-synced to the transformed
  // image's dimensions on load. Modal edits set it explicitly until the next
  // image load.
  outputCanvasSize: [number, number] | null;
  // Left-zone (inverse render) output size. null falls back to regionImageSize.
  // Auto-managed by alignToImage (rescaled with regionImageSize) and loadConfig
  // (read from JSON). No direct setter — there is no UI to override it.
  originalCanvasSize: [number, number] | null;

  // actions
  setOriginalImage: (
    img: HTMLImageElement | null,
    filename: string | null,
    blob?: Blob | null,
  ) => void;
  setTransformedImage: (
    img: HTMLImageElement | null,
    filename: string | null,
    blob?: Blob | null,
  ) => void;
  setLeftViewport: (patch: Partial<Viewport>) => void;
  setRightViewport: (patch: Partial<Viewport>) => void;
  setHoveredZone: (side: ZoneSide | null) => void;
  createRegion: (polygon: Vec2[]) => Region;
  deleteRegion: (id: string) => void;
  selectRegion: (id: string | null, side?: ZoneSide) => void;
  renameRegion: (id: string, name: string) => void;
  reorderRegions: (fromIdx: number, toIdx: number) => void;
  updateTransform: (id: string, patch: Partial<Transform>) => void;
  resetTransform: (id: string) => void;
  rebasePivot: (id: string, newPivot: Vec2) => void;
  flipRegion: (id: string, axis: 'h' | 'v') => void;
  flipSourcePolygon: (id: string, axis: 'h' | 'v') => void;
  insertVertex: (id: string, edgeIndex: number, point: Vec2) => void;
  removeVertex: (id: string, vertexIndex: number) => void;
  setVertex: (id: string, vertexIndex: number, point: Vec2) => void;
  setPolygon: (id: string, polygon: Vec2[]) => void;
  nudgeSelected: (dx: number, dy: number) => void;
  setRegionGeometry: (id: string, polygon: Vec2[], transform: Transform) => void;
  duplicateRegion: (id: string) => Region | null;
  setMode: (mode: Mode) => void;
  setHoveredHandle: (key: HandleKey | null) => void;
  setHoveredVertex: (idx: number | null) => void;
  setBgFill: (patch: Partial<BgFill>) => void;
  setRegionsOnlyView: (v: boolean) => void;
  setLoupeAlwaysOn: (v: boolean) => void;
  setShowRegionNames: (v: boolean) => void;
  setRightVertexEditUnlocked: (v: boolean) => void;
  setZonesRatio: (v: number) => void;
  setOutputCanvasSize: (size: [number, number] | null, stretch?: boolean) => void;
  setSourceCanvasSize: (size: [number, number], stretch: boolean) => void;
  loadConfig: (cfg: SerializedConfig) => void;
}

// Rescale a region under a source-space change of basis (sx, sy).
// Polygon and pivot live in source-space, so they scale directly. Translate
// lives in OUTPUT space and must NOT scale by the source ratio — instead the
// transform is compensated so that the rendered output position stays
// invariant. Derivation (uniform case, ignoring rotation/skew which commute):
//   out(p) = (p - pivot)*scale + pivot + translate
// For out_new(sx*p) = out_old(p) we need:
//   scale'     = scale / source_ratio
//   translate' = translate - (source_ratio - 1) * pivot_old
// Exact for sx == sy; approximate otherwise when rotation/skew are non-trivial.
function rescaleRegion(r: Region, sx: number, sy: number): Region {
  const [px, py] = r.transform.pivot;
  return {
    ...r,
    polygon: r.polygon.map(([x, y]) => [x * sx, y * sy] as Vec2),
    transform: {
      pivot: [px * sx, py * sy],
      scale: [r.transform.scale[0] / sx, r.transform.scale[1] / sy],
      translate: [
        r.transform.translate[0] - (sx - 1) * px,
        r.transform.translate[1] - (sy - 1) * py,
      ],
      rotation: r.transform.rotation,
      skew: [r.transform.skew[0], r.transform.skew[1]],
    },
  };
}

// Stretch every region's transform so its rendered output position+size
// scales by (sx, sy). Math: keeping pivot in source-space,
//   translate' = ratio*translate + (ratio-1)*pivot
//   scale'     = scale * ratio  (exact for uniform; approximate when sx≠sy
//                                 and rotation/skew are non-trivial)
function rescaleRegionTransformsForOutput(
  regions: Region[],
  oldSize: [number, number],
  newSize: [number, number],
): Region[] {
  if (oldSize[0] === newSize[0] && oldSize[1] === newSize[1]) return regions;
  const sx = newSize[0] / oldSize[0];
  const sy = newSize[1] / oldSize[1];
  return regions.map((r) => {
    const t = r.transform;
    const [px, py] = t.pivot;
    return {
      ...r,
      transform: {
        ...t,
        translate: [sx * t.translate[0] + (sx - 1) * px, sy * t.translate[1] + (sy - 1) * py],
        scale: [t.scale[0] * sx, t.scale[1] * sy],
      },
    };
  });
}

// Returns the patch needed to align state with a newly loaded image. If the
// image dimensions match (or no prior reference), only updates the reference;
// otherwise rescales every region polygon and transform-translate/pivot.
// Also drags outputCanvasSize / originalCanvasSize along by the same ratio
// so a JSON-loaded layout doesn't desync when a differently-sized image lands
// after it.
function alignToImage(state: EditorStore, newW: number, newH: number): Partial<EditorStore> {
  const ref = state.regionImageSize;
  if (!ref || (ref[0] === newW && ref[1] === newH)) {
    return { regionImageSize: [newW, newH] };
  }
  const sx = newW / ref[0];
  const sy = newH / ref[1];
  const scaleSize = (s: [number, number]): [number, number] => [
    Math.round(s[0] * sx),
    Math.round(s[1] * sy),
  ];
  const patch: Partial<EditorStore> = {
    regions: state.regions.map((r) => rescaleRegion(r, sx, sy)),
    regionImageSize: [newW, newH],
  };
  if (state.outputCanvasSize) {
    patch.outputCanvasSize = scaleSize(state.outputCanvasSize);
  }
  if (state.originalCanvasSize) {
    patch.originalCanvasSize = scaleSize(state.originalCanvasSize);
  }
  return patch;
}

function makeRegion(polygon: Vec2[], idx: number): Region {
  return {
    id: crypto.randomUUID(),
    name: `${idx}`,
    polygon,
    transform: {
      translate: [0, 0],
      rotation: 0,
      scale: [1, 1],
      skew: [0, 0],
      pivot: centroid(polygon),
    },
  };
}

export const useEditorStore = create<EditorStore>()(
  temporal(
    (set, get) => ({
      originalImage: null,
      originalFilename: null,
      transformedImage: null,
      transformedFilename: null,
      leftViewport: IDENTITY_VIEWPORT,
      rightViewport: IDENTITY_VIEWPORT,
      regions: [],
      selectedRegionId: null,
      selectedSide: 'right',
      mode: { kind: 'idle' },
      hoveredHandle: null,
      hoveredVertex: null,
      hoveredZone: null,
      bgFill: { color: '#000000', transparent: false },
      regionsOnlyView: false,
      loupeAlwaysOn: true,
      showRegionNames: false,
      rightVertexEditUnlocked: false,
      zonesRatio: 0.5,
      regionImageSize: null,
      outputCanvasSize: null,
      originalCanvasSize: null,

      // Source canvas size is driven by the ORIGINAL image only — that's where
      // region polygons live. Transformed image lives in output-space (right zone)
      // and may legitimately be a different size; loading it must NOT rescale.
      setOriginalImage: (img, filename, blob) => {
        set((s) => ({
          originalImage: img,
          originalFilename: filename,
          ...(img ? alignToImage(s, img.naturalWidth, img.naturalHeight) : {}),
        }));
        if (img && blob) void cacheImage('original', blob, filename);
        else if (!img) void clearCachedImage('original');
      },
      setTransformedImage: (img, filename, blob) => {
        set((s) => {
          const base = { transformedImage: img, transformedFilename: filename };
          if (!img) return base;
          const newSize: [number, number] = [img.naturalWidth, img.naturalHeight];
          const oldEff = s.outputCanvasSize ?? s.regionImageSize;
          // No prior basis to rescale against — just adopt the new size.
          if (!oldEff) return { ...base, outputCanvasSize: newSize };
          return {
            ...base,
            outputCanvasSize: newSize,
            regions: rescaleRegionTransformsForOutput(s.regions, oldEff, newSize),
          };
        });
        if (img && blob) void cacheImage('transformed', blob, filename);
        else if (!img) void clearCachedImage('transformed');
      },
      setLeftViewport: (patch) => set((s) => ({ leftViewport: { ...s.leftViewport, ...patch } })),
      setRightViewport: (patch) =>
        set((s) => ({ rightViewport: { ...s.rightViewport, ...patch } })),
      setHoveredZone: (side) => set({ hoveredZone: side }),

      createRegion: (polygon) => {
        const region = makeRegion(polygon, get().regions.length + 1);
        set((s) => ({
          regions: [...s.regions, region],
          selectedRegionId: region.id,
          mode: { kind: 'editing' },
        }));
        return region;
      },

      deleteRegion: (id) =>
        set((s) => ({
          regions: s.regions.filter((r) => r.id !== id),
          selectedRegionId: s.selectedRegionId === id ? null : s.selectedRegionId,
          mode: s.selectedRegionId === id ? { kind: 'idle' } : s.mode,
        })),

      selectRegion: (id, side) =>
        set((s) => {
          const sideChanged = side !== undefined && side !== s.selectedSide;
          if (s.selectedRegionId === id && !sideChanged) return s;
          return {
            selectedRegionId: id,
            selectedSide: side ?? s.selectedSide,
            mode: id ? { kind: 'editing' } : { kind: 'idle' },
            // Re-lock vertex edits whenever the selection changes — guard rail
            // restored on every region switch (see EditorStore.rightVertexEditUnlocked).
            rightVertexEditUnlocked: false,
          };
        }),

      renameRegion: (id, name) =>
        set((s) => ({
          regions: s.regions.map((r) => (r.id === id ? { ...r, name } : r)),
        })),

      reorderRegions: (fromIdx, toIdx) =>
        set((s) => {
          if (fromIdx === toIdx) return s;
          if (fromIdx < 0 || fromIdx >= s.regions.length) return s;
          if (toIdx < 0 || toIdx >= s.regions.length) return s;
          const next = s.regions.slice();
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          return { regions: next };
        }),

      updateTransform: (id, patch) =>
        set((s) => ({
          regions: s.regions.map((r) =>
            r.id === id ? { ...r, transform: { ...r.transform, ...patch } } : r,
          ),
        })),

      resetTransform: (id) =>
        set((s) => ({
          regions: s.regions.map((r) =>
            r.id === id
              ? {
                  ...r,
                  transform: {
                    translate: [0, 0],
                    rotation: 0,
                    scale: [1, 1],
                    skew: [0, 0],
                    pivot: centroid(r.polygon),
                  },
                }
              : r,
          ),
        })),

      // rebase pivot to a new image-space point without visually moving the region.
      // translate_new = M_old(pivot_new) - pivot_new
      rebasePivot: (id, newPivot) =>
        set((s) => ({
          regions: s.regions.map((r) => {
            if (r.id !== id) return r;
            const M = buildRegionMatrix(r.transform);
            const sp = applyPoint(M, newPivot);
            return {
              ...r,
              transform: {
                ...r.transform,
                pivot: [newPivot[0], newPivot[1]],
                translate: [sp[0] - newPivot[0], sp[1] - newPivot[1]],
              },
            };
          }),
        })),

      flipRegion: (id, axis) =>
        set((s) => ({
          regions: s.regions.map((r) => {
            if (r.id !== id) return r;
            const [sx, sy] = r.transform.scale;
            return {
              ...r,
              transform: {
                ...r.transform,
                scale: axis === 'h' ? [-sx, sy] : [sx, -sy],
              },
            };
          }),
        })),

      flipSourcePolygon: (id, axis) =>
        set((s) => {
          const r = s.regions.find((x) => x.id === id);
          if (!r) return s;
          const { minX, minY, maxX, maxY } = bbox(r.polygon);
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          const sxOp = axis === 'h' ? -1 : 1;
          const syOp = axis === 'v' ? -1 : 1;
          const polygon: Vec2[] = r.polygon.map((p) => [
            cx + (p[0] - cx) * sxOp,
            cy + (p[1] - cy) * syOp,
          ]);
          const transform = compensateSourceScale(r.transform, [cx, cy], sxOp, syOp);
          return {
            regions: s.regions.map((x) => (x.id === id ? { ...x, polygon, transform } : x)),
          };
        }),

      insertVertex: (id, edgeIndex, point) =>
        set((s) => ({
          regions: s.regions.map((r) => {
            if (r.id !== id) return r;
            const polygon = [...r.polygon];
            polygon.splice(edgeIndex + 1, 0, point);
            return { ...r, polygon };
          }),
        })),

      removeVertex: (id, vertexIndex) =>
        set((s) => ({
          regions: s.regions.map((r) => {
            if (r.id !== id) return r;
            if (r.polygon.length <= 3) return r;
            const polygon = r.polygon.filter((_, i) => i !== vertexIndex);
            return { ...r, polygon };
          }),
        })),

      setVertex: (id, vertexIndex, point) =>
        set((s) => ({
          regions: s.regions.map((r) => {
            if (r.id !== id) return r;
            const polygon = [...r.polygon];
            polygon[vertexIndex] = point;
            return { ...r, polygon };
          }),
        })),

      setPolygon: (id, polygon) =>
        set((s) => ({
          regions: s.regions.map((r) =>
            r.id === id ? { ...r, polygon: polygon.map((p) => [p[0], p[1]] as Vec2) } : r,
          ),
        })),

      // Translate the currently selected region or mask by (dx, dy) image-pixels.
      // For regions this hits transform.translate on the right side and shifts the
      // source polygon on the left side, mirroring drag behavior in each zone.
      nudgeSelected: (dx, dy) =>
        set((s) => {
          if (s.selectedRegionId) {
            const id = s.selectedRegionId;
            if (s.selectedSide === 'right') {
              return {
                regions: s.regions.map((r) =>
                  r.id === id
                    ? {
                        ...r,
                        transform: {
                          ...r.transform,
                          translate: [r.transform.translate[0] + dx, r.transform.translate[1] + dy],
                        },
                      }
                    : r,
                ),
              };
            }
            return {
              regions: s.regions.map((r) =>
                r.id === id
                  ? { ...r, polygon: r.polygon.map((p) => [p[0] + dx, p[1] + dy] as Vec2) }
                  : r,
              ),
            };
          }
          return s;
        }),

      setRegionGeometry: (id, polygon, transform) =>
        set((s) => ({
          regions: s.regions.map((r) =>
            r.id === id
              ? {
                  ...r,
                  polygon: polygon.map((p) => [p[0], p[1]] as Vec2),
                  transform: {
                    translate: [transform.translate[0], transform.translate[1]],
                    rotation: transform.rotation,
                    scale: [transform.scale[0], transform.scale[1]],
                    skew: [transform.skew[0], transform.skew[1]],
                    pivot: [transform.pivot[0], transform.pivot[1]],
                  },
                }
              : r,
          ),
        })),

      duplicateRegion: (id) => {
        const src = get().regions.find((r) => r.id === id);
        if (!src) return null;
        const offset = 10;
        const cloned: Region = {
          id: crypto.randomUUID(),
          name: `${src.name}-copy`,
          polygon: src.polygon.map((p) => [p[0] + offset, p[1] + offset]),
          transform: {
            translate: [src.transform.translate[0], src.transform.translate[1]],
            rotation: src.transform.rotation,
            scale: [src.transform.scale[0], src.transform.scale[1]],
            skew: [src.transform.skew[0], src.transform.skew[1]],
            pivot: [src.transform.pivot[0] + offset, src.transform.pivot[1] + offset],
          },
        };
        set((s) => ({
          regions: [...s.regions, cloned],
          selectedRegionId: cloned.id,
          mode: { kind: 'editing' },
        }));
        return cloned;
      },

      setMode: (mode) => set({ mode }),
      setHoveredHandle: (key) => set({ hoveredHandle: key }),
      setHoveredVertex: (idx) => set({ hoveredVertex: idx }),
      setBgFill: (patch) => set((s) => ({ bgFill: { ...s.bgFill, ...patch } })),
      setRegionsOnlyView: (v) => set({ regionsOnlyView: v }),
      setLoupeAlwaysOn: (v) => set({ loupeAlwaysOn: v }),
      setShowRegionNames: (v) => set({ showRegionNames: v }),
      setRightVertexEditUnlocked: (v) => set({ rightVertexEditUnlocked: v }),
      setZonesRatio: (v) => set({ zonesRatio: Math.max(0.02, Math.min(0.98, v)) }),
      setOutputCanvasSize: (size, stretch = false) =>
        set((s) => {
          // "Effective" old/new sizes: null falls back to source size for ratio purposes.
          const oldEff = s.outputCanvasSize ?? s.regionImageSize;
          const newEff = size ?? s.regionImageSize;
          const sameSize = oldEff && newEff && oldEff[0] === newEff[0] && oldEff[1] === newEff[1];
          if (!stretch || !oldEff || !newEff || sameSize) {
            return { outputCanvasSize: size };
          }
          return {
            outputCanvasSize: size,
            regions: rescaleRegionTransformsForOutput(s.regions, oldEff, newEff),
          };
        }),

      setSourceCanvasSize: (size, stretch) =>
        set((s) => {
          const ref = s.regionImageSize;
          if (!ref || (ref[0] === size[0] && ref[1] === size[1])) {
            return { regionImageSize: size };
          }
          if (!stretch) {
            // Just retag the source space — polygons stay put in absolute pixels.
            // The user is intentionally repositioning, e.g. authoring a square output
            // canvas from a rectangular source without warping their region shapes.
            return { regionImageSize: size };
          }
          const sx = size[0] / ref[0];
          const sy = size[1] / ref[1];
          return {
            regionImageSize: size,
            regions: s.regions.map((r) => rescaleRegion(r, sx, sy)),
          };
        }),

      loadConfig: (cfg) =>
        set((s) => {
          // Image (if loaded) wins over JSON-declared canvas sizes — parseConfig has
          // already denormalized regions against the loaded image's dimensions.
          // For outputCanvasSize: if a transformed image is loaded, snap to its dims
          // and rescale region transforms (since cfg.outputCanvasSize is in JSON
          // basis — possibly different from current image-driven regionImageSize).
          const transformedImg = s.transformedImage;
          let outputCanvasSize: [number, number] | null = cfg.outputCanvasSize ?? null;
          let regions = cfg.regions;
          if (transformedImg) {
            const imgSize: [number, number] = [
              transformedImg.naturalWidth,
              transformedImg.naturalHeight,
            ];
            const oldEff = outputCanvasSize ?? cfg.imageSize;
            if (oldEff && (oldEff[0] !== imgSize[0] || oldEff[1] !== imgSize[1])) {
              regions = rescaleRegionTransformsForOutput(regions, oldEff, imgSize);
            }
            outputCanvasSize = imgSize;
          }
          return {
            regions,
            bgFill: cfg.bgFill,
            // parseConfig sets imageSize to whatever it denormalized against — record
            // it so a later mismatched image load triggers rescale via alignToImage.
            regionImageSize: cfg.imageSize,
            outputCanvasSize,
            originalCanvasSize: cfg.originalCanvasSize ?? null,
            selectedRegionId: null,
            selectedSide: 'right',
            rightVertexEditUnlocked: false,
            mode: { kind: 'idle' },
          };
        }),
    }),
    {
      // Track only edit-relevant fields. Viewport/hover/mode/selection are excluded
      // so undo doesn't rewind UI state.
      partialize: (state): HistorySnapshot => ({
        regions: state.regions,
        bgFill: state.bgFill,
      }),
      limit: 100,
      // Bursts of updates (drag, typing into property fields) collapse into one
      // history entry captured ~300ms after the last change.
      handleSet: (handleSet) => debounce((pastState) => handleSet(pastState), 300),
    },
  ),
);
