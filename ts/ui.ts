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
  physicsEnabled: false,
  animationPlaying: false,
  currentAnimationIndex: -1,
  currentAnimationData: null as AnimationData | null,
  animationLoop: true,
  animationSpeed: 1.0,
  onClearModel: (index: number) => {},
  onRemovePart: (fileIndex: number, partId: string) => {},
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
  onFilesDropped: (files: FileList) => {},
};
const ensureApp = () => {
  if (!app) {
    const uiRoot = document.getElementById("ui-root");
    app = mount(App, {
      target: uiRoot || document.body,
      props: savedProps,
    }) as SvelteAppInstance;
    let top = document.getElementById("notifications-top");
    if (!top) {
      top = document.createElement("div");
      top.id = "notifications-top";
      top.style.position = "fixed";
      top.style.bottom = "20px";
      top.style.right = "20px";
      top.style.display = "flex";
      top.style.flexDirection = "column";
      top.style.gap = "10px";
      top.style.zIndex = "11000";
      top.style.pointerEvents = "none";
      document.body.appendChild(top);
    }
    if (app && app.showNotification) {
      const orig = app.showNotification.bind(app);
      app.showNotification = (
        message: string,
        type: string = "error",
        duration: number = 5000,
      ) => {
        try {
          orig(message, type, duration);
        } catch {}
        try {
          const note = document.createElement("div");
          note.className = `notification ${type} show`;
          note.style.pointerEvents = "auto";
          const content = document.createElement("div");
          content.className = "notification-content";
          content.textContent = message;
          const closeBtn = document.createElement("button");
          closeBtn.className = "notification-close";
          closeBtn.innerHTML = "&times;";
          closeBtn.onclick = () => note.remove();
          note.appendChild(content);
          note.appendChild(closeBtn);
          top!.appendChild(note);
          if (duration > 0) setTimeout(() => note.remove(), duration);
        } catch {}
      };
    }
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
  onFilesDropped: (files: FileList) => void,
): HTMLDivElement => {
  updateApp({ onFilesDropped });
  return null as never as HTMLDivElement;
};
export const setupFileInput = (
  onFilesSelected: (files: FileList) => void,
): HTMLInputElement => {
  let fileInput = document.getElementById(
    "file-upload-input",
  ) as HTMLInputElement | null;
  if (!fileInput) {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.id = "file-upload-input";
    fileInput.multiple = true;
    fileInput.style.display = "none";
    fileInput.onchange = (e: Event) =>
      onFilesSelected((e.target as HTMLInputElement).files!);
    document.body.appendChild(fileInput!);
  }
  const textFile = document.getElementById("text-file");
  if (textFile) {
    textFile.addEventListener("click", (e) => {
      e.stopPropagation();
      fileInput!.click();
    });
  }
  const uploadZone = document.getElementById("upload-zone");
  if (uploadZone) {
    uploadZone.addEventListener("click", () => fileInput!.click());
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
  return fileInput!;
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
  onRemovePart: (fileIndex: number, partId: PathId) => void,
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
    onRemovePart: (fileIdx: number, pid: string) =>
      onRemovePart(fileIdx, pid as PathId),
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
