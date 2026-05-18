import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { registerModelLoader } from './loaderRegistry';
import { normalizeScene } from './normalizeScene';
import type { LoadedModel } from './types';

async function loadGLB(blob: Blob, filename: string): Promise<LoadedModel> {
  const buffer = await blob.arrayBuffer();
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, '');
  return normalizeScene(gltf.scene, filename);
}

registerModelLoader({ extensions: ['glb', 'gltf'], load: loadGLB });
