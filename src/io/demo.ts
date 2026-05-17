import { toast } from 'sonner';
import { useEditorStore } from '../store';
import { loadImageFromBlob, parseConfig } from './storage';

export async function loadDemo(): Promise<void> {
  try {
    const [jsonResp, imgResp] = await Promise.all([
      fetch('./example.json'),
      fetch('./example.png'),
    ]);
    if (!jsonResp.ok || !imgResp.ok) {
      throw new Error('demo assets not reachable');
    }
    const jsonData = (await jsonResp.json()) as unknown;
    const imgBlob = await imgResp.blob();
    const img = await loadImageFromBlob(imgBlob);

    const store = useEditorStore.getState();
    store.setTransformedImage(img, 'example.png', imgBlob);
    store.loadConfig(parseConfig(jsonData));
  } catch (err) {
    toast.error('Demo not available: ' + (err as Error).message);
  }
}
