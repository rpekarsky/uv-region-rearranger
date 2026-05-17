import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { useEventListener } from 'usehooks-ts';
import { Toaster, toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { CanvasZone } from './canvas/CanvasZone';
import { RegionList } from './ui/RegionList';
import { PropertyPanel } from './ui/PropertyPanel';
import { HintsPanel } from './ui/HintsPanel';
import { KeyboardShortcuts } from './ui/KeyboardShortcuts';
import { ZonesSplitter } from './ui/ZonesSplitter';
import { CanvasSizeModal } from './ui/CanvasSizeModal';
import { onWindowMouseMove, onWindowMouseUp } from './canvas/interactions';
import {
  downloadJSON,
  loadJSONFromFile,
  parseConfig,
  serializeState,
} from './io/storage';
import { clearStorage } from './io/persist';
import { clearImageCache } from './io/imageCache';
import { useEditorStore } from './store';

export function App() {
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [canvasSizeModalOpen, setCanvasSizeModalOpen] = useState(false);

  const {
    hasRegionSelected,
    zonesRatio,
    setZonesRatio,
    showRegionNames,
    setShowRegionNames,
    sidebarOpen,
    setSidebarOpen,
    bgFill,
    setBgFill,
    regionsOnlyView,
    setRegionsOnlyView,
    loupeAlwaysOn,
    setLoupeAlwaysOn,
    regions,
    originalFilename,
    loadConfig,
  } = useEditorStore(
    useShallow((s) => ({
      hasRegionSelected: s.selectedRegionId !== null,
      zonesRatio: s.zonesRatio,
      setZonesRatio: s.setZonesRatio,
      showRegionNames: s.showRegionNames,
      setShowRegionNames: s.setShowRegionNames,
      sidebarOpen: s.sidebarOpen,
      setSidebarOpen: s.setSidebarOpen,
      bgFill: s.bgFill,
      setBgFill: s.setBgFill,
      regionsOnlyView: s.regionsOnlyView,
      setRegionsOnlyView: s.setRegionsOnlyView,
      loupeAlwaysOn: s.loupeAlwaysOn,
      setLoupeAlwaysOn: s.setLoupeAlwaysOn,
      regions: s.regions,
      originalFilename: s.originalFilename,
      loadConfig: s.loadConfig,
    })),
  );

  const zonesRef = useRef<HTMLDivElement>(null);
  const [vertical, setVertical] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1200px)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1200px)');
    const onChange = () => setVertical(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // window-level drag handlers (mousemove/mouseup) — bound once at app root
  // so dragging works even when the cursor leaves a canvas.
  useEventListener('mousemove', onWindowMouseMove);
  useEventListener('mouseup', onWindowMouseUp);

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

  const handleReset = () => {
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
  };

  const leftStyle = vertical
    ? { flex: `${zonesRatio} 0 0`, minHeight: 0 }
    : { flex: `${zonesRatio} 0 0`, minWidth: 0 };
  const rightStyle = vertical
    ? { flex: `${1 - zonesRatio} 0 0`, minHeight: 0 }
    : { flex: `${1 - zonesRatio} 0 0`, minWidth: 0 };

  return (
    <div className="app">
      <KeyboardShortcuts />
      <main className="workspace">
        <div className="zones" ref={zonesRef}>
          <div className="zone-slot" style={leftStyle}>
            <CanvasZone side="left" />
          </div>
          <ZonesSplitter
            containerRef={zonesRef}
            setRatio={setZonesRatio}
            vertical={vertical}
            onDoubleClick={() => setZonesRatio(0.5)}
          />
          <div className="zone-slot" style={rightStyle}>
            <CanvasZone side="right" />
          </div>
        </div>
        <button
          type="button"
          className={`sidebar-toggle ${sidebarOpen ? 'open' : 'collapsed'}`}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        />
        <aside className={`sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}>
          <section className="sidebar-section">
            <h3>Project</h3>
            <input
              ref={jsonInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={handleLoadJson}
            />
            <div className="sb-row">
              <button type="button" className="btn" onClick={() => jsonInputRef.current?.click()}>
                Load JSON
              </button>
              <button
                type="button"
                className="btn"
                disabled={regions.length === 0}
                onClick={handleSaveJson}
              >
                Save JSON
              </button>
            </div>
            <div className="sb-row">
              <button
                type="button"
                className="btn small"
                onClick={() => setCanvasSizeModalOpen(true)}
              >
                ⚙ Canvas size
              </button>
              <button type="button" className="btn small danger" onClick={handleReset}>
                Reset
              </button>
            </div>
          </section>
          <section className="sidebar-section">
            <h3>View</h3>
            <div className="sb-row">
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
            </div>
            <label className="bg-checkbox">
              <input
                type="checkbox"
                checked={regionsOnlyView}
                onChange={(e) => setRegionsOnlyView(e.target.checked)}
              />
              regions only
            </label>
            <label className="bg-checkbox">
              <input
                type="checkbox"
                checked={loupeAlwaysOn}
                onChange={(e) => setLoupeAlwaysOn(e.target.checked)}
              />
              loupe always
            </label>
            <label className="bg-checkbox">
              <input
                type="checkbox"
                checked={showRegionNames}
                onChange={(e) => setShowRegionNames(e.target.checked)}
              />
              show region names
            </label>
          </section>
          <section className="sidebar-section">
            <h3>Regions</h3>
            <RegionList />
          </section>
          {hasRegionSelected && (
            <section className="sidebar-section">
              <h3>Selected region</h3>
              <PropertyPanel />
            </section>
          )}
          <section className="sidebar-section help">
            <h3>Hints</h3>
            <HintsPanel />
          </section>
        </aside>
      </main>
      <CanvasSizeModal open={canvasSizeModalOpen} onClose={() => setCanvasSizeModalOpen(false)} />
      <Toaster position="bottom-right" theme="dark" richColors />
    </div>
  );
}
