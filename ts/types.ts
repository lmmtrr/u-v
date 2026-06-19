import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { Bone } from "@babylonjs/core/Bones/bone";
import type { MorphTarget } from "@babylonjs/core/Morph/morphTarget";
export type PathId = string;
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JSONValue[]
  | { [key: string]: JSONValue };
export type UnityObject = Record<string, JSONValue>;
export interface MeshRequest {
  fileIndex: number;
  pathId: PathId;
  sourceFileName: string;
  matrix?: Float32Array | number[] | null;
  normalMatrix?: Float32Array | number[] | null;
}
export interface MeshResponse {
  vertices?: Float32Array | null;
  normals?: Float32Array | null;
  uvs?: Float32Array | null;
  indices?: Uint32Array | null;
  skinIndices?: Uint32Array | null;
  skinWeights?: Float32Array | null;
}
export interface TextureMeta {
  path_id?: string | null;
  m_Width?: number;
  m_Height?: number;
  image_data?: string | Uint8Array | null;
  sourceFileName?: string;
  name?: string;
  m_Name?: string;
}
export interface MeshMeta {
  path_id?: string | null;
  m_VertexCount?: number;
  m_Vertices?: Float32Array | number[] | null;
  m_Normals?: Float32Array | number[] | null;
  m_Indices?: Uint32Array | number[] | null;
  m_UV0?: Float32Array | number[] | null;
  m_Skin?: Array<{
    boneIndex: [number, number, number, number];
    weight: [number, number, number, number];
  }> | null;
  m_BindPose?: Array<{ m?: number[] } | number[]> | null;
  m_BoneNameHashes?: number[] | null;
  m_Shapes?: {
    shapes?: Array<{
      vertexCount?: number;
      firstVertex?: number;
      vertices?: Array<{
        vertex?: { x: number; y: number; z: number };
        normal?: { x: number; y: number; z: number };
      }>;
    }>;
    channels?: Array<{
      name?: string;
      nameHash?: number;
      frameIndex?: number;
      frameCount?: number;
    }>;
    vertices?: Array<{
      index?: number;
      vertex?: [number, number, number] | number[];
    }>;
  } | null;
  m_SubMeshes?: Array<{
    firstByte?: number;
    indexCount?: number;
    topology?: number;
    baseVertex?: number;
    firstVertex?: number;
    vertexCount?: number;
    localAABB?: {
      m_Center?: { x: number; y: number; z: number };
      m_Extent?: { x: number; y: number; z: number };
    };
  }> | null;
  sourceFileName?: string;
  name?: string;
}
export interface GameObjectRef {
  path_id?: string | null;
  m_PathID?: string | null;
}
export interface LoadedFile {
  fileIndex?: number;
  name?: string;
  objects: UnityObject[];
  removedFromUI?: boolean;
  hash?: Record<string, string>;
  isExpanded?: boolean;
}
export interface AnimationClipItem {
  name: string;
  clipData: UnityObject;
}
export interface ViewerState {
  loadedFiles: LoadedFile[];
  allObjects: UnityObject[];
  allObjectHash: Map<string, string>;
  currentAnimationData: AnimationData | null;
  animationClips: AnimationClipItem[];
  animationPlaying: boolean;
  animationObserver: Observer<Scene> | null;
  animationLoop: boolean;
  animationSpeed: number;
  createdMeshes: Mesh[];
  animatorsByGameObjectId: Map<string, UnityObject>;
  avatarsByPathId: Map<string, UnityObject>;
  transformsByGameObjectId: Map<string, UnityObject>;
  transformsByPathId: Map<string, UnityObject>;
  transformNodesByPathId: Map<string, TransformNode>;
  showSkeletons: boolean;
  skeletonViewers: Array<{ dispose: () => void }>;
  physicsEnabled: boolean;
  physicsObserver: Observer<Scene> | null;
  partTranslations: Map<string, { x: number; y: number; z: number }>;
  materialCache: Map<string, Material>;
  textureCache: Map<string, Texture>;
  animationDropdown: HTMLElement | null;
  fileListPanel: HTMLDivElement | null;
  advancedTexture: object | null;
  _warnedEmptyAnim?: boolean;
  clearState(): void;
}
export interface EnvironmentInterface {
  getMeshVertices(
    path_id: PathId,
    source_file: string,
  ): Float32Array | undefined | null;
  getMeshNormals(
    path_id: PathId,
    source_file: string,
  ): Float32Array | undefined | null;
  getMeshUVs(path_id: PathId, source_file: string): Float32Array | undefined | null;
  getMeshIndices(
    path_id: PathId,
    source_file: string,
  ): Uint32Array | undefined | null;
  getTextureData(path_id: PathId, source_file: string): Uint8Array | undefined | null;
}
export interface StreamedCurveKeyType {
  index: number;
  coeff: number[];
  outSlope: number;
  value: number;
  inSlope: number;
}
export interface StreamedFrameType {
  time: number;
  keys: StreamedCurveKeyType[];
}
export interface AnimationCurveKey {
  time: number;
  frame: number;
  value: number;
}
export interface MuscleCurveItem {
  axis: string;
  curve: AnimationCurveKey[];
  humanBoneIndex: number;
}
export interface AnimationBoneData {
  position: Record<string, AnimationCurveKey[]>;
  rotation: Record<string, AnimationCurveKey[]>;
  scale: Record<string, AnimationCurveKey[]>;
  initialPos?: { x: number; y: number; z: number };
  initialRot?: any;
  originalInitialRot?: any;
  initialScale?: { x: number; y: number; z: number };
}
export interface AnimationData {
  name?: string;
  startTime?: number;
  frameRate?: number;
  curvesData?: Record<number, AnimationCurveKey[]>;
  bones: Map<Bone | TransformNode, AnimationBoneData>;
  muscles: Map<Bone | TransformNode, MuscleCurveItem[]>;
  morphs: Map<MorphTarget, AnimationCurveKey[]>;
  maxFrame: number;
  avatar?: UnityObject | null;
  lastUpdateTime?: number;
  accumulatedTime?: number;
}
declare global {
  interface Window {
    onSkeletonToggle?: (v: boolean) => void;
    onPhysicsToggle?: (v: boolean) => void;
    onAnimationToggle?: (v: boolean) => void;
    onLoopToggle?: (v: boolean) => void;
    onSpeedChange?: (v: number) => void;
    onChangeBackgroundColor?: (hex: string) => void;
    onExportGLB?: () => void;
    showSplash?: () => void;
    toggleSplash?: () => void;
    state?: ViewerState;
    _animationPlayed?: boolean;
    _missingBones?: Set<string | number>;
  }
}
