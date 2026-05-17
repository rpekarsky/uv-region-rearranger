import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls, Bounds, useBounds } from '@react-three/drei';
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

function AutoFit({ model }: { model: LoadedModel }) {
  const bounds = useBounds();
  useEffect(() => {
    const box = new Box3().setFromObject(model.root);
    if (box.isEmpty()) return;
    const size = new Vector3();
    box.getSize(size);
    if (size.length() === 0) return;
    bounds.refresh().clip().fit();
  }, [model, bounds]);
  return null;
}

function TextureBinder({ model }: { model: LoadedModel }) {
  const selectedMaterialIds = useEditorStore((s) => s.selectedMaterialIds);
  const flipY = useEditorStore((s) => s.texture3DFlipY);
  // Subscribed directly (not via useTextureCanvas) so the effect re-fires on
  // quality change even if sourceKey identity propagation lags by a frame.
  const outputScale = useEditorStore((s) => s.texture3DOutputScale);
  const { source, key: sourceKey } = useTextureCanvas();
  const { gl } = useThree();
  // Kept for completeness in case we re-enable mipmaps later; without them
  // anisotropy is a no-op on the GPU.
  void gl;
  const textureRef = useRef<Texture | null>(null);
  const materialRef = useRef<MeshBasicMaterial | null>(null);
  const prevBoundRef = useRef<string[]>([]);
  // Track actual canvas pixel dims. Three.js uses texStorage2D on WebGL2 which
  // immutably allocates GPU memory at the dims of the FIRST upload — subsequent
  // texSubImage2D calls silently mis-sample when canvas dims change. Detecting
  // a dim change here forces a Texture recreate, which triggers fresh
  // texStorage2D at the new dims.
  const lastDimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const prev = prevBoundRef.current;
    // Restore placeholders for slots no longer in selection.
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
        <Bounds key={key} margin={1.2}>
          <ModelMount model={model3d} />
          <AutoFit model={model3d} />
          <TextureBinder model={model3d} />
        </Bounds>
      )}
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
    </>
  );
}
