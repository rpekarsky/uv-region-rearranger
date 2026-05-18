import type { LoadedModel } from './types';

export type ModelLoader = (blob: Blob, filename: string) => Promise<LoadedModel>;

interface LoaderEntry {
  extensions: string[];
  load: ModelLoader;
}

const loaders: LoaderEntry[] = [];

export function registerModelLoader(entry: LoaderEntry): void {
  loaders.push(entry);
}

export function findLoader(filename: string): ModelLoader | null {
  const ext = filename.match(/\.([^.]+)$/)?.[1].toLowerCase();
  if (!ext) return null;
  return loaders.find((l) => l.extensions.includes(ext))?.load ?? null;
}

export function getSupportedExtensions(): string[] {
  return loaders.flatMap((l) => l.extensions);
}
