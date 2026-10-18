export interface UnrealBone {
  name: string;
  parent?: number;
  rotation: [number, number, number, number];
  translation: [number, number, number];
  scale: [number, number, number];
}
export type UnrealSocket = UnrealBone & { bone: string };
export interface UnrealMaterialInfo {
  name: string;
  parents: string[];
  textures: Array<{ name: string; texture: string }>;
  scalars: Array<{ name: string; value: number }>;
  vectors: Array<{ name: string; value: [number, number, number, number] }>;
  blend_mode: string | null;
  two_sided: boolean | null;
  shading_model: string | null;
  opacity_mask_clip_value: number | null;
}
export interface UnrealMaterialSlot {
  slot_name: string;
  material: string | null;
  info?: UnrealMaterialInfo | null;
  baseColor?: string | null;
  lineColor?: string | null;
}
export interface UnrealAnimationEntry {
  path: string;
  name: string;
  skeleton: string | null;
  num_frames: number;
  length: number;
  hasBoneTracks: boolean;
  curves: string[];
  additive: string | null;
}
export interface UnrealAnimationSamples {
  name: string;
  num_frames: number;
  length: number;
  bones: string[];
  channels: Array<[boolean, boolean, boolean]>;
  curves: string[];
  samples: Float32Array;
}
export interface UnrealTexture {
  path: string;
  width: number;
  height: number;
  format: string;
  pixels: Uint8Array;
}
export interface UnrealMesh {
  id: string;
  isStatic: boolean;
  name: string;
  path: string;
  version: string;
  skeleton: string | null;
  sockets: UnrealSocket[];
  physicsBones: string[];
  bones: UnrealBone[];
  materials: UnrealMaterialSlot[];
  sections: Array<{ material_index: number; first_index: number; index_count: number }>;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  skinIndices: Uint32Array;
  skinWeights: Float32Array;
  morphNames: string[];
  morphCounts: number[];
  morphData: Float32Array;
}
export interface UnrealLoadResult {
  envId: number;
  meshes: UnrealMesh[];
  sockets: UnrealSocket[];
  textures: UnrealTexture[];
  animations: UnrealAnimationEntry[];
  errors: string[];
  needsMappings: boolean;
}
export interface UnrealFileData {
  envId: number;
  meshes: UnrealMesh[];
  sockets: UnrealSocket[];
  textures: UnrealTexture[];
  animations: UnrealAnimationEntry[];
}
