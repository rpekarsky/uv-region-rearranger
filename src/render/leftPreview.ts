import type { BgFill, HandleKey, Matrix, Mode, Region, Viewport } from '../types';
import { isIdentityTransform } from '../geometry/transform';
import { unionBbox } from '../geometry/polygon';
import {
  drawDrawingPolyline,
  drawPlaceholderRect,
  drawTransformHandles,
  drawVertices,
  fillPolygon,
  hexWithAlpha,
  drawRegionLabel,
  regionColor,
  serializeRegionsForCache,
  strokePolygon,
} from './helpers';
import { renderInverse } from './pipeline';

const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

export interface LeftBackdropParams {
  originalImage: HTMLImageElement | null;
  transformedImage: HTMLImageElement | null;
  regions: readonly Region[];
  bgFill: BgFill;
  regionsOnlyView: boolean;
  regionImageSize: [number, number] | null;
  originalCanvasSize: [number, number] | null;
  viewport: Viewport;
}

export interface LeftOverlayParams {
  originalImage: HTMLImageElement | null;
  transformedImage: HTMLImageElement | null;
  regions: readonly Region[];
  selectedRegionId: string | null;
  mode: Mode;
  bgFill: BgFill;
  viewport: Viewport;
  hoveredHandle: HandleKey | null;
  hoveredVertex: number | null;
  showRegionNames: boolean;
}

// Backdrop layer: just the source image (or live inverse render). No vector
// overlays — those live in the overlay canvas. Heavy and infrequent: this
// only redraws when the image identity, the viewport, or the bg/render-mode
// settings change. The overlay redraws independently every interaction.
export function drawLeftBackdrop(canvas: HTMLCanvasElement, p: LeftBackdropParams): void {
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const baseImage = p.originalImage ?? deriveInverse(p);
  if (!baseImage) return;

  const { scale, panX, panY } = p.viewport;
  ctx.setTransform(scale, 0, 0, scale, panX, panY);

  ctx.drawImage(baseImage, 0, 0);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Overlay layer: vector polygons, vertex dots, transform handles, drawing
// polyline, lasso, and the no-image placeholder rect. All cheap; redraws on
// every interaction state change.
export function drawLeftOverlay(canvas: HTMLCanvasElement, p: LeftOverlayParams): void {
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const hasContent = p.regions.length > 0;
  const hasImage = !!(p.originalImage || p.transformedImage);
  if (!hasContent && !hasImage) return;

  const { scale, panX, panY } = p.viewport;
  ctx.setTransform(scale, 0, 0, scale, panX, panY);
  const px = 1 / scale;

  // Placeholder rect when no image is loaded — gives the regions something to
  // anchor against visually.
  if (!hasImage) {
    const b = unionBbox(p.regions.map((r) => r.polygon));
    if (b) drawPlaceholderRect(ctx, b.minX, b.minY, b.maxX, b.maxY, px);
  }

  p.regions.forEach((region, idx) => {
    const isSelected = region.id === p.selectedRegionId;
    const color = regionColor(idx);
    const moved = !isIdentityTransform(region.transform);
    if (!moved) {
      fillPolygon(ctx, region.polygon, hexWithAlpha(color, isSelected ? 0.22 : 0.1));
    }
    strokePolygon(ctx, region.polygon, color, (isSelected ? 2.5 : 1.5) * px, moved);
    if (p.showRegionNames) {
      drawRegionLabel(ctx, region.polygon, region.name, px, color);
    }
  });

  if (p.selectedRegionId) {
    const r = p.regions.find((x) => x.id === p.selectedRegionId);
    if (r) {
      drawTransformHandles(ctx, r.polygon, IDENTITY_MATRIX, px, p.hoveredHandle);
      drawVertices(ctx, r.polygon, px, p.hoveredVertex);
    }
  }

  if (p.mode.kind === 'drawing' || p.mode.kind === 'lasso') {
    drawDrawingPolyline(ctx, p.mode.points, p.mode.cursor, px);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Cache the last inverse-render so we don't recompute it every frame.
let inverseCache: {
  key: string;
  canvas: HTMLCanvasElement;
} | null = null;

function deriveInverse(p: LeftBackdropParams): HTMLCanvasElement | null {
  if (!p.transformedImage) return null;
  const sourceSize = p.originalCanvasSize ?? p.regionImageSize;
  const key =
    p.transformedImage.src +
    '|' +
    p.regions.length +
    '|' +
    p.bgFill.color +
    '|' +
    p.bgFill.transparent +
    '|' +
    p.regionsOnlyView +
    '|' +
    (sourceSize?.join('x') ?? 'null') +
    '|' +
    serializeRegionsForCache(p.regions);
  if (inverseCache && inverseCache.key === key) return inverseCache.canvas;
  const out = renderInverse(p.transformedImage, p.regions, p.bgFill, p.regionsOnlyView, sourceSize);
  inverseCache = { key, canvas: out };
  return out;
}
