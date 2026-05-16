import type { Vec2, Viewport } from '../types';

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 32;

const IDENTITY: Viewport = { scale: 1, panX: 0, panY: 0 };

// Convert canvas-event screen coords (relative to canvas top-left) → image-space coords.
export function eventToImage(screenX: number, screenY: number, vp: Viewport): Vec2 {
  return [(screenX - vp.panX) / vp.scale, (screenY - vp.panY) / vp.scale];
}

// Compute viewport that fits image into a zone with optional padding.
export function fitToZone(
  imgW: number,
  imgH: number,
  zoneW: number,
  zoneH: number,
  padding = 24,
): Viewport {
  if (imgW <= 0 || imgH <= 0 || zoneW <= 0 || zoneH <= 0) return IDENTITY;
  const sx = (zoneW - padding * 2) / imgW;
  const sy = (zoneH - padding * 2) / imgH;
  const scale = Math.min(sx, sy, 1);
  const panX = (zoneW - imgW * scale) / 2;
  const panY = (zoneH - imgH * scale) / 2;
  return { scale, panX, panY };
}

// Fit an arbitrary axis-aligned bbox (image-space coords) into a zone. Used
// when no image is loaded but regions exist — we still want to show them.
export function fitBboxToZone(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  zoneW: number,
  zoneH: number,
  padding = 24,
): Viewport {
  const w = maxX - minX,
    h = maxY - minY;
  if (w <= 0 || h <= 0 || zoneW <= 0 || zoneH <= 0) return IDENTITY;
  const sx = (zoneW - padding * 2) / w;
  const sy = (zoneH - padding * 2) / h;
  const scale = Math.min(sx, sy, 1);
  const panX = (zoneW - w * scale) / 2 - minX * scale;
  const panY = (zoneH - h * scale) / 2 - minY * scale;
  return { scale, panX, panY };
}

export function clampScale(s: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

// Zoom around a screen point keeping the image point under the cursor stable.
export function zoomAroundPoint(
  vp: Viewport,
  screenX: number,
  screenY: number,
  factor: number,
): Viewport {
  const newScale = clampScale(vp.scale * factor);
  if (newScale === vp.scale) return vp;
  // imagePoint = (screen - pan) / scale ; pan' = screen - imagePoint * scale'
  const ix = (screenX - vp.panX) / vp.scale;
  const iy = (screenY - vp.panY) / vp.scale;
  return {
    scale: newScale,
    panX: screenX - ix * newScale,
    panY: screenY - iy * newScale,
  };
}

export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, panX: vp.panX + dx, panY: vp.panY + dy };
}
