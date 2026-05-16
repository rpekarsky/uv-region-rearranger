import type { Polygon, Vec2 } from '../types';

export function centroid(polygon: Polygon): Vec2 {
  let cx = 0,
    cy = 0;
  for (const [x, y] of polygon) {
    cx += x;
    cy += y;
  }
  const n = polygon.length;
  return [cx / n, cy / n];
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bbox(polygon: Polygon): BBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBbox(polygons: readonly Polygon[]): BBox | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let any = false;
  for (const poly of polygons) {
    for (const [x, y] of poly) {
      any = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

export function pointInPolygon(point: Vec2, polygon: Polygon): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function distancePoint(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax,
    dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distancePoint(p, a);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function nearestVertex(point: Vec2, polygon: Polygon, threshold: number): number {
  let bestIdx = -1;
  let bestDist = threshold;
  for (let i = 0; i < polygon.length; i++) {
    const d = distancePoint(point, polygon[i]);
    if (d <= bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export interface EdgeHit {
  edgeIndex: number;
  t: number;
  point: Vec2;
}

export function nearestEdge(point: Vec2, polygon: Polygon, threshold: number): EdgeHit | null {
  let best: (EdgeHit & { dist: number }) | null = null;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const d = distanceToSegment(point, a, b);
    if (d <= threshold && (best === null || d < best.dist)) {
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const lenSq = dx * dx + dy * dy;
      let t = lenSq === 0 ? 0 : ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      best = {
        edgeIndex: i,
        t,
        dist: d,
        point: [a[0] + t * dx, a[1] + t * dy],
      };
    }
  }
  if (!best) return null;
  return { edgeIndex: best.edgeIndex, t: best.t, point: best.point };
}
