import {
  BufferGeometry,
  BufferAttribute,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { registerModelLoader } from './loaderRegistry';
import type { LoadedModel } from './types';

// kn5 = Assetto Corsa binary model. Ported from the community Python converter
// (chipicao). Supports v5+ headers; pulls geometry + UVs + per-mesh material
// slot name. Textures, shader params, animations are skipped.

class Reader {
  view: DataView;
  pos = 0;
  td = new TextDecoder('utf-8');
  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf);
  }
  i32() {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  i16() {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  f32() {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  skip(n: number) {
    this.pos += n;
  }
  str() {
    const len = this.i32();
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, len);
    this.pos += len;
    return this.td.decode(bytes);
  }
  ascii(n: number) {
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n);
    this.pos += n;
    return this.td.decode(bytes);
  }
}

type Mat4 = number[]; // length 16, row-major

function identityMat4(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

// Row-major numpy-style matmul: out = a * b. Mirrors Python np.matmul(tmatrix, parent.hmatrix).
function matMul(a: Mat4, b: Mat4): Mat4 {
  const r = new Array<number>(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      r[i * 4 + j] =
        a[i * 4] * b[j] +
        a[i * 4 + 1] * b[4 + j] +
        a[i * 4 + 2] * b[8 + j] +
        a[i * 4 + 3] * b[12 + j];
    }
  }
  return r;
}

interface ParsedMaterial {
  name: string;
}

interface ParsedNode {
  name: string;
  type: number;
  hmatrix: Mat4;
  materialID: number;
  vertexCount: number;
  position?: Float32Array;
  normal?: Float32Array;
  uv?: Float32Array;
  indices?: Uint16Array;
}

function readMaterials(r: Reader, version: number): ParsedMaterial[] {
  const count = r.i32();
  const mats: ParsedMaterial[] = [];
  for (let m = 0; m < count; m++) {
    const name = r.str();
    r.str(); // shader name — unused
    r.i16(); // blendMode(byte) + alphaTested(byte)
    if (version > 4) r.skip(4); // depthMode(i32)

    const propCount = r.i32();
    for (let p = 0; p < propCount; p++) {
      r.str(); // prop name
      r.skip(4); // ValueA float
      r.skip(36); // ValueB(vec2) + ValueC(vec3) + ValueD(vec4)
    }

    const sampCount = r.i32();
    for (let s = 0; s < sampCount; s++) {
      r.str(); // sampler name
      r.skip(4); // slot index
      r.str(); // referenced texture name
    }

    mats.push({ name });
  }
  return mats;
}

function readTextures(r: Reader): void {
  const count = r.i32();
  for (let t = 0; t < count; t++) {
    r.skip(4); // active flag
    const name = r.str();
    const size = r.i32();
    if (size < 0 || r.pos + size > r.view.byteLength) {
      throw new Error(`tex ${t} "${name}" bogus size ${size}`);
    }
    r.skip(size);
  }
}

function readNodes(r: Reader, list: ParsedNode[], parentIdx: number): void {
  const type = r.i32();
  const name = r.str();
  const childCount = r.i32();
  r.skip(1); // active flag

  const node: ParsedNode = {
    name,
    type,
    hmatrix: identityMat4(),
    materialID: -1,
    vertexCount: 0,
  };

  let tmatrix: Mat4 | null = null;

  if (type === 1) {
    tmatrix = new Array<number>(16);
    for (let i = 0; i < 16; i++) tmatrix[i] = r.f32();
  } else if (type === 2 || type === 3) {
    r.skip(3); // 3 flag bytes

    if (type === 3) {
      const boneCount = r.i32();
      for (let b = 0; b < boneCount; b++) {
        r.str(); // bone name
        r.skip(64); // bone transform
      }
    }

    const vc = r.i32();
    node.vertexCount = vc;
    const position = new Float32Array(vc * 3);
    const normal = new Float32Array(vc * 3);
    const uv = new Float32Array(vc * 2);
    const skipAfterUV = type === 2 ? 12 : 44; // tangents (+ skin weights for type 3)

    for (let v = 0; v < vc; v++) {
      position[v * 3] = r.f32();
      position[v * 3 + 1] = r.f32();
      position[v * 3 + 2] = r.f32();
      normal[v * 3] = r.f32();
      normal[v * 3 + 1] = r.f32();
      normal[v * 3 + 2] = r.f32();
      uv[v * 2] = r.f32();
      uv[v * 2 + 1] = 1 - r.f32();
      r.skip(skipAfterUV);
    }

    const ic = r.i32();
    const indices = new Uint16Array(ic);
    for (let i = 0; i < ic; i++) {
      indices[i] = r.view.getUint16(r.pos + i * 2, true);
    }
    r.skip(ic * 2);
    node.materialID = r.i32();
    r.skip(type === 2 ? 29 : 12); // trailing bbox / padding

    node.position = position;
    node.normal = normal;
    node.uv = uv;
    node.indices = indices;
  } else {
    throw new Error(`kn5: unknown node type ${type} at ${name}`);
  }

  if (type === 1) {
    node.hmatrix = parentIdx < 0 ? tmatrix!.slice() : matMul(tmatrix!, list[parentIdx].hmatrix);
  } else {
    node.hmatrix = parentIdx < 0 ? identityMat4() : list[parentIdx].hmatrix.slice();
  }

  list.push(node);
  const me = list.length - 1;
  for (let c = 0; c < childCount; c++) readNodes(r, list, me);
}

function placeholderColor(i: number, n: number): Color {
  const hue = (i / Math.max(1, n)) * 360;
  return new Color().setHSL(hue / 360, 0.25, 0.55);
}

// Apply hmatrix to a (x,y,z) point in row-vector convention, then flip Z (LHS→RHS).
function transformPoint(h: Mat4, x: number, y: number, z: number, w: number, out: Float32Array, o: number) {
  out[o] = h[0] * x + h[4] * y + h[8] * z + h[12] * w;
  out[o + 1] = h[1] * x + h[5] * y + h[9] * z + h[13] * w;
  out[o + 2] = -(h[2] * x + h[6] * y + h[10] * z + h[14] * w);
}

function buildMesh(node: ParsedNode, materialName: string, material: MeshStandardMaterial): Mesh {
  const vc = node.vertexCount;
  const srcPos = node.position!;
  const srcNrm = node.normal!;
  const srcUv = node.uv!;
  const srcIdx = node.indices!;

  const worldPos = new Float32Array(vc * 3);
  const worldNrm = new Float32Array(vc * 3);
  for (let v = 0; v < vc; v++) {
    transformPoint(node.hmatrix, srcPos[v * 3], srcPos[v * 3 + 1], srcPos[v * 3 + 2], 1, worldPos, v * 3);
    transformPoint(node.hmatrix, srcNrm[v * 3], srcNrm[v * 3 + 1], srcNrm[v * 3 + 2], 0, worldNrm, v * 3);
  }

  // Flipping Z above reverses triangle winding; swap to restore CCW front faces.
  const tris = srcIdx.length / 3;
  const flipped = new Uint16Array(srcIdx.length);
  for (let t = 0; t < tris; t++) {
    flipped[t * 3] = srcIdx[t * 3];
    flipped[t * 3 + 1] = srcIdx[t * 3 + 2];
    flipped[t * 3 + 2] = srcIdx[t * 3 + 1];
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(worldPos, 3));
  geom.setAttribute('normal', new BufferAttribute(worldNrm, 3));
  geom.setAttribute('uv', new BufferAttribute(srcUv, 2));
  geom.setIndex(new BufferAttribute(flipped, 1));

  const mesh = new Mesh(geom, material);
  mesh.name = node.name;
  mesh.userData.materialSlot = materialName;
  return mesh;
}

async function loadKN5(blob: Blob, filename: string): Promise<LoadedModel> {
  const buffer = await blob.arrayBuffer();
  const r = new Reader(buffer);

  const magic = r.ascii(6);
  if (magic !== 'sc6969') {
    throw new Error(`kn5: bad magic "${magic}" (expected sc6969)`);
  }
  const version = r.u32();
  if (version > 5) r.skip(4); // extra uint32 in v6+

  readTextures(r);
  const materials = readMaterials(r, version);

  const nodes: ParsedNode[] = [];
  readNodes(r, nodes, -1);

  const root = new Group();
  root.name = filename;

  const meshesByMaterial = new Map<string, Mesh[]>();
  const meshNames: string[] = [];
  const placeholderMaterials = new Map<string, MeshStandardMaterial>();
  const materialNames: string[] = [];

  for (const node of nodes) {
    if (node.type !== 2 && node.type !== 3) continue;
    if (node.name.startsWith('AC_')) continue;
    if (!node.position || !node.indices) continue;

    const matName =
      node.materialID >= 0 && node.materialID < materials.length
        ? materials[node.materialID].name || `__mat_${node.materialID}`
        : '__default__';

    let placeholder = placeholderMaterials.get(matName);
    if (!placeholder) {
      placeholder = new MeshStandardMaterial({
        color: placeholderColor(materialNames.length, materials.length || 1),
        metalness: 0.1,
        roughness: 0.7,
        name: matName,
      });
      placeholderMaterials.set(matName, placeholder);
      materialNames.push(matName);
    }

    const mesh = buildMesh(node, matName, placeholder);
    meshNames.push(mesh.name || mesh.uuid);
    const bucket = meshesByMaterial.get(matName);
    if (bucket) bucket.push(mesh);
    else meshesByMaterial.set(matName, [mesh]);
    root.add(mesh);
  }

  return {
    root,
    meshesByMaterial,
    placeholderMaterials,
    materialNames,
    meshNames,
    filename,
  };
}

registerModelLoader({ extensions: ['kn5'], load: loadKN5 });
