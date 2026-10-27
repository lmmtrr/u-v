import { Bone } from "@babylonjs/core/Bones/bone";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Matrix, Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { SkeletonViewer } from "@babylonjs/core/Debug/skeletonViewer";
import { Light } from "@babylonjs/core/Lights/light";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { IndicesArray } from "@babylonjs/core/types";
import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { GLTF2Export } from "@babylonjs/serializers/glTF/2.0/glTFSerializer";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { state } from "./state";
import {
  createAnimationUI,
  createFileListUI,
  hideSplash,
  updateUIState,
  showNotification,
} from "./ui";
import { createAnimationObserver } from "./animation_system";
import { interpolate } from "./animation_interpolator";
import { applyHumanoidRotation } from "./humanoid_system";
import { createPhysicsObserver } from "./physics_system";
import { updateProgress, hideProgress } from "./progress";
import type { UnityObject, JSONValue, AnimationData } from "./types";
import type { EngineScene } from "./engines/asset_engine";
import { engineForClip, engines, filesOwnedBy } from "./engines/registry";
const EXPORT_EMISSIVE = 0;
export class SceneManager {
  public scene: Scene;
  constructor(scene: Scene) {
    this.scene = scene;
  }
  public cleanUpSceneResources() {
    if (state.animationObserver) {
      this.scene.onBeforeRenderObservable.remove(state.animationObserver);
    }
    if (state.physicsObserver) {
      this.scene.onBeforeRenderObservable.remove(state.physicsObserver);
    }
    this.scene.meshes.slice().forEach((m) => m.dispose());
    this.scene.skeletons.slice().forEach((s) => s.dispose());
    this.scene.transformNodes.slice().forEach((n) => n.dispose());
    state.clearState();
  }
  public removePart = (
    fileIndex: number,
    partId: string,
    partName?: string,
  ) => {
    const file = state.loadedFiles[fileIndex];
    if (!file) return;
    const targetId = String(partId);
    const cleanTargetId = targetId.startsWith("orphan_")
      ? targetId.slice(7)
      : targetId;

    const isMatchObj = (obj: UnityObject): boolean => {
      const type = Object.keys(obj)[0];
      const data = obj[type] as Record<string, unknown> | undefined;
      if (!data) return false;
      const pid = String(data.path_id ?? "");
      if (
        pid &&
        (pid === targetId ||
          pid === cleanTargetId ||
          `orphan_${pid}` === targetId)
      ) {
        return true;
      }
      if (partName) {
        const meshMeta = data.mesh as Record<string, unknown> | undefined;
        const displayName = String(data.name || meshMeta?.name || "");
        if (displayName && displayName === partName) {
          return true;
        }
      }
      return false;
    };
    file.objects = file.objects.filter((obj) => !isMatchObj(obj));
    state.allObjects = state.allObjects.filter((obj) => !isMatchObj(obj));
    state.createdMeshes = state.createdMeshes.filter((mesh) => {
      if (!mesh.metadata) return true;
      const rId = String(mesh.metadata.rendererPathId ?? "");
      const idMatch =
        rId === targetId ||
        rId === cleanTargetId ||
        `orphan_${rId}` === targetId ||
        this.isApproxPathIdMatch(rId, targetId);
      const nameMatch =
        !!partName &&
        ((mesh.name && mesh.name.toLowerCase() === partName.toLowerCase()) ||
          (mesh.metadata.name &&
            String(mesh.metadata.name).toLowerCase() ===
              partName.toLowerCase()));
      if (idMatch || nameMatch) {
        mesh.dispose();
        return false;
      }
      return true;
    });
    if (state.partTranslations) {
      state.partTranslations.delete(targetId);
      state.partTranslations.delete(cleanTargetId);
    }
    const createdPathIds = new Set<string>(
      state.createdMeshes.map((m) => String(m.metadata?.rendererPathId)),
    );
    updateUIState({
      loadedFiles: [...state.loadedFiles],
      createdPathIds,
    });
  };
  public isApproxPathIdMatch = (idA: unknown, idB: unknown): boolean => {
    if (!idA || !idB) return false;
    const strA = String(idA).replace("orphan_", "");
    const strB = String(idB).replace("orphan_", "");
    if (strA === strB) return true;
    if (strA.length >= 15 && strB.length >= 15) {
      return strA.substring(0, 15) === strB.substring(0, 15);
    }
    return false;
  };
  public togglePartVisibility = (
    fileIndex: number,
    partId: string,
    partName: string,
  ) => {
    const file = state.loadedFiles[fileIndex];
    if (!file) return;
    const targetId = partId;
    const matchingRenderers: Array<Record<string, JSONValue>> = [];
    file.objects.forEach((obj) => {
      const data = (obj?.SkinnedMeshRenderer ||
        obj?.MeshRenderer ||
        obj?.Mesh) as Record<string, JSONValue> | undefined;
      if (!data) return;
      const pathIdStr = String(data.path_id || "");
      if (!pathIdStr) return;
      const meshMeta = data.mesh as Record<string, JSONValue> | undefined;
      const displayName = String(
        data.name || meshMeta?.name || `part_${pathIdStr}`,
      );
      const isMatch =
        (targetId &&
          (pathIdStr === targetId || `orphan_${pathIdStr}` === targetId)) ||
        (partName && displayName && displayName === partName);
      if (isMatch) {
        matchingRenderers.push(data);
      }
    });
    if (matchingRenderers.length > 0) {
      const matchingMeshes = state.createdMeshes.filter((mesh) => {
        if (!mesh.metadata) return false;
        const meshPathIdStr = String(mesh.metadata.rendererPathId);
        return matchingRenderers.some((data) => {
          const pathIdStr = String(data.path_id || "");
          const meshMeta = data.mesh as Record<string, JSONValue> | undefined;
          const displayName = String(
            data.name || meshMeta?.name || `part_${pathIdStr}`,
          );
          const idMatch =
            meshPathIdStr === pathIdStr ||
            meshPathIdStr === `orphan_${pathIdStr}`;
          const normMeshName = (mesh.name || "").toLowerCase();
          const normDispName = (displayName || "").toLowerCase();
          const normDataName = String(data.name || "").toLowerCase();
          const normPartName = (partName || "").toLowerCase();
          const nameMatch =
            (normMeshName && normDispName && normMeshName === normDispName) ||
            (normMeshName && normDataName && normMeshName === normDataName) ||
            (normMeshName && normPartName && normMeshName === normPartName);
          return idMatch || nameMatch;
        });
      });
      let currentEnabled: boolean;
      if (matchingMeshes.length > 0) {
        currentEnabled = matchingMeshes.some(
          (m) => m.isEnabled() && this.isMeshFullyVisible(m),
        );
      } else {
        const hasTrue = matchingRenderers.some(
          (data) => data.m_Enabled === true,
        );
        const hasFalse = matchingRenderers.some(
          (data) => data.m_Enabled === false,
        );
        if (hasTrue) {
          currentEnabled = true;
        } else if (hasFalse) {
          currentEnabled = false;
        } else {
          currentEnabled = matchingRenderers.some(
            (data) => data.m_Enabled !== false,
          );
        }
      }
      const nextEnabled = !currentEnabled;
      matchingRenderers.forEach((data) => {
        data.m_Enabled = nextEnabled;
      });
      const allToggles = document.querySelectorAll(".visibility-toggle");
      const allNames = document.querySelectorAll(".part-name");
      allToggles.forEach((t) => {
        const el = t as HTMLElement;
        const pid = el.getAttribute("data-path-id") || el.dataset?.pathId;
        const row = t.closest(".part-row");
        const nameEl = row?.querySelector(".part-name");
        const rowName = nameEl?.textContent;
        if (
          (targetId && pid === String(targetId)) ||
          (partName && rowName === partName)
        ) {
          el.classList.toggle("active", nextEnabled);
        }
      });
      allNames.forEach((n) => {
        const el = n as HTMLElement;
        const pid = el.getAttribute("data-path-id") || el.dataset?.pathId;
        const rowName = n.textContent;
        if (
          (targetId && pid === String(targetId)) ||
          (partName && rowName === partName)
        ) {
          el.classList.toggle("active", nextEnabled);
        }
      });
      state.createdMeshes.forEach((mesh) => {
        if (mesh.metadata) {
          const meshPathIdStr = String(mesh.metadata.rendererPathId);
          const hasMatch = matchingRenderers.some((data) => {
            const pathIdStr = String(data.path_id || "");
            const meshMeta = data.mesh as Record<string, JSONValue> | undefined;
            const displayName = String(
              data.name || meshMeta?.name || `part_${pathIdStr}`,
            );
            const idMatch =
              meshPathIdStr === pathIdStr ||
              meshPathIdStr === `orphan_${pathIdStr}`;
            const normMeshName = (mesh.name || "").toLowerCase();
            const normDispName = (displayName || "").toLowerCase();
            const normDataName = String(data.name || "").toLowerCase();
            const normPartName = (partName || "").toLowerCase();
            const nameMatch =
              (normMeshName && normDispName && normMeshName === normDispName) ||
              (normMeshName && normDataName && normMeshName === normDataName) ||
              (normMeshName && normPartName && normMeshName === normPartName);
            return idMatch || nameMatch;
          });
          if (hasMatch) {
            if (!mesh.metadata.originalSubMeshes) {
              mesh.metadata.originalSubMeshes = [...mesh.subMeshes];
            }
            const originalSubMeshes = mesh.metadata.originalSubMeshes as any[];
            if (!mesh.metadata.visibleSubmeshIndices) {
              mesh.metadata.visibleSubmeshIndices = new Set(
                originalSubMeshes
                  .map((sub, idx) => (mesh.subMeshes.includes(sub) ? idx : -1))
                  .filter((idx) => idx !== -1),
              );
            }
            if (nextEnabled) {
              originalSubMeshes.forEach((_, idx) =>
                mesh.metadata.visibleSubmeshIndices.add(idx),
              );
            } else {
              mesh.metadata.visibleSubmeshIndices.clear();
            }
            mesh.subMeshes = originalSubMeshes.filter((_, idx) =>
              mesh.metadata.visibleSubmeshIndices.has(idx),
            );
            mesh.setEnabled(nextEnabled);
          }
        }
      });
      updateUIState({ loadedFiles: [...state.loadedFiles] });
    }
  };
  public toggleAllVisibility = (
    nextEnabled: boolean,
    targetFileIndex = -1,
    pathIds: string[] | null = null,
    query = "",
  ) => {
    const filesToProcess =
      targetFileIndex >= 0
        ? [state.loadedFiles[targetFileIndex]]
        : state.loadedFiles;
    filesToProcess.forEach((file) => {
      if (!file || file.removedFromUI) return;
      const namesToToggle = new Set<string>();
      if (pathIds) {
        file.objects.forEach((obj) => {
          const data = (obj?.SkinnedMeshRenderer ||
            obj?.MeshRenderer ||
            obj?.Mesh) as Record<string, JSONValue> | undefined;
          if (data) {
            const pathIdStr = String(data.path_id || "");
            const isOrphan = pathIds.some((pid) =>
              this.isApproxPathIdMatch(pid, pathIdStr),
            );
            if (isOrphan && pathIdStr) {
              const meshMeta = data.mesh as
                | Record<string, JSONValue>
                | undefined;
              const name = String(
                data.name || meshMeta?.name || `part_${pathIdStr}`,
              );
              namesToToggle.add(name);
            }
          }
        });
      }
      const matchingRenderers: Array<Record<string, JSONValue>> = [];
      const fullyVisibleByRenderer = new Map<Record<string, JSONValue>, boolean>();
      file.objects.forEach((obj) => {
        const data = (obj?.SkinnedMeshRenderer ||
          obj?.MeshRenderer ||
          obj?.Mesh) as Record<string, JSONValue> | undefined;
        if (data) {
          const pathIdStr = String(data.path_id || "");
          const meshMeta = data.mesh as Record<string, JSONValue> | undefined;
          const name = String(
            data.name || meshMeta?.name || `part_${pathIdStr}`,
          );
          const matchesPath =
            pathIds &&
            pathIds.some((pid) => this.isApproxPathIdMatch(pid, pathIdStr));
          const matchesName = pathIds && namesToToggle.has(name);
          if (pathIds && !matchesPath && !matchesName) return;
          data.m_Enabled = nextEnabled;
          matchingRenderers.push(data);
        }
      });
      state.createdMeshes.forEach((mesh) => {
        const matchedRenderer =
          mesh.metadata &&
          matchingRenderers.find((data) => {
            const pathIdStr = String(data.path_id || "");
            const meshPathIdStr = String(mesh.metadata.rendererPathId);
            return this.isApproxPathIdMatch(meshPathIdStr, pathIdStr);
          });
        if (matchedRenderer) {
          if (!mesh.metadata.originalSubMeshes) {
            mesh.metadata.originalSubMeshes = [...mesh.subMeshes];
          }
          const originalSubMeshes = mesh.metadata.originalSubMeshes as any[];
          if (!mesh.metadata.visibleSubmeshIndices) {
            mesh.metadata.visibleSubmeshIndices = new Set(
              originalSubMeshes
                .map((sub, idx) => (mesh.subMeshes.includes(sub) ? idx : -1))
                .filter((idx) => idx !== -1),
            );
          }
          if (query) {
            const getSubmeshName = (subMesh: any, subIndex: number) => {
              const friendlyName = subMesh.friendlyName;
              let name = friendlyName || `Submesh ${subIndex + 1}`;
              if (mesh.material instanceof MultiMaterial) {
                const subMat =
                  mesh.material.subMaterials[subMesh.materialIndex];
                if (subMat) {
                  const standardMat = subMat as any;
                  const matName = standardMat.diffuseTexture
                    ? standardMat.diffuseTexture.name ||
                      `Texture ${subMesh.materialIndex + 1}`
                    : standardMat.name || `Submesh ${subIndex + 1}`;
                  name = friendlyName
                    ? `${friendlyName} (${matName})`
                    : matName;
                }
              }
              return name;
            };
            originalSubMeshes.forEach((sub, subIndex) => {
              const subName = getSubmeshName(sub, subIndex);
              if (subName.toLowerCase().includes(query.toLowerCase())) {
                if (nextEnabled) {
                  mesh.metadata.visibleSubmeshIndices.add(subIndex);
                } else {
                  mesh.metadata.visibleSubmeshIndices.delete(subIndex);
                }
              }
            });
            mesh.subMeshes = originalSubMeshes.filter((_, idx) =>
              mesh.metadata.visibleSubmeshIndices.has(idx),
            );
            mesh.setEnabled(mesh.metadata.visibleSubmeshIndices.size > 0);
          } else {
            if (nextEnabled) {
              originalSubMeshes.forEach((_, idx) =>
                mesh.metadata.visibleSubmeshIndices.add(idx),
              );
            } else {
              mesh.metadata.visibleSubmeshIndices.clear();
            }
            mesh.subMeshes = originalSubMeshes.filter((_, idx) =>
              mesh.metadata.visibleSubmeshIndices.has(idx),
            );
            mesh.setEnabled(nextEnabled);
          }
          matchedRenderer.m_Enabled = mesh.isEnabled();
          fullyVisibleByRenderer.set(
            matchedRenderer,
            this.isMeshFullyVisible(mesh),
          );
        }
      });
      const allToggles = document.querySelectorAll(".visibility-toggle");
      const allNames = document.querySelectorAll(".part-name");
      matchingRenderers.forEach((data) => {
        const pathIdStr = String(data.path_id || "");
        const isActive =
          !!data.m_Enabled && fullyVisibleByRenderer.get(data) !== false;
        allToggles.forEach((t) => {
          const pid =
            (t as HTMLElement).getAttribute("data-path-id") ||
            (t as HTMLElement).dataset?.pathId;
          if (this.isApproxPathIdMatch(pid, pathIdStr)) {
            t.classList.toggle("active", isActive);
          }
        });
        allNames.forEach((n) => {
          const pid =
            (n as HTMLElement).getAttribute("data-path-id") ||
            (n as HTMLElement).dataset?.pathId;
          if (this.isApproxPathIdMatch(pid, pathIdStr)) {
            n.classList.toggle("active", isActive);
          }
        });
      });
    });
    updateUIState({ loadedFiles: [...state.loadedFiles] });
  };
  public toggleSubmeshVisibility = (
    fileIndex: number,
    partId: string,
    submeshIndex: number,
    visible: boolean,
  ) => {
    const targetIdStr = String(partId);
    const mesh = state.createdMeshes.find(
      (m) => m.metadata && String(m.metadata.rendererPathId) === targetIdStr,
    );
    if (mesh) {
      if (!mesh.metadata.originalSubMeshes) {
        mesh.metadata.originalSubMeshes = [...mesh.subMeshes];
      }
      const originalSubMeshes = mesh.metadata.originalSubMeshes as SubMesh[];
      if (!mesh.metadata.visibleSubmeshIndices) {
        mesh.metadata.visibleSubmeshIndices = new Set(
          originalSubMeshes
            .map((sub, idx) => (mesh.subMeshes.includes(sub) ? idx : -1))
            .filter((idx) => idx !== -1),
        );
      }
      if (visible) {
        mesh.metadata.visibleSubmeshIndices.add(submeshIndex);
      } else {
        mesh.metadata.visibleSubmeshIndices.delete(submeshIndex);
      }
      mesh.subMeshes = originalSubMeshes.filter((_, idx) =>
        mesh.metadata.visibleSubmeshIndices.has(idx),
      );
      updateUIState({ loadedFiles: [...state.loadedFiles] });
    }
  };
  private isMeshFullyVisible(mesh: Mesh): boolean {
    const originalSubMeshes = mesh.metadata?.originalSubMeshes as
      | SubMesh[]
      | undefined;
    if (!originalSubMeshes) return true;
    return originalSubMeshes.every((sub) => mesh.subMeshes.includes(sub));
  }
  public updateMorphTargetWeight = (
    partId: string,
    targetIndex: number,
    value: number,
  ) => {
    const targetIdStr = String(partId);
    const mesh = state.createdMeshes.find(
      (m) => m.metadata && String(m.metadata.rendererPathId) === targetIdStr,
    );
    if (mesh && mesh.morphTargetManager) {
      const target = mesh.morphTargetManager.getTarget(targetIndex);
      if (target) {
        target.influence = value;
      }
    }
  };
  public onTranslatePart = (
    partId: string,
    translation: { x: number; y: number; z: number },
  ) => {
    const partIdStr = String(partId);
    state.partTranslations.set(partIdStr, translation);
    const renderer = state.allObjects.find((obj) => {
      const data = (obj?.SkinnedMeshRenderer || obj?.MeshRenderer) as
        | Record<string, JSONValue>
        | undefined;
      return data && String(data.path_id || "") === partIdStr;
    });
    if (renderer) {
      const data = (renderer.SkinnedMeshRenderer || renderer.MeshRenderer) as
        | Record<string, JSONValue>
        | undefined;
      const gameObj = data?.m_GameObject as
        | Record<string, JSONValue>
        | undefined;
      const transformId = gameObj ? String(gameObj.path_id || "") : "";
      const transform = transformId
        ? state.transformsByGameObjectId.get(transformId)
        : undefined;
      const transformPathId = transform?.path_id
        ? String(transform.path_id)
        : "";
      const node = state.transformNodesByPathId.get(transformPathId);
      if (node) {
        const localPos = transform?.m_LocalPosition as
          | Record<string, number>
          | undefined;
        const basePos = localPos
          ? new Vector3(localPos.x ?? 0, localPos.y ?? 0, localPos.z ?? 0)
          : Vector3.Zero();
        node.position.set(
          basePos.x + translation.x,
          basePos.y + translation.y,
          basePos.z + translation.z,
        );
        node.metadata = node.metadata || {};
        node.metadata.partTranslation = translation;
        const mesh = state.createdMeshes.find(
          (m) => m.metadata?.gameObjectId === transformId,
        );
        if (mesh && mesh.skeleton) {
          mesh.position.set(translation.x, translation.y, translation.z);
        }
        return;
      }
    }
    this.rebuildScene(true);
  };
  private resetToBindPose = () => {
    state.transformNodesByPathId.forEach((node) => {
      if (node.metadata) {
        if (node.metadata.initialPosition) {
          node.position.copyFrom(node.metadata.initialPosition);
          if (node.metadata.partTranslation) {
            node.position.x += node.metadata.partTranslation.x;
            node.position.y += node.metadata.partTranslation.y;
            node.position.z += node.metadata.partTranslation.z;
          }
        }
        if (
          node.rotationQuaternion &&
          node.metadata.initialRotationQuaternion
        ) {
          node.rotationQuaternion.copyFrom(
            node.metadata.initialRotationQuaternion,
          );
        } else if (node.metadata.initialRotation) {
          node.rotation.copyFrom(node.metadata.initialRotation);
        }
        if (node.metadata.initialScaling) {
          node.scaling.copyFrom(node.metadata.initialScaling);
        }
      }
    });
    state.createdMeshes.forEach((mesh) => {
      if (mesh.morphTargetManager) {
        for (let i = 0; i < mesh.morphTargetManager.numTargets; i++) {
          mesh.morphTargetManager.getTarget(i).influence = 0;
        }
      }
    });
    engines.forEach((engine) => engine.resetPose(state.createdMeshes));
  };
  public stopAnimation = () => {
    state.currentAnimationData = null;
    state.animationPlaying = false;
    this.resetToBindPose();
    updateUIState({
      currentAnimationIndex: -1,
      currentAnimationData: null,
      animationPlaying: false,
    });
  };
  private animationRequest = 0;
  private applyAnimation(idx: number, data: AnimationData) {
    state.currentAnimationData = data;
    state.currentAnimationData.startTime = performance.now();
    state.animationPlaying = true;
    updateUIState({
      currentAnimationIndex: idx,
      currentAnimationData: state.currentAnimationData,
      animationPlaying: state.animationPlaying,
    });
  }
  public playAnimation = (idx: number) => {
    const request = ++this.animationRequest;
    if (idx === -1) {
      this.stopAnimation();
      return;
    }
    const clip = state.animationClips[idx];
    const engine = clip && engineForClip(clip);
    if (!engine) return;
    this.resetToBindPose();
    const reportFailure = (err: unknown) =>
      showNotification(
        `Failed to load animation ${clip.name}: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    let result: AnimationData | Promise<AnimationData>;
    try {
      result = engine.buildAnimation(clip, state.createdMeshes, this.scene, state);
    } catch (err) {
      reportFailure(err);
      return;
    }
    if (!(result instanceof Promise)) {
      this.applyAnimation(idx, result);
      return;
    }
    result.then((data) => {
      if (request === this.animationRequest) this.applyAnimation(idx, data);
    }, reportFailure);
  };
  public clearModel = (index: number) => {
    const file = state.loadedFiles[index];
    if (file) {
      file.removedFromUI = true;
      file.objects = file.objects.filter((obj) => {
        const type = Object.keys(obj)[0];
        return type !== "SkinnedMeshRenderer" && type !== "Mesh";
      });
      this.rebuildScene();
    }
  };
  private addSkeletonViewer(skeleton: Skeleton) {
    const targetMesh =
      this.scene.meshes.find((m) => m.skeleton === skeleton) ||
      new Mesh("dummy", this.scene);
    state.skeletonViewers.push(
      new SkeletonViewer(skeleton, targetMesh, this.scene, true, 3, {
        displayMode: SkeletonViewer.DISPLAY_LINES,
        displayOptions: { color: new Color3(1, 0, 0) } as never,
      }),
    );
  }
  public toggleSkeletonViewer = (v: boolean) => {
    if (state.showSkeletons !== v) {
      state.showSkeletons = v;
      if (v) {
        this.scene.skeletons.forEach((skeleton) => this.addSkeletonViewer(skeleton));
      } else {
        state.skeletonViewers.forEach((viewer) => viewer.dispose());
        state.skeletonViewers = [];
      }
    }
  };
  public async rebuildScene(skipUIUpdate = false) {
    this.cleanUpSceneResources();
    const builtScenes: EngineScene[] = [];
    for (const engine of engines) {
      const files = filesOwnedBy(engine, state.loadedFiles);
      if (files.length > 0) builtScenes.push(await engine.buildScene(this.scene, files));
    }
    state.createdMeshes = builtScenes.flatMap((built) => built.meshes);
    state.genericPartAttachments = builtScenes.flatMap((built) => built.partAttachments);
    if (state.showSkeletons) {
      builtScenes.forEach((built) =>
        built.skeletons.forEach((skeleton) => this.addSkeletonViewer(skeleton)),
      );
    }
    state.animationClips = builtScenes.flatMap((built) => built.animationClips);
    if (state.animationClips.length > 0) {
      if (!skipUIUpdate) {
        state.animationDropdown = createAnimationUI(
          state.advancedTexture,
          state.animationClips as never,
          this.playAnimation,
          state.animationPlaying,
        );
      }
      this.playAnimation(-1);
      state.animationObserver = createAnimationObserver(this.scene, state);
    } else {
      if (!skipUIUpdate) {
        updateUIState({
          animationClips: [],
          animationPlaying: false,
          currentAnimationIndex: -1,
          currentAnimationData: null,
        });
      }
    }
    const physicsEntries = builtScenes.flatMap((built) => built.createPhysics());
    if (physicsEntries.length > 0) {
      state.physicsObserver = createPhysicsObserver(this.scene, physicsEntries);
    }
    if (!skipUIUpdate) {
      const createdPathIds = new Set(
        state.createdMeshes.map((m) => String(m.metadata?.rendererPathId)),
      );
      state.fileListPanel = createFileListUI(
        state.advancedTexture,
        state.loadedFiles,
        this.clearModel,
        this.removePart,
        this.togglePartVisibility,
        this.toggleAllVisibility,
        this.onTranslatePart,
        state.showSkeletons,
        state.partTranslations,
        state.physicsEnabled,
        createdPathIds,
        this.toggleSubmeshVisibility,
        this.updateMorphTargetWeight,
      );
    }
    hideSplash();
    hideProgress();
  }
  public async exportToGLB() {
    let wasSkeletonVisible = false;
    let originalTime = 0;
    let originalPlaying = false;
    const exportRestores: Array<() => void> = [];
    try {
      updateProgress(0, "Preparing GLB export...");
      wasSkeletonVisible = state.showSkeletons;
      if (wasSkeletonVisible) {
        this.toggleSkeletonViewer(false);
      }
      const activeFile = state.loadedFiles.find((f) => !f.removedFromUI);
      const baseName = activeFile
        ? activeFile.name?.replace(/\.[^/.]+$/, "")
        : "model";
      const animName = state.currentAnimationData?.name;
      const exportName = animName
        ? `${baseName}_${animName}_export`
        : `${baseName}_export`;
      updateProgress(15, "Converting active animations for GLB...");
      const createdAnimations: Array<{ node: any; anims: any[] }> = [];
      let tempAnimGroup: any = null;
      if (state.currentAnimationData) {
        const animData = state.currentAnimationData;
        originalTime = animData.accumulatedTime || 0;
        originalPlaying = state.animationPlaying;
        state.animationPlaying = false;
        const frameRate = animData.frameRate || 24;
        const maxFrame = animData.maxFrame || 1;
        const TO_RAD = Math.PI / 180;
        const attachments = state.genericPartAttachments || [];
        const attachmentNodes = new Set<TransformNode>(
          attachments.map((a) => a.partNode),
        );
        const attachMat1 = new Matrix();
        const attachMat2 = new Matrix();
        const attachMat3 = new Matrix();
        const attachScale = new Vector3();
        const attachRot = new Quaternion();
        const attachPos = new Vector3();
        const preparedSkeletons = new Set<Skeleton>();
        const applyAttachments = () => {
          if (attachments.length === 0) return;
          preparedSkeletons.clear();
          attachments.forEach(
            ({ partNode, humanBone, partBindAbsolute, humanBoneBindAbsolute }) => {
              const humanSkeleton = humanBone.getSkeleton();
              if (!preparedSkeletons.has(humanSkeleton)) {
                humanSkeleton.prepare(true);
                preparedSkeletons.add(humanSkeleton);
              }
              humanBoneBindAbsolute.invertToRef(attachMat1);
              partBindAbsolute.multiplyToRef(attachMat1, attachMat2);
              attachMat2.multiplyToRef(
                humanBone.getAbsoluteMatrix(),
                attachMat3,
              );
              attachMat3.decompose(attachScale, attachRot, attachPos);
              partNode.position.copyFrom(attachPos);
              if (!partNode.rotationQuaternion) {
                partNode.rotationQuaternion = attachRot.clone();
              } else {
                partNode.rotationQuaternion.copyFrom(attachRot);
              }
            },
          );
        };
        const evaluateFrame = (frame: number) => {
          animData.bones.forEach((boneData, bone) => {
            const node =
              "getTransformNode" in bone
                ? (bone as Bone).getTransformNode()
                : (bone as TransformNode);
            if (!node) return;
            const hasPos =
              boneData.position.x || boneData.position.y || boneData.position.z;
            if (hasPos) {
              const isRootNode = (boneData as any).isRoot === true;
              if (isRootNode) {
                if (boneData.initialPos) {
                  node.position.set(
                    boneData.initialPos.x,
                    boneData.initialPos.y,
                    boneData.initialPos.z,
                  );
                } else {
                  node.position.set(0, 0, 0);
                }
              } else {
                const x = interpolate(boneData.position.x, frame);
                const y = interpolate(boneData.position.y, frame);
                const z = interpolate(boneData.position.z, frame);
                node.position.set(
                  x !== null ? x : (boneData.initialPos?.x ?? 0),
                  y !== null ? y : (boneData.initialPos?.y ?? 0),
                  z !== null ? z : (boneData.initialPos?.z ?? 0),
                );
              }
              const metadata = node.metadata as {
                partTranslation?: { x: number; y: number; z: number };
              } | null;
              if (metadata && metadata.partTranslation) {
                node.position.addInPlace(
                  new Vector3(
                    metadata.partTranslation.x,
                    metadata.partTranslation.y,
                    metadata.partTranslation.z,
                  ),
                );
              }
            }
            const hasRot =
              boneData.rotation.x ||
              boneData.rotation.y ||
              boneData.rotation.z ||
              boneData.rotation.w;
            if (hasRot) {
              const x = interpolate(boneData.rotation.x, frame);
              const y = interpolate(boneData.rotation.y, frame);
              const z = interpolate(boneData.rotation.z, frame);
              const w = interpolate(boneData.rotation.w, frame);
              if (x !== null && y !== null && z !== null) {
                if (w !== null) {
                  node.rotationQuaternion = new Quaternion(x, y, z, w);
                  node.rotationQuaternion.normalize();
                } else {
                  node.rotationQuaternion = Quaternion.FromEulerAngles(
                    x * TO_RAD,
                    y * TO_RAD,
                    z * TO_RAD,
                  );
                }
              }
            }
            const hasScale =
              boneData.scale.x || boneData.scale.y || boneData.scale.z;
            if (hasScale) {
              const x = interpolate(boneData.scale.x, frame);
              const y = interpolate(boneData.scale.y, frame);
              const z = interpolate(boneData.scale.z, frame);
              node.scaling.set(
                x !== null ? x : (boneData.initialScale?.x ?? 1),
                y !== null ? y : (boneData.initialScale?.y ?? 1),
                z !== null ? z : (boneData.initialScale?.z ?? 1),
              );
            }
          });
          animData.muscles.forEach((muscleCurves, targetBone) => {
            const muscleVals: Record<string, number> = {};
            let hasAny = false;
            let humanBoneIndex = 0;
            for (const mc of muscleCurves) {
              const val = interpolate(mc.curve, frame);
              if (val !== null) {
                muscleVals[mc.axis] = val;
                hasAny = true;
                humanBoneIndex = mc.humanBoneIndex;
              }
            }
            if (hasAny) {
              const avatarObj =
                "avatar" in targetBone
                  ? (targetBone as { avatar?: UnityObject }).avatar
                  : undefined;
              applyHumanoidRotation(
                targetBone,
                muscleVals,
                avatarObj || animData.avatar!,
                humanBoneIndex,
              );
            }
          });
          applyAttachments();
        };
        const animatedNodes = new Set<TransformNode>();
        animData.bones.forEach((_, bone) => {
          const node =
            "getTransformNode" in bone
              ? (bone as Bone).getTransformNode()
              : (bone as TransformNode);
          if (node) animatedNodes.add(node as TransformNode);
        });
        animData.muscles.forEach((_, bone) => {
          const node =
            "getTransformNode" in bone
              ? (bone as Bone).getTransformNode()
              : (bone as TransformNode);
          if (node) animatedNodes.add(node as TransformNode);
        });
        attachmentNodes.forEach((node) => animatedNodes.add(node));
        const nodeKeys = new Map<
          TransformNode,
          {
            posKeys: any[];
            rotKeys: any[];
            scaleKeys: any[];
          }
        >();
        animatedNodes.forEach((node) => {
          nodeKeys.set(node, { posKeys: [], rotKeys: [], scaleKeys: [] });
        });
        for (let f = 0; f <= maxFrame; f++) {
          evaluateFrame(f);
          animatedNodes.forEach((node) => {
            const keys = nodeKeys.get(node)!;
            let hasPos = attachmentNodes.has(node);
            let hasRot = attachmentNodes.has(node);
            let hasScale = false;
            animData.bones.forEach((boneData, bone) => {
              const bNode =
                "getTransformNode" in bone
                  ? (bone as Bone).getTransformNode()
                  : (bone as TransformNode);
              if (bNode === node) {
                if (
                  boneData.position.x ||
                  boneData.position.y ||
                  boneData.position.z
                )
                  hasPos = true;
                if (
                  boneData.rotation.x ||
                  boneData.rotation.y ||
                  boneData.rotation.z ||
                  boneData.rotation.w
                )
                  hasRot = true;
                if (boneData.scale.x || boneData.scale.y || boneData.scale.z)
                  hasScale = true;
              }
            });
            animData.muscles.forEach((muscleCurves, bone) => {
              const bNode =
                "getTransformNode" in bone
                  ? (bone as Bone).getTransformNode()
                  : (bone as TransformNode);
              if (bNode === node) {
                hasRot = true;
                if (
                  muscleCurves.some(
                    (mc) =>
                      mc.humanBoneIndex === 0 && mc.axis.startsWith("pos_"),
                  )
                ) {
                  hasPos = true;
                }
              }
            });
            if (hasPos) {
              keys.posKeys.push({ frame: f, value: node.position.clone() });
            }
            if (hasRot) {
              const q = node.rotationQuaternion
                ? node.rotationQuaternion.clone()
                : Quaternion.FromEulerVector(node.rotation);
              keys.rotKeys.push({ frame: f, value: q });
            }
            if (hasScale) {
              keys.scaleKeys.push({ frame: f, value: node.scaling.clone() });
            }
          });
        }
        animData.accumulatedTime = originalTime;
        state.animationPlaying = originalPlaying;
        evaluateFrame(originalTime * frameRate);
        tempAnimGroup = new AnimationGroup(
          animData.name || "ExportAnimationClip",
          this.scene,
        );
        nodeKeys.forEach((keys, node) => {
          const nodeAnims: any[] = [];
          if (keys.posKeys.length > 0) {
            const anim = new Animation(
              node.name + "_pos",
              "position",
              frameRate,
              Animation.ANIMATIONTYPE_VECTOR3,
              Animation.ANIMATIONLOOPMODE_CYCLE,
            );
            anim.setKeys(keys.posKeys);
            node.animations.push(anim);
            tempAnimGroup.addTargetedAnimation(anim, node);
            nodeAnims.push(anim);
          }
          if (keys.rotKeys.length > 0) {
            const anim = new Animation(
              node.name + "_rot",
              "rotationQuaternion",
              frameRate,
              Animation.ANIMATIONTYPE_QUATERNION,
              Animation.ANIMATIONLOOPMODE_CYCLE,
            );
            anim.setKeys(keys.rotKeys);
            node.animations.push(anim);
            tempAnimGroup.addTargetedAnimation(anim, node);
            nodeAnims.push(anim);
          }
          if (keys.scaleKeys.length > 0) {
            const anim = new Animation(
              node.name + "_scale",
              "scaling",
              frameRate,
              Animation.ANIMATIONTYPE_VECTOR3,
              Animation.ANIMATIONLOOPMODE_CYCLE,
            );
            anim.setKeys(keys.scaleKeys);
            node.animations.push(anim);
            tempAnimGroup.addTargetedAnimation(anim, node);
            nodeAnims.push(anim);
          }

          if (nodeAnims.length > 0) {
            createdAnimations.push({ node, anims: nodeAnims });
          }
        });
      }
      updateProgress(45, "Preparing scene serialization...");
      this.pauseSceneObserversForExport(exportRestores);
      this.alignSkinRootsForExport(exportRestores);
      this.prepareMaterialsForExport(exportRestores);
      this.prepareMeshDataForExport(exportRestores);
      this.flipFrontCulledSubMeshesForExport(exportRestores);
      this.consolidateSubMeshesForExport(exportRestores);
      updateProgress(70, "Serializing scene meshes...");
      const glbData = await GLTF2Export.GLBAsync(this.scene, exportName, {
        exportUnusedUVs: true,
        shouldExportNode: (node) => {
          if (
            node instanceof Light ||
            node instanceof Camera ||
            node.name.includes("dummy") ||
            node.name.includes("SkeletonViewer") ||
            (node.name === "sceneRoot" && node.getChildren().length === 0)
          ) {
            return false;
          }
          if (!node.isEnabled()) {
            return false;
          }
          if ((node as any).isVisible === false) {
            return false;
          }
          return true;
        },
      });
      updateProgress(90, "Triggering GLB download...");
      const blob = glbData.glTFFiles[exportName + ".glb"] as Blob;
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = exportName + ".glb";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        throw new Error("GLB serialization returned empty data.");
      }
      if (tempAnimGroup) {
        tempAnimGroup.dispose();
      }
      createdAnimations.forEach(({ node, anims }) => {
        anims.forEach((anim) => {
          const idx = node.animations.indexOf(anim);
          if (idx !== -1) {
            node.animations.splice(idx, 1);
          }
        });
      });
      if (wasSkeletonVisible) {
        this.toggleSkeletonViewer(true);
      }
    } catch (error: any) {
      showNotification(`GLB Export failed: ${error.message || error}`, "error");
    } finally {
      exportRestores.forEach((restore) => {
        try {
          restore();
        } catch {}
      });
      exportRestores.length = 0;
      hideProgress();
    }
  }
  private pauseSceneObserversForExport(restores: Array<() => void>): void {
    const observable = this.scene.onBeforeRenderObservable;
    const entries: Array<{
      observer: Observer<Scene> | null;
      assign: (next: Observer<Scene> | null) => void;
    }> = [
      {
        observer: state.animationObserver,
        assign: (next) => {
          state.animationObserver = next;
        },
      },
      {
        observer: state.physicsObserver,
        assign: (next) => {
          state.physicsObserver = next;
        },
      },
    ];
    entries.forEach(({ observer, assign }) => {
      if (!observer) return;
      observable.remove(observer);
      assign(null);
      restores.push(() => {
        assign(observable.add(observer.callback));
      });
    });
  }
  private alignSkinRootsForExport(restores: Array<() => void>): void {
    const nearlyEqual = (a: Matrix, b: Matrix): boolean => {
      for (let i = 0; i < 16; i++) {
        if (Math.abs(a.m[i] - b.m[i]) > 1e-6) return false;
      }
      return true;
    };
    const meshesBySkeleton = new Map<Skeleton, Mesh[]>();
    this.scene.meshes.forEach((node) => {
      const mesh = node as Mesh;
      if (!mesh.skeleton) return;
      const meshes = meshesBySkeleton.get(mesh.skeleton);
      if (meshes) meshes.push(mesh);
      else meshesBySkeleton.set(mesh.skeleton, [mesh]);
    });
    meshesBySkeleton.forEach((meshes, skeleton) => {
      const reference =
        meshes.find((mesh) => mesh.isVisible && mesh.isEnabled()) || meshes[0];
      const referenceWorld = reference.computeWorldMatrix(true).clone();
      const uniformWorld = meshes.every((mesh) =>
        nearlyEqual(mesh.computeWorldMatrix(true), referenceWorld),
      );
      const referenceParent = reference.parent as TransformNode | null;
      const referenceParentWorld = referenceParent
        ? referenceParent.computeWorldMatrix(true).clone()
        : Matrix.Identity();
      const targetWorld = uniformWorld ? referenceWorld : referenceParentWorld;
      let holder: TransformNode | null = null;
      skeleton.bones.forEach((bone) => {
        if (bone.getParent()) return;
        const rootNode = bone.getTransformNode();
        if (!rootNode) return;
        const previousParent = rootNode.parent as TransformNode | null;
        const previousParentWorld = previousParent
          ? previousParent.computeWorldMatrix(true)
          : Matrix.Identity();
        if (nearlyEqual(previousParentWorld, targetWorld)) return;
        let newParent = referenceParent;
        if (!newParent || !nearlyEqual(referenceParentWorld, targetWorld)) {
          if (!holder) {
            holder = new TransformNode(
              `${skeleton.name}_exportRoot`,
              this.scene,
            );
            const holderScaling = new Vector3();
            const holderRotation = new Quaternion();
            const holderPosition = new Vector3();
            targetWorld.decompose(
              holderScaling,
              holderRotation,
              holderPosition,
            );
            holder.position.copyFrom(holderPosition);
            holder.rotationQuaternion = holderRotation;
            holder.scaling.copyFrom(holderScaling);
          }
          newParent = holder;
        }
        rootNode.parent = newParent;
        restores.push(() => {
          rootNode.parent = previousParent;
        });
      });
      const created = holder as TransformNode | null;
      if (created) {
        restores.push(() => created.dispose(true));
      }
    });
  }
  private prepareMaterialsForExport(restores: Array<() => void>): void {
    const exact = this.scene.getEngine().useExactSrgbConversions;
    const linear = new Color3();
    this.scene.materials.forEach((material) => {
      if (material.getClassName() !== "StandardMaterial") return;
      const standard = material as unknown as {
        diffuseColor: Color3;
        emissiveColor: Color3;
      };
      const original = standard.diffuseColor;
      if (!original) return;
      original.toLinearSpaceToRef(linear, exact);
      const boosted = new Color3(
        Math.min(1, linear.r),
        Math.min(1, linear.g),
        Math.min(1, linear.b),
      ).toGammaSpace(exact);
      standard.diffuseColor = boosted;
      const originalEmissive = standard.emissiveColor;
      standard.emissiveColor = new Color3(
        EXPORT_EMISSIVE,
        EXPORT_EMISSIVE,
        EXPORT_EMISSIVE,
      );
      restores.push(() => {
        standard.diffuseColor = original;
        standard.emissiveColor = originalEmissive;
      });
    });
  }
  private prepareMeshDataForExport(restores: Array<() => void>): void {
    const engine = this.scene.getEngine();
    const seen = new Set<unknown>();
    this.scene.meshes.forEach((node) => {
      const mesh = node as Mesh;
      if (!mesh.geometry || seen.has(mesh.geometry)) return;
      seen.add(mesh.geometry);
      const indices = mesh.getIndices();
      const totalVertices = mesh.getTotalVertices();
      if (
        indices &&
        (indices as Uint32Array).BYTES_PER_ELEMENT === 4 &&
        totalVertices <= 65536
      ) {
        let maxIndex = 0;
        for (let i = 0; i < indices.length; i++) {
          if (indices[i] > maxIndex) maxIndex = indices[i];
        }
        if (maxIndex <= 65535) {
          const geometry = mesh.geometry as unknown as {
            _indices: IndicesArray;
          };
          const original = geometry._indices;
          geometry._indices = new Uint16Array(indices);
          restores.push(() => {
            geometry._indices = original;
          });
        }
      }
      [
        VertexBuffer.MatricesIndicesKind,
        VertexBuffer.MatricesIndicesExtraKind,
      ].forEach((kind) => {
        const original = mesh.geometry?.getVertexBuffer(kind);
        if (!original || original.type !== VertexBuffer.FLOAT) return;
        const floats = original.getFloatData(totalVertices);
        if (!floats) return;
        const packed = new Uint16Array(floats.length);
        for (let i = 0; i < floats.length; i++) {
          packed[i] = floats[i];
        }
        const replacement = new VertexBuffer(engine, packed, kind, {
          updatable: false,
          stride: 4,
          size: 4,
          type: VertexBuffer.UNSIGNED_SHORT,
          normalized: false,
        });
        mesh.setVerticesBuffer(replacement, false);
        restores.push(() => {
          mesh.setVerticesBuffer(original, false);
          replacement.dispose();
        });
      });
    });
  }
  private flipFrontCulledSubMeshesForExport(restores: Array<() => void>): void {
    const seen = new Set<unknown>();
    this.scene.meshes.forEach((node) => {
      const mesh = node as Mesh;
      if (!mesh.geometry || !mesh.subMeshes || seen.has(mesh.geometry)) return;
      const material = mesh.material;
      const frontCulled = mesh.subMeshes.filter((sub) => {
        const m =
          material instanceof MultiMaterial
            ? material.subMaterials[sub.materialIndex]
            : material;
        return !!m && m.backFaceCulling && m.cullBackFaces === false;
      });
      if (frontCulled.length === 0) return;
      seen.add(mesh.geometry);
      const geometry = mesh.geometry as unknown as { _indices: IndicesArray };
      const original = geometry._indices;
      const flipped = original.slice();
      frontCulled.forEach((sub) => {
        const end = sub.indexStart + sub.indexCount;
        for (let i = sub.indexStart; i + 2 < end; i += 3) {
          const b = flipped[i + 1];
          flipped[i + 1] = flipped[i + 2];
          flipped[i + 2] = b;
        }
      });
      geometry._indices = flipped;
      restores.push(() => {
        if (geometry._indices === flipped) geometry._indices = original;
      });
    });
  }
  private consolidateSubMeshesForExport(restores: Array<() => void>): void {
    this.scene.meshes.forEach((node) => {
      const mesh = node as Mesh;
      const subMeshes = mesh.subMeshes;
      if (!subMeshes || subMeshes.length < 2) return;
      const indices = mesh.getIndices();
      if (!indices) return;
      const totalVertices = mesh.getTotalVertices();
      const ordered = [...subMeshes].sort((a, b) => a.indexStart - b.indexStart);
      const runs: Array<{
        materialIndex: number;
        start: number;
        count: number;
      }> = [];
      ordered.forEach((sub) => {
        const last = runs[runs.length - 1];
        if (
          last &&
          last.materialIndex === sub.materialIndex &&
          last.start + last.count === sub.indexStart
        ) {
          last.count += sub.indexCount;
        } else {
          runs.push({
            materialIndex: sub.materialIndex,
            start: sub.indexStart,
            count: sub.indexCount,
          });
        }
      });
      restores.push(() => {
        mesh.subMeshes = subMeshes;
      });
      mesh.subMeshes = [];
      runs.forEach((run) => {
        let minVertex = totalVertices;
        let maxVertex = -1;
        for (let i = run.start; i < run.start + run.count; i++) {
          const v = indices[i];
          if (v < minVertex) minVertex = v;
          if (v > maxVertex) maxVertex = v;
        }
        if (maxVertex < minVertex) {
          minVertex = 0;
          maxVertex = totalVertices - 1;
        }
        new SubMesh(
          run.materialIndex,
          minVertex,
          maxVertex - minVertex + 1,
          run.start,
          run.count,
          mesh,
        );
      });
    });
  }
}
