import { describe, expect, it } from 'vitest';
import type { Region, Vec2 } from '../types';
import { serializeRegionsForCache } from './helpers';

const mkRegion = (over: Partial<Region> = {}): Region => ({
  id: 'r1',
  name: '1',
  polygon: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  transform: {
    translate: [0, 0],
    rotation: 0,
    scale: [1, 1],
    skew: [0, 0],
    pivot: [5, 5],
  },
  ...over,
});

describe('serializeRegionsForCache', () => {
  // Locks in C-1 from the 2026-05-09 review: vertex drag must invalidate the
  // inverse-render cache. Polygon vertex coords MUST be in the key.
  it('changes when a single vertex moves (id and length unchanged)', () => {
    const a = mkRegion();
    const b = mkRegion({
      polygon: [
        [0, 0],
        [10, 0],
        [10, 11], // moved one vertex
        [0, 10],
      ],
    });
    expect(serializeRegionsForCache([a])).not.toBe(serializeRegionsForCache([b]));
  });

  it('changes on transform edits', () => {
    const a = mkRegion();
    expect(serializeRegionsForCache([a])).not.toBe(
      serializeRegionsForCache([
        mkRegion({
          transform: { ...a.transform, translate: [1, 0] as Vec2 },
        }),
      ]),
    );
    expect(serializeRegionsForCache([a])).not.toBe(
      serializeRegionsForCache([mkRegion({ transform: { ...a.transform, rotation: 0.01 } })]),
    );
  });

  it('stable for structurally identical inputs', () => {
    expect(serializeRegionsForCache([mkRegion()])).toBe(serializeRegionsForCache([mkRegion()]));
  });
});
