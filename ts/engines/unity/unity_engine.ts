import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { AssetEngine, type EngineScene } from "../asset_engine";
import type { AnimationClipItem, AnimationData, LoadedFile, UnityObject, ViewerState } from "../../types";
import { buildAnimationData } from "../../animation_system";
import { loadUnityFiles } from "./loader";
import { UnitySceneBuilder } from "./scene_builder";

export class UnityEngine extends AssetEngine {
  readonly id = "unity";

  accepts(_file: File): boolean {
    return true;
  }

  load(files: File[], state: ViewerState): Promise<boolean> {
    return loadUnityFiles(files, state, this.id);
  }

  buildScene(scene: Scene, files: LoadedFile[]): Promise<EngineScene> {
    return new UnitySceneBuilder(scene).build(
      files.filter((f) => !f.removedFromUI),
      this.id,
    );
  }

  buildAnimation(clip: AnimationClipItem, meshes: Mesh[], scene: Scene, state: ViewerState): AnimationData {
    return buildAnimationData(clip as never as UnityObject, state.allObjectHash, meshes, scene);
  }
}
