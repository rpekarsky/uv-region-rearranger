import type { Group, Mesh } from 'three';

export interface LoadedModel {
  root: Group;
  meshesByMaterial: Map<string, Mesh[]>;
  materialNames: string[];
  meshNames: string[];
  filename: string;
}

export interface Model3DInfo {
  filename: string;
  materialNames: string[];
  meshNames: string[];
}
