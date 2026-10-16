import { workerClient } from "./worker_client";
import { updateProgress, hideProgress } from "./progress";
import { showNotification, showSplash } from "./ui";
import type { AssetInfo, LoadedFile, ViewerState, UnityObject } from "./types";
import { isUnrealFile, loadUnrealFiles } from "./ue_loader";
const readFileAsArrayBuffer = (
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target!.result as ArrayBuffer);
    reader.onerror = (error) => reject(error);
    reader.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = (event.loaded / event.total) * 100;
        onProgress(percent);
      }
    };
    reader.readAsArrayBuffer(file);
  });
};
export const loadFiles = async (
  files: FileList | File[],
  _EnvironmentClass: unknown,
  state: ViewerState,
  onComplete: () => Promise<void> | void,
): Promise<void> => {
  window._animationPlayed = false;
  if (!files || files.length === 0) return;
  const unrealFiles = Array.from(files).filter((f) => isUnrealFile(f.name));
  const unityFiles = Array.from(files).filter((f) => !isUnrealFile(f.name));
  updateProgress(5, "Loading Files...", "Starting queue import");
  let skipOnComplete = false;
  if (unrealFiles.length > 0) {
    const loaded = await loadUnrealFiles(unrealFiles, state);
    if (!loaded && unityFiles.length === 0) {
      showSplash();
      hideProgress();
      return;
    }
  }
  const totalFiles = unityFiles.length;
  let filesCompleted = 0;
  const loadPromises = unityFiles.map(async (file) => {
    try {
      const arrayBuf = await readFileAsArrayBuffer(file, (percent) => {
        const overallPercent =
          5 +
          (percent * 0.25) / totalFiles +
          (filesCompleted / totalFiles) * 20;
        updateProgress(
          overallPercent,
          "Uploading File...",
          `Reading ${file.name} (${Math.round(percent)}%)`,
        );
      });
      const expectedEndPercent = 25 + ((filesCompleted + 1) / totalFiles) * 25;
      updateProgress(
        expectedEndPercent,
        "Parsing Asset Bundle...",
        `Decompressing structures in ${file.name}`,
      );
      const result: {
        fileIndex: number;
        name: string;
        objects: UnityObject[];
        hash: Record<string, string> | Map<string, string>;
        assetInfo?: AssetInfo | null;
      } = await workerClient.loadFile(arrayBuf, file.name);
      const { fileIndex, name, objects, hash, assetInfo } = result;
      if (!objects || objects.length === 0) {
        showNotification(
          `${file.name} may not be a Unity file or may be encrypted.`,
          "error",
        );
        showSplash();
        skipOnComplete = true;
      }
      state.loadedFiles.push({
        name,
        objects,
        hash,
        assetInfo,
        fileIndex,
        isExpanded: true,
      } as LoadedFile);
      filesCompleted++;
      updateProgress(
        25 + (filesCompleted / totalFiles) * 35,
        "Parsing Asset Bundle...",
        `Successfully parsed ${file.name}`,
      );
    } catch (err: any) {
      showNotification(
        `Failed to load ${file.name}: ${err?.message || String(err)}`,
        "error",
      );
      showSplash();
      filesCompleted++;
      skipOnComplete = true;
      updateProgress(
        25 + (filesCompleted / totalFiles) * 35,
        "Parsing Asset Bundle...",
        `Failed to parse ${file.name}`,
      );
    }
  });
  await Promise.all(loadPromises);
  if (skipOnComplete) {
    hideProgress();
    return;
  }
  updateProgress(75, "Building Scene...", "Assembling 3D nodes");
  await onComplete();
};
