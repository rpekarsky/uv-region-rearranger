import type { BgFill, Region, Polygon, Matrix } from '../types';
import { applyPolygon, buildRegionMatrix, invert } from '../geometry/transform';
import { drawRegionLabel, hexWithAlpha, regionColor } from './helpers';

function pathPolygon(ctx: CanvasRenderingContext2D, polygon: Polygon): void {
  if (polygon.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(polygon[0][0], polygon[0][1]);
  for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i][0], polygon[i][1]);
  ctx.closePath();
}

function setMatrix(ctx: CanvasRenderingContext2D, M: Matrix): void {
  ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
}

function fillBg(ctx: CanvasRenderingContext2D, w: number, h: number, bg: BgFill): void {
  if (bg.transparent) {
    ctx.clearRect(0, 0, w, h);
  } else {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
  }
}

// Forward render: produces the rearranged image at `outputSize` (default =
// source image native size). The decoupling lets a 2.7:1 source rearrange into
// a 1:1 output, etc.
export function renderForward(
  image: HTMLImageElement,
  regions: readonly Region[],
  bgFill: BgFill,
  regionsOnly = false,
  outputSize?: [number, number] | null,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = outputSize?.[0] ?? image.naturalWidth ?? image.width;
  out.height = outputSize?.[1] ?? image.naturalHeight ?? image.height;
  const ctx = out.getContext('2d')!;

  if (!bgFill.transparent) {
    ctx.fillStyle = bgFill.color;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  // regionsOnly: skip the source image so only the rearranged islands paint
  // onto a clean bgFill backdrop (useful for AI prompt input).
  if (!regionsOnly) {
    ctx.drawImage(image, 0, 0);
  }

  // Cut out source polygons (replace with bg)
  for (const region of regions) {
    ctx.save();
    pathPolygon(ctx, region.polygon);
    ctx.clip();
    fillBg(ctx, out.width, out.height, bgFill);
    ctx.restore();
  }

  // Paste each region with its transform (drawn last → always on top)
  for (const region of regions) {
    const M = buildRegionMatrix(region.transform);
    ctx.save();
    setMatrix(ctx, M);
    pathPolygon(ctx, region.polygon);
    ctx.clip();
    ctx.drawImage(image, 0, 0);
    ctx.restore();
  }

  return out;
}

// Inverse render (Variant A): for each region, take pixels from AI image at
// transformed-polygon location and back-project via inverse transform onto
// original polygon position. Areas outside any region are taken from AI image
// as-is so AI edits to non-region areas are preserved.
export function renderInverse(
  aiImage: HTMLImageElement,
  regions: readonly Region[],
  bgFill: BgFill,
  regionsOnly = false,
  sourceSize?: [number, number] | null,
): HTMLCanvasElement {
  const w = sourceSize?.[0] ?? aiImage.naturalWidth ?? aiImage.width;
  const h = sourceSize?.[1] ?? aiImage.naturalHeight ?? aiImage.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;

  // Always paint bg first so areas outside the output canvas footprint (when
  // sourceSize > aiImage size) end up with bg colour, not transparent.
  if (!bgFill.transparent) {
    ctx.fillStyle = bgFill.color;
    ctx.fillRect(0, 0, w, h);
  }
  if (!regionsOnly) {
    ctx.drawImage(aiImage, 0, 0);
  }

  // Clear transformed-polygon areas (the moved islands shouldn't stay there)
  for (const region of regions) {
    const M = buildRegionMatrix(region.transform);
    const transformedPoly = applyPolygon(M, region.polygon);
    ctx.save();
    pathPolygon(ctx, transformedPoly);
    ctx.clip();
    fillBg(ctx, w, h, bgFill);
    ctx.restore();
  }

  // Back-project: clip to SOURCE polygon (in canvas coords), then draw aiImage
  // with M^-1. AI pixels at transformed-poly land at source-poly.
  for (const region of regions) {
    const M = buildRegionMatrix(region.transform);
    const Minv = invert(M);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    pathPolygon(ctx, region.polygon);
    ctx.clip();
    setMatrix(ctx, Minv);
    ctx.drawImage(aiImage, 0, 0);
    ctx.restore();
  }

  return out;
}

// Reference render: each region painted as a filled+bordered shape with its
// name in the center, in either source or transformed space at `outputSize`.
// Useful to feed an AI tool a layout reference.
export function renderRegionMap(
  regions: readonly Region[],
  bgFill: BgFill,
  outputSize: [number, number],
  space: 'source' | 'transformed' = 'transformed',
): HTMLCanvasElement {
  const [w, h] = outputSize;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  fillBg(ctx, w, h, bgFill);

  // The shared label helper is sized via pxScale (= 1/viewport.scale on screen).
  // For a static export there's no viewport — pick a scale so labels read at
  // the same relative size on any output dimension.
  const pxScale = Math.min(w, h) / 600;
  const lineWidth = 3 * pxScale;

  regions.forEach((region, idx) => {
    const color = regionColor(idx);
    const poly =
      space === 'transformed'
        ? applyPolygon(buildRegionMatrix(region.transform), region.polygon)
        : region.polygon;
    if (poly.length < 3) return;

    ctx.save();
    ctx.fillStyle = hexWithAlpha(color, 0.45);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    pathPolygon(ctx, poly);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    drawRegionLabel(ctx, poly, region.name, pxScale, '#fff');
  });

  return out;
}
