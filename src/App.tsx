import { useEffect, useRef, useState } from 'react';
import { useEventListener } from 'usehooks-ts';
import { Toaster } from 'sonner';
import { CanvasZone } from './canvas/CanvasZone';
import { RegionList } from './ui/RegionList';
import { PropertyPanel } from './ui/PropertyPanel';
import { HintsPanel } from './ui/HintsPanel';
import { KeyboardShortcuts } from './ui/KeyboardShortcuts';
import { ZonesSplitter } from './ui/ZonesSplitter';
import { onWindowMouseMove, onWindowMouseUp } from './canvas/interactions';
import { useEditorStore } from './store';

export function App() {
  const hasRegionSelected = useEditorStore((s) => s.selectedRegionId !== null);
  const zonesRatio = useEditorStore((s) => s.zonesRatio);
  const setZonesRatio = useEditorStore((s) => s.setZonesRatio);
  const showRegionNames = useEditorStore((s) => s.showRegionNames);
  const setShowRegionNames = useEditorStore((s) => s.setShowRegionNames);
  const sidebarOpen = useEditorStore((s) => s.sidebarOpen);
  const setSidebarOpen = useEditorStore((s) => s.setSidebarOpen);
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
            <div className="sb-row">
              <button type="button" className="btn">Load JSON</button>
              <button type="button" className="btn">Save JSON</button>
            </div>
            <div className="sb-row">
              <button type="button" className="btn small">⚙ Canvas size</button>
              <button type="button" className="btn small danger">Reset</button>
            </div>
          </section>
          <section className="sidebar-section">
            <h3>View</h3>
            <div className="sb-row">
              <span className="bg-fill-label">BG:</span>
              <input type="color" defaultValue="#000000" aria-label="Background color" />
              <label className="bg-checkbox">
                <input type="checkbox" />
                transparent
              </label>
            </div>
            <label className="bg-checkbox">
              <input type="checkbox" />
              regions only
            </label>
            <label className="bg-checkbox">
              <input type="checkbox" />
              loupe always
            </label>
          </section>
          <section className="sidebar-section">
            <h3>Regions</h3>
            <label className="bg-checkbox" style={{ marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={showRegionNames}
                onChange={(e) => setShowRegionNames(e.target.checked)}
              />
              show region names
            </label>
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
      <Toaster position="bottom-right" theme="dark" richColors />
    </div>
  );
}
