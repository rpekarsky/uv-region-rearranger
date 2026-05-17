import { type ChangeEvent, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from 'zustand';
import { useEditorStore } from '../store';
import {
  downloadJSON,
  loadImageFromFile,
  loadJSONFromFile,
  parseConfig,
  serializeState,
} from '../io/storage';
import { toast } from 'sonner';
import { clearStorage } from '../io/persist';
import { clearImageCache } from '../io/imageCache';
import { CanvasSizeModal } from './CanvasSizeModal';

function UndoRedoButtons() {
  const pastCount = useStore(useEditorStore.temporal, (s) => s.pastStates.length);
  const futureCount = useStore(useEditorStore.temporal, (s) => s.futureStates.length);
  const undo = () => useEditorStore.temporal.getState().undo();
  const redo = () => useEditorStore.temporal.getState().redo();
  return (
    <div className="tb-group">
      <button className="btn small" disabled={pastCount === 0} title="Undo (Ctrl+Z)" onClick={undo}>
        ↶ Undo
      </button>
      <button
        className="btn small"
        disabled={futureCount === 0}
        title="Redo (Ctrl+Shift+Z)"
        onClick={redo}
      >
        ↷ Redo
      </button>
    </div>
  );
}

export function Toolbar() {
  const originalInputRef = useRef<HTMLInputElement>(null);
  const transformedInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [canvasSizeModalOpen, setCanvasSizeModalOpen] = useState(false);

  const {
    originalImage,
    originalFilename,
    transformedImage,
    regions,
    bgFill,
    regionsOnlyView,
    loupeAlwaysOn,
    setOriginalImage,
    setTransformedImage,
    setBgFill,
    setRegionsOnlyView,
    setLoupeAlwaysOn,
    loadConfig,
  } = useEditorStore(
    useShallow((s) => ({
      originalImage: s.originalImage,
      originalFilename: s.originalFilename,
      transformedImage: s.transformedImage,
      regions: s.regions,
      bgFill: s.bgFill,
      regionsOnlyView: s.regionsOnlyView,
      loupeAlwaysOn: s.loupeAlwaysOn,
      setOriginalImage: s.setOriginalImage,
      setTransformedImage: s.setTransformedImage,
      setBgFill: s.setBgFill,
      setRegionsOnlyView: s.setRegionsOnlyView,
      setLoupeAlwaysOn: s.setLoupeAlwaysOn,
      loadConfig: s.loadConfig,
    })),
  );

  const handleLoadOriginal = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const img = await loadImageFromFile(file);
      setOriginalImage(img, file.name, file);
    } catch (err) {
      toast.error((err as Error).message);
    }
    e.target.value = '';
  };

  const handleLoadTransformed = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const img = await loadImageFromFile(file);
      setTransformedImage(img, file.name, file);
    } catch (err) {
      toast.error((err as Error).message);
    }
    e.target.value = '';
  };

  const handleLoadJson = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await loadJSONFromFile(file);
      loadConfig(parseConfig(data));
    } catch (err) {
      toast.error('Failed to load JSON: ' + (err as Error).message);
    }
    e.target.value = '';
  };

  const baseName = (originalFilename || 'regions').replace(/\.[^.]+$/, '');

  const handleSaveJson = () => downloadJSON(serializeState(), `${baseName}.regions.json`);

  return (
    <header className="toolbar">
      <div className="tb-group">
        <input
          ref={originalInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleLoadOriginal}
        />
        <button className="btn" onClick={() => originalInputRef.current?.click()}>
          Load original
        </button>
        {originalImage && (
          <button
            className="btn small"
            onClick={() => setOriginalImage(null, null)}
            title="Clear original"
          >
            ×
          </button>
        )}
        <input
          ref={transformedInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleLoadTransformed}
        />
        <button className="btn" onClick={() => transformedInputRef.current?.click()}>
          Load transformed
        </button>
        {transformedImage && (
          <button
            className="btn small"
            onClick={() => setTransformedImage(null, null)}
            title="Clear transformed"
          >
            ×
          </button>
        )}
      </div>

      <UndoRedoButtons />

      <div className="tb-group">
        <input
          ref={jsonInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={handleLoadJson}
        />
        <button className="btn" onClick={() => jsonInputRef.current?.click()}>
          Load JSON
        </button>
        <button className="btn" disabled={regions.length === 0} onClick={handleSaveJson}>
          Save JSON
        </button>
        <button
          className="btn small"
          title="Reset everything (clears auto-saved state too)"
          onClick={() => {
            if (!confirm('Wipe all regions and clear auto-saved state?')) return;
            clearStorage();
            void clearImageCache();
            loadConfig({
              version: 1,
              imageSize: null,
              outputCanvasSize: null,
              originalCanvasSize: null,
              imageSourceFilename: null,
              bgFill: { color: '#000000', transparent: false },
              regions: [],
            });
          }}
        >
          Reset
        </button>
      </div>

      <div className="tb-group">
        <span className="bg-fill-label">BG:</span>
        <input
          type="color"
          value={bgFill.color}
          onChange={(e) => setBgFill({ color: e.target.value })}
          aria-label="Background color"
        />
        <label className="bg-checkbox">
          <input
            type="checkbox"
            checked={bgFill.transparent}
            onChange={(e) => setBgFill({ transparent: e.target.checked })}
          />
          transparent
        </label>
        <label
          className="bg-checkbox"
          title="Hide source image in the live-rendered side; islands paint onto a clean BG fill (useful for AI prompt input)"
        >
          <input
            type="checkbox"
            checked={regionsOnlyView}
            onChange={(e) => setRegionsOnlyView(e.target.checked)}
          />
          regions only
        </label>
        <label
          className="bg-checkbox"
          title="Keep the magnifier loupe visible whenever the cursor is over a zone, not just during vertex placement / drag"
        >
          <input
            type="checkbox"
            checked={loupeAlwaysOn}
            onChange={(e) => setLoupeAlwaysOn(e.target.checked)}
          />
          loupe always
        </label>
      </div>

      <div className="tb-group">
        <button
          className="btn small"
          title="Resize source / output canvas"
          onClick={() => setCanvasSizeModalOpen(true)}
        >
          ⚙ Canvas size
        </button>
      </div>

      <CanvasSizeModal open={canvasSizeModalOpen} onClose={() => setCanvasSizeModalOpen(false)} />
    </header>
  );
}
