import { describe, expect, it } from 'vitest';
import type { Transform, Vec2 } from '../types';
import {
  applyPoint,
  buildRegionMatrix,
  compensateSourceRotate,
  compensateSourceScale,
  compensateSourceTranslate,
  identity,
  invert,
  isIdentityTransform,
  multiply,
  rotate,
  scale,
  translate,
} from './transform';

const identityT = (): Transform => ({
  translate: [0, 0],
  rotation: 0,
  scale: [1, 1],
  skew: [0, 0],
  pivot: [0, 0],
});

const sample = (over: Partial<Transform> = {}): Transform => ({ ...identityT(), ...over });

const expectVecClose = (a: Vec2, b: Vec2): void => {
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(a[1]).toBeCloseTo(b[1], 9);
};

describe('matrix primitives', () => {
  it('identity is the multiplicative neutral', () => {
    const M = scale(2, 3);
    expect(multiply(identity(), M)).toEqual(M);
    expect(multiply(M, identity())).toEqual(M);
  });

  it('invert undoes', () => {
    const M = multiply(translate(5, 7), multiply(rotate(0.7), scale(2, 1.5)));
    const Minv = invert(M);
    const p: Vec2 = [3, -4];
    expectVecClose(applyPoint(Minv, applyPoint(M, p)), p);
  });

  it('throws on singular matrix', () => {
    expect(() => invert([0, 0, 0, 0, 0, 0])).toThrow('Singular');
  });
});

describe('buildRegionMatrix', () => {
  it('identity transform yields identity-acting matrix', () => {
    const M = buildRegionMatrix(identityT());
    const p: Vec2 = [123, -45];
    expectVecClose(applyPoint(M, p), p);
  });

  it('pivot is the fixed point of pure rotation/scale', () => {
    const piv: Vec2 = [10, 20];
    const M1 = buildRegionMatrix(sample({ rotation: 0.9, pivot: piv }));
    const M2 = buildRegionMatrix(sample({ scale: [2, 3], pivot: piv }));
    expectVecClose(applyPoint(M1, piv), piv);
    expectVecClose(applyPoint(M2, piv), piv);
  });

  it('translate moves by the exact amount when scale=1, rotation=0', () => {
    const M = buildRegionMatrix(sample({ translate: [7, -3] }));
    expectVecClose(applyPoint(M, [0, 0]), [7, -3]);
    expectVecClose(applyPoint(M, [10, 10]), [17, 7]);
  });
});

describe('compensateSourceTranslate', () => {
  // Invariant: M_new(v + d) == M_old(v)
  it('preserves rendered point under source translation', () => {
    const t = sample({
      translate: [50, -20],
      rotation: 0.4,
      scale: [1.3, 0.7],
      skew: [0.1, 0],
      pivot: [100, 80],
    });
    const d: Vec2 = [15, -25];
    const tNew = compensateSourceTranslate(t, d);
    const Mold = buildRegionMatrix(t);
    const Mnew = buildRegionMatrix(tNew);

    // Several arbitrary source points
    for (const v of [
      [0, 0],
      [50, 50],
      [-30, 100],
      [200, -10],
    ] as Vec2[]) {
      const moved: Vec2 = [v[0] + d[0], v[1] + d[1]];
      expectVecClose(applyPoint(Mnew, moved), applyPoint(Mold, v));
    }
  });
});

describe('compensateSourceScale', () => {
  // Invariant: M_new(scaledV) == M_old(v) where scaledV is v scaled around c by (sxOp, syOp)
  it('preserves rendered point under source scale around pivot c', () => {
    const t = sample({
      translate: [10, 5],
      rotation: 0.3,
      scale: [2, 1.5],
      pivot: [40, 40],
    });
    const c: Vec2 = [50, 50];
    const sxOp = -1; // horizontal flip around c
    const syOp = 1;
    const tNew = compensateSourceScale(t, c, sxOp, syOp);
    const Mold = buildRegionMatrix(t);
    const Mnew = buildRegionMatrix(tNew);

    for (const v of [
      [0, 0],
      [50, 50],
      [80, 30],
      [-10, 70],
    ] as Vec2[]) {
      const scaled: Vec2 = [c[0] + (v[0] - c[0]) * sxOp, c[1] + (v[1] - c[1]) * syOp];
      expectVecClose(applyPoint(Mnew, scaled), applyPoint(Mold, v));
    }
  });

  it('handles non-uniform scale around c', () => {
    const t = sample({ rotation: 0.2, scale: [1, 1], pivot: [0, 0] });
    const c: Vec2 = [25, 25];
    const tNew = compensateSourceScale(t, c, 2, 0.5);
    const Mold = buildRegionMatrix(t);
    const Mnew = buildRegionMatrix(tNew);
    for (const v of [
      [0, 0],
      [25, 25],
      [60, 10],
    ] as Vec2[]) {
      const scaled: Vec2 = [c[0] + (v[0] - c[0]) * 2, c[1] + (v[1] - c[1]) * 0.5];
      expectVecClose(applyPoint(Mnew, scaled), applyPoint(Mold, v));
    }
  });
});

describe('compensateSourceRotate', () => {
  // Exact only when scale is uniform — that's the case under test.
  it('preserves rendered point under source rotation around c (uniform scale)', () => {
    const t = sample({
      translate: [10, 5],
      rotation: 0.6,
      scale: [1.4, 1.4],
      pivot: [30, 30],
    });
    const c: Vec2 = [40, 60];
    const theta = 0.5;
    const tNew = compensateSourceRotate(t, c, theta);
    const Mold = buildRegionMatrix(t);
    const Mnew = buildRegionMatrix(tNew);
    const cosT = Math.cos(theta),
      sinT = Math.sin(theta);
    for (const v of [
      [0, 0],
      [40, 60],
      [80, 10],
      [-15, 90],
    ] as Vec2[]) {
      const dx = v[0] - c[0],
        dy = v[1] - c[1];
      const rotated: Vec2 = [c[0] + dx * cosT - dy * sinT, c[1] + dx * sinT + dy * cosT];
      const after = applyPoint(Mnew, rotated);
      const before = applyPoint(Mold, v);
      expect(after[0]).toBeCloseTo(before[0], 6);
      expect(after[1]).toBeCloseTo(before[1], 6);
    }
  });
});

describe('isIdentityTransform', () => {
  it('true for default', () => {
    expect(isIdentityTransform(identityT())).toBe(true);
  });
  it('false on any single non-default field', () => {
    expect(isIdentityTransform(sample({ translate: [1, 0] }))).toBe(false);
    expect(isIdentityTransform(sample({ rotation: 0.001 }))).toBe(false);
    expect(isIdentityTransform(sample({ scale: [1, -1] }))).toBe(false);
    expect(isIdentityTransform(sample({ skew: [0.1, 0] }))).toBe(false);
  });
});
