import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../store';
import type { LoadedModel } from './types';
import type { Viewport } from '../types';

interface Props {
  viewport: Viewport;
  containerW: number;
  containerH: number;
  imageW: number;
  imageH: number;
  // Lets the parent register the underlying canvas so other consumers
  // (e.g. Loupe) can composite this layer on top of their own source.
  onCanvasReady?: (el: HTMLCanvasElement | null) => void;
}

// Per-material Path2D of triangle outlines. Triangles whose UVs lie outside
// [0,1] (kn5 detail-UVs) are wrapped to their canonical tile by subtracting
// floor(minU)/floor(minV) from all three vertices at once.
function buildUvPaths(
  model: LoadedModel,
  materials: readonly string[],
  imageW: number,
  imageH: number,
): Map<string, Path2D> {
  const paths = new Map<string, Path2D>();
  for (const mat of materials) {
    const meshes = model.meshesByMaterial.get(mat);
    if (!meshes) continue;
    const path = new Path2D();
    let any = false;
    for (const m of meshes) {
      const uvAttr = m.geometry.attributes.uv as { array: ArrayLike<number> } | undefined;
      if (!uvAttr) continue;
      const uv = uvAttr.array;
      const idxAttr = m.geometry.index as { array: ArrayLike<number> } | null | undefined;
      // Indexed (GLB/kn5 typical): triangles read from `index`.
      // Non-indexed (FBXLoader typical): every 3 consecutive UV pairs form one triangle.
      const triCount = idxAttr ? Math.floor(idxAttr.array.length / 3) : Math.floor(uv.length / 6);
      for (let t = 0; t < triCount; t++) {
        const i0 = idxAttr ? idxAttr.array[t * 3] : t * 3;
        const i1 = idxAttr ? idxAttr.array[t * 3 + 1] : t * 3 + 1;
        const i2 = idxAttr ? idxAttr.array[t * 3 + 2] : t * 3 + 2;
        const a = i0 * 2;
        const b = i1 * 2;
        const c = i2 * 2;
        const ua = uv[a],
          va = uv[a + 1];
        const ub = uv[b],
          vb = uv[b + 1];
        const uc = uv[c],
          vc = uv[c + 1];
        const offU = Math.floor(Math.min(ua, ub, uc));
        const offV = Math.floor(Math.min(va, vb, vc));
        const ax = (ua - offU) * imageW;
        const ay = (va - offV) * imageH;
        const bx = (ub - offU) * imageW;
        const by = (vb - offV) * imageH;
        const cx = (uc - offU) * imageW;
        const cy = (vc - offV) * imageH;
        path.moveTo(ax, ay);
        path.lineTo(bx, by);
        path.lineTo(cx, cy);
        path.closePath();
        any = true;
      }
    }
    if (any) paths.set(mat, path);
  }
  return paths;
}

function materialColorCss(model: LoadedModel, matName: string, alpha: number): string {
  const placeholder = model.placeholderMaterials.get(matName);
  if (!placeholder) return `rgba(0, 220, 255, ${alpha})`;
  const { r, g, b } = placeholder.color;
  return `rgba(${(r * 255) | 0}, ${(g * 255) | 0}, ${(b * 255) | 0}, ${alpha})`;
}

export function UvOverlay({
  viewport,
  containerW,
  containerH,
  imageW,
  imageH,
  onCanvasReady,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { model3d, selectedMaterialIds, showUvOverlay, uvOverlayOpacity } = useEditorStore(
    useShallow((s) => ({
      model3d: s.model3d,
      selectedMaterialIds: s.selectedMaterialIds,
      showUvOverlay: s.showUvOverlay,
      uvOverlayOpacity: s.uvOverlayOpacity,
    })),
  );

  const paths = useMemo(() => {
    if (!showUvOverlay || !model3d || imageW <= 0 || imageH <= 0) return null;
    if (selectedMaterialIds.length === 0) return null;
    return buildUvPaths(model3d, selectedMaterialIds, imageW, imageH);
  }, [showUvOverlay, model3d, selectedMaterialIds, imageW, imageH]);

  // Canvas-pixel coordinates match the sibling backdrop/overlay canvases (no
  // DPR multiplier) so consumers like Loupe can drawImage from the same source
  // rect without re-scaling. Trade-off: lines render at native CSS-pixel
  // resolution rather than retina-crisp — acceptable for a translucent wire.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const w = Math.max(1, Math.floor(containerW));
    const h = Math.max(1, Math.floor(containerH));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!paths || !model3d) return;

    ctx.translate(viewport.panX, viewport.panY);
    ctx.scale(viewport.scale, viewport.scale);
    ctx.lineWidth = 0.2 / viewport.scale;
    for (const [matName, path] of paths) {
      ctx.strokeStyle = materialColorCss(model3d, matName, uvOverlayOpacity);
      ctx.stroke(path);
    }
  }, [
    paths,
    model3d,
    uvOverlayOpacity,
    viewport.panX,
    viewport.panY,
    viewport.scale,
    containerW,
    containerH,
  ]);

  useEffect(() => {
    onCanvasReady?.(canvasRef.current);
    return () => onCanvasReady?.(null);
  }, [onCanvasReady]);

  return <canvas ref={canvasRef} className="canvas-uv-overlay" />;
}
