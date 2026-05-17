import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../store';
import { renderInverse } from '../render/pipeline';

export type TextureSource = HTMLImageElement | HTMLCanvasElement;

export interface TextureSourceResult {
  source: TextureSource | null;
  // Opaque identity that changes whenever the texture content might have
  // changed. Consumer uses it as a useEffect dep to call texture.needsUpdate.
  // Without this, the persistent canvas's identity stays stable and downstream
  // effects never re-fire.
  key: unknown;
}

const EMPTY_RESULT: TextureSourceResult = { source: null, key: null };

export function useTextureCanvas(): TextureSourceResult {
  // Persistent reusable canvas — created once per mount, reused across
  // renderInverse calls to avoid alloc/copy churn each pass.
  const [reuseCanvas] = useState(() => document.createElement('canvas'));
  const [result, setResult] = useState<TextureSourceResult>(EMPTY_RESULT);

  const originalImage = useEditorStore((s) => s.originalImage);
  const transformedImage = useEditorStore((s) => s.transformedImage);
  const outputScale = useEditorStore((s) => s.texture3DOutputScale);
  const params = useEditorStore(
    useShallow((s) => ({
      regions: s.regions,
      bgFill: s.bgFill,
      regionsOnlyView: s.regionsOnlyView,
      regionImageSize: s.regionImageSize,
      originalCanvasSize: s.originalCanvasSize,
    })),
  );

  // Defer all work to rAF — keeps renderInverse out of React's render phase
  // so input handlers don't queue behind a heavy Canvas2D pass. rAF cleanup
  // coalesces rapid changes into one render per frame.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (transformedImage) {
        renderInverse(
          transformedImage,
          params.regions,
          params.bgFill,
          params.regionsOnlyView,
          params.originalCanvasSize ?? params.regionImageSize,
          reuseCanvas,
          outputScale,
        );
        setResult({ source: reuseCanvas, key: {} });
        return;
      }
      if (originalImage) {
        setResult({ source: originalImage, key: originalImage });
        return;
      }
      setResult(EMPTY_RESULT);
    });
    return () => cancelAnimationFrame(raf);
  }, [originalImage, transformedImage, params, outputScale, reuseCanvas]);

  return result;
}
