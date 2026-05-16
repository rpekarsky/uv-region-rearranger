import type { HandleKey, Matrix, Polygon, Vec2 } from '../types';
import { bbox } from './polygon';
import { applyPoint } from './transform';

// Screen-space sizes — multiplied by pxScale (= 1/viewport.scale) at call time
// so that handles, padding and rotation tether stay a constant CSS-pixel size
// regardless of the user's zoom.
const HANDLE_PADDING_SCREEN_PX = 10;
const ROTATION_HANDLE_OFFSET_SCREEN_PX = 30;

export type HandleMap = Record<HandleKey | 'center', Vec2>;

// Computes handle positions in SOURCE space, but pre-divided by M's per-axis
// effective scale so that after the caller applies M the padding/rotation-tether
// length lands at a constant screen-px size — independent of the region's
// transform.scale. Without this compensation, scaled regions get visually
// shrunken/expanded handle frames.
//
// For pure rotation OR rotation+uniform-scale this is exact. For non-uniform
// scale combined with rotation it's a close approximation (rotation mixes the
// axes, so per-axis division can't be perfect — but the error is small for
// typical UV-editing transforms).
export function getHandles(polygon: Polygon, M: Matrix, pxScale: number): HandleMap {
  // |M * x_axis| and |M * y_axis| — how many output-units per source-unit.
  const sx = Math.hypot(M[0], M[1]) || 1;
  const sy = Math.hypot(M[2], M[3]) || 1;
  const padX = (HANDLE_PADDING_SCREEN_PX * pxScale) / sx;
  const padY = (HANDLE_PADDING_SCREEN_PX * pxScale) / sy;
  const rotOff = (ROTATION_HANDLE_OFFSET_SCREEN_PX * pxScale) / sy;
  const { minX, minY, maxX, maxY } = bbox(polygon);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    nw: [minX - padX, minY - padY],
    ne: [maxX + padX, minY - padY],
    se: [maxX + padX, maxY + padY],
    sw: [minX - padX, maxY + padY],
    n: [cx, minY - padY],
    s: [cx, maxY + padY],
    w: [minX - padX, cy],
    e: [maxX + padX, cy],
    rotation: [cx, minY - padY - rotOff],
    center: [cx, cy],
  };
}

const HANDLE_KEYS: HandleKey[] = ['nw', 'ne', 'se', 'sw', 'n', 's', 'w', 'e', 'rotation'];

export function hitTestHandle(
  screenPoint: Vec2,
  polygon: Polygon,
  M: Matrix,
  threshold: number,
  pxScale: number,
): HandleKey | null {
  const handles = getHandles(polygon, M, pxScale);
  for (const key of HANDLE_KEYS) {
    const [hx, hy] = applyPoint(M, handles[key]);
    if (Math.hypot(hx - screenPoint[0], hy - screenPoint[1]) <= threshold) return key;
  }
  return null;
}

const OPPOSITES: Record<Exclude<HandleKey, 'rotation'>, HandleKey> = {
  nw: 'se',
  ne: 'sw',
  se: 'nw',
  sw: 'ne',
  n: 's',
  s: 'n',
  w: 'e',
  e: 'w',
};

export function getOppositeHandle(key: HandleKey): HandleKey {
  if (key === 'rotation') return 'rotation';
  return OPPOSITES[key];
}

export function isEdgeHandle(key: HandleKey): boolean {
  return key === 'n' || key === 's' || key === 'w' || key === 'e';
}
