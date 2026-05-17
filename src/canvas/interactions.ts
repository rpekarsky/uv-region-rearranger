import type { HandleKey, Matrix, Mode, Region, Vec2, Viewport, ZoneSide } from '../types';
import {
  applyPolygon,
  buildRegionMatrix,
  compensateSourceRotate,
  compensateSourceScale,
  compensateSourceTranslate,
  invert,
  isIdentityTransform,
} from '../geometry/transform';
import { centroid, nearestEdge, nearestVertex, pointInPolygon } from '../geometry/polygon';
import { getHandles, getOppositeHandle, hitTestHandle, isEdgeHandle } from '../geometry/handles';

const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];
import { useEditorStore } from '../store';
import { panBy, zoomAroundPoint } from './viewport';

const HANDLE_THRESHOLD = 12; // screen px
const VERTEX_THRESHOLD = 10;
const EDGE_THRESHOLD = 8;
const ROTATE_SNAP_DEG = 15;
const RMB_DRAG_THRESHOLD = 4; // screen px before RMB hold counts as pan
const LASSO_DBLCLICK_MS = 400; // window after first LMB up to qualify as dblclick
const LASSO_DBLCLICK_PX = 5; // max screen px between the two clicks
const LASSO_ANCHOR_PX = 50; // screen px between auto-placed lasso anchors

// ---------- canvas registry (for window-level event → image conversion) ----------
const canvasRefs: Record<ZoneSide, HTMLCanvasElement | null> = { left: null, right: null };

export function registerCanvas(side: ZoneSide, canvas: HTMLCanvasElement | null): void {
  canvasRefs[side] = canvas;
}

function getViewport(side: ZoneSide): Viewport {
  const s = useEditorStore.getState();
  return side === 'left' ? s.leftViewport : s.rightViewport;
}

function setViewport(side: ZoneSide, patch: Partial<Viewport>): void {
  const s = useEditorStore.getState();
  if (side === 'left') s.setLeftViewport(patch);
  else s.setRightViewport(patch);
}

function clientToImage(side: ZoneSide, clientX: number, clientY: number): Vec2 | null {
  const canvas = canvasRefs[side];
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const vp = getViewport(side);
  return [(clientX - rect.left - vp.panX) / vp.scale, (clientY - rect.top - vp.panY) / vp.scale];
}

// ---------- RMB state (pan vs context-menu detection) ----------
let rmbState: {
  side: ZoneSide;
  startClient: Vec2; // event clientX/Y at down
  startViewport: Viewport;
  panning: boolean;
} | null = null;

// ---------- lasso state ----------
// `lastLmbUp` lets the next mousedown decide if it's the second click of a
// dblclick. `pendingLasso` is armed on that second click but only promoted to
// an active lasso once the cursor moves past the anchor threshold; otherwise
// the gesture falls through to the normal dblclick handler. `suppressDblclick`
// swallows the dblclick event that the browser fires after a successful lasso
// promotion so it doesn't also kick off a regular drawing.
let lastLmbUp: { time: number; clientX: number; clientY: number } | null = null;
let pendingLasso: {
  side: ZoneSide;
  anchorImage: Vec2;
  startClient: Vec2;
} | null = null;
let suppressDblclick = false;

// ---------- hit test ----------

type HitResult =
  | { type: 'handle'; region: Region; handle: HandleKey }
  | { type: 'regionVertex'; region: Region; vertexIndex: number }
  | { type: 'regionInterior'; region: Region }
  | null;

function hitTestLeft(point: Vec2, pxScale: number): HitResult {
  const state = useEditorStore.getState();
  const handleThr = HANDLE_THRESHOLD * pxScale;
  const vertexThr = VERTEX_THRESHOLD * pxScale;

  const selectedRegion = state.regions.find((r) => r.id === state.selectedRegionId);
  if (selectedRegion) {
    // Vertex first so polygon corners (which often coincide with bbox corners)
    // remain editable; handles take whatever is left around the bbox.
    const vIdx = nearestVertex(point, selectedRegion.polygon, vertexThr);
    if (vIdx !== -1) return { type: 'regionVertex', region: selectedRegion, vertexIndex: vIdx };
    const h = hitTestHandle(point, selectedRegion.polygon, IDENTITY_MATRIX, handleThr, pxScale);
    if (h) return { type: 'handle', region: selectedRegion, handle: h };
  }

  for (let i = state.regions.length - 1; i >= 0; i--) {
    const r = state.regions[i];
    if (pointInPolygon(point, r.polygon)) return { type: 'regionInterior', region: r };
  }
  return null;
}

function hitTestRight(point: Vec2, pxScale: number): HitResult {
  const state = useEditorStore.getState();
  const handleThr = HANDLE_THRESHOLD * pxScale;
  const vertexThr = VERTEX_THRESHOLD * pxScale;

  const selectedRegion = state.regions.find((r) => r.id === state.selectedRegionId);
  if (selectedRegion) {
    const M = buildRegionMatrix(selectedRegion.transform);
    const h = hitTestHandle(point, selectedRegion.polygon, M, handleThr, pxScale);
    if (h) return { type: 'handle', region: selectedRegion, handle: h };

    // Vertex hit-test on the right zone is gated by the unlock flag — when
    // locked, vertices aren't draggable. User unlocks via dblclick on the region.
    if (state.rightVertexEditUnlocked) {
      const transformedPoly = applyPolygon(M, selectedRegion.polygon);
      const vIdx = nearestVertex(point, transformedPoly, vertexThr);
      if (vIdx !== -1) return { type: 'regionVertex', region: selectedRegion, vertexIndex: vIdx };
    }
  }

  for (let i = state.regions.length - 1; i >= 0; i--) {
    const r = state.regions[i];
    const M = buildRegionMatrix(r.transform);
    const transformed = applyPolygon(M, r.polygon);
    if (pointInPolygon(point, transformed)) return { type: 'regionInterior', region: r };
  }
  return null;
}

// ---------- LMB / RMB on canvas ----------

export function onCanvasMouseDown(
  side: ZoneSide,
  imageCoord: Vec2,
  clientX: number,
  clientY: number,
  button: number,
  ctrlKey: boolean,
): void {
  if (button === 2) {
    rmbState = {
      side,
      startClient: [clientX, clientY],
      startViewport: { ...getViewport(side) },
      panning: false,
    };
    return;
  }
  if (button !== 0) return;

  // Reset stale suppress flag so a real dblclick fires normally.
  suppressDblclick = false;

  const store = useEditorStore.getState();
  const mode = store.mode;

  // Drawing happens only in left zone.
  if (mode.kind === 'drawing') {
    if (side === 'left') {
      store.setMode({ ...mode, points: [...mode.points, imageCoord] });
    }
    return;
  }

  // Ctrl+LMB on the left zone → start lasso immediately, regardless of hit-test.
  if (ctrlKey && side === 'left' && (store.originalImage || store.transformedImage)) {
    store.selectRegion(null, 'left');
    store.setMode({
      kind: 'lasso',
      side: 'left',
      target: 'region',
      points: [imageCoord],
      cursor: imageCoord,
    });
    return;
  }

  const pxScale = 1 / getViewport(side).scale;
  const hit =
    side === 'left' ? hitTestLeft(imageCoord, pxScale) : hitTestRight(imageCoord, pxScale);

  if (!hit) {
    // Empty area on the left zone: if this looks like the second click of a
    // dblclick, arm a pending lasso. Promotion happens in onWindowMouseMove
    // once the user drags past the anchor threshold; otherwise the upcoming
    // dblclick falls through to the normal startDrawing flow.
    if (side === 'left' && (store.originalImage || store.transformedImage) && lastLmbUp) {
      const dt = performance.now() - lastLmbUp.time;
      const dist = Math.hypot(clientX - lastLmbUp.clientX, clientY - lastLmbUp.clientY);
      if (dt <= LASSO_DBLCLICK_MS && dist <= LASSO_DBLCLICK_PX) {
        pendingLasso = {
          side: 'left',
          anchorImage: imageCoord,
          startClient: [clientX, clientY],
        };
      }
    }
    store.selectRegion(null, side);
    return;
  }

  switch (hit.type) {
    case 'handle':
      if (hit.region.id !== store.selectedRegionId || side !== store.selectedSide) {
        store.selectRegion(hit.region.id, side);
      }
      if (side === 'right') {
        if (hit.handle === 'rotation') startRotate(hit.region, imageCoord);
        else startScale(hit.region, hit.handle, pxScale);
      } else {
        if (hit.handle === 'rotation') startSourceRotate(hit.region, imageCoord);
        else startSourceScale(hit.region, hit.handle, pxScale);
      }
      break;
    case 'regionVertex':
      if (hit.region.id !== store.selectedRegionId || side !== store.selectedSide) {
        store.selectRegion(hit.region.id, side);
      }
      startVertexDrag(side, hit.region, imageCoord, hit.vertexIndex);
      break;
    case 'regionInterior':
      if (hit.region.id !== store.selectedRegionId || side !== store.selectedSide) {
        store.selectRegion(hit.region.id, side);
      }
      if (side === 'right') startTranslate(hit.region, imageCoord);
      else startSourceTranslate(hit.region, imageCoord);
      break;
  }
}

// ---------- hover ----------

export function onCanvasHover(side: ZoneSide, imageCoord: Vec2): void {
  const store = useEditorStore.getState();
  if (store.mode.kind !== 'editing' && store.mode.kind !== 'idle') return;
  const pxScale = 1 / getViewport(side).scale;
  const hit =
    side === 'left' ? hitTestLeft(imageCoord, pxScale) : hitTestRight(imageCoord, pxScale);
  const newHandle = hit?.type === 'handle' ? hit.handle : null;
  let newVertex: number | null = null;
  if (hit?.type === 'regionVertex') newVertex = hit.vertexIndex;
  if (newHandle !== store.hoveredHandle) store.setHoveredHandle(newHandle);
  if (newVertex !== store.hoveredVertex) store.setHoveredVertex(newVertex);
}

export function onCanvasDrawingMove(side: ZoneSide, imageCoord: Vec2): void {
  if (side !== 'left') return;
  const store = useEditorStore.getState();
  if (store.mode.kind === 'drawing') store.setMode({ ...store.mode, cursor: imageCoord });
}

// ---------- window-level mousemove + mouseup ----------

export function onWindowMouseMove(e: MouseEvent): void {
  // RMB pan / context-menu detection
  if (rmbState) {
    const dx = e.clientX - rmbState.startClient[0];
    const dy = e.clientY - rmbState.startClient[1];
    if (!rmbState.panning && Math.hypot(dx, dy) > RMB_DRAG_THRESHOLD) {
      rmbState.panning = true;
    }
    if (rmbState.panning) {
      setViewport(rmbState.side, {
        panX: rmbState.startViewport.panX + dx,
        panY: rmbState.startViewport.panY + dy,
      });
    }
    return;
  }

  // Promote an armed dblclick-hold into an active lasso once the cursor moves
  // past the threshold. Suppress the dblclick that the browser will fire on
  // the eventual mouseup so it doesn't also start a regular drawing.
  if (pendingLasso) {
    const dx = e.clientX - pendingLasso.startClient[0];
    const dy = e.clientY - pendingLasso.startClient[1];
    if (Math.hypot(dx, dy) > LASSO_ANCHOR_PX) {
      const point = clientToImage(pendingLasso.side, e.clientX, e.clientY);
      if (point) {
        const store = useEditorStore.getState();
        store.selectRegion(null, pendingLasso.side);
        store.setMode({
          kind: 'lasso',
          side: pendingLasso.side,
          target: 'region',
          points: [pendingLasso.anchorImage, point],
          cursor: point,
        });
        suppressDblclick = true;
      }
      pendingLasso = null;
    }
    return;
  }

  const store = useEditorStore.getState();
  if (store.mode.kind === 'lasso') {
    const lassoMode = store.mode;
    const point = clientToImage(lassoMode.side, e.clientX, e.clientY);
    if (!point) return;
    const last = lassoMode.points[lassoMode.points.length - 1];
    const vp = getViewport(lassoMode.side);
    const dxScreen = (point[0] - last[0]) * vp.scale;
    const dyScreen = (point[1] - last[1]) * vp.scale;
    if (Math.hypot(dxScreen, dyScreen) > LASSO_ANCHOR_PX) {
      store.setMode({ ...lassoMode, points: [...lassoMode.points, point], cursor: point });
    } else {
      store.setMode({ ...lassoMode, cursor: point });
    }
    return;
  }

  const dragSide = getDragSide(store.mode);
  if (!dragSide) return;
  const point = clientToImage(dragSide, e.clientX, e.clientY);
  if (!point) return;
  scheduleDragMove(point, e.shiftKey);
}

// Coalesce drag mousemove updates into one per animation frame. mousemove
// events fire faster than RAF on high-Hz displays / under React load; without
// this latch we'd run the full handleDragMove → setMode → re-render pipeline
// multiple times per frame.
let pendingDragMove: { point: Vec2; shift: boolean } | null = null;
let dragRafScheduled = false;
function scheduleDragMove(point: Vec2, shift: boolean): void {
  pendingDragMove = { point, shift };
  if (dragRafScheduled) return;
  dragRafScheduled = true;
  requestAnimationFrame(() => {
    dragRafScheduled = false;
    const next = pendingDragMove;
    pendingDragMove = null;
    if (next) handleDragMove(next.point, next.shift);
  });
}

export function onWindowMouseUp(e: MouseEvent): void {
  if (rmbState) {
    if (!rmbState.panning && e.button === 2) {
      // RMB tap (no movement) → context-menu logic (delete vertex if on one)
      const point = clientToImage(rmbState.side, e.clientX, e.clientY);
      if (point) doContextMenu(rmbState.side, point);
    }
    rmbState = null;
    return;
  }

  const store = useEditorStore.getState();

  if (store.mode.kind === 'lasso') {
    const points = store.mode.points;
    if (points.length >= 3) {
      store.createRegion([...points]);
    } else {
      store.setMode({ kind: 'idle' });
    }
    pendingLasso = null;
    if (e.button === 0) {
      lastLmbUp = { time: performance.now(), clientX: e.clientX, clientY: e.clientY };
    }
    return;
  }

  // Drop any unpromoted pending lasso so the next dblclick falls through.
  pendingLasso = null;

  if (isDragMode(store.mode)) {
    store.setMode({ kind: 'editing' });
    if (dragBegun) {
      store.endAction();
      dragBegun = false;
    }
  }

  if (e.button === 0) {
    lastLmbUp = { time: performance.now(), clientX: e.clientX, clientY: e.clientY };
  }
}

function getDragSide(mode: Mode): ZoneSide | null {
  switch (mode.kind) {
    case 'dragTranslate':
    case 'dragRotate':
    case 'dragScale':
      return 'right';
    case 'dragSourceTranslate':
    case 'dragSourceRotate':
    case 'dragSourceScale':
      return 'left';
    case 'dragVertex':
      return mode.viaSide;
    default:
      return null;
  }
}

function isDragMode(mode: Mode): boolean {
  return (
    mode.kind === 'dragTranslate' ||
    mode.kind === 'dragVertex' ||
    mode.kind === 'dragRotate' ||
    mode.kind === 'dragScale' ||
    mode.kind === 'dragSourceTranslate' ||
    mode.kind === 'dragSourceRotate' ||
    mode.kind === 'dragSourceScale'
  );
}

// ---------- dblclick / contextmenu / wheel ----------

export function onCanvasDblClick(side: ZoneSide, imageCoord: Vec2): void {
  // Browser fires dblclick after a successful lasso promotion — swallow it so
  // the post-lasso state doesn't immediately enter a fresh drawing mode.
  if (suppressDblclick) {
    suppressDblclick = false;
    return;
  }

  const store = useEditorStore.getState();
  if (store.mode.kind === 'drawing') {
    if (side === 'left') finishDrawing();
    return;
  }

  const pxScale = 1 / getViewport(side).scale;
  const edgeThr = EDGE_THRESHOLD * pxScale;

  // Left zone: insert vertex on selected region edge, else start drawing.
  if (side === 'left') {
    const selectedRegion = store.regions.find((r) => r.id === store.selectedRegionId);
    if (selectedRegion) {
      const edge = nearestEdge(imageCoord, selectedRegion.polygon, edgeThr);
      if (edge) {
        store.insertVertex(selectedRegion.id, edge.edgeIndex, edge.point);
        return;
      }
    }
    if (store.originalImage || store.transformedImage) startDrawing(imageCoord);
    return;
  }

  // Right zone: dblclick is the unlock gesture for source-shape editing.
  // Locked → just unlock (no edge insertion). Unlocked → insert vertex on the
  // selected region's transformed edge (the legacy behavior).
  if (side === 'right') {
    const selectedRegion = store.regions.find((r) => r.id === store.selectedRegionId);
    if (!selectedRegion) return;
    if (!store.rightVertexEditUnlocked) {
      const M = buildRegionMatrix(selectedRegion.transform);
      const transformedPoly = applyPolygon(M, selectedRegion.polygon);
      // Only treat as unlock-gesture if the dblclick is on the region itself
      // (interior or edge). Outside → ignore so empty-canvas dblclicks don't
      // silently flip the gate.
      const onEdge = nearestEdge(imageCoord, transformedPoly, edgeThr);
      if (onEdge || pointInPolygon(imageCoord, transformedPoly)) {
        store.setRightVertexEditUnlocked(true);
      }
      return;
    }
    const M = buildRegionMatrix(selectedRegion.transform);
    const transformedPoly = applyPolygon(M, selectedRegion.polygon);
    const edge = nearestEdge(imageCoord, transformedPoly, edgeThr);
    if (edge) {
      const a = selectedRegion.polygon[edge.edgeIndex];
      const b = selectedRegion.polygon[(edge.edgeIndex + 1) % selectedRegion.polygon.length];
      const sourcePoint: Vec2 = [a[0] + edge.t * (b[0] - a[0]), a[1] + edge.t * (b[1] - a[1])];
      store.insertVertex(selectedRegion.id, edge.edgeIndex, sourcePoint);
    }
  }
}

function doContextMenu(side: ZoneSide, imageCoord: Vec2): void {
  const store = useEditorStore.getState();
  const pxScale = 1 / getViewport(side).scale;
  const vertexThr = VERTEX_THRESHOLD * pxScale;

  if (side === 'left') {
    const selectedRegion = store.regions.find((r) => r.id === store.selectedRegionId);
    if (selectedRegion) {
      const vIdx = nearestVertex(imageCoord, selectedRegion.polygon, vertexThr);
      if (vIdx !== -1) store.removeVertex(selectedRegion.id, vIdx);
    }
    return;
  }

  // Right: vertex against transformed polygon
  const selectedRegion = store.regions.find((r) => r.id === store.selectedRegionId);
  if (!selectedRegion) return;
  const M = buildRegionMatrix(selectedRegion.transform);
  const transformedPoly = applyPolygon(M, selectedRegion.polygon);
  const vIdx = nearestVertex(imageCoord, transformedPoly, vertexThr);
  if (vIdx !== -1) store.removeVertex(selectedRegion.id, vIdx);
}

export function onWheel(side: ZoneSide, screenX: number, screenY: number, deltaY: number): void {
  const vp = getViewport(side);
  const factor = Math.exp(-deltaY * 0.0015);
  const next = zoomAroundPoint(vp, screenX, screenY, factor);
  setViewport(side, next);
}

export function nudgeViewport(side: ZoneSide, dx: number, dy: number): void {
  const vp = getViewport(side);
  const next = panBy(vp, dx, dy);
  setViewport(side, { panX: next.panX, panY: next.panY });
}

// ---------- drawing ----------

export function startDrawing(initialPoint: Vec2 | null = null): void {
  const store = useEditorStore.getState();
  store.selectRegion(null, 'left');
  store.setMode({
    kind: 'drawing',
    points: initialPoint ? [initialPoint] : [],
    cursor: null,
  });
}

export function finishDrawing(): void {
  const store = useEditorStore.getState();
  if (store.mode.kind !== 'drawing') return;
  if (store.mode.points.length < 3) {
    cancelDrawing();
    return;
  }
  store.createRegion([...store.mode.points]);
}

export function cancelDrawing(): void {
  useEditorStore.getState().setMode({ kind: 'idle' });
}

// ---------- drag operations ----------

function startTranslate(region: Region, mouseStart: Vec2): void {
  useEditorStore.getState().setMode({
    kind: 'dragTranslate',
    regionId: region.id,
    mouseStart,
    startTranslate: region.transform.translate,
  });
}

function startVertexDrag(
  side: ZoneSide,
  region: Region,
  mouseStart: Vec2,
  vertexIndex: number,
): void {
  useEditorStore.getState().setMode({
    kind: 'dragVertex',
    viaSide: side,
    regionId: region.id,
    vertexIndex,
    mouseStart,
    startPolygon: region.polygon.map((p) => [p[0], p[1]]),
  });
}

function startRotate(region: Region, mouseStart: Vec2): void {
  const t = region.transform;
  const pivotScreen: Vec2 = [t.pivot[0] + t.translate[0], t.pivot[1] + t.translate[1]];
  const startAngle = Math.atan2(mouseStart[1] - pivotScreen[1], mouseStart[0] - pivotScreen[0]);
  useEditorStore.getState().setMode({
    kind: 'dragRotate',
    regionId: region.id,
    pivotScreen,
    startAngle,
    startRotation: t.rotation,
  });
}

function snapshotTransform(t: Region['transform']): Region['transform'] {
  return {
    translate: [t.translate[0], t.translate[1]],
    rotation: t.rotation,
    scale: [t.scale[0], t.scale[1]],
    skew: [t.skew[0], t.skew[1]],
    pivot: [t.pivot[0], t.pivot[1]],
  };
}

function startSourceTranslate(region: Region, mouseStart: Vec2): void {
  useEditorStore.getState().setMode({
    kind: 'dragSourceTranslate',
    regionId: region.id,
    mouseStart,
    startPolygon: region.polygon.map((p) => [p[0], p[1]]),
    startTransform: snapshotTransform(region.transform),
  });
}

function startSourceRotate(region: Region, mouseStart: Vec2): void {
  const pivot = centroid(region.polygon);
  const startAngle = Math.atan2(mouseStart[1] - pivot[1], mouseStart[0] - pivot[0]);
  useEditorStore.getState().setMode({
    kind: 'dragSourceRotate',
    regionId: region.id,
    pivot: [pivot[0], pivot[1]],
    startAngle,
    startPolygon: region.polygon.map((p) => [p[0], p[1]]),
    startTransform: snapshotTransform(region.transform),
  });
}

function startSourceScale(region: Region, handleKey: HandleKey, pxScale: number): void {
  // Source-side scaling: M is identity, no compensation needed. Pass IDENTITY
  // so deltaPre matches the legacy convention (uncompensated pad), which the
  // dragScale math elsewhere assumes. Visual handle drawing uses its own
  // M-aware getHandles call in drawTransformHandles.
  const handles = getHandles(region.polygon, IDENTITY_MATRIX, pxScale);
  const C = handles[handleKey];
  const P = handles[getOppositeHandle(handleKey)];
  useEditorStore.getState().setMode({
    kind: 'dragSourceScale',
    regionId: region.id,
    handleKey,
    pivot: [P[0], P[1]],
    deltaPre: [C[0] - P[0], C[1] - P[1]],
    startPolygon: region.polygon.map((p) => [p[0], p[1]]),
    startTransform: snapshotTransform(region.transform),
  });
}

function startScale(region: Region, handleKey: HandleKey, pxScale: number): void {
  const store = useEditorStore.getState();
  // Right-zone scaling: deltaPre needs the uncompensated source-space corner
  // offset (incl. raw padding) to match the dragScale math downstream — that
  // math assumes corner = pivot + scale * deltaPre. Passing IDENTITY here keeps
  // deltaPre in the legacy basis even after the M-aware drawing change.
  const handles = getHandles(region.polygon, IDENTITY_MATRIX, pxScale);
  const C_pre = handles[handleKey];
  const P_pre = handles[getOppositeHandle(handleKey)];

  // rebasePivot is the first region mutation for a scale op — push history
  // BEFORE it so undo lands on the pre-rebase state. (Subsequent drag frames
  // happen inside the lazy-begun bracket via handleDragMove.)
  store.beginAction();
  store.rebasePivot(region.id, P_pre);
  dragBegun = true;
  const refreshed = useEditorStore.getState().regions.find((r) => r.id === region.id)!;
  const t = refreshed.transform;
  const pivotScreen: Vec2 = [t.pivot[0] + t.translate[0], t.pivot[1] + t.translate[1]];

  store.setMode({
    kind: 'dragScale',
    regionId: region.id,
    handleKey,
    deltaPre: [C_pre[0] - P_pre[0], C_pre[1] - P_pre[1]],
    pivotScreen,
    startScale: [t.scale[0], t.scale[1]],
    startSkew: [t.skew[0], t.skew[1]],
    rotation: t.rotation,
  });
}

// Deferred-action flag: drags shouldn't push to history until the user
// actually moves the mouse. A click that resolves to "selectRegion + drag-
// translate setup" without any movement should not create an undo entry.
// startScale is the exception — it mutates regions immediately (rebasePivot)
// so it sets this flag itself.
let dragBegun = false;

function handleDragMove(p: Vec2, shift: boolean): void {
  const store = useEditorStore.getState();
  const mode = store.mode;
  if (!isDragMode(mode)) return;
  if (!dragBegun) {
    store.beginAction();
    dragBegun = true;
  }

  switch (mode.kind) {
    case 'dragTranslate': {
      store.updateTransform(mode.regionId, {
        translate: [
          mode.startTranslate[0] + (p[0] - mode.mouseStart[0]),
          mode.startTranslate[1] + (p[1] - mode.mouseStart[1]),
        ],
      });
      break;
    }
    case 'dragVertex': {
      let dx = p[0] - mode.mouseStart[0];
      let dy = p[1] - mode.mouseStart[1];
      if (mode.viaSide === 'right') {
        const region = store.regions.find((r) => r.id === mode.regionId);
        if (region && !isIdentityTransform(region.transform)) {
          const Minv = invert(buildRegionMatrix(region.transform));
          const ndx = Minv[0] * dx + Minv[2] * dy;
          const ndy = Minv[1] * dx + Minv[3] * dy;
          dx = ndx;
          dy = ndy;
        }
      }
      const start = mode.startPolygon[mode.vertexIndex];
      store.setVertex(mode.regionId, mode.vertexIndex, [start[0] + dx, start[1] + dy]);
      break;
    }
    case 'dragRotate': {
      const angle = Math.atan2(p[1] - mode.pivotScreen[1], p[0] - mode.pivotScreen[0]);
      let newRot = mode.startRotation + (angle - mode.startAngle);
      if (shift) {
        const snap = (ROTATE_SNAP_DEG * Math.PI) / 180;
        newRot = Math.round(newRot / snap) * snap;
      }
      store.updateTransform(mode.regionId, { rotation: newRot });
      break;
    }
    case 'dragScale': {
      const dx = p[0] - mode.pivotScreen[0];
      const dy = p[1] - mode.pivotScreen[1];
      const c = Math.cos(-mode.rotation),
        s = Math.sin(-mode.rotation);
      const v: Vec2 = [c * dx - s * dy, s * dx + c * dy];

      // Shift+edge handle → skew along the edge's axis (scale stays at startScale).
      // Math: with skew*scale*deltaPre at the dragged handle, for n/s edge
      // (deltaPre[0] === 0) only skewX changes; for w/e (deltaPre[1] === 0) only skewY.
      // Corner handles fall through to scale (with shift = uniform).
      if (shift && isEdgeHandle(mode.handleKey)) {
        let skewX = mode.startSkew[0];
        let skewY = mode.startSkew[1];
        if (Math.abs(mode.deltaPre[1]) > 1e-6 && Math.abs(mode.startScale[1]) > 1e-6) {
          skewX = v[0] / (mode.startScale[1] * mode.deltaPre[1]);
        }
        if (Math.abs(mode.deltaPre[0]) > 1e-6 && Math.abs(mode.startScale[0]) > 1e-6) {
          skewY = v[1] / (mode.startScale[0] * mode.deltaPre[0]);
        }
        store.updateTransform(mode.regionId, { skew: [skewX, skewY] });
        break;
      }

      let sx = mode.startScale[0];
      let sy = mode.startScale[1];
      if (Math.abs(mode.deltaPre[0]) > 1e-6) sx = v[0] / mode.deltaPre[0];
      if (Math.abs(mode.deltaPre[1]) > 1e-6) sy = v[1] / mode.deltaPre[1];

      if (shift && Math.abs(mode.deltaPre[0]) > 1e-6 && Math.abs(mode.deltaPre[1]) > 1e-6) {
        const rx = sx / mode.startScale[0];
        const ry = sy / mode.startScale[1];
        const r = Math.abs(rx) > Math.abs(ry) ? rx : ry;
        sx = mode.startScale[0] * r;
        sy = mode.startScale[1] * r;
      }
      store.updateTransform(mode.regionId, { scale: [sx, sy] });
      break;
    }
    case 'dragSourceTranslate': {
      const dx = p[0] - mode.mouseStart[0];
      const dy = p[1] - mode.mouseStart[1];
      const polygon: Vec2[] = mode.startPolygon.map((v) => [v[0] + dx, v[1] + dy]);
      const transform = compensateSourceTranslate(mode.startTransform, [dx, dy]);
      store.setRegionGeometry(mode.regionId, polygon, transform);
      break;
    }
    case 'dragSourceRotate': {
      const angle = Math.atan2(p[1] - mode.pivot[1], p[0] - mode.pivot[0]);
      let theta = angle - mode.startAngle;
      if (shift) {
        const snap = (ROTATE_SNAP_DEG * Math.PI) / 180;
        theta = Math.round(theta / snap) * snap;
      }
      const c = Math.cos(theta),
        s = Math.sin(theta);
      const polygon: Vec2[] = mode.startPolygon.map((v) => {
        const dx = v[0] - mode.pivot[0];
        const dy = v[1] - mode.pivot[1];
        return [mode.pivot[0] + c * dx - s * dy, mode.pivot[1] + s * dx + c * dy];
      });
      const transform = compensateSourceRotate(mode.startTransform, mode.pivot, theta);
      store.setRegionGeometry(mode.regionId, polygon, transform);
      break;
    }
    case 'dragSourceScale': {
      const dx = p[0] - mode.pivot[0];
      const dy = p[1] - mode.pivot[1];
      // Edge handles (n/s/w/e) have a zero component in deltaPre; lock that
      // axis at scale=1 so the polygon doesn't collapse onto the pivot line.
      let sx = 1,
        sy = 1;
      if (Math.abs(mode.deltaPre[0]) > 1e-6) sx = dx / mode.deltaPre[0];
      if (Math.abs(mode.deltaPre[1]) > 1e-6) sy = dy / mode.deltaPre[1];
      if (shift && Math.abs(mode.deltaPre[0]) > 1e-6 && Math.abs(mode.deltaPre[1]) > 1e-6) {
        const r = Math.abs(sx) > Math.abs(sy) ? sx : sy;
        sx = r;
        sy = r;
      }
      const polygon: Vec2[] = mode.startPolygon.map((v) => {
        const vx = v[0] - mode.pivot[0];
        const vy = v[1] - mode.pivot[1];
        return [mode.pivot[0] + vx * sx, mode.pivot[1] + vy * sy];
      });
      const transform = compensateSourceScale(mode.startTransform, mode.pivot, sx, sy);
      store.setRegionGeometry(mode.regionId, polygon, transform);
      break;
    }
  }
}
