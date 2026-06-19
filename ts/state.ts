import { Observer } from "@babylonjs/core/Misc/observable";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Material } from "@babylonjs/core/Materials/material";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type {
  LoadedFile as LoadedFileType,
  ViewerState,
  AnimationData,
  UnityObject,
} from "./types";
export interface LoadedFile extends LoadedFileType {}
export interface AnimationClipItem {
  name: string;
  clipData: UnityObject;
}
export const state: ViewerState = {
  loadedFiles: [] as LoadedFile[],
  allObjects: [] as UnityObject[],
  allObjectHash: new Map<string, string>(),
  currentAnimationData: null as AnimationData | null,
  animationClips: [] as AnimationClipItem[],
  animationPlaying: false,
  animationObserver: null as Observer<Scene> | null,
  animationLoop: true,
  animationSpeed: 1.0,
  createdMeshes: [] as Mesh[],
  animatorsByGameObjectId: new Map<string, UnityObject>(),
  avatarsByPathId: new Map<string, UnityObject>(),
  transformsByGameObjectId: new Map<string, UnityObject>(),
  transformsByPathId: new Map<string, UnityObject>(),
  transformNodesByPathId: new Map<string, TransformNode>(),
  showSkeletons: false,
  skeletonViewers: [] as Array<{ dispose: () => void }>,
  physicsEnabled: false,
  physicsObserver: null as Observer<Scene> | null,
  partTranslations: new Map<string, { x: number; y: number; z: number }>(),
  materialCache: new Map<string, Material>(),
  textureCache: new Map<string, Texture>(),
  animationDropdown: null as HTMLElement | null,
  fileListPanel: null as HTMLDivElement | null,
  advancedTexture: null as object | null,
  _warnedEmptyAnim: false,
  clearState() {
    this.materialCache.clear();
    this.textureCache.clear();
    this.allObjects = [];
    this.allObjectHash.clear();
    this.currentAnimationData = null;
    this.animatorsByGameObjectId.clear();
    this.avatarsByPathId?.clear();
    this.transformsByGameObjectId.clear();
    this.transformsByPathId.clear();
    this.transformNodesByPathId.clear();
    if (this.skeletonViewers) {
      this.skeletonViewers.forEach((v: { dispose: () => void }) => v.dispose());
    }
    this.skeletonViewers = [];
    this.animationObserver = null;
    this.physicsObserver = null;
    this.animationClips = [];
    this.createdMeshes = [];
    this.animationPlaying = false;
    this._warnedEmptyAnim = false;
  },
};
