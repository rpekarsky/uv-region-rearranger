import type { Group, Mesh, MeshStandardMaterial } from 'three';

export interface LoadedModel {
  root: Group;
  meshesByMaterial: Map<string, Mesh[]>;
  placeholderMaterials: Map<string, MeshStandardMaterial>;
  materialNames: string[];
  meshNames: string[];
  filename: string;
}

export interface Model3DInfo {
  filename: string;
  materialNames: string[];
  meshNames: string[];
}
