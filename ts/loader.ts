import { updateProgress, hideProgress } from "./progress";
import { showSplash } from "./ui";
import type { ViewerState } from "./types";
import { groupFilesByEngine } from "./engines/registry";
export const loadFiles = async (
  files: FileList | File[],
  _EnvironmentClass: unknown,
  state: ViewerState,
  onComplete: () => Promise<void> | void,
): Promise<void> => {
  window._animationPlayed = false;
  if (!files || files.length === 0) return;
  updateProgress(5, "Loading Files...", "Starting queue import");
  const results: boolean[] = [];
  for (const [engine, engineFiles] of groupFilesByEngine(Array.from(files))) {
    results.push(await engine.load(engineFiles, state));
  }
  if (!results.some(Boolean)) {
    showSplash();
    hideProgress();
    return;
  }
  updateProgress(75, "Building Scene...", "Assembling 3D nodes");
  await onComplete();
};
