import { del, get, set } from 'idb-keyval';

interface CachedModel {
  blob: Blob;
  filename: string;
}

const KEY = 'model-cache:glb-v1';

export async function cacheModel(blob: Blob, filename: string): Promise<void> {
  try {
    await set(KEY, { blob, filename } satisfies CachedModel);
  } catch (err) {
    console.warn('[modelCache] failed to cache:', err);
  }
}

export async function readCachedModel(): Promise<CachedModel | null> {
  try {
    const v = await get<CachedModel>(KEY);
    return v ?? null;
  } catch (err) {
    console.warn('[modelCache] failed to read:', err);
    return null;
  }
}

export async function clearCachedModel(): Promise<void> {
  try {
    await del(KEY);
  } catch (err) {
    console.warn('[modelCache] failed to clear:', err);
  }
}
