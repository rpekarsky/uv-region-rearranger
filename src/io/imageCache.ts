import { del, get, set } from 'idb-keyval';

// IDB-backed cache for the user's loaded source images so they survive a page
// reload without a re-drop. Stored as raw Blobs to avoid base64 inflation and
// to keep encode/decode out of the main thread; localStorage is too small for
// multi-MB textures.

export type CachedSide = 'original' | 'transformed';

interface CachedImage {
  blob: Blob;
  filename: string | null;
}

const KEYS: Record<CachedSide, string> = {
  original: 'image-cache:original-v1',
  transformed: 'image-cache:transformed-v1',
};

export async function cacheImage(
  side: CachedSide,
  blob: Blob,
  filename: string | null,
): Promise<void> {
  try {
    await set(KEYS[side], { blob, filename } satisfies CachedImage);
  } catch (err) {
    console.warn(`[imageCache] failed to cache ${side}:`, err);
  }
}

export async function readCachedImage(side: CachedSide): Promise<CachedImage | null> {
  try {
    const v = await get<CachedImage>(KEYS[side]);
    return v ?? null;
  } catch (err) {
    console.warn(`[imageCache] failed to read ${side}:`, err);
    return null;
  }
}

export async function clearCachedImage(side: CachedSide): Promise<void> {
  try {
    await del(KEYS[side]);
  } catch (err) {
    console.warn(`[imageCache] failed to clear ${side}:`, err);
  }
}

export async function clearImageCache(): Promise<void> {
  await Promise.all([clearCachedImage('original'), clearCachedImage('transformed')]);
}
