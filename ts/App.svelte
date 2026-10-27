<script lang="ts">
  import { onMount } from "svelte";
  import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
  import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
  import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
  import type { LoadedFile, AnimationData, UnityObject } from "./types";
  import { collectDroppedFiles } from "./drop_files";
  import { state } from "./state";
  export let loadedFiles: LoadedFile[] = [];
  export let animationClips: Array<{ name: string }> = [];
  export let createdPathIds: Set<string> = new Set();
  export let partTranslations: Map<string, { x: number; y: number; z: number }> = new Map();
  export let showSkeletons = false;
  export let showOutlines = false;
  export let physicsEnabled = false;
  export let animationPlaying = false;
  export let currentAnimationIndex = -1;
  export let currentAnimationData: AnimationData | null = null;
  export let animationLoop = true;
  export let animationSpeed = 1.0;
  export let onClearModel: (index: number) => void = () => {};
  export let onRemovePart: (fileIndex: number, partId: string, partName?: string) => void = () => {};
  export let onToggleVisibility: (fileIndex: number, partId: string, name: string) => void = () => {};
  export let onToggleAllVisibility: (visible: boolean, fileIndex: number, partIds: string[], query?: string) => void = () => {};
  export let onTranslatePart: (partId: string, translation: { x: number; y: number; z: number }) => void = () => {};
  export let onToggleSubmeshVisibility: (fileIndex: number, partId: string, submeshIndex: number, visible: boolean) => void = () => {};
  export let onUpdateMorphTargetWeight: (partId: string, targetIndex: number, weight: number) => void = () => {};
  export let onPlayAnimation: (index: number) => void = () => {};
  export let onFilesDropped: (files: FileList | File[]) => void = () => {};
  export function updateProps(newProps: Record<string, unknown>) {
    if (newProps.loadedFiles !== undefined) loadedFiles = newProps.loadedFiles as LoadedFile[];
    if (newProps.animationClips !== undefined) animationClips = newProps.animationClips as Array<{ name: string }>;
    if (newProps.createdPathIds !== undefined) createdPathIds = newProps.createdPathIds as Set<string>;
    if (newProps.partTranslations !== undefined) partTranslations = newProps.partTranslations as Map<string, { x: number; y: number; z: number }>;
    if (newProps.showSkeletons !== undefined) showSkeletons = newProps.showSkeletons as boolean;
    if (newProps.showOutlines !== undefined) showOutlines = newProps.showOutlines as boolean;
    if (newProps.physicsEnabled !== undefined) physicsEnabled = newProps.physicsEnabled as boolean;
    if (newProps.animationPlaying !== undefined) animationPlaying = newProps.animationPlaying as boolean;
    if (newProps.currentAnimationIndex !== undefined) currentAnimationIndex = newProps.currentAnimationIndex as number;
    if (newProps.currentAnimationData !== undefined) currentAnimationData = newProps.currentAnimationData as AnimationData | null;
    if (newProps.animationLoop !== undefined) animationLoop = newProps.animationLoop as boolean;
    if (newProps.animationSpeed !== undefined) animationSpeed = newProps.animationSpeed as number;
    if (newProps.onClearModel !== undefined) onClearModel = newProps.onClearModel as (index: number) => void;
    if (newProps.onRemovePart !== undefined) onRemovePart = newProps.onRemovePart as (fileIndex: number, partId: string, partName?: string) => void;
    if (newProps.onToggleVisibility !== undefined) onToggleVisibility = newProps.onToggleVisibility as (fileIndex: number, partId: string, name: string) => void;
    if (newProps.onToggleAllVisibility !== undefined) onToggleAllVisibility = newProps.onToggleAllVisibility as (visible: boolean, fileIndex: number, partIds: string[], query?: string) => void;
    if (newProps.onTranslatePart !== undefined) onTranslatePart = newProps.onTranslatePart as (partId: string, translation: { x: number; y: number; z: number }) => void;
    if (newProps.onToggleSubmeshVisibility !== undefined) onToggleSubmeshVisibility = newProps.onToggleSubmeshVisibility as (fileIndex: number, partId: string, submeshIndex: number, visible: boolean) => void;
    if (newProps.onUpdateMorphTargetWeight !== undefined) onUpdateMorphTargetWeight = newProps.onUpdateMorphTargetWeight as (partId: string, targetIndex: number, weight: number) => void;
    if (newProps.onPlayAnimation !== undefined) onPlayAnimation = newProps.onPlayAnimation as (index: number) => void;
    if (newProps.onFilesDropped !== undefined) onFilesDropped = newProps.onFilesDropped as (files: FileList | File[]) => void;
  }
  let showDroparea = false;
  let notifications: Array<{ id: number; message: string; type: string }> = [];
  let nextNotificationId = 0;
  let partFilters: Record<number, string> = {};
  let expandedParts: Record<string, boolean> = {};
  let filterExpandedOverrides: Record<string, boolean> = {};
  let expandedExpressions: Record<string, boolean> = {};
  let morphTick = 0;
  let morphSignature = "";
  let morphSyncFrame = 0;
  function syncMorphInfluences() {
    let signature = "";
    state.createdMeshes.forEach((mesh) => {
      const manager = mesh.morphTargetManager;
      if (!manager) return;
      for (let i = 0; i < manager.numTargets; i++) {
        signature += manager.getTarget(i).influence.toFixed(2) + ",";
      }
    });
    if (signature !== morphSignature) {
      morphSignature = signature;
      morphTick++;
    }
    morphSyncFrame = requestAnimationFrame(syncMorphInfluences);
  }
  function resetMorphTargets(partId: string) {
    getPartDetails(partId).morphTargets.forEach(({ target }) => {
      target.influence = 0;
      state.morphOverrides.delete(target);
    });
    morphTick++;
  }
  function startMorphDrag(e: PointerEvent, partId: string, morphIdx: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    const row = e.currentTarget as HTMLElement;
    const slider = row.querySelector<HTMLInputElement>(".blendshape-slider");
    if (!slider) return;
    const thumbSize = 12;
    const apply = (ev: PointerEvent) => {
      const rect = slider.getBoundingClientRect();
      const ratio = (ev.clientX - rect.left - thumbSize / 2) / Math.max(1, rect.width - thumbSize);
      const weight = Math.round(Math.min(1, Math.max(0, ratio)) * 100) / 100;
      onUpdateMorphTargetWeight(partId, morphIdx, weight);
      morphTick++;
    };
    const end = () => {
      row.removeEventListener("pointermove", apply);
      row.removeEventListener("pointerup", end);
      row.removeEventListener("pointercancel", end);
    };
    row.setPointerCapture(e.pointerId);
    row.addEventListener("pointermove", apply);
    row.addEventListener("pointerup", end);
    row.addEventListener("pointercancel", end);
    apply(e);
  }
  let lastPartFilters: Record<number, string> = {};
  let fileHeaderHeights: Record<number, number> = {};
  let partRowHeights: Record<string, number> = {};
  $: {
    for (const [fileIndexStr, q] of Object.entries(partFilters)) {
      const fIdx = Number(fileIndexStr);
      if (lastPartFilters[fIdx] !== q) {
        lastPartFilters[fIdx] = q;
        filterExpandedOverrides = {};
      }
    }
  }
  $: filesWithMeshes = loadedFiles.filter(
    (file) =>
      !file.removedFromUI &&
      file.objects.some(
        (obj: UnityObject) =>
          obj.SkinnedMeshRenderer || obj.MeshRenderer || obj.Mesh,
      ),
  );
  $: globalReferencedMeshIds = (() => {
    const ids = new Set<string>();
    const goFilters = new Map<string, string>();
    loadedFiles.forEach((file) => {
      if (file.removedFromUI || !file.objects) return;
      file.objects.forEach((obj: UnityObject) => {
        const filter = obj.MeshFilter as Record<string, unknown> | undefined;
        const gameObj = filter?.m_GameObject as Record<string, unknown> | undefined;
        if (filter && gameObj && filter.mesh_path_id) {
          const goId = String(gameObj.path_id || "");
          const meshId = String(filter.mesh_path_id);
          if (goId && meshId) {
            goFilters.set(goId, meshId);
          }
        }
      });
    });
    loadedFiles.forEach((file) => {
      if (file.removedFromUI || !file.objects) return;
      file.objects.forEach((obj: UnityObject) => {
        const renderer = (obj.SkinnedMeshRenderer || obj.MeshRenderer) as Record<string, unknown> | undefined;
        if (renderer) {
          let meshId = renderer.mesh_path_id ? String(renderer.mesh_path_id) : undefined;
          const gameObj = renderer.m_GameObject as Record<string, unknown> | undefined;
          if (!meshId && gameObj) {
            const goId = String(gameObj.path_id || "");
            if (goId) {
              meshId = goFilters.get(goId);
            }
          }
          if (meshId) ids.add(meshId);
        }
      });
    });
    return ids;
  })();
  $: hasPhysicsBones = loadedFiles.some(
    (file) =>
      !file.removedFromUI &&
      file.objects.some(
        (obj: UnityObject) => obj.SpringBone || obj.DynamicBone,
      ),
  );
  $: physicsLabel = (() => {
    const kinds = new Set<string>();
    loadedFiles.forEach((file) => {
      if (file.removedFromUI) return;
      file.objects.forEach((obj: UnityObject) => {
        if (obj.DynamicBone) kinds.add("DynamicBone");
        else if (obj.SpringBone) kinds.add(String((obj.SpringBone as Record<string, unknown>).label ?? "SpringBone"));
      });
    });
    return kinds.size === 1 ? `Enable ${[...kinds][0]}` : "Enable Physics";
  })();
  export function showNotification(message: string, type = "error", duration = 5000) {
    const id = nextNotificationId++;
    notifications = [...notifications, { id, message, type }];
    if (duration > 0) {
      setTimeout(() => {
        dismissNotification(id);
      }, duration);
    }
  }
  function dismissNotification(id: number) {
    notifications = notifications.filter((n) => n.id !== id);
  }
  function getBestParts(file: LoadedFile) {
    const bestPartsByName = new Map<string, { name: string; id: string; enabled: unknown; isCreated: boolean; textureCount: number }>();
    const renderers = file.objects.filter(
      (obj: UnityObject) => obj.SkinnedMeshRenderer || obj.MeshRenderer,
    );
    renderers.forEach((obj: UnityObject) => {
      const renderer = (obj.SkinnedMeshRenderer || obj.MeshRenderer) as Record<string, unknown>;
      const partIdStr = String(renderer.path_id || "");
      if (!partIdStr) return;
      const isCreated = !!(createdPathIds && createdPathIds.has(partIdStr));
      if (!isCreated) return;
      const meshMeta = renderer.mesh as Record<string, unknown> | undefined;
      const partNameStr =
        String(renderer.name || meshMeta?.name || "part_" + partIdStr);
      const texturePathIds = renderer.texture_path_ids as unknown[] | undefined;
      const textureCount = (texturePathIds || []).filter(
        (id: unknown) => String(id) !== "0",
      ).length;
      const current = bestPartsByName.get(partNameStr);
      if (!current || textureCount > current.textureCount) {
        bestPartsByName.set(partNameStr, {
          name: partNameStr,
          id: partIdStr,
          enabled: renderer.m_Enabled,
          isCreated,
          textureCount,
        });
      }
    });
    file.objects
      .filter((obj: UnityObject) => obj.Mesh)
      .forEach((obj: UnityObject) => {
        const mesh = obj.Mesh as Record<string, unknown>;
        const meshPathIdStr = String(mesh.path_id || "");
        if (!meshPathIdStr) return;
        if (
          globalReferencedMeshIds.size > 0 &&
          !globalReferencedMeshIds.has(meshPathIdStr)
        ) {
          return;
        }
        const partNameStr = String(mesh.name || "mesh_" + meshPathIdStr);
        if (bestPartsByName.has(partNameStr)) return;
        const rendererPathId = `orphan_${meshPathIdStr}`;
        const isCreated = !!(
          createdPathIds && createdPathIds.has(rendererPathId)
        );
        bestPartsByName.set(partNameStr, {
          name: partNameStr,
          id: rendererPathId,
          enabled: mesh.m_Enabled !== false,
          isCreated,
          textureCount: 0,
        });
      });
    return Array.from(bestPartsByName.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }
  function getPartDetails(partId: string, _tick = 0) {
    const babylonMesh = state.createdMeshes.find(
      (m) => m.metadata && String(m.metadata.rendererPathId) === String(partId),
    );
    if (!babylonMesh) return { subMaterials: [], morphTargets: [], hasDetails: false };
    const originalSubMeshes: SubMesh[] = babylonMesh.metadata.originalSubMeshes || babylonMesh.subMeshes || [];
    const subMaterials = originalSubMeshes.map((subMesh, subIndex) => {
      const isSubVisible = babylonMesh.subMeshes.includes(subMesh);
      const friendlyName = (subMesh as any).friendlyName;
      let name = friendlyName || `Submesh ${subIndex + 1}`;
      if (babylonMesh.material instanceof MultiMaterial) {
        const subMat = babylonMesh.material.subMaterials[subMesh.materialIndex];
        if (subMat) {
          const diffuse = (subMat as StandardMaterial).diffuseTexture;
          const matName = diffuse
            ? diffuse.name || `Texture ${subMesh.materialIndex + 1}`
            : subMat.name || `Submesh ${subIndex + 1}`;
          name = friendlyName ? `${friendlyName} (${matName})` : matName;
        }
      }
      return { originalIndex: subIndex, name, visible: isSubVisible, subMesh };
    });
    subMaterials.sort((a, b) => a.name.localeCompare(b.name));
    const morphManager = babylonMesh.morphTargetManager;
    const morphTargets = morphManager
      ? Array.from(
          { length: morphManager.numTargets },
          (_, i) => {
            const target = morphManager.getTarget(i);
            return { name: target.name, influence: target.influence, target };
          },
        )
      : [];
    return {
      subMaterials,
      morphTargets,
      hasDetails: subMaterials.length > 1,
    };
  }
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }
  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    showDroparea = true;
  }
  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    if (e.clientX === 0 && e.clientY === 0) {
      showDroparea = false;
    }
  }
  let showLeftPanel = false;
  let showRightPanel = false;
  let dragToggleState = {
    active: false,
    targetValue: false,
    type: "main" as "main" | "sub",
    fileIndex: -1,
    parentPartId: "",
  };
  const handleGlobalMouseUp = () => {
    dragToggleState.active = false;
  };
  function handleMouseMove(e: MouseEvent) {
    showLeftPanel = e.clientX <= 380;
    showRightPanel = e.clientX >= window.innerWidth - 380;
  }
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    showDroparea = false;
    if (e.dataTransfer) {
      collectDroppedFiles(e.dataTransfer).then((files) => onFilesDropped(files));
    }
  }
  function playAnimationAtIndex(index: number) {
    currentAnimationIndex = index;
    if (window.onAnimationToggle) {
      window.onAnimationToggle(currentAnimationIndex !== -1);
    }
    onPlayAnimation(currentAnimationIndex);
  }
  function handleKeyDown(e: KeyboardEvent) {
    const activeEl = document.activeElement;
    if (activeEl) {
      const tagName = activeEl.tagName.toLowerCase();
      if (
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        activeEl.hasAttribute("contenteditable")
      ) {
        return;
      }
    }
    const key = e.key.toLowerCase();
    if (key === "c") {
      e.preventDefault();
      if (window.toggleSplash) {
        window.toggleSplash();
      }
      return;
    }
    if (key === "v") {
      e.preventDefault();
      if (window.onExportGLB) {
        window.onExportGLB();
      } else {
        showNotification("GLB export function is not registered yet.", "info");
      }
      return;
    }
    if (!animationClips || animationClips.length === 0) {
      return;
    }
    if (key === "z") {
      e.preventDefault();
      let newIndex = currentAnimationIndex - 1;
      if (newIndex < -1) {
        newIndex = animationClips.length - 1;
      }
      playAnimationAtIndex(newIndex);
    } else if (key === "x") {
      e.preventDefault();
      let newIndex = currentAnimationIndex + 1;
      if (newIndex >= animationClips.length) {
        newIndex = -1;
      }
      playAnimationAtIndex(newIndex);
    }
  }
  onMount(() => {
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleGlobalMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    morphSyncFrame = requestAnimationFrame(syncMorphInfluences);
    return () => {
      cancelAnimationFrame(morphSyncFrame);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  });
  function getTranslation(partId: string, axis: "x" | "y" | "z") {
    const trans = partTranslations.get(String(partId));
    return trans ? trans[axis] : 0;
  }
  function updateTranslation(partId: string, axis: "x" | "y" | "z", val: number) {
    const partIdStr = String(partId);
    const current = {
      ...(partTranslations.get(partIdStr) || { x: 0, y: 0, z: 0 }),
    };
    current[axis] = val;
    onTranslatePart(partIdStr, current);
  }
  function togglePlay() {
    animationPlaying = !animationPlaying;
    if (window.onAnimationToggle) {
      window.onAnimationToggle(animationPlaying);
    }
  }
  function stopAnim() {
    animationPlaying = false;
    if (window.onAnimationToggle) {
      window.onAnimationToggle(false);
    }
    if (currentAnimationData) {
      currentAnimationData.accumulatedTime = 0;
      const seekbar = document.getElementById("animation-seekbar") as HTMLInputElement | null;
      if (seekbar) seekbar.value = "0";
      const label = document.getElementById("seekbar-label") as HTMLElement | null;
      if (label) label.textContent = `0 / ${currentAnimationData.maxFrame}`;
    }
  }
  function toggleLoop() {
    animationLoop = !animationLoop;
    if (window.onLoopToggle) {
      window.onLoopToggle(animationLoop);
    }
  }
  function handleSpeedChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const logVal = parseFloat(target.value);
    const speedVal = Math.pow(10, logVal);
    animationSpeed = speedVal;
    if (window.onSpeedChange) {
      window.onSpeedChange(speedVal);
    }
  }
  function handleSeekInput(e: Event) {
    const target = e.target as HTMLInputElement;
    const frameVal = parseFloat(target.value);
    if (animationPlaying) {
      animationPlaying = false;
      if (window.onAnimationToggle) {
        window.onAnimationToggle(false);
      }
    }
    if (currentAnimationData && currentAnimationData.frameRate) {
      currentAnimationData.accumulatedTime = frameVal / currentAnimationData.frameRate;
      const label = document.getElementById("seekbar-label");
      if (label) {
        label.textContent = `${Math.floor(frameVal)} / ${currentAnimationData.maxFrame}`;
      }
    }
  }
  let selectedBgColor = "#1a1a24";
  let customBgColor = "#1a1a24";
  function changeBgColor(color: string) {
    selectedBgColor = color;
    customBgColor = color;
    if (window.onChangeBackgroundColor) {
      window.onChangeBackgroundColor(color);
    }
  }
  function handleRemovePart(fileIndex: number, partId: string, partName?: string) {
    onRemovePart(fileIndex, partId, partName);
    const file = loadedFiles[fileIndex];
    if (file) {
      const cleanTargetId = partId.startsWith("orphan_") ? partId.slice(7) : partId;
      file.objects = file.objects.filter((obj: UnityObject) => {
        const type = Object.keys(obj)[0];
        const data = obj[type] as Record<string, unknown> | undefined;
        if (!data) return true;
        const pid = String(data.path_id ?? "");
        if (pid && (pid === partId || pid === cleanTargetId || `orphan_${pid}` === partId)) {
          return false;
        }
        if (partName && (type === "SkinnedMeshRenderer" || type === "MeshRenderer" || type === "Mesh")) {
          const meshMeta = data.mesh as Record<string, unknown> | undefined;
          const displayName = String(data.name || meshMeta?.name || "");
          if (displayName && displayName === partName) {
            return false;
          }
        }
        return true;
      });
      if (createdPathIds) {
        createdPathIds.delete(partId);
        createdPathIds.delete(cleanTargetId);
        createdPathIds = new Set(createdPathIds);
      }
      loadedFiles = [...loadedFiles];
    }
  }
</script>
{#if showDroparea}
  <div class="droparea active" on:dragleave={() => (showDroparea = false)}>
    Drag and drop files here
  </div>
{/if}
<div id="notifications">
  {#each notifications as note (note.id)}
    <div class="notification {note.type} show">
      <div class="notification-content">{note.message}</div>
      <button class="notification-close" on:click={() => dismissNotification(note.id)}>
        &times;
      </button>
    </div>
  {/each}
</div>
<div id="left-panels">
  {#if loadedFiles.some(f => !f.removedFromUI)}
    <div class="ui-panel ui-panel-left" class:visible={showLeftPanel} id="animation-panel">
      <button
        class="ui-btn"
        style="margin-bottom: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; flex-shrink: 0;"
        on:click={() => {
          if (window.toggleSplash) {
            window.toggleSplash();
          }
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
        Show Splash Screen (C)
      </button>
      <button
        class="ui-btn ui-btn-primary"
        style="margin-bottom: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; flex-shrink: 0;"
        on:click={() => {
          if (window.onExportGLB) {
            window.onExportGLB();
          } else {
            showNotification("GLB export function is not registered yet.", "info");
          }
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        Export GLB (V)
      </button>
      <div class="animation-selector">
        <select
          class="ui-select animation-list"
          size={999}
          bind:value={currentAnimationIndex}
          on:change={() => {
            if (window.onAnimationToggle) {
              window.onAnimationToggle(currentAnimationIndex !== -1);
            }
            onPlayAnimation(currentAnimationIndex);
          }}
        >
          <option value={-1}>None</option>
          {#each animationClips as clip, index}
            <option value={index}>{clip.name}</option>
          {/each}
        </select>
      </div>
      <div
        class="animation-controls-row"
        class:disabled={currentAnimationIndex === -1 || !currentAnimationData}
      >
        <button
          class="btn-playback inline-control"
          class:active={animationPlaying}
          disabled={currentAnimationIndex === -1 || !currentAnimationData}
          title={animationPlaying ? "Pause" : "Play"}
          on:click={togglePlay}
        >
          {#if animationPlaying}
            <svg viewBox="0 0 24 24" fill="currentColor" class="icon-svg">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="currentColor" class="icon-svg">
              <path d="M8 5v14l11-7z" />
            </svg>
          {/if}
        </button>
        <div class="seekbar-flex-container">
          <input
            type="range"
            class="animation-seekbar-slider"
            id="animation-seekbar"
            min="0"
            max={currentAnimationData ? currentAnimationData.maxFrame : 100}
            step="1"
            value="0"
            disabled={currentAnimationIndex === -1 || !currentAnimationData}
            on:input={handleSeekInput}
          />
        </div>
        <div class="speed-flex-container">
          <input
            type="range"
            class="speed-range-slider inline-speed"
            min="-1"
            max="1"
            step="0.01"
            value={animationSpeed > 0 ? Math.log10(animationSpeed) : -1}
            disabled={currentAnimationIndex === -1 || !currentAnimationData}
            title={`Speed: ${animationSpeed.toFixed(2)}x`}
            on:input={handleSpeedChange}
          />
          <span class="speed-slider-label-inline">{animationSpeed.toFixed(1)}x</span>
        </div>
        <span class="seekbar-label-counter-inline" id="seekbar-label">
          0 / {currentAnimationData ? currentAnimationData.maxFrame : 0}
        </span>
      </div>
    </div>
  {/if}
</div>
<div id="right-panels">
  {#if filesWithMeshes.length > 0}
    <div class="ui-panel ui-panel-right" class:visible={showRightPanel} id="files-panel">
      <div class="ui-control-row">
        <input
          type="checkbox"
          class="ui-checkbox"
          id="skeleton-toggle"
          bind:checked={showSkeletons}
          on:change={() => {
            if (window.onSkeletonToggle) {
              window.onSkeletonToggle(showSkeletons);
            }
          }}
        />
        <label for="skeleton-toggle" style="cursor: pointer; user-select: none;">Show Skeletons</label>
      </div>
      <div class="ui-control-row">
        <input
          type="checkbox"
          class="ui-checkbox"
          id="outline-toggle"
          bind:checked={showOutlines}
          on:change={() => {
            if (window.onOutlineToggle) {
              window.onOutlineToggle(showOutlines);
            }
          }}
        />
        <label for="outline-toggle" style="cursor: pointer; user-select: none;">Show Outlines</label>
      </div>
      {#if hasPhysicsBones}
        <div class="ui-control-row">
          <input
            type="checkbox"
            class="ui-checkbox"
            id="physics-toggle"
            bind:checked={physicsEnabled}
            on:change={() => {
              if (window.onPhysicsToggle) {
                window.onPhysicsToggle(physicsEnabled);
              }
            }}
          />
          <label for="physics-toggle" style="cursor: pointer; user-select: none;">
            {physicsLabel}
          </label>
        </div>
      {/if}
      <div class="ui-control-row" style="margin-bottom: 16px;">
        <div class="custom-color-picker-wrapper" title="Background Color">
          <input
            type="color"
            id="bg-color-picker"
            class="custom-color-picker"
            bind:value={customBgColor}
            on:input={(e) => changeBgColor(e.currentTarget.value)}
          />
          <span class="custom-color-icon">🎨</span>
        </div>
        <label for="bg-color-picker" style="font-size: 13px; color: var(--text-main); cursor: pointer; user-select: none;">Background Color</label>
      </div>
      <div class="ui-scroll-area">
        {#each loadedFiles as file, fileIndex}
          {#if !file.removedFromUI && file.objects.some((obj) => obj.SkinnedMeshRenderer || obj.MeshRenderer || obj.Mesh)}
            <div class="file-tree-item" style="--file-header-height: {fileHeaderHeights[fileIndex] || 0}px;">
              <div class="file-header-block" bind:offsetHeight={fileHeaderHeights[fileIndex]}>
                <div class="file-row">
                  <div
                    class="expand-toggle"
                    class:expanded={file.isExpanded}
                    on:click={() => (file.isExpanded = !file.isExpanded)}
                  >
                    ▶
                  </div>
                  <div class="file-name" on:click={() => (file.isExpanded = !file.isExpanded)}>
                    {file.name}
                  </div>
                  <button class="btn-icon btn-danger" on:click={() => onClearModel(fileIndex)}>
                    &times;
                  </button>
                </div>
                {#if file.isExpanded}
                  <div class="ui-control-row filter-row file-filter-row" style="display: flex;">
                    <div class="file-actions">
                      <button
                        class="btn-icon-sm"
                        title="Show all in this file"
                        on:click={() => {
                          const bestParts = getBestParts(file);
                          const query = (partFilters[fileIndex] || "").toLowerCase();
                          const visibleIds = bestParts
                            .filter((part) => {
                              const matchesMesh = part.name.toLowerCase().includes(query);
                              const subDetails = getPartDetails(part.id);
                              const matchesSubmesh = subDetails.subMaterials.some((sub) => sub.name.toLowerCase().includes(query));
                              return !query || matchesMesh || matchesSubmesh;
                            })
                            .map((part) => part.id);
                          onToggleAllVisibility(true, fileIndex, visibleIds, query);
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          style="width:14px;height:14px;"
                        >
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                      <button
                        class="btn-icon-sm"
                        title="Hide all in this file"
                        on:click={() => {
                          const bestParts = getBestParts(file);
                          const query = (partFilters[fileIndex] || "").toLowerCase();
                          const visibleIds = bestParts
                            .filter((part) => {
                              const matchesMesh = part.name.toLowerCase().includes(query);
                              const subDetails = getPartDetails(part.id);
                              const matchesSubmesh = subDetails.subMaterials.some((sub) => sub.name.toLowerCase().includes(query));
                              return !query || matchesMesh || matchesSubmesh;
                            })
                            .map((part) => part.id);
                          onToggleAllVisibility(false, fileIndex, visibleIds, query);
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          style="width:14px;height:14px;"
                        >
                          <path
                            d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                          />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      </button>
                    </div>
                    <input
                      type="text"
                      class="ui-input ui-filter-input"
                      placeholder="Filter parts..."
                      bind:value={partFilters[fileIndex]}
                    />
                  </div>
                {/if}
              </div>
              {#if file.isExpanded}
                <div class="parts-container show">
                  {#each getBestParts(file) as part}
                    {@const query = (partFilters[fileIndex] || "").toLowerCase()}
                    {@const subDetails = getPartDetails(part.id)}
                    {@const matchesMesh = part.name.toLowerCase().includes(query)}
                    {@const matchesSubmesh = subDetails.subMaterials.some(sub => sub.name.toLowerCase().includes(query))}
                    {@const isFilterMatch = !query || matchesMesh || matchesSubmesh}
                    {@const defaultExpanded = query ? (matchesSubmesh || !!expandedParts[part.id]) : !!expandedParts[part.id]}
                    {@const isExpanded = query && filterExpandedOverrides[part.id] !== undefined ? filterExpandedOverrides[part.id] : defaultExpanded}
                    {@const isPartActive = part.enabled !== false && subDetails.subMaterials.every((sub) => sub.visible)}
                    {#if isFilterMatch}
                      <div class="part-group" style="--part-row-height: {partRowHeights[part.id] || 0}px;">
                      <div class="part-row" bind:offsetHeight={partRowHeights[part.id]}>
                        {#if subDetails.hasDetails}
                          <div
                            class="part-expand-toggle"
                            class:expanded={isExpanded}
                            on:click={() => {
                              if (query) {
                                filterExpandedOverrides = { ...filterExpandedOverrides, [part.id]: !isExpanded };
                              } else {
                                expandedParts = { ...expandedParts, [part.id]: !isExpanded };
                              }
                            }}
                          >
                            {isExpanded ? "▼" : "▶"}
                          </div>
                        {:else}
                          <div style="width: 14px; flex-shrink: 0;" />
                        {/if}
                        <div
                          class="visibility-toggle"
                          class:active={isPartActive}
                          data-path-id={part.id}
                          data-part-name={part.name}
                          on:mousedown={(e) => {
                            e.preventDefault();
                            const nextVal = !isPartActive;
                            dragToggleState = {
                              active: true,
                              targetValue: nextVal,
                              type: "main",
                              fileIndex,
                              parentPartId: "",
                            };
                            onToggleVisibility(fileIndex, part.id, part.name);
                          }}
                          on:mouseenter={() => {
                            if (
                              dragToggleState.active &&
                              dragToggleState.type === "main" &&
                              dragToggleState.fileIndex === fileIndex
                            ) {
                              const currentVal = isPartActive;
                              if (currentVal !== dragToggleState.targetValue) {
                                onToggleVisibility(fileIndex, part.id, part.name);
                              }
                            }
                          }}
                        />
                        <div
                          class="part-name"
                          class:active={isPartActive}
                          data-path-id={part.id}
                          data-part-name={part.name}
                          on:mousedown={(e) => {
                            e.preventDefault();
                            const nextVal = !isPartActive;
                            dragToggleState = {
                              active: true,
                              targetValue: nextVal,
                              type: "main",
                              fileIndex,
                              parentPartId: "",
                            };
                            onToggleVisibility(fileIndex, part.id, part.name);
                          }}
                          on:mouseenter={() => {
                            if (
                              dragToggleState.active &&
                              dragToggleState.type === "main" &&
                              dragToggleState.fileIndex === fileIndex
                            ) {
                              const currentVal = isPartActive;
                              if (currentVal !== dragToggleState.targetValue) {
                                onToggleVisibility(fileIndex, part.id, part.name);
                              }
                            }
                          }}
                        >
                          {part.name}
                        </div>
                        <button class="btn-icon" on:click={() => handleRemovePart(fileIndex, part.id, part.name)}>
                          &times;
                        </button>
                      </div>
                      {#if isExpanded && subDetails.hasDetails}
                        <div class="part-details-container show">
                          {#if subDetails.subMaterials.length > 1}
                            <div class="submeshes-list">
                              {#each subDetails.subMaterials as sub}
                                {#if !query || sub.name.toLowerCase().includes(query)}
                                  <div
                                    class="submesh-row"
                                    on:mousedown={(e) => {
                                      e.preventDefault();
                                      const nextVal = !sub.visible;
                                      dragToggleState = {
                                        active: true,
                                        targetValue: nextVal,
                                        type: "sub",
                                        fileIndex,
                                        parentPartId: part.id,
                                      };
                                      sub.visible = nextVal;
                                      onToggleSubmeshVisibility(
                                        fileIndex,
                                        part.id,
                                        sub.originalIndex,
                                        nextVal,
                                      );
                                    }}
                                    on:mouseenter={() => {
                                      if (
                                        dragToggleState.active &&
                                        dragToggleState.type === "sub" &&
                                        dragToggleState.fileIndex === fileIndex &&
                                        dragToggleState.parentPartId === part.id
                                      ) {
                                        if (sub.visible !== dragToggleState.targetValue) {
                                          sub.visible = dragToggleState.targetValue;
                                          onToggleSubmeshVisibility(
                                            fileIndex,
                                            part.id,
                                            sub.originalIndex,
                                            dragToggleState.targetValue,
                                          );
                                        }
                                      }
                                    }}
                                  >
                                    <div class="submesh-eye-toggle" class:active={sub.visible} />
                                    <div class="submesh-name" class:active={sub.visible}>
                                      {sub.name}
                                    </div>
                                  </div>
                                {/if}
                              {/each}
                            </div>
                          {/if}
                        </div>
                      {/if}
                      {#if subDetails.morphTargets.length > 0}
                        {@const isExprExpanded = !!expandedExpressions[part.id]}
                        <div class="expressions-accordion">
                          <div
                            class="expressions-header-row"
                            on:click={() => (expandedExpressions = { ...expandedExpressions, [part.id]: !isExprExpanded })}
                          >
                            <div class="part-expand-toggle" class:expanded={isExprExpanded}>
                              {isExprExpanded ? "▼" : "▶"}
                            </div>
                            <span class="part-details-header">Expressions ({subDetails.morphTargets.length})</span>
                            <button
                              class="expressions-reset"
                              title="Reset all expressions to 0"
                              on:click|stopPropagation={() => resetMorphTargets(part.id)}
                            >Reset</button>
                          </div>
                          {#if isExprExpanded}
                          <div class="blendshapes-list">
                            {#each getPartDetails(part.id, morphTick).morphTargets as morph, morphIdx}
                              <div
                                class="blendshape-row"
                                on:pointerdown={(e) => startMorphDrag(e, part.id, morphIdx)}
                              >
                                <div class="blendshape-info">
                                  <div class="blendshape-label">{morph.name}</div>
                                  <div class="blendshape-value">
                                    {morph.influence.toFixed(2)}
                                  </div>
                                </div>
                                <div class="blendshape-slider-container">
                                  <input
                                    type="range"
                                    class="blendshape-slider"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={morph.influence}
                                    on:input={(e) => {
                                      const weight = Number(e.currentTarget.value);
                                      onUpdateMorphTargetWeight(part.id, morphIdx, weight);
                                      morphTick++;
                                    }}
                                  />
                                </div>
                              </div>
                            {/each}
                          </div>
                          {/if}
                        </div>
                      {/if}
                      <div class="translation-controls">
                        <div class="translation-label">Pos</div>
                        {#each ["x", "y", "z"] as const as axis}
                          <input
                            type="number"
                            class="translation-input"
                            step="0.01"
                            value={getTranslation(part.id, axis)}
                            on:input={(e) =>
                              updateTranslation(
                                part.id,
                                axis,
                                parseFloat(e.currentTarget.value) || 0,
                              )}
                          />
                        {/each}
                      </div>
                      </div>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</div>
