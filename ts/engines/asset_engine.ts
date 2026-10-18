import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import type { AnimationClipItem, AnimationData, LoadedFile, ViewerState } from "../types";
import type { PhysicsEntry } from "../physics_system";
import type { GenericPartAttachment } from "../bone_system";

export interface EngineScene {
  meshes: Mesh[];
  skeletons: Skeleton[];
  partAttachments: GenericPartAttachment[];
  animationClips: AnimationClipItem[];
  createPhysics: () => PhysicsEntry[];
}

export abstract class AssetEngine {
  abstract readonly id: string;

  abstract accepts(file: File): boolean;

  abstract load(files: File[], state: ViewerState): Promise<boolean>;

  abstract buildScene(scene: Scene, files: LoadedFile[]): Promise<EngineScene>;

  abstract buildAnimation(
    clip: AnimationClipItem,
    meshes: Mesh[],
    scene: Scene,
    state: ViewerState,
  ): AnimationData | Promise<AnimationData>;

  resetPose(_meshes: Mesh[]): void {}

  owns(file: LoadedFile): boolean {
    return file.engine === this.id;
  }

  ownsClip(clip: AnimationClipItem): boolean {
    return clip.engine === this.id;
  }
}
