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
import { loadImageFromBlob } from './io/storage';
import { useEditorStore } from './store';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element');

// Restore last saved state, then start auto-saving on changes.
restoreFromStorage();
restoreUIPersistence();
setupPersistence();
setupUIPersistence();

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
})();

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
