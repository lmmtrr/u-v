import type { AssetEngine } from "./asset_engine";
import { UnityEngine } from "./unity/unity_engine";
import { UnrealEngine } from "./unreal/unreal_engine";
import type { AnimationClipItem, LoadedFile } from "../types";

const unityEngine = new UnityEngine();

export const engines: readonly AssetEngine[] = [unityEngine, new UnrealEngine()];

const fallbackEngine: AssetEngine = unityEngine;

export const engineForFile = (file: File): AssetEngine =>
  engines.find((e) => e !== fallbackEngine && e.accepts(file)) ?? fallbackEngine;

export const engineForClip = (clip: AnimationClipItem): AssetEngine | undefined =>
  engines.find((e) => e.ownsClip(clip));

export const filesOwnedBy = (engine: AssetEngine, files: LoadedFile[]): LoadedFile[] =>
  files.filter((f) => engine.owns(f));

export const groupFilesByEngine = (files: File[]): Map<AssetEngine, File[]> => {
  const groups = new Map<AssetEngine, File[]>();
  engines.forEach((engine) => {
    const owned = files.filter((f) => engineForFile(f) === engine);
    if (owned.length > 0) groups.set(engine, owned);
  });
  return groups;
};
