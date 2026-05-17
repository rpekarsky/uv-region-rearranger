import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls, Bounds, useBounds } from '@react-three/drei';
import { useShallow } from 'zustand/react/shallow';
import { Box3, Vector3, Group } from 'three';
import { useEditorStore } from '../store';
import type { LoadedModel } from './types';

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
    // Recompute the model bbox after meshes mount; drei <Bounds> + .refresh().fit()
    // is the idiomatic way to frame arbitrary scene content.
    const box = new Box3().setFromObject(model.root);
    if (box.isEmpty()) return;
    const size = new Vector3();
    box.getSize(size);
    if (size.length() === 0) return;
    bounds.refresh().clip().fit();
  }, [model, bounds]);
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
        </Bounds>
      )}
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
    </>
  );
}
