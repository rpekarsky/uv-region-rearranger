import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import {
  restoreFromStorage,
  restoreUIPersistence,
  setupPersistence,
  setupUIPersistence,
} from './io/persist';
import { readCachedImage } from './io/imageCache';
import { readCachedModel } from './preview3d/modelCache';
import { findLoader } from './preview3d/loaderRegistry';
import './preview3d/registerLoaders';
import { loadImageFromBlob } from './io/storage';
import { loadDemo } from './io/demo';
import { useEditorStore } from './store';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element');

const isDemo = new URLSearchParams(window.location.search).has('demo');

// Demo path skips state + IDB-image restore — the demo loader fully
// populates the store, and we don't want cached images racing with it.
if (!isDemo) {
  restoreFromStorage();
}
restoreUIPersistence();
setupPersistence();
setupUIPersistence();

if (isDemo) {
  void loadDemo();
} else {
  // Async-restore previously loaded images from IndexedDB. Renders a blank
  // editor first; images pop in once decoded (typically a couple hundred ms).
  // We pass `undefined` for blob so setOriginalImage doesn't redundantly write
  // the same blob back to IDB.
  void (async () => {
    const [orig, trans] = await Promise.all([
      readCachedImage('original'),
      readCachedImage('transformed'),
    ]);
    if (orig) {
      try {
        const img = await loadImageFromBlob(orig.blob);
        useEditorStore.getState().setOriginalImage(img, orig.filename);
      } catch (err) {
        console.warn('[imageCache] failed to decode original:', err);
      }
    }
    if (trans) {
      try {
        const img = await loadImageFromBlob(trans.blob);
        useEditorStore.getState().setTransformedImage(img, trans.filename);
      } catch (err) {
        console.warn('[imageCache] failed to decode transformed:', err);
      }
    }
    const cachedModel = await readCachedModel();
    if (cachedModel) {
      const load = findLoader(cachedModel.filename);
      if (load) {
        try {
          const model = await load(cachedModel.blob, cachedModel.filename);
          // Pass undefined for blob — avoid re-writing the same bytes to IDB.
          useEditorStore.getState().setModel3D(model);
        } catch (err) {
          console.warn('[modelCache] failed to decode model:', err);
        }
      }
    }
  })();
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
