import { updateProgress } from "../../progress";
import { showNotification, showSplash } from "../../ui";
import type { ViewerState } from "../../types";
import { unityWorker } from "./worker_api";
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
export const loadUnityFiles = async (
  files: File[],
  state: ViewerState,
  engine: string,
): Promise<boolean> => {
  const totalFiles = files.length;
  let filesCompleted = 0;
  let succeeded = false;
  const loadPromises = files.map(async (file) => {
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
      const { fileIndex, name, objects, hash, assetInfo } =
        await unityWorker.loadFile(arrayBuf, file.name);
      if (!objects || objects.length === 0) {
        showNotification(
          `${file.name} may not be a Unity file or may be encrypted.`,
          "error",
        );
        showSplash();
      } else {
        succeeded = true;
      }
      state.loadedFiles.push({
        name,
        engine,
        objects,
        hash,
        assetInfo,
        fileIndex,
        isExpanded: true,
      });
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
      updateProgress(
        25 + (filesCompleted / totalFiles) * 35,
        "Parsing Asset Bundle...",
        `Failed to parse ${file.name}`,
      );
    }
  });
  await Promise.all(loadPromises);
  return succeeded;
};
