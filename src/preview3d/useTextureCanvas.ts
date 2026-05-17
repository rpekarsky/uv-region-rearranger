import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../store';
import { renderInverse } from '../render/pipeline';
import { useThrottledValue } from './useThrottledValue';

export type TextureSource = HTMLImageElement | HTMLCanvasElement;

export interface TextureSourceResult {
  source: TextureSource | null;
  // Opaque identity that changes whenever the texture content might have
  // changed. Consumer uses it as a useEffect dep to call texture.needsUpdate.
  // Without this, the persistent canvas's identity stays stable and downstream
  // effects never re-fire.
  key: unknown;
}

const THROTTLE_MS = 500;

export function useTextureCanvas(): TextureSourceResult {
  // Persistent reusable canvas — created once per mount, reused across
  // renderInverse calls to avoid ~64MB alloc/copy churn each pass.
  const [reuseCanvas] = useState(() => document.createElement('canvas'));

  const originalImage = useEditorStore((s) => s.originalImage);
  const transformedImage = useEditorStore((s) => s.transformedImage);
  const liveParams = useEditorStore(
    useShallow((s) => ({
      regions: s.regions,
      bgFill: s.bgFill,
      regionsOnlyView: s.regionsOnlyView,
      regionImageSize: s.regionImageSize,
      originalCanvasSize: s.originalCanvasSize,
    })),
  );
  const params = useThrottledValue(liveParams, THROTTLE_MS);

  return useMemo(() => {
    if (transformedImage) {
      renderInverse(
        transformedImage,
        params.regions,
        params.bgFill,
        params.regionsOnlyView,
        params.originalCanvasSize ?? params.regionImageSize,
        reuseCanvas,
      );
      return { source: reuseCanvas, key: params };
    }
    if (originalImage) return { source: originalImage, key: originalImage };
    return { source: null, key: null };
  }, [originalImage, transformedImage, params, reuseCanvas]);
}
