import type { Matrix, Transform, Vec2, Polygon } from '../types';

export function identity(): Matrix {
  return [1, 0, 0, 1, 0, 0];
}

export function translate(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

export function rotate(theta: number): Matrix {
  const c = Math.cos(theta),
    s = Math.sin(theta);
  return [c, s, -s, c, 0, 0];
}

export function scale(sx: number, sy: number): Matrix {
  return [sx, 0, 0, sy, 0, 0];
}

// Shear matrix [[1, sx], [sy, 1]]; applied to (x, y) gives (x + sx*y, y + sy*x).
export function skew(sx: number, sy: number): Matrix {
  return [1, sy, sx, 1, 0, 0];
}

// M · N (apply N first, then M, when transforming a point)
export function multiply(M: Matrix, N: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = M;
  const [a2, b2, c2, d2, e2, f2] = N;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function applyPoint(M: Matrix, p: Vec2): Vec2 {
  const [x, y] = p;
  return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
}

export function applyPolygon(M: Matrix, polygon: Polygon): Vec2[] {
  return polygon.map((p) => applyPoint(M, p));
}

export function invert(M: Matrix): Matrix {
  const [a, b, c, d, e, f] = M;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error('Singular matrix');
  const inv = 1 / det;
  return [d * inv, -b * inv, -c * inv, a * inv, (c * f - d * e) * inv, (b * e - a * f) * inv];
}

// M = T(translate) · T(pivot) · R(rotation) · Skew(skew) · S(scale) · T(-pivot)
export function buildRegionMatrix(t: Transform): Matrix {
  const [tx, ty] = t.translate;
  const [sx, sy] = t.scale;
  const [skX, skY] = t.skew;
  const [px, py] = t.pivot;

  let M = translate(-px, -py);
  M = multiply(scale(sx, sy), M);
  M = multiply(skew(skX, skY), M);
  M = multiply(rotate(t.rotation), M);
  M = multiply(translate(px, py), M);
  M = multiply(translate(tx, ty), M);
  return M;
}

export function isIdentityTransform(t: Transform): boolean {
  return (
    t.translate[0] === 0 &&
    t.translate[1] === 0 &&
    t.rotation === 0 &&
    t.scale[0] === 1 &&
    t.scale[1] === 1 &&
    t.skew[0] === 0 &&
    t.skew[1] === 0
  );
}

// Compensate `transform` so the rendered output stays in place when the source
// polygon is translated by `d`. Exact: M_new(v + d) == M_old(v) for all v.
export function compensateSourceTranslate(t: Transform, d: Vec2): Transform {
  return {
    translate: [t.translate[0] - d[0], t.translate[1] - d[1]],
    rotation: t.rotation,
    scale: [t.scale[0], t.scale[1]],
    skew: [t.skew[0], t.skew[1]],
    pivot: [t.pivot[0] + d[0], t.pivot[1] + d[1]],
  };
}

// Compensate `transform` for source rotation by `theta` around source-space
// pivot `c`. Exact when the existing scale is uniform; lossy (best-fit
// decomposition) when non-uniform — the unrepresentable shear gets dropped.
export function compensateSourceRotate(t: Transform, c: Vec2, theta: number): Transform {
  const [sx, sy] = t.scale;
  const cosA = Math.cos(t.rotation),
    sinA = Math.sin(t.rotation);
  const cosT = Math.cos(-theta),
    sinT = Math.sin(-theta);
  // R(rotation) * diag(scale)
  const a1 = cosA * sx,
    b1 = -sinA * sy;
  const c1 = sinA * sx,
    d1 = cosA * sy;
  // ... * R(-theta)
  const a = a1 * cosT + b1 * sinT;
  const b = -a1 * sinT + b1 * cosT;
  const c2 = c1 * cosT + d1 * sinT;
  const d = -c1 * sinT + d1 * cosT;
  const newRotation = Math.atan2(c2, a);
  const cs = Math.cos(newRotation),
    sn = Math.sin(newRotation);
  const newScaleX = cs * a + sn * c2;
  const newScaleY = -sn * b + cs * d;
  // M_old(c) - c
  const M = buildRegionMatrix(t);
  const Mc = applyPoint(M, c);
  return {
    translate: [Mc[0] - c[0], Mc[1] - c[1]],
    rotation: newRotation,
    scale: [newScaleX, newScaleY],
    skew: [t.skew[0], t.skew[1]],
    pivot: [c[0], c[1]],
  };
}

// Compensate `transform` for source scaling by (sxOp, syOp) around source-space
// pivot `c`. Exact: R*Skew*S*diag(1/sxOp, 1/syOp) factors cleanly as R*Skew*S'
// (S and diag are both diagonal so they commute).
export function compensateSourceScale(
  t: Transform,
  c: Vec2,
  sxOp: number,
  syOp: number,
): Transform {
  const M = buildRegionMatrix(t);
  const Mc = applyPoint(M, c);
  const sxNew = Math.abs(sxOp) > 1e-12 ? t.scale[0] / sxOp : t.scale[0];
  const syNew = Math.abs(syOp) > 1e-12 ? t.scale[1] / syOp : t.scale[1];
  return {
    translate: [Mc[0] - c[0], Mc[1] - c[1]],
    rotation: t.rotation,
    scale: [sxNew, syNew],
    skew: [t.skew[0], t.skew[1]],
    pivot: [c[0], c[1]],
  };
}
