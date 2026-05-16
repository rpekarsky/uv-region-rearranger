import type { HandleKey, Matrix, Polygon, Region, Vec2 } from '../types';
import { applyPoint } from '../geometry/transform';
import { bbox } from '../geometry/polygon';
import { getHandles } from '../geometry/handles';

// Stable cache key for a region list. Includes polygon vertex coords so vertex
// drags (which preserve id and length) invalidate the key. Shared by
// leftPreview's inverse-render cache and rightPreview's forward-render cache —
// keep them in sync via this single helper.
export function serializeRegionsForCache(regions: readonly Region[]): string {
  return regions
    .map(
      (r) =>
        r.id +
        ':' +
        r.polygon.length +
        ':' +
        r.polygon.flat().join(',') +
        ':' +
        r.transform.translate.join(',') +
        ':' +
        r.transform.rotation +
        ':' +
        r.transform.scale.join(',') +
        ':' +
        r.transform.skew.join(',') +
        ':' +
        r.transform.pivot.join(','),
    )
    .join(';');
}

export const REGION_COLORS = [
  '#ff6b6b',
  '#4ecdc4',
  '#ffe66d',
  '#a8e6cf',
  '#ff8b94',
  '#c7ceea',
  '#b5ead7',
  '#ffdac1',
];

export function regionColor(index: number): string {
  return REGION_COLORS[index % REGION_COLORS.length];
}

export function hexWithAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function pathPolygon(ctx: CanvasRenderingContext2D, polygon: Polygon): void {
  if (polygon.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(polygon[0][0], polygon[0][1]);
  for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i][0], polygon[i][1]);
  ctx.closePath();
}

export function strokePolygon(
  ctx: CanvasRenderingContext2D,
  polygon: Polygon,
  color: string,
  width: number,
  dashed = false,
): void {
  if (polygon.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dashed ? [width * 4, width * 3] : []);
  pathPolygon(ctx, polygon);
  ctx.stroke();
  ctx.restore();
}

export function fillPolygon(ctx: CanvasRenderingContext2D, polygon: Polygon, color: string): void {
  if (polygon.length < 3) return;
  ctx.save();
  ctx.fillStyle = color;
  pathPolygon(ctx, polygon);
  ctx.fill();
  ctx.restore();
}

export function drawVertices(
  ctx: CanvasRenderingContext2D,
  polygon: Polygon,
  pxScale: number,
  hoveredIdx: number | null,
): void {
  const r = 5 * pxScale;
  ctx.save();
  for (let i = 0; i < polygon.length; i++) {
    const [x, y] = polygon[i];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = i === hoveredIdx ? '#ff0' : '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5 * pxScale;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// Centroid of a polygon for label positioning.
function polyCentroid(polygon: Polygon): Vec2 {
  let sx = 0,
    sy = 0;
  for (const p of polygon) {
    sx += p[0];
    sy += p[1];
  }
  return [sx / polygon.length, sy / polygon.length];
}

// Region name overlay: monospace text with outline. Drawn in centroid by default.
// Falls back to above the bbox top when the bbox is narrower than the rendered
// text width (tiny regions or very long names).
export function drawRegionLabel(
  ctx: CanvasRenderingContext2D,
  polygon: Polygon,
  name: string,
  pxScale: number,
  color: string,
): void {
  if (!name) return;
  const fontPx = 13 * pxScale;
  const { minX, minY, maxX } = bbox(polygon);
  const widthAvail = maxX - minX;
  // Monospace char width ≈ 0.6 em; rough estimate good enough to decide fallback.
  const estTextWidth = fontPx * 0.62 * name.length;
  const fitsHorizontally = estTextWidth <= widthAvail * 0.95;
  const center = polyCentroid(polygon);

  ctx.save();
  ctx.font = `${fontPx}px ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = fitsHorizontally ? 'middle' : 'bottom';
  const x = fitsHorizontally ? center[0] : (minX + maxX) / 2;
  const y = fitsHorizontally ? center[1] : minY - 4 * pxScale;

  ctx.lineWidth = 3 * pxScale;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineJoin = 'round';
  ctx.strokeText(name, x, y);
  ctx.fillStyle = color;
  ctx.fillText(name, x, y);
  ctx.restore();
}

// Faint dashed rect used as a stand-in for the image canvas when no image is
// loaded — so regions have visual anchoring.
export function drawPlaceholderRect(
  ctx: CanvasRenderingContext2D,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  pxScale: number,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1.5 * pxScale;
  ctx.setLineDash([6 * pxScale, 4 * pxScale]);
  ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
  ctx.restore();
}

// Drawing-in-progress polyline overlay.
export function drawDrawingPolyline(
  ctx: CanvasRenderingContext2D,
  points: readonly Vec2[],
  cursorPoint: Vec2 | null,
  pxScale: number,
): void {
  if (points.length === 0) return;
  const color = '#4080ee';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * pxScale;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();

  if (cursorPoint) {
    ctx.setLineDash([5 * pxScale, 4 * pxScale]);
    ctx.beginPath();
    ctx.moveTo(points[points.length - 1][0], points[points.length - 1][1]);
    ctx.lineTo(cursorPoint[0], cursorPoint[1]);
    if (points.length > 1) ctx.lineTo(points[0][0], points[0][1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const r = 4 * pxScale;
  for (const [x, y] of points) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 * pxScale;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// Transform manipulator: bbox + tether to rotation handle, plus the handle dots.
export function drawTransformHandles(
  ctx: CanvasRenderingContext2D,
  polygon: Polygon,
  M: Matrix,
  pxScale: number,
  hoveredKey: HandleKey | null,
): void {
  const handles = getHandles(polygon, M, pxScale);
  const r = 6 * pxScale;

  // Bbox + tether: drawn in viewport space (M applied to each point manually)
  // so stroke width and dash lengths stay constant in screen pixels regardless
  // of the region's transform.scale. Drawing them inside ctx.transform(M) would
  // scale lineWidth/dash by M and produce visibly thicker/thinner frames on
  // scaled regions.
  const { minX, minY, maxX, maxY } = bbox(polygon);
  const innerCornersOut: Vec2[] = [
    applyPoint(M, [minX, minY]),
    applyPoint(M, [maxX, minY]),
    applyPoint(M, [maxX, maxY]),
    applyPoint(M, [minX, maxY]),
  ];
  const outerCornersOut: Vec2[] = [
    applyPoint(M, handles.nw),
    applyPoint(M, handles.ne),
    applyPoint(M, handles.se),
    applyPoint(M, handles.sw),
  ];
  const tetherStartOut = applyPoint(M, handles.n);
  const tetherEndOut = applyPoint(M, handles.rotation);

  ctx.save();
  ctx.strokeStyle = 'rgba(64,128,238,0.45)';
  ctx.lineWidth = 1 * pxScale;
  ctx.beginPath();
  ctx.moveTo(innerCornersOut[0][0], innerCornersOut[0][1]);
  for (let i = 1; i < innerCornersOut.length; i++) {
    ctx.lineTo(innerCornersOut[i][0], innerCornersOut[i][1]);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(64,128,238,0.7)';
  ctx.lineWidth = 1.5 * pxScale;
  ctx.setLineDash([4 * pxScale, 3 * pxScale]);
  ctx.beginPath();
  ctx.moveTo(outerCornersOut[0][0], outerCornersOut[0][1]);
  for (let i = 1; i < outerCornersOut.length; i++) {
    ctx.lineTo(outerCornersOut[i][0], outerCornersOut[i][1]);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(tetherStartOut[0], tetherStartOut[1]);
  ctx.lineTo(tetherEndOut[0], tetherEndOut[1]);
  ctx.stroke();
  ctx.restore();

  // Handle dots: drawn in IMAGE-space (caller's transform is viewport), but
  // positioned at M(handle) so they sit at the rotated-bbox corners.
  ctx.save();
  ctx.lineWidth = 1.5 * pxScale;
  ctx.strokeStyle = '#000';
  const keys: HandleKey[] = ['nw', 'ne', 'se', 'sw', 'n', 's', 'w', 'e', 'rotation'];
  for (const key of keys) {
    const [x, y] = applyPoint(M, handles[key]);
    ctx.beginPath();
    if (key === 'rotation') {
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = key === hoveredKey ? '#ff0' : '#4080ee';
    } else {
      ctx.rect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = key === hoveredKey ? '#ff0' : '#fff';
    }
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
