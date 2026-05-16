import type { BgFill, HandleKey, Region, Vec2, Viewport } from '../types';
import { applyPolygon, buildRegionMatrix } from '../geometry/transform';
import { unionBbox } from '../geometry/polygon';
import {
  drawPlaceholderRect,
  drawRegionLabel,
  drawTransformHandles,
  drawVertices,
  hexWithAlpha,
  regionColor,
  serializeRegionsForCache,
  strokePolygon,
} from './helpers';
import { renderForward } from './pipeline';

export interface RightBackdropParams {
  originalImage: HTMLImageElement | null;
  transformedImage: HTMLImageElement | null;
  regions: readonly Region[];
  bgFill: BgFill;
  regionsOnlyView: boolean;
  outputCanvasSize: [number, number] | null;
  viewport: Viewport;
}

export interface RightOverlayParams {
  originalImage: HTMLImageElement | null;
  transformedImage: HTMLImageElement | null;
  regions: readonly Region[];
  selectedRegionId: string | null;
  outputCanvasSize: [number, number] | null;
  viewport: Viewport;
  hoveredHandle: HandleKey | null;
  hoveredVertex: number | null;
  showRegionNames: boolean;
  // When false, vertex edits are blocked: vertices are not drawn or hit-tested.
  // The lock toggle button drawn near the rotation handle flips this.
  rightVertexEditUnlocked: boolean;
}

export function drawRightBackdrop(canvas: HTMLCanvasElement, p: RightBackdropParams): void {
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const baseImage = p.transformedImage ?? deriveForward(p);
  if (!baseImage) return;

  const { scale, panX, panY } = p.viewport;
  ctx.setTransform(scale, 0, 0, scale, panX, panY);

  ctx.drawImage(baseImage, 0, 0);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function drawRightOverlay(canvas: HTMLCanvasElement, p: RightOverlayParams): void {
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const hasContent = p.regions.length > 0;
  const hasImage = !!(p.transformedImage || p.originalImage);
  if (!hasContent && !hasImage && !p.outputCanvasSize) return;

  const { scale, panX, panY } = p.viewport;
  ctx.setTransform(scale, 0, 0, scale, panX, panY);
  const px = 1 / scale;

  // Placeholder rect when no image is loaded.
  if (!hasImage) {
    if (p.outputCanvasSize) {
      const [oW, oH] = p.outputCanvasSize;
      drawPlaceholderRect(ctx, 0, 0, oW, oH, px);
    } else if (hasContent) {
      const polys: Vec2[][] = [];
      for (const r of p.regions) {
        const M = buildRegionMatrix(r.transform);
        polys.push(applyPolygon(M, r.polygon));
      }
      const b = unionBbox(polys);
      if (b) drawPlaceholderRect(ctx, b.minX, b.minY, b.maxX, b.maxY, px);
    }
  }

  p.regions.forEach((region, idx) => {
    const isSelected = region.id === p.selectedRegionId;
    const color = regionColor(idx);
    const M = buildRegionMatrix(region.transform);
    const transformed = applyPolygon(M, region.polygon);
    strokePolygon(ctx, transformed, color, (isSelected ? 2.5 : 1.5) * px);
    if (isSelected) {
      ctx.save();
      ctx.fillStyle = hexWithAlpha(color, 0.12);
      ctx.beginPath();
      ctx.moveTo(transformed[0][0], transformed[0][1]);
      for (let i = 1; i < transformed.length; i++) ctx.lineTo(transformed[i][0], transformed[i][1]);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (p.showRegionNames) {
      drawRegionLabel(ctx, transformed, region.name, px, color);
    }
  });

  if (p.selectedRegionId) {
    const region = p.regions.find((r) => r.id === p.selectedRegionId);
    if (region) {
      const M = buildRegionMatrix(region.transform);
      // Vertices on the right zone modify the SOURCE polygon — by default that's
      // unintuitive (you're looking at the output but editing source shape).
      // Hidden until the user double-clicks the region to unlock; auto-relocks
      // on selection change. Locked = no draw, no hit-test, no edge insert.
      if (p.rightVertexEditUnlocked) {
        const visiblePoly = applyPolygon(M, region.polygon);
        drawVertices(ctx, visiblePoly, px, p.hoveredVertex);
      }
      drawTransformHandles(ctx, region.polygon, M, px, p.hoveredHandle);
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

let forwardCache: {
  key: string;
  canvas: HTMLCanvasElement;
} | null = null;

function deriveForward(p: RightBackdropParams): HTMLCanvasElement | null {
  if (!p.originalImage) return null;
  const key =
    p.originalImage.src +
    '|' +
    p.regions.length +
    '|' +
    p.bgFill.color +
    '|' +
    p.bgFill.transparent +
    '|' +
    p.regionsOnlyView +
    '|' +
    (p.outputCanvasSize?.join('x') ?? 'null') +
    '|' +
    serializeRegionsForCache(p.regions);
  if (forwardCache && forwardCache.key === key) return forwardCache.canvas;
  const out = renderForward(
    p.originalImage,
    p.regions,
    p.bgFill,
    p.regionsOnlyView,
    p.outputCanvasSize,
  );
  forwardCache = { key, canvas: out };
  return out;
}
