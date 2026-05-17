import type { Region, SerializedConfig, Transform, Vec2 } from '../types';
import { useEditorStore } from '../store';

// ---------- coord normalization ----------
// State holds image-pixel coords. JSON holds UV coords [0..1] for resolution
// independence. Multiplied/divided by imageSize on (de)serialization.

function toUV(p: Vec2, w: number, h: number): Vec2 {
  return [p[0] / w, p[1] / h];
}
function fromUV(p: Vec2, w: number, h: number): Vec2 {
  return [p[0] * w, p[1] * h];
}
function transformToUV(t: Transform, w: number, h: number): Transform {
  return {
    translate: toUV(t.translate, w, h),
    rotation: t.rotation,
    scale: t.scale,
    skew: t.skew,
    pivot: toUV(t.pivot, w, h),
  };
}
function transformFromUV(t: Transform, w: number, h: number): Transform {
  // skew may be missing on configs saved before the field existed — default to 0.
  const skew: Vec2 = t.skew ?? [0, 0];
  return {
    translate: fromUV(t.translate, w, h),
    rotation: t.rotation,
    scale: t.scale,
    skew,
    pivot: fromUV(t.pivot, w, h),
  };
}

export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Not an image: ' + file.type));
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image decode failed'));
    img.src = URL.createObjectURL(file);
  });
}

export function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image decode failed'));
    img.src = URL.createObjectURL(blob);
  });
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

export function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  return canvas;
}

export function downloadJSON(data: unknown, filename: string): void {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function loadJSONFromFile<T = unknown>(file: File): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result as string) as T);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsText(file);
  });
}

export function serializeState(): SerializedConfig {
  const s = useEditorStore.getState();
  // Normalize against source-space dims — that's where polygons live, and it's
  // the basis the loader will use to denormalize. Prefer the live original
  // image; otherwise the tracked regionImageSize (set by image load or by an
  // earlier JSON load). Transformed image is NOT valid here — it's in output-space.
  const w = s.originalImage?.naturalWidth ?? s.regionImageSize?.[0];
  const h = s.originalImage?.naturalHeight ?? s.regionImageSize?.[1];
  if (!w || !h) {
    throw new Error('Cannot save: no source size known. Load the original image or a JSON first.');
  }

  return {
    version: 1,
    imageSize: [w, h],
    outputCanvasSize: s.outputCanvasSize,
    originalCanvasSize: s.originalCanvasSize,
    imageSourceFilename: s.originalFilename,
    bgFill: s.bgFill,
    regions: s.regions.map((r) => ({
      id: r.id,
      name: r.name,
      polygon: r.polygon.map((p) => toUV(p, w, h)),
      transform: transformToUV(r.transform, w, h),
    })),
    preview3d: {
      flipY: s.texture3DFlipY,
      selectedMaterialIds: s.selectedMaterialIds,
      meshVisibility: s.meshVisibility,
      followRegions: s.followRegions,
      cameraStates: s.cameraStates,
    },
  };
}

export function parseConfig(data: unknown): SerializedConfig {
  if (!data || typeof data !== 'object') throw new Error('Invalid JSON');
  const cfg = data as Partial<SerializedConfig>;
  if (cfg.version !== 1) throw new Error('Unsupported config version: ' + cfg.version);
  if (!Array.isArray(cfg.regions)) throw new Error('Missing regions');

  // Determine the size to denormalize against. Polygons live in SOURCE space,
  // and transforms are normalized against source-dims at save time. So the
  // basis must be the source-image dims — original image if loaded, else the
  // JSON's recorded imageSize. Transformed image dims are NOT a valid basis
  // (transformed lives in output-space, which is independent).
  const s = useEditorStore.getState();
  let w: number, h: number;
  if (s.originalImage) {
    w = s.originalImage.naturalWidth;
    h = s.originalImage.naturalHeight;
  } else if (cfg.imageSize) {
    [w, h] = cfg.imageSize;
  } else {
    throw new Error('Cannot load: no original image loaded and JSON has no imageSize');
  }

  const regions: Region[] = cfg.regions.map((r) => ({
    id: r.id || crypto.randomUUID(),
    name: r.name || 'region',
    polygon: r.polygon.map((p) => fromUV(p, w, h)),
    transform: transformFromUV(r.transform, w, h),
  }));

  // `cfg.masks` from old configs is intentionally ignored — masks were dropped
  // from the app, but we silently tolerate the field so legacy JSONs still load.

  return {
    version: 1,
    // Reflect the basis we just denormalized against, not the JSON's saved
    // value — callers (loadConfig) use this to detect/scale a later mismatched
    // image load.
    imageSize: [w, h],
    outputCanvasSize: cfg.outputCanvasSize ?? null,
    originalCanvasSize: cfg.originalCanvasSize ?? null,
    imageSourceFilename: cfg.imageSourceFilename ?? null,
    bgFill: cfg.bgFill ?? { color: '#000000', transparent: false },
    regions,
    preview3d: cfg.preview3d,
  };
}
