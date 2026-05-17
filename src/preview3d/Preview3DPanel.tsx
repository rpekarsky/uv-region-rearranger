import { type ChangeEvent, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { toast } from 'sonner';
import { useEditorStore } from '../store';
import { loadGLB } from './loadGLB';
import { Scene } from './Scene';

export function Preview3DPanel() {
  const model3d = useEditorStore((s) => s.model3d);
  const setModel3D = useEditorStore((s) => s.setModel3D);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const dragDepth = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleFile = async (file: File) => {
    if (!/\.(glb|gltf)$/i.test(file.name)) {
      toast.error('Only .glb / .gltf supported (v1)');
      return;
    }
    setLoading(true);
    try {
      const model = await loadGLB(file, file.name);
      setModel3D(model, file);
      toast.success(`Loaded ${file.name} (${model.materialNames.length} material slots)`);
    } catch (err) {
      toast.error('Failed to load model: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await handleFile(file);
    e.target.value = '';
  };

  const setDragging = (v: boolean) => {
    const el = containerRef.current;
    if (el) el.classList.toggle('dragging', v);
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
    if (file) await handleFile(file);
  };

  const handleClear = () => setModel3D(null);

  return (
    <div
      ref={containerRef}
      className="preview3d-panel"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        hidden
        onChange={onPickFile}
      />
      <div className="zone-header">
        <div className="zone-header-row">
          <button
            type="button"
            className="zone-label-btn"
            title="Load 3D model (.glb)"
            onClick={() => fileInputRef.current?.click()}
          >
            3D Preview
          </button>
          {model3d && (
            <button
              type="button"
              className="zone-label-clear"
              title="Clear model"
              onClick={handleClear}
            >
              ×
            </button>
          )}
        </div>
        {model3d && <div className="zone-label-live">{model3d.filename}</div>}
      </div>
      <div className="preview3d-canvas-wrap">
        <Canvas camera={{ position: [3, 2, 4], fov: 45 }} dpr={[1, 2]}>
          <Scene />
        </Canvas>
      </div>
      {!model3d && !loading && <div className="empty-hint">Drop a .glb model here</div>}
      {loading && <div className="empty-hint">Loading…</div>}
    </div>
  );
}
