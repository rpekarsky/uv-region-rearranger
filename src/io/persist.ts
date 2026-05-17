// Auto-save the editable state (regions, bgFill, canvas sizes) to localStorage
// so it survives page reloads. Image bytes are NOT persisted — user re-drops images.

import { useEditorStore } from '../store';
import { parseConfig, serializeState } from './storage';
import type { Viewport } from '../types';

const STORAGE_KEY = 'uv-region-rearranger:state.v1';
const UI_STORAGE_KEY = 'uv-region-rearranger:ui.v1';
const DEBOUNCE_MS = 500;

let saveTimer: number | null = null;

function scheduleSave(): void {
  if (saveTimer != null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    try {
      const data = serializeState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // serializeState throws if no image is loaded yet — skip silently;
      // we'll catch it on the next change after an image lands.
    }
  }, DEBOUNCE_MS);
}

export function setupPersistence(): () => void {
  return useEditorStore.subscribe((state, prev) => {
    if (
      state.regions !== prev.regions ||
      state.bgFill !== prev.bgFill ||
      state.outputCanvasSize !== prev.outputCanvasSize ||
      state.regionImageSize !== prev.regionImageSize ||
      state.originalCanvasSize !== prev.originalCanvasSize
    ) {
      scheduleSave();
    }
  });
}

export function restoreFromStorage(): void {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    const cfg = parseConfig(data);
    useEditorStore.getState().loadConfig(cfg);
  } catch (err) {
    console.warn('[persist] Failed to restore saved state, clearing:', err);
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function clearStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ---------- UI prefs (viewport + splitter) ----------
// Kept in a separate localStorage key so they don't leak into exported project
// JSON. Saved with their own debounce because viewport changes fire often
// (every wheel tick, every drag frame).

interface UIPrefs {
  leftViewport: Viewport;
  rightViewport: Viewport;
  zonesRatio: number;
  regionsOnlyView: boolean;
  loupeAlwaysOn: boolean;
  showRegionNames: boolean;
  sidebarOpen: boolean;
}

let uiSaveTimer: number | null = null;

function scheduleUISave(): void {
  if (uiSaveTimer != null) clearTimeout(uiSaveTimer);
  uiSaveTimer = window.setTimeout(() => {
    uiSaveTimer = null;
    const s = useEditorStore.getState();
    const prefs: UIPrefs = {
      leftViewport: s.leftViewport,
      rightViewport: s.rightViewport,
      zonesRatio: s.zonesRatio,
      regionsOnlyView: s.regionsOnlyView,
      loupeAlwaysOn: s.loupeAlwaysOn,
      showRegionNames: s.showRegionNames,
      sidebarOpen: s.sidebarOpen,
    };
    try {
      localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // ignore quota or serialization errors
    }
  }, DEBOUNCE_MS);
}

export function setupUIPersistence(): () => void {
  return useEditorStore.subscribe((state, prev) => {
    if (
      state.leftViewport !== prev.leftViewport ||
      state.rightViewport !== prev.rightViewport ||
      state.zonesRatio !== prev.zonesRatio ||
      state.regionsOnlyView !== prev.regionsOnlyView ||
      state.loupeAlwaysOn !== prev.loupeAlwaysOn ||
      state.showRegionNames !== prev.showRegionNames ||
      state.sidebarOpen !== prev.sidebarOpen
    ) {
      scheduleUISave();
    }
  });
}

export function restoreUIPersistence(): void {
  const raw = localStorage.getItem(UI_STORAGE_KEY);
  if (!raw) return;
  try {
    const prefs = JSON.parse(raw) as Partial<UIPrefs>;
    const store = useEditorStore.getState();
    if (prefs.leftViewport) store.setLeftViewport(prefs.leftViewport);
    if (prefs.rightViewport) store.setRightViewport(prefs.rightViewport);
    if (typeof prefs.zonesRatio === 'number') store.setZonesRatio(prefs.zonesRatio);
    if (typeof prefs.regionsOnlyView === 'boolean') store.setRegionsOnlyView(prefs.regionsOnlyView);
    if (typeof prefs.loupeAlwaysOn === 'boolean') store.setLoupeAlwaysOn(prefs.loupeAlwaysOn);
    if (typeof prefs.showRegionNames === 'boolean') store.setShowRegionNames(prefs.showRegionNames);
    if (typeof prefs.sidebarOpen === 'boolean') store.setSidebarOpen(prefs.sidebarOpen);
  } catch (err) {
    console.warn('[persist] Failed to restore UI prefs, clearing:', err);
    localStorage.removeItem(UI_STORAGE_KEY);
  }
}
