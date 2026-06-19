<script lang="ts">
  import { onMount } from "svelte";
  import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
  import type { LoadedFile, AnimationData, UnityObject } from "./types";
  import { state } from "./state";
  export let loadedFiles: LoadedFile[] = [];
  export let animationClips: Array<{ name: string }> = [];
  export let createdPathIds: Set<string> = new Set();
  export let partTranslations: Map<string, { x: number; y: number; z: number }> = new Map();
  export let showSkeletons = false;
  export let physicsEnabled = false;
  export let animationPlaying = false;
  export let currentAnimationIndex = -1;
  export let currentAnimationData: AnimationData | null = null;
  export let animationLoop = true;
  export let animationSpeed = 1.0;
  export let onClearModel: (index: number) => void = () => {};
  export let onRemovePart: (fileIndex: number, partId: string) => void = () => {};
  export let onToggleVisibility: (fileIndex: number, partId: string, name: string) => void = () => {};
  export let onToggleAllVisibility: (visible: boolean, fileIndex: number, partIds: string[], query?: string) => void = () => {};
  export let onTranslatePart: (partId: string, translation: { x: number; y: number; z: number }) => void = () => {};
  export let onToggleSubmeshVisibility: (fileIndex: number, partId: string, submeshIndex: number, visible: boolean) => void = () => {};
  export let onUpdateMorphTargetWeight: (partId: string, targetIndex: number, weight: number) => void = () => {};
  export let onPlayAnimation: (index: number) => void = () => {};
  export let onFilesDropped: (files: FileList) => void = () => {};
  export function updateProps(newProps: Record<string, unknown>) {
    if (newProps.loadedFiles !== undefined) loadedFiles = newProps.loadedFiles as LoadedFile[];
    if (newProps.animationClips !== undefined) animationClips = newProps.animationClips as Array<{ name: string }>;
    if (newProps.createdPathIds !== undefined) createdPathIds = newProps.createdPathIds as Set<string>;
    if (newProps.partTranslations !== undefined) partTranslations = newProps.partTranslations as Map<string, { x: number; y: number; z: number }>;
    if (newProps.showSkeletons !== undefined) showSkeletons = newProps.showSkeletons as boolean;
    if (newProps.physicsEnabled !== undefined) physicsEnabled = newProps.physicsEnabled as boolean;
    if (newProps.animationPlaying !== undefined) animationPlaying = newProps.animationPlaying as boolean;
    if (newProps.currentAnimationIndex !== undefined) currentAnimationIndex = newProps.currentAnimationIndex as number;
    if (newProps.currentAnimationData !== undefined) currentAnimationData = newProps.currentAnimationData as AnimationData | null;
    if (newProps.animationLoop !== undefined) animationLoop = newProps.animationLoop as boolean;
    if (newProps.animationSpeed !== undefined) animationSpeed = newProps.animationSpeed as number;
    if (newProps.onClearModel !== undefined) onClearModel = newProps.onClearModel as (index: number) => void;
    if (newProps.onRemovePart !== undefined) onRemovePart = newProps.onRemovePart as (fileIndex: number, partId: string) => void;
    if (newProps.onToggleVisibility !== undefined) onToggleVisibility = newProps.onToggleVisibility as (fileIndex: number, partId: string, name: string) => void;
    if (newProps.onToggleAllVisibility !== undefined) onToggleAllVisibility = newProps.onToggleAllVisibility as (visible: boolean, fileIndex: number, partIds: string[], query?: string) => void;
    if (newProps.onTranslatePart !== undefined) onTranslatePart = newProps.onTranslatePart as (partId: string, translation: { x: number; y: number; z: number }) => void;
    if (newProps.onToggleSubmeshVisibility !== undefined) onToggleSubmeshVisibility = newProps.onToggleSubmeshVisibility as (fileIndex: number, partId: string, submeshIndex: number, visible: boolean) => void;
    if (newProps.onUpdateMorphTargetWeight !== undefined) onUpdateMorphTargetWeight = newProps.onUpdateMorphTargetWeight as (partId: string, targetIndex: number, weight: number) => void;
    if (newProps.onPlayAnimation !== undefined) onPlayAnimation = newProps.onPlayAnimation as (index: number) => void;
    if (newProps.onFilesDropped !== undefined) onFilesDropped = newProps.onFilesDropped as (files: FileList) => void;
  }
  let showDroparea = false;
  let notifications: Array<{ id: number; message: string; type: string }> = [];
  let nextNotificationId = 0;
  let partFilters: Record<number, string> = {};
  let expandedParts: Record<string, boolean> = {};
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
  $: hasDynamicBone = loadedFiles.some(
    (file) =>
      !file.removedFromUI &&
      file.objects.some(
        (obj: UnityObject) => !!obj.DynamicBone,
      ),
  );
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
      const meshMeta = renderer.mesh as Record<string, unknown> | undefined;
      const partNameStr =
        String(renderer.name || meshMeta?.name || "part_" + partIdStr);
      const texturePathIds = renderer.texture_path_ids as unknown[] | undefined;
      const textureCount = (texturePathIds || []).filter(
        (id: unknown) => String(id) !== "0",
      ).length;
      const isCreated = !!(createdPathIds && createdPathIds.has(partIdStr));
      const current = bestPartsByName.get(partNameStr);
      if (
        !current ||
        isCreated ||
        (!current.isCreated && textureCount > current.textureCount)
      ) {
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
  function getPartDetails(partId: string) {
    const babylonMesh = state.createdMeshes.find(
      (m) => m.metadata && String(m.metadata.rendererPathId) === String(partId),
    );
    if (!babylonMesh) return { subMaterials: [], morphTargets: [], hasDetails: false };
    const originalSubMeshes = babylonMesh.metadata.originalSubMeshes || babylonMesh.subMeshes || [];
    const subMaterials = originalSubMeshes.map((subMesh, subIndex) => {
      const isSubVisible = babylonMesh.subMeshes.includes(subMesh);
      const friendlyName = (subMesh as any).friendlyName;
      let name = friendlyName || `Submesh ${subIndex + 1}`;
      if (babylonMesh.material instanceof MultiMaterial) {
        const subMat = babylonMesh.material.subMaterials[subMesh.materialIndex];
        if (subMat) {
          const matName = subMat.diffuseTexture
            ? subMat.diffuseTexture.name || `Texture ${subMesh.materialIndex + 1}`
            : subMat.name || `Submesh ${subIndex + 1}`;
          name = friendlyName ? `${friendlyName} (${matName})` : matName;
        }
      }
      return { originalIndex: subIndex, name, visible: isSubVisible, subMesh };
    });
    subMaterials.sort((a, b) => a.name.localeCompare(b.name));
    const morphTargets = babylonMesh.morphTargetManager
      ? Array.from(
          { length: babylonMesh.morphTargetManager.numTargets },
          (_, i) => {
            const target = babylonMesh.morphTargetManager.getTarget(i);
            return { name: target.name, influence: target.influence, target };
          },
        )
      : [];
    return {
      subMaterials,
      morphTargets,
      hasDetails: subMaterials.length > 1 || morphTargets.length > 0,
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
    if (e.dataTransfer && e.dataTransfer.files) {
      onFilesDropped(e.dataTransfer.files);
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
    return () => {
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
            {hasDynamicBone ? "Enable DynamicBone" : "Enable SpringBone"}
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
            <div class="file-tree-item">
              <div class="file-header-block">
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
                    {@const isExpanded = expandedParts[part.id] || (query && matchesSubmesh)}
                    {#if isFilterMatch}
                      <div class="part-row">
                        {#if subDetails.hasDetails}
                          <div
                            class="part-expand-toggle"
                            class:expanded={isExpanded}
                            on:click={() => (expandedParts[part.id] = !expandedParts[part.id])}
                          >
                            {isExpanded ? "▼" : "▶"}
                          </div>
                        {:else}
                          <div style="width: 14px; flex-shrink: 0;" />
                        {/if}
                        <div
                          class="visibility-toggle"
                          class:active={part.enabled !== false}
                          data-path-id={part.id}
                          data-part-name={part.name}
                          on:mousedown={(e) => {
                            e.preventDefault();
                            const nextVal = !(part.enabled !== false);
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
                              const currentVal = part.enabled !== false;
                              if (currentVal !== dragToggleState.targetValue) {
                                onToggleVisibility(fileIndex, part.id, part.name);
                              }
                            }
                          }}
                        />
                        <div
                          class="part-name"
                          class:active={part.enabled !== false}
                          data-path-id={part.id}
                          data-part-name={part.name}
                          on:mousedown={(e) => {
                            e.preventDefault();
                            const nextVal = !(part.enabled !== false);
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
                              const currentVal = part.enabled !== false;
                              if (currentVal !== dragToggleState.targetValue) {
                                onToggleVisibility(fileIndex, part.id, part.name);
                              }
                            }
                          }}
                        >
                          {part.name}
                        </div>
                        <button class="btn-icon" on:click={() => onRemovePart(fileIndex, part.id)}>
                          &times;
                        </button>
                      </div>
                      {#if isExpanded && subDetails.hasDetails}
                        <div class="part-details-container show">
                          {#if subDetails.subMaterials.length > 1}
                            <div class="submeshes-list">
                              {#each subDetails.subMaterials as sub}
                                {#if !query || sub.name.toLowerCase().includes(query)}
                                  <div class="submesh-row">
                                    <div
                                      class="submesh-eye-toggle"
                                      class:active={sub.visible}
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
                                    />
                                    <div
                                      class="submesh-name"
                                      class:active={sub.visible}
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
                                      {sub.name}
                                    </div>
                                  </div>
                                {/if}
                              {/each}
                            </div>
                          {/if}
                          {#if subDetails.morphTargets.length > 0}
                            <div class="part-details-header">Expressions</div>
                            <div class="blendshapes-list">
                              {#each getPartDetails(part.id).morphTargets as morph, morphIdx}
                                <div class="blendshape-row">
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
                                      bind:value={morph.influence}
                                      on:input={() => {
                                        onUpdateMorphTargetWeight(
                                          part.id,
                                          morphIdx,
                                          morph.influence,
                                        );
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
                        {#each ["x", "y", "z"] as axis}
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
