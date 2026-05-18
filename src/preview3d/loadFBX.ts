import { Group } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { registerModelLoader } from './loaderRegistry';
import { normalizeScene } from './normalizeScene';
import type { LoadedModel } from './types';

async function loadFBX(blob: Blob, filename: string): Promise<LoadedModel> {
  const buffer = await blob.arrayBuffer();
  const loader = new FBXLoader();
  // FBXLoader.parse is sync and returns a Group directly (no .scene wrapper).
  const root = loader.parse(buffer, '') as Group;
  return normalizeScene(root, filename);
}

registerModelLoader({ extensions: ['fbx'], load: loadFBX });
