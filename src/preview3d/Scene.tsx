import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import { useShallow } from 'zustand/react/shallow';
import {
  Box3,
  Vector3,
  Group,
  Texture,
  MeshBasicMaterial,
  SRGBColorSpace,
  LinearFilter,
} from 'three';
import { useEditorStore } from '../store';
import type { LoadedModel } from './types';
import { useTextureCanvas } from './useTextureCanvas';

interface CameraControlsLike {
  setLookAt(
    px: number,
    py: number,
    pz: number,
    tx: number,
    ty: number,
    tz: number,
    enableTransition?: boolean,
  ): Promise<boolean>;
  getPosition(out: Vector3): Vector3;
  getTarget(out: Vector3): Vector3;
  fitToBox(box: Box3, enableTransition: boolean, options?: object): Promise<boolean>;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

function ModelMount({ model }: { model: LoadedModel }) {
  const meshVisibility = useEditorStore((s) => s.meshVisibility);
  const groupRef = useRef<Group>(null);

  useEffect(() => {
    model.root.traverse((obj) => {
      const name = obj.name || obj.uuid;
      if (name in meshVisibility) obj.visible = meshVisibility[name];
    });
  }, [model, meshVisibility]);

  return <primitive ref={groupRef} object={model.root} />;
}

function CameraFit({ model }: { model: LoadedModel }) {
  const controls = useThree((s) => s.controls) as CameraControlsLike | null;
  const resetTick = useEditorStore((s) => s.resetCameraTick);
  const hasFitOnceRef = useRef(false);

  useEffect(() => {
    if (!controls) return;
    const box = new Box3().setFromObject(model.root);
    if (box.isEmpty()) return;
    // First fit on model load: instant. Subsequent (Reset button): smooth.
    const smooth = hasFitOnceRef.current;
    hasFitOnceRef.current = true;
    void controls.fitToBox(box, smooth);
  }, [controls, model, resetTick]);

  return null;
}

function CameraFollower() {
  const controls = useThree((s) => s.controls) as CameraControlsLike | null;
  const selectedRegionId = useEditorStore((s) => s.selectedRegionId);
  const followRegions = useEditorStore((s) => s.followRegions);
  const setCameraState = useEditorStore((s) => s.setCameraState);

  // Restore (or capture-on-first-visit) when the selected region changes and
  // follow is on. Inline getState() read for cameraStates so this effect
  // doesn't re-fire on every save.
  useEffect(() => {
    if (!controls || !followRegions || !selectedRegionId) return;
    const saved = useEditorStore.getState().cameraStates[selectedRegionId];
    if (saved) {
      void controls.setLookAt(
        saved.position[0],
        saved.position[1],
        saved.position[2],
        saved.target[0],
        saved.target[1],
        saved.target[2],
        true,
      );
    } else {
      // First visit with follow on — capture current camera as the region's baseline.
      const pos = new Vector3();
      const tgt = new Vector3();
      controls.getPosition(pos);
      controls.getTarget(tgt);
      setCameraState(selectedRegionId, {
        position: [pos.x, pos.y, pos.z],
        target: [tgt.x, tgt.y, tgt.z],
      });
    }
  }, [controls, followRegions, selectedRegionId, setCameraState]);

  // Save state on user-driven camera change (controlend = drag/wheel/pan end).
  useEffect(() => {
    if (!controls) return;
    const handler = () => {
      const s = useEditorStore.getState();
      if (!s.followRegions || !s.selectedRegionId) return;
      const pos = new Vector3();
      const tgt = new Vector3();
      controls.getPosition(pos);
      controls.getTarget(tgt);
      setCameraState(s.selectedRegionId, {
        position: [pos.x, pos.y, pos.z],
        target: [tgt.x, tgt.y, tgt.z],
      });
    };
    controls.addEventListener('controlend', handler);
    return () => controls.removeEventListener('controlend', handler);
  }, [controls, setCameraState]);

  return null;
}

export function Scene() {
  const { model3d } = useEditorStore(useShallow((s) => ({ model3d: s.model3d })));
  const { gl } = useThree();

  useEffect(() => {
    gl.setClearColor(0x1f1f1f, 1);
  }, [gl]);

  const key = useMemo(() => model3d?.filename ?? 'empty', [model3d]);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 5]} intensity={1.0} />
      <directionalLight position={[-5, 3, -2]} intensity={0.4} />
      {model3d && (
        <group key={key}>
          <ModelMount model={model3d} />
          <CameraFit model={model3d} />
          <TextureBinder model={model3d} />
          <CameraFollower />
        </group>
      )}
      <CameraControls makeDefault />
    </>
  );
}

function TextureBinder({ model }: { model: LoadedModel }) {
  const selectedMaterialIds = useEditorStore((s) => s.selectedMaterialIds);
  const flipY = useEditorStore((s) => s.texture3DFlipY);
  const outputScale = useEditorStore((s) => s.texture3DOutputScale);
  const { source, key: sourceKey } = useTextureCanvas();
  const { gl } = useThree();
  void gl;
  const textureRef = useRef<Texture | null>(null);
  const materialRef = useRef<MeshBasicMaterial | null>(null);
  const prevBoundRef = useRef<string[]>([]);
  // Detect canvas-dim changes so we force a Texture recreate. three.js on WebGL2
  // uses texStorage2D which immutably allocates GPU memory at first-upload dims;
  // subsequent texSubImage2D with different canvas dims silently mis-samples.
  const lastDimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const prev = prevBoundRef.current;
    for (const slot of prev) {
      if (!selectedMaterialIds.includes(slot)) {
        const placeholder = model.placeholderMaterials.get(slot);
        const meshes = model.meshesByMaterial.get(slot);
        if (placeholder && meshes) for (const m of meshes) m.material = placeholder;
      }
    }

    if (selectedMaterialIds.length === 0 || !source) {
      prevBoundRef.current = [...selectedMaterialIds];
      return;
    }

    const sourceCanvas = source instanceof HTMLCanvasElement ? source : null;
    const dimsChanged =
      sourceCanvas !== null &&
      (sourceCanvas.width !== lastDimsRef.current.w ||
        sourceCanvas.height !== lastDimsRef.current.h);

    if (!textureRef.current || textureRef.current.image !== source || dimsChanged) {
      textureRef.current?.dispose();
      const tex = new Texture(source);
      tex.flipY = flipY;
      tex.colorSpace = SRGBColorSpace;
      tex.minFilter = LinearFilter;
      tex.magFilter = LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      textureRef.current = tex;
      if (materialRef.current) {
        materialRef.current.map = tex;
        materialRef.current.needsUpdate = true;
      }
    } else {
      const tex = textureRef.current;
      if (tex.flipY !== flipY) tex.flipY = flipY;
      tex.needsUpdate = true;
    }

    if (sourceCanvas) {
      lastDimsRef.current = { w: sourceCanvas.width, h: sourceCanvas.height };
    }

    if (!materialRef.current) {
      materialRef.current = new MeshBasicMaterial({ map: textureRef.current });
    }

    for (const slot of selectedMaterialIds) {
      const meshes = model.meshesByMaterial.get(slot);
      if (meshes) for (const m of meshes) m.material = materialRef.current;
    }

    prevBoundRef.current = [...selectedMaterialIds];
  }, [model, selectedMaterialIds, source, sourceKey, flipY, outputScale]);

  useEffect(() => {
    return () => {
      textureRef.current?.dispose();
      materialRef.current?.dispose();
      textureRef.current = null;
      materialRef.current = null;
    };
  }, [model]);

  return null;
}
