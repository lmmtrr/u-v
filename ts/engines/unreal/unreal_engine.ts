import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { AssetEngine, type EngineScene } from "../asset_engine";
import type { AnimationClipItem, AnimationData, LoadedFile, ViewerState } from "../../types";
import { loadUnrealFiles } from "./loader";
import { buildUnrealMeshes } from "./scene";
import { buildUnrealSpringBones } from "./physics";
import { unrealData } from "./file_data";
import { unrealWorker } from "./worker_api";
import {
  forgetUnrealSamples,
  buildUnrealAnimationData,
  resetUnrealPose,
  unrealAnimationClips,
  type UnrealClipData,
} from "./animation";

const UNREAL_EXTENSIONS = /\.(uasset|uexp|ubulk|usmap)$/i;

export class UnrealEngine extends AssetEngine {
  readonly id = "unreal";

  accepts(file: File): boolean {
    return UNREAL_EXTENSIONS.test(file.name);
  }

  load(files: File[], state: ViewerState): Promise<boolean> {
    return loadUnrealFiles(files, state, this.id);
  }

  async buildScene(scene: Scene, files: LoadedFile[]): Promise<EngineScene> {
    const meshes = buildUnrealMeshes(scene, files);
    return {
      meshes,
      skeletons: meshes.map((m) => m.skeleton).filter((s): s is Skeleton => !!s),
      partAttachments: [],
      animationClips: unrealAnimationClips(files, this.id),
      createPhysics: () => buildUnrealSpringBones(meshes),
    };
  }

  buildAnimation(clip: AnimationClipItem, meshes: Mesh[]): Promise<AnimationData> {
    return buildUnrealAnimationData(clip.clipData as never as UnrealClipData, meshes);
  }

  release(file: LoadedFile): void {
    const data = unrealData(file);
    if (!data) return;
    forgetUnrealSamples(data.envId);
    unrealWorker.freeEnvironment(data.envId).catch(() => {});
  }

  resetPose(meshes: Mesh[]): void {
    resetUnrealPose(meshes);
  }
}
