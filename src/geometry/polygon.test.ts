import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../types';
import {
  bbox,
  centroid,
  distancePoint,
  distanceToSegment,
  nearestEdge,
  nearestVertex,
  pointInPolygon,
  unionBbox,
} from './polygon';

const square: Vec2[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('centroid', () => {
  it('square mean', () => {
    expect(centroid(square)).toEqual([5, 5]);
  });
});

describe('bbox', () => {
  it('returns extents', () => {
    expect(bbox(square)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });
});

describe('unionBbox', () => {
  it('null on empty input', () => {
    expect(unionBbox([])).toBeNull();
    expect(unionBbox([[]])).toBeNull();
  });
  it('joins multiple polygons', () => {
    const a: Vec2[] = [
      [0, 0],
      [5, 5],
    ];
    const b: Vec2[] = [
      [-3, 7],
      [12, 1],
    ];
    expect(unionBbox([a, b])).toEqual({ minX: -3, minY: 0, maxX: 12, maxY: 7 });
  });
});

describe('pointInPolygon', () => {
  it('inside', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
  });
  it('outside', () => {
    expect(pointInPolygon([15, 5], square)).toBe(false);
    expect(pointInPolygon([-1, 5], square)).toBe(false);
  });
});

describe('distance helpers', () => {
  it('distancePoint', () => {
    expect(distancePoint([0, 0], [3, 4])).toBe(5);
  });
  it('distanceToSegment — perpendicular foot inside', () => {
    expect(distanceToSegment([5, 3], [0, 0], [10, 0])).toBe(3);
  });
  it('distanceToSegment — clamps to endpoint when outside', () => {
    expect(distanceToSegment([-5, 0], [0, 0], [10, 0])).toBe(5);
    expect(distanceToSegment([15, 0], [0, 0], [10, 0])).toBe(5);
  });
  it('distanceToSegment — degenerate segment falls back to endpoint distance', () => {
    expect(distanceToSegment([3, 4], [0, 0], [0, 0])).toBe(5);
  });
});

describe('nearestVertex', () => {
  it('returns index when within threshold', () => {
    expect(nearestVertex([0.5, 0.5], square, 2)).toBe(0);
  });
  it('returns -1 when no vertex within threshold', () => {
    expect(nearestVertex([100, 100], square, 5)).toBe(-1);
  });
});

describe('nearestEdge', () => {
  it('finds the closest edge with t parameter and projected point', () => {
    const hit = nearestEdge([5, 1], square, 2);
    expect(hit).not.toBeNull();
    expect(hit!.edgeIndex).toBe(0);
    expect(hit!.t).toBeCloseTo(0.5);
    expect(hit!.point[0]).toBeCloseTo(5);
    expect(hit!.point[1]).toBeCloseTo(0);
  });
  it('returns null when no edge within threshold', () => {
    expect(nearestEdge([100, 100], square, 5)).toBeNull();
  });
});
