import { Color, Group, Mesh, MeshStandardMaterial } from 'three';
import type { LoadedModel } from './types';

function placeholderColor(index: number, total: number): Color {
  const hue = (index / Math.max(1, total)) * 360;
  return new Color().setHSL(hue / 360, 0.25, 0.55);
}

export function normalizeScene(root: Group, filename: string): LoadedModel {
  const meshesByMaterial = new Map<string, Mesh[]>();
  const meshNames: string[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    meshNames.push(obj.name || obj.uuid);
    const mat = obj.material;
    // Multi-material meshes (array) get bucketed under slot 0; splitting
    // geometry by material group is out of scope for v1.
    const matLike = Array.isArray(mat) ? mat[0] : mat;
    const key = matLike?.name?.trim() || matLike?.uuid || obj.uuid;
    const bucket = meshesByMaterial.get(key);
    if (bucket) bucket.push(obj);
    else meshesByMaterial.set(key, [obj]);
  });

  const materialNames = Array.from(meshesByMaterial.keys());
  const placeholderMaterials = new Map<string, MeshStandardMaterial>();
  materialNames.forEach((name, idx) => {
    const placeholder = new MeshStandardMaterial({
      color: placeholderColor(idx, materialNames.length),
      metalness: 0.1,
      roughness: 0.7,
      name,
    });
    placeholderMaterials.set(name, placeholder);
    const meshes = meshesByMaterial.get(name)!;
    for (const m of meshes) m.material = placeholder;
  });

  return {
    root,
    meshesByMaterial,
    placeholderMaterials,
    materialNames,
    meshNames,
    filename,
  };
}
