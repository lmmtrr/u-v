import { mount } from "svelte";
import App from "./App.svelte";
import type { LoadedFile, PathId, JSONValue, AnimationData } from "./types";
import { state } from "./state";
interface SvelteAppInstance {
  updateProps?: (props: Record<string, unknown>) => void;
  showNotification?: (message: string, type: string, duration: number) => void;
}
let app: SvelteAppInstance | null = null;
let savedProps = {
  loadedFiles: [] as LoadedFile[],
  animationClips: [] as Array<{ name: string }>,
  createdPathIds: new Set<string>(),
  partTranslations: new Map<string, { x: number; y: number; z: number }>(),
  showSkeletons: false,
  showOutlines: false,
  physicsEnabled: false,
  animationPlaying: false,
  currentAnimationIndex: -1,
  currentAnimationData: null as AnimationData | null,
  animationLoop: true,
  animationSpeed: 1.0,
  onClearModel: (index: number) => {},
  onRemovePart: (fileIndex: number, partId: string, partName?: string) => {},
  onToggleVisibility: (fileIndex: number, partId: string, name: string) => {},
  onToggleAllVisibility: (
    visible: boolean,
    fileIndex: number,
    partIds: string[],
    query?: string,
  ) => {},
  onTranslatePart: (
    partId: string,
    translation: { x: number; y: number; z: number },
  ) => {},
  onToggleSubmeshVisibility: (
    fileIndex: number,
    partId: string,
    submeshIndex: number,
    visible: boolean,
  ) => {},
  onUpdateMorphTargetWeight: (
    partId: string,
    targetIndex: number,
    weight: number,
  ) => {},
  onPlayAnimation: (index: number) => {},
  onFilesDropped: (files: FileList | File[]) => {},
};
const ensureApp = () => {
  if (!app) {
    const uiRoot = document.getElementById("ui-root");
    app = mount(App, {
      target: uiRoot || document.body,
      props: savedProps,
    }) as SvelteAppInstance;
  }
};
const updateApp = (newProps: Partial<typeof savedProps>) => {
  Object.assign(savedProps, newProps);
  ensureApp();
  if (app && typeof app.updateProps === "function") {
    try {
      app.updateProps(newProps);
    } catch {}
  }
};
export const updateUIState = (newProps: Partial<typeof savedProps>) => {
  updateApp(newProps);
};
export const setupDropzone = (
  onFilesDropped: (files: FileList | File[]) => void,
): HTMLDivElement => {
  updateApp({ onFilesDropped });
  return null as never as HTMLDivElement;
};
export const setupFileInput = (
  onFilesSelected: (files: FileList) => void,
): HTMLInputElement => {
  const createInput = (id: string, directory: boolean): HTMLInputElement => {
    let input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) {
      input = document.createElement("input");
      input.type = "file";
      input.id = id;
      input.multiple = true;
      input.webkitdirectory = directory;
      input.style.display = "none";
      input.onchange = (e: Event) =>
        onFilesSelected((e.target as HTMLInputElement).files!);
      document.body.appendChild(input);
    }
    return input;
  };
  const fileInput = createInput("file-upload-input", false);
  const folderInput = createInput("folder-upload-input", true);
  const bindClick = (id: string, input: HTMLInputElement) => {
    document.getElementById(id)?.addEventListener("click", (e) => {
      e.stopPropagation();
      input.click();
    });
  };
  bindClick("text-file", fileInput);
  bindClick("text-folder", folderInput);
  const uploadZone = document.getElementById("upload-zone");
  if (uploadZone) {
    uploadZone.addEventListener("click", () => fileInput.click());
  }
  const splash = document.getElementById("splash");
  if (splash) {
    splash.addEventListener("click", (e: MouseEvent) => {
      if (e.target === splash) {
        const hasLoadedModel = state.loadedFiles.some((f) => !f.removedFromUI);
        if (hasLoadedModel) {
          hideSplash();
        }
      }
    });
  }
  return fileInput;
};
export const createAnimationUI = (
  advancedTexture: object | null,
  animationClips: Array<{ name: string }>,
  playAnimationCallback: (index: number) => void,
  isPlaying: boolean,
): HTMLDivElement | null => {
  updateApp({
    animationClips,
    onPlayAnimation: playAnimationCallback,
    animationPlaying: isPlaying,
  });
  return null as never as HTMLDivElement;
};
export const createFileListUI = (
  advancedTexture: object | null,
  loadedFiles: LoadedFile[],
  onClearModel: (index: number) => void,
  onRemovePart: (fileIndex: number, partId: PathId, partName?: string) => void,
  onToggleVisibility: (fileIndex: number, partId: PathId, name: string) => void,
  onToggleAllVisibility: (
    visible: boolean,
    fileIndex: number,
    partIds: PathId[],
    query?: string,
  ) => void,
  onTranslatePart: (
    partId: PathId,
    translation: { x: number; y: number; z: number },
  ) => void,
  showSkeletons: boolean,
  partTranslations: Map<string, { x: number; y: number; z: number }>,
  physicsEnabled: boolean,
  createdPathIds: Set<PathId> | null = null,
  onToggleSubmeshVisibility:
    | ((
        fileIndex: number,
        partId: PathId,
        submeshIndex: number,
        visible: boolean,
      ) => void)
    | null = null,
  onUpdateMorphTargetWeight:
    | ((partId: PathId, targetIndex: number, weight: number) => void)
    | null = null,
): HTMLDivElement | null => {
  updateApp({
    loadedFiles,
    onClearModel,
    onRemovePart: (fileIdx: number, pid: string, name?: string) =>
      onRemovePart(fileIdx, pid as PathId, name),
    onToggleVisibility: (fileIdx: number, pid: string, name: string) =>
      onToggleVisibility(fileIdx, pid as PathId, name),
    onToggleAllVisibility: (
      visible: boolean,
      fileIdx: number,
      pids: string[],
      query?: string,
    ) => onToggleAllVisibility(visible, fileIdx, pids as PathId[], query),
    onTranslatePart: (
      pid: string,
      trans: { x: number; y: number; z: number },
    ) => onTranslatePart(pid as PathId, trans),
    showSkeletons,
    partTranslations,
    physicsEnabled,
    createdPathIds: createdPathIds || new Set<string>(),
    onToggleSubmeshVisibility: (
      fileIdx: number,
      pid: string,
      subIdx: number,
      visible: boolean,
    ) => {
      if (onToggleSubmeshVisibility) {
        onToggleSubmeshVisibility(fileIdx, pid as PathId, subIdx, visible);
      }
    },
    onUpdateMorphTargetWeight: (
      pid: string,
      targetIdx: number,
      weight: number,
    ) => {
      if (onUpdateMorphTargetWeight) {
        onUpdateMorphTargetWeight(pid as PathId, targetIdx, weight);
      }
    },
  });
  return null as never as HTMLDivElement;
};
export const hideSplash = () => {
  const splash = document.getElementById("splash");
  if (splash) {
    splash.classList.add("fade-out");
    setTimeout(() => {
      splash.style.display = "none";
    }, 400);
  }
};
export const showSplash = () => {
  const splash = document.getElementById("splash");
  if (splash) {
    splash.classList.remove("fade-out");
    splash.style.display = "flex";
  }
};
window.showSplash = showSplash;

export const toggleSplash = () => {
  const splash = document.getElementById("splash");
  if (!splash) return;
  const isHidden =
    splash.style.display === "none" || splash.classList.contains("fade-out");
  if (isHidden) {
    showSplash();
  } else {
    const hasLoadedModel = state.loadedFiles.some((f) => !f.removedFromUI);
    if (hasLoadedModel) {
      hideSplash();
    }
  }
};
window.toggleSplash = toggleSplash;
export const showNotification = (
  message: string,
  type: string = "error",
  duration: number = 5000,
) => {
  ensureApp();
  if (app && app.showNotification) {
    app.showNotification(message, type, duration);
  }
};
