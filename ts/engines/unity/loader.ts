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
const RAW_STREAM = /\.(resS|resource)$/i;
const isBundle = (buffer: ArrayBuffer): boolean =>
  new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(7, buffer.byteLength))) === "UnityFS";
export const loadUnityFiles = async (
  droppedFiles: File[],
  state: ViewerState,
  engine: string,
): Promise<boolean> => {
  const rawStreams = droppedFiles.filter((f) => RAW_STREAM.test(f.name));
  const files = droppedFiles.filter((f) => !RAW_STREAM.test(f.name));
  if (files.length === 0) {
    showNotification(
      "Load .resS / .resource files together with the serialized file that uses them.",
      "error",
    );
    return false;
  }
  const rawStreamsFor = async (file: File, buffer: ArrayBuffer) => {
    const matched = rawStreams.filter((raw) => raw.name.startsWith(file.name));
    const selected = matched.length > 0 || isBundle(buffer) ? matched : rawStreams;
    return Promise.all(
      selected.map(async (raw) => ({ name: raw.name, arrayBuffer: await raw.arrayBuffer() })),
    );
  };
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
        await unityWorker.loadFile(arrayBuf, file.name, await rawStreamsFor(file, arrayBuf));
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
