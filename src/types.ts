// Shared types used across the app.

export type Vec2 = readonly [number, number];
export type Polygon = readonly Vec2[];

// 2D affine matrix as [a, b, c, d, e, f]:
//   [a c e]
//   [b d f]
//   [0 0 1]
// Compatible with CanvasRenderingContext2D.setTransform(a, b, c, d, e, f).
export type Matrix = readonly [number, number, number, number, number, number];

export interface Transform {
  translate: Vec2;
  rotation: number; // radians
  scale: Vec2; // negative for flip
  skew: Vec2; // unitless shear factors [skewX, skewY], applied between R and S
  pivot: Vec2; // image-space pivot
}

export interface Region {
  id: string;
  name: string;
  polygon: Vec2[]; // mutable for vertex editing
  transform: Transform;
}

export interface BgFill {
  color: string;
  transparent: boolean;
}

export type HandleKey = 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'w' | 'e' | 'rotation';

// Editor input mode — discriminated union, lifecycle:
// idle → drawing → editing → drag* → editing → idle
export type ZoneSide = 'left' | 'right';

export interface Viewport {
  scale: number;
  panX: number;
  panY: number;
}

export type Mode =
  | { kind: 'idle' }
  | { kind: 'drawing'; points: Vec2[]; cursor: Vec2 | null }
  | { kind: 'lasso'; side: ZoneSide; target: 'region'; points: Vec2[]; cursor: Vec2 }
  | { kind: 'editing' }
  | { kind: 'dragTranslate'; regionId: string; mouseStart: Vec2; startTranslate: Vec2 }
  | {
      kind: 'dragVertex';
      viaSide: ZoneSide; // determines whether to apply Minv
      regionId: string;
      vertexIndex: number;
      mouseStart: Vec2;
      startPolygon: Vec2[];
    }
  | {
      kind: 'dragRotate';
      regionId: string;
      pivotScreen: Vec2;
      startAngle: number;
      startRotation: number;
    }
  | {
      kind: 'dragScale';
      regionId: string;
      handleKey: HandleKey;
      deltaPre: Vec2;
      pivotScreen: Vec2;
      startScale: Vec2;
      startSkew: Vec2;
      rotation: number;
    }
  | {
      kind: 'dragSourceTranslate';
      regionId: string;
      mouseStart: Vec2;
      startPolygon: Vec2[];
      startTransform: Transform;
    }
  | {
      kind: 'dragSourceRotate';
      regionId: string;
      pivot: Vec2;
      startAngle: number;
      startPolygon: Vec2[];
      startTransform: Transform;
    }
  | {
      kind: 'dragSourceScale';
      regionId: string;
      handleKey: HandleKey;
      pivot: Vec2;
      deltaPre: Vec2;
      startPolygon: Vec2[];
      startTransform: Transform;
    };

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

export interface Preview3DConfig {
  flipY?: boolean;
  selectedMaterialIds?: string[];
  meshVisibility?: Record<string, boolean>;
  followRegions?: boolean;
  cameraStates?: Record<string, CameraState>;
}

// All coordinates serialized in UV space [0..1] (relative to imageSize at save time).
// State holds absolute pixel coords; (de)serialization scales via current image size.
export interface SerializedConfig {
  version: 1;
  imageSize: [number, number] | null;
  // Decoupled output canvas size (right zone). null = same as imageSize.
  // Lets the user rearrange a 2.7:1 source into a 1:1 output, etc.
  outputCanvasSize: [number, number] | null;
  // Decoupled inverse-render canvas size (left zone). null = same as imageSize.
  originalCanvasSize: [number, number] | null;
  imageSourceFilename: string | null;
  bgFill: BgFill;
  regions: Region[];
  preview3d?: Preview3DConfig;
}
