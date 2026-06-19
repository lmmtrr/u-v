import { Engine } from "@babylonjs/core/Engines/engine";
import { RegisterEnginesExtensionsEngineRawTexture } from "@babylonjs/core/Engines/Extensions/engine.rawTexture.pure";
import { RegisterEnginesExtensionsEngineDynamicTexture } from "@babylonjs/core/Engines/Extensions/engine.dynamicTexture.pure";
import { RegisterEngineUniformBuffer } from "@babylonjs/core/Engines/Extensions/engine.uniformBuffer.pure";
import { RegisterStandardMaterial } from "@babylonjs/core/Materials/standardMaterial.pure";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { state } from "./state";
import { createScene, setupResizeListener } from "./scene";
import { setupDropzone, setupFileInput, updateUIState, showNotification } from "./ui";
import { loadFiles } from "./loader";
import { SceneManager } from "./scene_manager";
RegisterEnginesExtensionsEngineRawTexture();
RegisterEnginesExtensionsEngineDynamicTexture();
RegisterEngineUniformBuffer();
RegisterStandardMaterial();
const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const engine = new Engine(canvas);
const scene = createScene(engine);
setupResizeListener(engine);
const sceneManager = new SceneManager(scene);
const onFilesLoaded = () => sceneManager.rebuildScene();
setupDropzone((files) => loadFiles(files, null, state, onFilesLoaded));
setupFileInput((files) => loadFiles(files, null, state, onFilesLoaded));
window.onSkeletonToggle = (v: boolean) => {
  sceneManager.toggleSkeletonViewer(v);
};
window.onPhysicsToggle = (v: boolean) => {
  state.physicsEnabled = v;
};
window.onAnimationToggle = (v: boolean) => {
  state.animationPlaying = v;
  updateUIState({ animationPlaying: v });
};
window.onLoopToggle = (v: boolean) => {
  state.animationLoop = v;
  updateUIState({ animationLoop: v });
};
window.onSpeedChange = (v: number) => {
  state.animationSpeed = v;
  updateUIState({ animationSpeed: v });
};
window.onChangeBackgroundColor = (hexColor: string) => {
  const r = parseInt(hexColor.slice(1, 3), 16) / 255;
  const g = parseInt(hexColor.slice(3, 5), 16) / 255;
  const b = parseInt(hexColor.slice(5, 7), 16) / 255;
  scene.clearColor = new Color4(r, g, b, 1.0);
};
window.onExportGLB = () => {
  sceneManager.exportToGLB();
};
const urlInput = document.getElementById("input") as HTMLInputElement | null;
const submitBtn = document.getElementById("button") as HTMLButtonElement | null;
if (urlInput && submitBtn) {
  const handleUrlSubmit = async () => {
    const url = urlInput.value.trim();
    if (!url) {
      showNotification("Please enter a valid URL.", "error");
      return;
    }
    try {
      submitBtn.textContent = "Fetching...";
      submitBtn.disabled = true;
      submitBtn.style.opacity = "0.7";
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const blob = await response.blob();
      let filename = "remote_asset.ab";
      const parsedUrl = new URL(url);
      const pathSegments = parsedUrl.pathname.split('/');
      const lastSegment = pathSegments[pathSegments.length - 1];
      if (lastSegment && lastSegment.includes('.')) {
        filename = lastSegment;
      }
      const file = new File([blob], filename);
      showNotification(`Asset downloaded. Starting import...`, "success");
      await loadFiles([file], null, state, onFilesLoaded);
    } catch (error: any) {
      showNotification(
        `Failed to fetch asset from URL. Ensure CORS is enabled on the remote server.`,
        "error"
      );
    } finally {
      submitBtn.textContent = "Load";
      submitBtn.disabled = false;
      submitBtn.style.opacity = "1";
    }
  };
  submitBtn.addEventListener("click", handleUrlSubmit);
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      handleUrlSubmit();
    }
  });
}
window.state = state;
engine.runRenderLoop(() => scene.render());
export {};
