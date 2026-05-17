import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useResizeObserver } from 'usehooks-ts';
import { toast } from 'sonner';
import type { ZoneSide } from '../types';
import { useEditorStore } from '../store';
import { drawLeftBackdrop, drawLeftOverlay } from '../render/leftPreview';
import { drawRightBackdrop, drawRightOverlay } from '../render/rightPreview';
import { fitBboxToZone, fitToZone } from './viewport';
import { applyPolygon, buildRegionMatrix } from '../geometry/transform';
import { unionBbox } from '../geometry/polygon';
import {
  downloadCanvas,
  imageToCanvas,
  loadImageFromFile,
  loadJSONFromFile,
  parseConfig,
} from '../io/storage';
import { renderForward, renderInverse, renderRegionMap } from '../render/pipeline';
import {
  onCanvasDblClick,
  onCanvasDrawingMove,
  onCanvasHover,
  onCanvasMouseDown,
  onWheel,
  registerCanvas,
} from './interactions';
import { Loupe, type LoupePolyline } from './Loupe';
import type { Vec2 } from '../types';

interface Props {
  side: ZoneSide;
}

// Pause backdrop redraws while any drag interaction is active so the heavy
// image / derive* path doesn't run per-frame. The overlay still updates
// every frame (it's cheap), so the user sees live polygon outlines even
// though the rendered transformed view is frozen until drag-end.
function isDragModeKind(kind: string): boolean {
  return (
    kind === 'dragTranslate' ||
    kind === 'dragVertex' ||
    kind === 'dragRotate' ||
    kind === 'dragScale' ||
    kind === 'dragSourceTranslate' ||
    kind === 'dragSourceRotate' ||
    kind === 'dragSourceScale'
  );
}

export function CanvasZone({ side }: Props) {
  // Backdrop canvas tracked as state via callback ref — we read it during
  // render to forward to <Loupe sourceCanvas>, which the new react-hooks
  // rule (rightly) flags if done from a useRef. State+callback-ref triggers
  // a render when the canvas attaches, keeping consumers in sync.
  const [backdropCanvas, setBackdropCanvas] = useState<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const params = useEditorStore(
    useShallow((s) => ({
      originalImage: s.originalImage,
      transformedImage: s.transformedImage,
      regions: s.regions,
      selectedRegionId: s.selectedRegionId,
      mode: s.mode,
      bgFill: s.bgFill,
      regionsOnlyView: s.regionsOnlyView,
      regionImageSize: s.regionImageSize,
      outputCanvasSize: s.outputCanvasSize,
      originalCanvasSize: s.originalCanvasSize,
      viewport: side === 'left' ? s.leftViewport : s.rightViewport,
      hoveredHandle: s.hoveredHandle,
      hoveredVertex: s.hoveredVertex,
      loupeAlwaysOn: s.loupeAlwaysOn,
      showRegionNames: s.showRegionNames,
      rightVertexEditUnlocked: s.rightVertexEditUnlocked,
    })),
  );

  const setViewport = useEditorStore(
    side === 'left' ? (s) => s.setLeftViewport : (s) => s.setRightViewport,
  );
  const setOriginalImage = useEditorStore((s) => s.setOriginalImage);
  const setTransformedImage = useEditorStore((s) => s.setTransformedImage);
  const loadConfig = useEditorStore((s) => s.loadConfig);

  // ---- canvas registration for window-level drag handlers ----
  // The OVERLAY canvas is the one that receives mouse events; that's also what
  // window-level handlers use for getBoundingClientRect / clientToImage math.
  useEffect(() => {
    registerCanvas(side, overlayCanvasRef.current);
    return () => registerCanvas(side, null);
  }, [side]);

  // ---- size both canvas backing stores to the visible CSS pixel size ----
  const containerSize = useResizeObserver({
    ref: containerRef as React.RefObject<HTMLDivElement>,
    box: 'border-box',
  });
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const w = Math.max(1, Math.floor(containerSize.width ?? container.clientWidth));
    const h = Math.max(1, Math.floor(containerSize.height ?? container.clientHeight));
    for (const canvas of [backdropCanvas, overlayCanvasRef.current]) {
      if (!canvas) continue;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }
  }, [containerSize.width, containerSize.height, backdropCanvas]);

  // ---- fit-to-zone for this side ----
  // Per-side native image: left = original, right = transformed. The "other"
  // image doesn't dictate the zone size since each zone may render at a
  // different canonical (source vs output canvas) size.
  const nativeImageSrc =
    (side === 'left' ? params.originalImage : params.transformedImage)?.src ?? null;
  // Per-side canonical size when no native image is loaded:
  //   left  → regionImageSize (deriveInverse outputs at this)
  //   right → outputCanvasSize ?? regionImageSize (deriveForward outputs at this)
  const canonicalSize: [number, number] | null =
    side === 'left'
      ? (params.originalCanvasSize ?? params.regionImageSize)
      : (params.outputCanvasSize ?? params.regionImageSize);
  const canonicalKey = canonicalSize?.join('x') ?? null;
  const hasContent = params.regions.length > 0;
  // Fit-to-zone only fires once per zone lifetime. Otherwise: auto-fit would
  // clobber user-restored viewport on async image load (IDB cache) and would
  // re-fit when content first appears (drawing first region), undoing pan/zoom.
  // If a non-default viewport is already in the store on mount (restored from
  // localStorage), skip the initial fit too.
  // Capture the viewport once at mount via lazy useState — reading a ref's
  // .current during render is flagged by react-hooks/refs, and a constant
  // captured at mount is conceptually a useState value, not a mutable ref.
  const [initialVp] = useState(() => params.viewport);
  const hasFitRef = useRef(initialVp.scale !== 1 || initialVp.panX !== 0 || initialVp.panY !== 0);
  useLayoutEffect(() => {
    if (hasFitRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (nativeImageSrc) {
      hasFitRef.current = true;
      const img = new Image();
      img.onload = () => {
        setViewport(fitToZone(img.naturalWidth, img.naturalHeight, rect.width, rect.height));
      };
      img.src = nativeImageSrc;
      return;
    }
    if (canonicalSize) {
      hasFitRef.current = true;
      setViewport(fitToZone(canonicalSize[0], canonicalSize[1], rect.width, rect.height));
      return;
    }
    if (!hasContent) return;
    const polys: [number, number][][] = [];
    if (side === 'left') {
      for (const r of params.regions) polys.push(r.polygon.map((p) => [p[0], p[1]]));
    } else {
      for (const r of params.regions) {
        const M = buildRegionMatrix(r.transform);
        polys.push(applyPolygon(M, r.polygon).map((p) => [p[0], p[1]]));
      }
    }
    const b = unionBbox(polys);
    if (!b) return;
    hasFitRef.current = true;
    setViewport(fitBboxToZone(b.minX, b.minY, b.maxX, b.maxY, rect.width, rect.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeImageSrc, canonicalKey, hasContent]);

  // ---- backdrop redraw (image / derived render) ----
  // Heavy: full-resolution drawImage and possibly a renderForward/Inverse pass.
  // Frozen during any drag: the user sees the pre-drag rendering plus live
  // vector overlays during interaction; the backdrop catches up on drag-end.
  const isDragging = isDragModeKind(params.mode.kind);
  useEffect(() => {
    if (isDragging) return;
    const canvas = backdropCanvas;
    if (!canvas) return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      if (side === 'left') {
        drawLeftBackdrop(canvas, {
          originalImage: params.originalImage,
          transformedImage: params.transformedImage,
          regions: params.regions,
          bgFill: params.bgFill,
          regionsOnlyView: params.regionsOnlyView,
          regionImageSize: params.regionImageSize,
          originalCanvasSize: params.originalCanvasSize,
          viewport: params.viewport,
        });
      } else {
        drawRightBackdrop(canvas, {
          originalImage: params.originalImage,
          transformedImage: params.transformedImage,
          regions: params.regions,
          bgFill: params.bgFill,
          regionsOnlyView: params.regionsOnlyView,
          outputCanvasSize: params.outputCanvasSize,
          viewport: params.viewport,
        });
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [
    side,
    isDragging,
    backdropCanvas,
    params.originalImage,
    params.transformedImage,
    params.regions,
    params.bgFill,
    params.regionsOnlyView,
    params.regionImageSize,
    params.outputCanvasSize,
    params.originalCanvasSize,
    params.viewport,
    containerSize.width,
    containerSize.height,
  ]);

  // ---- overlay redraw (vector polygons + handles + drawing previews) ----
  // Cheap: redraws on every interaction state change.
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      if (side === 'left') {
        drawLeftOverlay(canvas, {
          originalImage: params.originalImage,
          transformedImage: params.transformedImage,
          regions: params.regions,
          selectedRegionId: params.selectedRegionId,
          mode: params.mode,
          bgFill: params.bgFill,
          viewport: params.viewport,
          hoveredHandle: params.hoveredHandle,
          hoveredVertex: params.hoveredVertex,
          showRegionNames: params.showRegionNames,
        });
      } else {
        drawRightOverlay(canvas, {
          originalImage: params.originalImage,
          transformedImage: params.transformedImage,
          regions: params.regions,
          selectedRegionId: params.selectedRegionId,
          outputCanvasSize: params.outputCanvasSize,
          viewport: params.viewport,
          hoveredHandle: params.hoveredHandle,
          hoveredVertex: params.hoveredVertex,
          showRegionNames: params.showRegionNames,
          rightVertexEditUnlocked: params.rightVertexEditUnlocked,
        });
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [side, params, containerSize.width, containerSize.height]);

  // ---- mouse handlers (attached to the overlay canvas — top of stack) ----
  // Stable per viewport — children that depend on it can pass it through deps
  // without re-binding every render.
  const getImagePoint = useCallback(
    (e: MouseEvent | React.MouseEvent): [number, number] => {
      const canvas = overlayCanvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const vp = params.viewport;
      return [
        (e.clientX - rect.left - vp.panX) / vp.scale,
        (e.clientY - rect.top - vp.panY) / vp.scale,
      ];
    },
    [params.viewport],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) return;
      const point = getImagePoint(e);
      onCanvasMouseDown(side, point, e.clientX, e.clientY, e.button, e.ctrlKey);
    },
    [side, getImagePoint],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const point = getImagePoint(e);
      onCanvasDrawingMove(side, point);
      onCanvasHover(side, point);
      const canvas = overlayCanvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
    },
    [side, getImagePoint],
  );

  const handleMouseLeave = useCallback(() => {
    setCursor(null);
  }, []);

  const handleDblClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const point = getImagePoint(e);
      onCanvasDblClick(side, point);
    },
    [side, getImagePoint],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      onWheel(side, e.clientX - rect.left, e.clientY - rect.top, e.deltaY);
    },
    [side],
  );

  // window-level mousemove/mouseup are bound once in App.tsx (see GlobalDragHandlers).

  // ---- per-zone drag-n-drop ----
  const dragDepth = useRef(0);
  const setDragging = (v: boolean) => {
    const el = containerRef.current;
    if (!el) return;
    el.classList.toggle('dragging', v);
  };
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current--;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      if (file.name.endsWith('.json')) {
        const data = await loadJSONFromFile(file);
        loadConfig(parseConfig(data));
        toast.success(`Loaded ${file.name}`);
      } else {
        const img = await loadImageFromFile(file);
        if (side === 'left') setOriginalImage(img, file.name, file);
        else setTransformedImage(img, file.name, file);
        toast.success(`Loaded ${file.name} → ${side}`);
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const baseImage =
    side === 'left'
      ? (params.originalImage ?? params.transformedImage)
      : (params.transformedImage ?? params.originalImage);

  const label = side === 'left' ? 'Original' : 'Transformed';
  const liveTag =
    side === 'left'
      ? !params.originalImage && params.transformedImage
        ? '(live inverse)'
        : ''
      : !params.transformedImage && params.originalImage
        ? '(live forward)'
        : '';
  const hint = side === 'left' ? 'Drop original image here' : 'Drop transformed image here';

  const handleDownload = () => {
    const fname =
      useEditorStore.getState().originalFilename ??
      useEditorStore.getState().transformedFilename ??
      'uv';
    const baseName = fname.replace(/\.[^.]+$/, '');
    let canvas: HTMLCanvasElement;
    if (side === 'left') {
      if (params.originalImage) canvas = imageToCanvas(params.originalImage);
      else if (params.transformedImage) {
        canvas = renderInverse(
          params.transformedImage,
          params.regions,
          params.bgFill,
          params.regionsOnlyView,
          params.originalCanvasSize ?? params.regionImageSize,
        );
      } else return;
      downloadCanvas(canvas, `${baseName}.original.png`);
      toast.success(`Downloaded ${baseName}.original.png`);
    } else {
      if (params.transformedImage) canvas = imageToCanvas(params.transformedImage);
      else if (params.originalImage) {
        canvas = renderForward(
          params.originalImage,
          params.regions,
          params.bgFill,
          params.regionsOnlyView,
          params.outputCanvasSize,
        );
      } else return;
      downloadCanvas(canvas, `${baseName}.transformed.png`);
      toast.success(`Downloaded ${baseName}.transformed.png`);
    }
  };

  const downloadLabel = side === 'left' ? 'Download original' : 'Download transformed';

  const handleDownloadRegionMap = () => {
    const fname =
      useEditorStore.getState().originalFilename ??
      useEditorStore.getState().transformedFilename ??
      'uv';
    const baseName = fname.replace(/\.[^.]+$/, '');
    const size: [number, number] | null =
      side === 'left'
        ? (params.originalCanvasSize ?? params.regionImageSize)
        : (params.outputCanvasSize ?? params.regionImageSize);
    if (!size) {
      toast.error('Load an image first to determine map size');
      return;
    }
    const space = side === 'left' ? 'source' : 'transformed';
    const canvas = renderRegionMap(
      params.regions,
      params.bgFill,
      size,
      space,
      params.showRegionNames,
    );
    const suffix = side === 'left' ? 'original.region-map' : 'region-map';
    downloadCanvas(canvas, `${baseName}.${suffix}.png`);
    toast.success(`Downloaded ${baseName}.${suffix}.png`);
  };

  const loupePolylines: LoupePolyline[] = (() => {
    const out: LoupePolyline[] = [];
    const mode = params.mode;

    // In-progress drawing / lasso path (left zone only).
    if (
      side === 'left' &&
      (mode.kind === 'drawing' || mode.kind === 'lasso') &&
      mode.points.length > 0
    ) {
      const pts = mode.points;
      const cursorImg = mode.cursor;
      const linePts: Vec2[] = cursorImg ? [...pts, cursorImg] : [...pts];
      out.push({
        points: linePts,
        closed: false,
        color: 'rgba(255,220,80,0.95)',
        width: 1,
        drawVertices: true,
      });
      if (mode.kind === 'drawing' && cursorImg && pts.length >= 2) {
        out.push({
          points: [cursorImg, pts[0]],
          closed: false,
          color: 'rgba(255,220,80,0.5)',
          width: 1,
        });
      }
    }

    // Selected region outline so the user sees nearby edges while editing a vertex.
    if (params.selectedRegionId) {
      const region = params.regions.find((r) => r.id === params.selectedRegionId);
      if (region) {
        const poly: Vec2[] =
          side === 'left'
            ? region.polygon.map((p) => [p[0], p[1]])
            : applyPolygon(buildRegionMatrix(region.transform), region.polygon);
        out.push({
          points: poly,
          closed: true,
          color: 'rgba(120,200,255,0.9)',
          width: 1,
          drawVertices: true,
        });
      }
    }
    return out;
  })();

  return (
    <div
      ref={containerRef}
      className={`canvas-zone canvas-zone-${side}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="zone-label">
        <span className="zone-label-name">{label}</span>
        {liveTag && <span className="zone-label-live">{liveTag}</span>}
      </div>
      <button
        className="zone-download"
        onClick={handleDownload}
        disabled={!baseImage}
        title={downloadLabel}
      >
        ⬇ {downloadLabel}
      </button>
      <button
        className="zone-download zone-download-secondary"
        onClick={handleDownloadRegionMap}
        disabled={params.regions.length === 0}
        title="Export region layout PNG (filled paths + names)"
      >
        ⬇ Region map
      </button>
      <div className="canvas-stack">
        <canvas ref={setBackdropCanvas} className="canvas-backdrop" />
        <canvas
          ref={overlayCanvasRef}
          className="canvas-overlay"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onDoubleClick={handleDblClick}
          onContextMenu={handleContextMenu}
          onWheel={handleWheel}
        />
      </div>
      <Loupe
        sourceCanvas={backdropCanvas}
        cursor={
          cursor &&
          (params.loupeAlwaysOn ||
            params.mode.kind === 'drawing' ||
            params.mode.kind === 'dragVertex' ||
            params.mode.kind === 'lasso' ||
            params.hoveredVertex !== null)
            ? cursor
            : null
        }
        containerW={containerSize.width ?? 0}
        containerH={containerSize.height ?? 0}
        viewport={params.viewport}
        polylines={loupePolylines}
      />
      {!baseImage && params.regions.length === 0 && <div className="empty-hint">{hint}</div>}
    </div>
  );
}
