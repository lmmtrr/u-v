import { Bone } from "@babylonjs/core/Bones/bone";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Matrix, Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { SkeletonViewer } from "@babylonjs/core/Debug/skeletonViewer";
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
import {
  buildAnimationData,
  createAnimationObserver,
} from "./animation_system";
import { interpolate } from "./animation_interpolator";
import { applyHumanoidRotation } from "./humanoid_system";
import { setupSpringBones, createPhysicsObserver } from "./physics_system";
import { computeCRC32, createSorter, normalizeHash } from "./utils";
import { updateProgress, hideProgress } from "./progress";
import type {
  MeshMeta,
  TextureMeta,
  UnityObject,
  JSONValue,
  AnimationClipItem,
} from "./types";
import { processOrphanedMeshes } from "./orphan_resolver";
import { resolveRendererTextures, isValidPathId } from "./texture_resolver";
import { instantiateMesh, getRelativeMatrix } from "./mesh_builder";
import { findRoot, computeGenericPartAttachments } from "./bone_system";
import { buildExternalRefIndex, type ExternalRefIndex } from "./external_refs";
import { normalizeLoadedFileIds, getRawPathId } from "./id_space";
const EXPORT_EMISSIVE = 0;
type Lookup = {
  gameObjects: Map<string, Record<string, JSONValue>>;
  transforms: Map<string, Record<string, JSONValue>>;
  transformsByGo: Map<string, Record<string, JSONValue>>;
  meshes: Map<string, MeshMeta[]>;
  textures: Map<string, TextureMeta>;
  materials: Map<string, Record<string, JSONValue>>;
  renderersByGo: Map<string, Record<string, JSONValue>>;
  filtersByGo: Map<string, Record<string, JSONValue>>;
  texturesByFile: Map<string, Map<string, TextureMeta>>;
  materialsByFile: Map<string, Map<string, Record<string, JSONValue>>>;
  meshesByFile: Map<string, Map<string, MeshMeta[]>>;
  externalRefs: ExternalRefIndex;
  animationClips: Array<{ name: string; clipData: Record<string, JSONValue> }>;
};
type RendererRecord = {
  m_GameObject?: { path_id?: string };
  mesh?: MeshMeta | null;
  mesh_path_id?: string;
  m_Materials?: JSONValue[];
  textures?: JSONValue[];
  texture_path_ids?: Array<string>;
  name?: string;
  sourceFileName?: string;
  path_id?: string;
  useDualQuaternionSkinning?: boolean;
};
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
  public removePart = (fileIndex: number, partId: string) => {
    const file = state.loadedFiles[fileIndex];
    if (!file) return;
    const targetId = partId;
    file.objects = file.objects.filter((obj) => {
      const type = Object.keys(obj)[0];
      const data = obj[type] as Record<string, unknown> | undefined;
      const pathIdStr = data?.path_id;
      return pathIdStr !== targetId;
    });
    state.allObjects = state.allObjects.filter((obj) => {
      const type = Object.keys(obj)[0];
      const data = obj[type] as Record<string, JSONValue> | undefined;
      const pathIdStr = data?.path_id;
      return pathIdStr !== targetId;
    });
    state.createdMeshes = state.createdMeshes.filter((mesh) => {
      if (
        mesh.metadata &&
        String(mesh.metadata.rendererPathId) === String(targetId)
      ) {
        mesh.dispose();
        return false;
      }
      return true;
    });
    const elementsToRemove = document.querySelectorAll(
      `[data-path-id="${targetId}"]`,
    );
    elementsToRemove.forEach((el) => el.remove());
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
      const currentEnabled = matchingRenderers.some(
        (data) => data.m_Enabled !== false,
      );
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
        }
      });
      const allToggles = document.querySelectorAll(".visibility-toggle");
      const allNames = document.querySelectorAll(".part-name");
      matchingRenderers.forEach((data) => {
        const pathIdStr = String(data.path_id || "");
        allToggles.forEach((t) => {
          const pid =
            (t as HTMLElement).getAttribute("data-path-id") ||
            (t as HTMLElement).dataset?.pathId;
          if (this.isApproxPathIdMatch(pid, pathIdStr)) {
            t.classList.toggle("active", !!data.m_Enabled);
          }
        });
        allNames.forEach((n) => {
          const pid =
            (n as HTMLElement).getAttribute("data-path-id") ||
            (n as HTMLElement).dataset?.pathId;
          if (this.isApproxPathIdMatch(pid, pathIdStr)) {
            n.classList.toggle("active", !!data.m_Enabled);
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
    }
  };
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
  public playAnimation = (idx: number) => {
    if (idx === -1) {
      this.stopAnimation();
      return;
    }
    if (!state.animationClips[idx]) return;
    this.resetToBindPose();
    state.currentAnimationData = buildAnimationData(
      state.animationClips[idx] as never as UnityObject,
      state.allObjectHash,
      state.createdMeshes,
      this.scene,
    );
    state.currentAnimationData.startTime = performance.now();
    state.animationPlaying = true;
    updateUIState({
      currentAnimationIndex: idx,
      currentAnimationData: state.currentAnimationData,
      animationPlaying: state.animationPlaying,
    });
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
  public toggleSkeletonViewer = (v: boolean) => {
    if (state.showSkeletons !== v) {
      state.showSkeletons = v;
      if (v) {
        this.scene.skeletons.forEach((skeleton) => {
          const targetMesh =
            this.scene.meshes.find((m) => m.skeleton === skeleton) ||
            new Mesh("dummy", this.scene);
          const viewer = new SkeletonViewer(
            skeleton,
            targetMesh,
            this.scene,
            true,
            3,
            {
              displayMode: SkeletonViewer.DISPLAY_LINES,
              displayOptions: { color: new Color3(1, 0, 0) } as never,
            },
          );
          state.skeletonViewers.push(viewer);
        });
      } else {
        state.skeletonViewers.forEach((viewer) => viewer.dispose());
        state.skeletonViewers = [];
      }
    }
  };
  public async rebuildScene(skipUIUpdate = false) {
    state.loadedFiles.forEach((f) => {
      if (f.objects) {
        const counts: Record<string, number> = {};
        f.objects.forEach((obj) => {
          if (obj) {
            const type = Object.keys(obj)[0];
            counts[type] = (counts[type] || 0) + 1;
          }
        });
      }
    });
    this.cleanUpSceneResources();
    const objects = this.aggregateObjectsAndHashes();
    const lookup = this.classifyObjects(objects);
    this.applyGameObjectActiveState(objects, lookup);
    this.applyLODGroups(objects);
    const meshSourceFiles = new Set<string>();
    state.loadedFiles.forEach((f) => {
      const hasMesh = f.objects.some((obj) => {
        if (!obj) return false;
        const type = Object.keys(obj)[0];
        return (
          type === "SkinnedMeshRenderer" ||
          type === "MeshRenderer" ||
          type === "Mesh" ||
          type === "MeshFilter"
        );
      });
      if (hasMesh && f.name) meshSourceFiles.add(f.name);
    });
    this.alignTwistBones(lookup);
    const transformNodes = this.createTransformNodes(lookup, meshSourceFiles);
    const sceneRoot = new TransformNode("sceneRoot", this.scene);
    this.setupTransformHierarchy(lookup, transformNodes, sceneRoot);
    const rootCounts = new Map<string, number>();
    lookup.transforms.forEach((t, pathIdStr) => {
      const rootId = findRoot(pathIdStr, lookup.transforms);
      rootCounts.set(rootId, (rootCounts.get(rootId) || 0) + 1);
    });
    let mainRigRootId = "";
    let maxCount = 0;
    rootCounts.forEach((count, rootId) => {
      if (count > maxCount) {
        maxCount = count;
        mainRigRootId = rootId;
      }
    });
    if (mainRigRootId) {
      const mainRigTransformsByName = new Map<string, string>();
      lookup.transforms.forEach((t, pathIdStr) => {
        const rootId = findRoot(pathIdStr, lookup.transforms);
        if (rootId === mainRigRootId) {
          const node = transformNodes.get(pathIdStr);
          if (node) {
            mainRigTransformsByName.set(node.name, pathIdStr);
          }
        }
      });
      objects.forEach((obj) => {
        const smr = obj?.SkinnedMeshRenderer as
          | Record<string, JSONValue>
          | undefined;
        if (smr && smr.bone_path_ids && Array.isArray(smr.bone_path_ids)) {
          const meshName = String(smr.name || "").toLowerCase();
          const firstBoneIdStr = String(smr.bone_path_ids[0] || "");
          const originalRootId = findRoot(firstBoneIdStr, lookup.transforms);
          const rootNode = transformNodes.get(originalRootId);
          const rootName = String(rootNode?.name || "").toLowerCase();
          const isModular =
            meshName.includes("face") ||
            meshName.includes("hair") ||
            meshName.includes("tiara") ||
            meshName.includes("accessory") ||
            meshName.includes("acc") ||
            meshName.includes("connect") ||
            meshName.includes("head") ||
            rootName.includes("face") ||
            rootName.includes("hair") ||
            rootName.includes("tiara") ||
            rootName.includes("accessory") ||
            rootName.includes("acc") ||
            rootName.includes("connect") ||
            rootName.includes("head");
          if (isModular) {
            smr.bone_path_ids = smr.bone_path_ids.map((boneId) => {
              const boneIdStr = String(boneId);
              const node = transformNodes.get(boneIdStr);
              if (node) {
                const name = node.name;
                const boneRootId = findRoot(boneIdStr, lookup.transforms);
                if (boneRootId !== mainRigRootId) {
                  const matchingMainBoneId = mainRigTransformsByName.get(name);
                  if (matchingMainBoneId) {
                    return matchingMainBoneId;
                  }
                }
              }
              return boneIdStr;
            });
          }
        }
      });
    }
    if (transformNodes.size === 0) {
      sceneRoot.rotation.x = -Math.PI / 2;
    }
    processOrphanedMeshes(objects, lookup as never);
    resolveRendererTextures(objects, lookup as never);
    const { uniqueRenderers, meshBestRendererMap } =
      this.identifyUniqueRenderers(objects, lookup);
    const skeletons = new Map<
      string,
      {
        skeleton: Skeleton;
        boneMap: Map<string, Bone>;
        hierarchyRootId: string;
      }
    >();
    const allUsedBones = new Set<string>();
    objects.forEach((obj) => {
      const smr = obj?.SkinnedMeshRenderer as
        | Record<string, JSONValue>
        | undefined;
      if (smr) {
        const bonePathIds = smr.bone_path_ids as JSONValue[] | undefined;
        if (bonePathIds) {
          bonePathIds.forEach((id: unknown) => {
            if (id !== undefined && id !== null) {
              allUsedBones.add(String(id));
            }
          });
        }
      }
    });
    const transformChildrenMap = new Map<string, Set<string>>();
    lookup.transforms.forEach((t) => {
      const fatherObj = t.m_Father as Record<string, JSONValue> | undefined;
      const fatherId = fatherObj
        ? fatherObj.path_id || fatherObj.m_PathID || null
        : null;
      if (fatherId !== undefined && fatherId !== null) {
        const fatherIdStr = String(fatherId);
        if (fatherIdStr !== "0" && fatherIdStr !== "") {
          const currentId = String(t.path_id || "");
          if (!transformChildrenMap.has(fatherIdStr))
            transformChildrenMap.set(fatherIdStr, new Set());
          transformChildrenMap.get(fatherIdStr)!.add(currentId);
        }
      }
    });
    const createdMeshes = await this.instantiateBabylonMeshes(
      uniqueRenderers,
      lookup,
      transformNodes,
      transformChildrenMap,
      skeletons,
      allUsedBones,
      meshBestRendererMap,
      sceneRoot,
    );
    state.createdMeshes = createdMeshes;
    state.genericPartAttachments = computeGenericPartAttachments(skeletons);
    if (state.showSkeletons) {
      skeletons.forEach((data) => {
        const targetMesh =
          this.scene.meshes.find((m) => m.skeleton === data.skeleton) ||
          new Mesh("dummy", this.scene);
        const viewer = new SkeletonViewer(
          data.skeleton,
          targetMesh,
          this.scene,
          true,
          3,
          {
            displayMode: SkeletonViewer.DISPLAY_LINES,
            displayOptions: { color: new Color3(1, 0, 0) } as never,
          },
        );
        state.skeletonViewers.push(viewer);
      });
    }
    lookup.animationClips.sort(createSorter((a) => a.name));
    state.animationClips =
      lookup.animationClips as never as AnimationClipItem[];
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
    const physicsEntries = setupSpringBones(
      objects,
      transformNodes,
      skeletons as never,
      lookup.transformsByGo as never,
    );
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
      const exportName = `${baseName}_export`;
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
        tempAnimGroup = new AnimationGroup("ExportAnimationClip", this.scene);
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
      this.consolidateSubMeshesForExport(exportRestores);
      updateProgress(70, "Serializing scene meshes...");
      const glbData = await GLTF2Export.GLBAsync(this.scene, exportName, {
        exportUnusedUVs: true,
        shouldExportNode: (node) => {
          const className = node.getClassName ? node.getClassName() : "";
          const isMeshNode = className.includes("Mesh");
          if (
            node.name.includes("dummy") ||
            node.name.includes("SkeletonViewer") ||
            className.includes("Camera") ||
            className.includes("Light") ||
            (!isMeshNode && node.name.toLowerCase().includes("light")) ||
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
        showNotification(
          `Successfully exported as ${exportName}.glb`,
          "success",
        );
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
  private aggregateObjectsAndHashes(): UnityObject[] {
    normalizeLoadedFileIds(state.loadedFiles);
    const objects: UnityObject[] = [];
    state.loadedFiles.forEach((f) => {
      f.objects.forEach((obj) => {
        if (!obj) return;
        const type = Object.keys(obj)[0];
        const actualObj = obj[type] as Record<string, JSONValue> | undefined;
        if (actualObj) actualObj.sourceFileName = f.name;
      });
      objects.push(...f.objects);
      if (f.hash instanceof Map) {
        f.hash.forEach((v, k) => state.allObjectHash.set(normalizeHash(k), v));
      } else if (f.hash) {
        Object.entries(f.hash).forEach(([k, v]) =>
          state.allObjectHash.set(normalizeHash(k), v as string),
        );
      }
    });
    objects.forEach((obj) => {
      const go = obj?.GameObject as Record<string, JSONValue> | undefined;
      if (go && go.name) {
        const hash = computeCRC32(String(go.name));
        const norm = normalizeHash(hash);
        if (!state.allObjectHash.has(norm)) {
          state.allObjectHash.set(norm, String(go.name));
        }
      }
    });
    state.allObjects = objects;
    return objects;
  }
  private applyLODGroups(objects: UnityObject[]): void {
    const lod0 = new Set<string>();
    const lowerLods = new Set<string>();
    objects.forEach((obj) => {
      const group = obj?.LODGroup as Record<string, JSONValue> | undefined;
      if (!group || !Array.isArray(group.m_LODs)) return;
      (group.m_LODs as JSONValue[]).forEach((levelValue, levelIndex) => {
        const level = levelValue as Record<string, JSONValue> | null;
        const renderers = level?.renderers;
        if (!Array.isArray(renderers)) return;
        (renderers as JSONValue[]).forEach((entryValue) => {
          const entry = entryValue as Record<string, JSONValue> | null;
          const ref = entry?.renderer as Record<string, JSONValue> | undefined;
          const refId = ref ? String(ref.path_id || ref.m_PathID || "") : "";
          if (!refId || refId === "0") return;
          if (levelIndex === 0) lod0.add(refId);
          else lowerLods.add(refId);
        });
      });
    });
    if (lowerLods.size === 0) return;
    objects.forEach((obj) => {
      const renderer = (obj?.SkinnedMeshRenderer || obj?.MeshRenderer) as
        | Record<string, JSONValue>
        | undefined;
      if (!renderer) return;
      const rendererId = String(renderer.path_id || "");
      if (!rendererId) return;
      if (lowerLods.has(rendererId) && !lod0.has(rendererId)) {
        renderer.m_Enabled = false;
      }
    });
  }
  private applyGameObjectActiveState(
    objects: UnityObject[],
    lookup: Lookup,
  ): void {
    const activeCache = new Map<string, boolean>();
    const isGameObjectActive = (goIdStr: string): boolean => {
      if (!goIdStr || goIdStr === "0") return true;
      const cached = activeCache.get(goIdStr);
      if (cached !== undefined) return cached;
      activeCache.set(goIdStr, true);
      const go = lookup.gameObjects.get(goIdStr);
      const selfActive = !(go?.m_IsActive === false || go?.m_IsActive === 0);
      let active = selfActive;
      if (active) {
        const transform = lookup.transformsByGo.get(goIdStr);
        const father = transform?.m_Father as
          | Record<string, JSONValue>
          | undefined;
        const fatherIdStr = father
          ? String(father.path_id || father.m_PathID || "0")
          : "0";
        if (fatherIdStr && fatherIdStr !== "0") {
          const fatherTransform = lookup.transforms.get(fatherIdStr);
          const fatherGo = fatherTransform?.m_GameObject as
            | Record<string, JSONValue>
            | undefined;
          const fatherGoIdStr = fatherGo ? String(fatherGo.path_id || "") : "";
          if (fatherGoIdStr) active = isGameObjectActive(fatherGoIdStr);
        }
      }
      activeCache.set(goIdStr, active);
      return active;
    };
    objects.forEach((obj) => {
      const renderer = (obj?.SkinnedMeshRenderer || obj?.MeshRenderer) as
        | Record<string, JSONValue>
        | undefined;
      if (!renderer) return;
      const go = renderer.m_GameObject as
        | Record<string, JSONValue>
        | undefined;
      const goIdStr = go ? String(go.path_id || "") : "";
      if (!goIdStr) return;
      if (!isGameObjectActive(goIdStr)) renderer.m_Enabled = false;
    });
  }
  private classifyObjects(objects: UnityObject[]): Lookup {
    const lookup: Lookup = {
      gameObjects: new Map<string, Record<string, JSONValue>>(),
      transforms: new Map<string, Record<string, JSONValue>>(),
      transformsByGo: new Map<string, Record<string, JSONValue>>(),
      meshes: new Map<string, MeshMeta[]>(),
      textures: new Map<string, TextureMeta>(),
      materials: new Map<string, Record<string, JSONValue>>(),
      renderersByGo: new Map<string, Record<string, JSONValue>>(),
      filtersByGo: new Map<string, Record<string, JSONValue>>(),
      texturesByFile: new Map<string, Map<string, TextureMeta>>(),
      materialsByFile: new Map<string, Map<string, Record<string, JSONValue>>>(),
      meshesByFile: new Map<string, Map<string, MeshMeta[]>>(),
      externalRefs: buildExternalRefIndex(state.loadedFiles),
      animationClips: [],
    };
    const indexByFile = <T>(
      byFile: Map<string, Map<string, T>>,
      fileName: string,
      pathId: string,
      value: T,
    ) => {
      if (!fileName || !pathId) return;
      let perFile = byFile.get(fileName);
      if (!perFile) {
        perFile = new Map<string, T>();
        byFile.set(fileName, perFile);
      }
      perFile.set(pathId, value);
    };
    objects.forEach((obj) => {
      if (!obj) return;
      const type = Object.keys(obj)[0];
      const data = obj[type] as Record<string, JSONValue> | undefined;
      const dataPathIdStr = data?.path_id ? String(data.path_id) : "";
      const gameObj = data?.m_GameObject as
        | Record<string, JSONValue>
        | undefined;
      const dataGOPathIdStr = gameObj?.path_id ? String(gameObj.path_id) : "";
      switch (type) {
        case "GameObject":
          if (data) lookup.gameObjects.set(dataPathIdStr, data);
          break;
        case "Transform":
          if (data) {
            state.transformsByPathId.set(
              dataPathIdStr,
              data as never as UnityObject,
            );
            state.transformsByGameObjectId.set(
              dataGOPathIdStr,
              data as never as UnityObject,
            );
            lookup.transforms.set(dataPathIdStr, data);
            lookup.transformsByGo.set(dataGOPathIdStr, data);
          }
          break;
        case "Mesh":
          if (data) {
            if (!lookup.meshes.has(dataPathIdStr))
              lookup.meshes.set(dataPathIdStr, []);
            lookup.meshes.get(dataPathIdStr)!.push(data as never as MeshMeta);
            const meshFile = String(data.sourceFileName || "");
            const meshRawId = getRawPathId(data);
            if (meshFile && meshRawId) {
              let perFile = lookup.meshesByFile.get(meshFile);
              if (!perFile) {
                perFile = new Map<string, MeshMeta[]>();
                lookup.meshesByFile.set(meshFile, perFile);
              }
              if (!perFile.has(meshRawId)) perFile.set(meshRawId, []);
              perFile.get(meshRawId)!.push(data as never as MeshMeta);
            }
          }
          break;
        case "Texture2D":
          if (data) {
            lookup.textures.set(dataPathIdStr, data as never as TextureMeta);
            indexByFile(
              lookup.texturesByFile,
              String(data.sourceFileName || ""),
              getRawPathId(data),
              data as never as TextureMeta,
            );
          }
          break;
        case "SkinnedMeshRenderer":
        case "MeshRenderer":
          if (data) lookup.renderersByGo.set(dataGOPathIdStr, data);
          break;
        case "MeshFilter":
          if (data) lookup.filtersByGo.set(dataGOPathIdStr, data);
          break;
        case "AnimationClip":
          if (data) {
            const clip = data;
            const mMuscleClip = clip.m_MuscleClip as
              | Record<string, JSONValue>
              | undefined;
            const mmClip = mMuscleClip?.m_Clip as
              | Record<string, JSONValue>
              | undefined;
            const mmClipData = mmClip?.data;
            let streamClip = mmClip?.m_StreamedClip as
              | Record<string, JSONValue>
              | undefined;
            let denseClip = mmClip?.m_DenseClip as
              | Record<string, JSONValue>
              | undefined;
            if (
              mmClipData &&
              typeof mmClipData === "object" &&
              !Array.isArray(mmClipData) &&
              !(mmClipData instanceof ArrayBuffer)
            ) {
              const clipDataObj = mmClipData as Record<string, JSONValue>;
              if (!streamClip)
                streamClip = clipDataObj.m_StreamedClip as
                  | Record<string, JSONValue>
                  | undefined;
              if (!denseClip)
                denseClip = clipDataObj.m_DenseClip as
                  | Record<string, JSONValue>
                  | undefined;
            }
            const hasMuscleClipData =
              (mmClipData &&
                ((Array.isArray(mmClipData) && mmClipData.length > 0) ||
                  mmClipData instanceof ArrayBuffer)) ||
              (streamClip &&
                Number(streamClip.curveCount ?? 0) > 0 &&
                ((streamClip.data as ArrayLike<unknown> | undefined)?.length ??
                  0) > 0) ||
              (denseClip &&
                Number(denseClip.m_CurveCount ?? 0) > 0 &&
                ((denseClip.m_FrameCount ?? 0) as number) > 0);
            const hasCurves =
              (Array.isArray(clip.m_RotationCurves) &&
                clip.m_RotationCurves.length > 0) ||
              (Array.isArray(clip.m_PositionCurves) &&
                clip.m_PositionCurves.length > 0) ||
              (Array.isArray(clip.m_ScaleCurves) &&
                clip.m_ScaleCurves.length > 0) ||
              (Array.isArray(clip.m_EulerCurves) &&
                clip.m_EulerCurves.length > 0) ||
              (Array.isArray(clip.m_FloatCurves) &&
                clip.m_FloatCurves.length > 0);
            if (hasMuscleClipData || hasCurves) {
              const clipName = String(data.name || "");
              if (!clipName.includes("Recorded")) {
                lookup.animationClips.push({ name: clipName, clipData: data });
              }
            }
          }
          break;
        case "Animator":
          if (data)
            state.animatorsByGameObjectId.set(
              dataGOPathIdStr,
              data as never as UnityObject,
            );
          break;
        case "Avatar":
          if (data)
            state.avatarsByPathId.set(
              dataPathIdStr,
              data as never as UnityObject,
            );
          break;
        case "Material":
          if (data) {
            lookup.materials.set(dataPathIdStr, data);
            indexByFile(
              lookup.materialsByFile,
              String(data.sourceFileName || ""),
              getRawPathId(data),
              data,
            );
          }
          break;
      }
    });
    return lookup;
  }
  private alignTwistBones(lookup: Lookup): void {
    let rootPathId = "0";
    for (const [pathId, t] of lookup.transforms) {
      const gameObj = t.m_GameObject as Record<string, JSONValue> | undefined;
      const goId = gameObj?.path_id || "";
      const go = lookup.gameObjects.get(String(goId));
      if (go && go.name) {
        const goNameStr = String(go.name).toLowerCase();
        if (
          goNameStr === "root" ||
          goNameStr === "hips" ||
          goNameStr === "bip001"
        ) {
          rootPathId = pathId;
          break;
        }
      }
    }
    if (rootPathId !== "0") {
      const findRootLocal = (
        startId: string,
        transforms: Map<string, Record<string, JSONValue>>,
      ): string => {
        let currentId = String(startId);
        let visited = new Set<string>();
        while (true) {
          if (visited.has(currentId)) break;
          visited.add(currentId);
          const t = transforms.get(currentId);
          if (!t) break;
          const fatherObj = t.m_Father as Record<string, JSONValue> | undefined;
          const fatherId = fatherObj
            ? fatherObj.path_id || fatherObj.m_PathID || null
            : null;
          if (fatherId === null || fatherId === 0 || String(fatherId) === "0") {
            break;
          }
          currentId = String(fatherId);
        }
        return currentId;
      };
      const findTransformIdInSameTree = (
        twistBonePathId: string,
        nameTargets: string[],
        lookupData: Lookup,
      ): string | null => {
        const twistRootId = findRootLocal(
          twistBonePathId,
          lookupData.transforms,
        );
        for (const [pathId, t] of lookupData.transforms) {
          const currentRootId = findRootLocal(pathId, lookupData.transforms);
          if (currentRootId !== twistRootId) continue;
          const gameObj = t.m_GameObject as
            | Record<string, JSONValue>
            | undefined;
          const goId = gameObj?.path_id || "";
          const go = lookupData.gameObjects.get(String(goId));
          if (go && go.name) {
            const goNameLower = String(go.name).toLowerCase();
            for (const target of nameTargets) {
              if (
                goNameLower === target.toLowerCase() ||
                goNameLower.endsWith("/" + target.toLowerCase())
              ) {
                return pathId;
              }
            }
          }
        }
        for (const [pathId, t] of lookupData.transforms) {
          const currentRootId = findRootLocal(pathId, lookupData.transforms);
          if (currentRootId !== twistRootId) continue;
          const gameObj = t.m_GameObject as
            | Record<string, JSONValue>
            | undefined;
          const goId = gameObj?.path_id || "";
          const go = lookupData.gameObjects.get(String(goId));
          if (go && go.name) {
            const goNameLower = String(go.name).toLowerCase();
            for (const target of nameTargets) {
              const cleanTarget = target
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "");
              const cleanGoName = goNameLower.replace(/[^a-z0-9]/g, "");
              if (
                cleanGoName.includes(cleanTarget) ||
                cleanTarget.includes(cleanGoName)
              ) {
                return pathId;
              }
            }
          }
        }
        return null;
      };
      lookup.transforms.forEach((t, path_idStr) => {
        const gameObj = t.m_GameObject as Record<string, JSONValue> | undefined;
        const goId = gameObj?.path_id || "";
        const go = lookup.gameObjects.get(String(goId));
        if (!go || !go.name) return;
        const goNameLower = String(go.name).toLowerCase();
        const fatherObj = t.m_Father as Record<string, JSONValue> | undefined;
        const fatherId = fatherObj
          ? String(fatherObj.path_id || fatherObj.m_PathID || "0")
          : "0";
        let fatherIsTwist = false;
        if (fatherId !== "0" && fatherId !== "") {
          const fatherTransform = lookup.transforms.get(fatherId);
          const fatherGameObj = fatherTransform?.m_GameObject as
            | Record<string, JSONValue>
            | undefined;
          const fatherGoId = fatherGameObj?.path_id || "";
          const fatherGo = lookup.gameObjects.get(String(fatherGoId));
          if (
            fatherGo &&
            String(fatherGo.name).toLowerCase().includes("twist")
          ) {
            fatherIsTwist = true;
          }
        }
        if (!fatherIsTwist && goNameLower.includes("twist")) {
          let targets: string[] = [];
          const has002ButNotBip =
            goNameLower.includes("002") && !goNameLower.includes("bip002");
          const isRight =
            has002ButNotBip ||
            goNameLower.includes(".r") ||
            goNameLower.includes("_r") ||
            goNameLower.includes("right") ||
            goNameLower.endsWith("r") ||
            goNameLower.includes(" r ") ||
            goNameLower.includes(" r") ||
            goNameLower.includes("r_") ||
            goNameLower.includes("rthigh") ||
            goNameLower.includes("rcalf") ||
            goNameLower.includes("ruparm") ||
            goNameLower.includes("rfore") ||
            goNameLower.includes("rhand");
          const has001ButNotBip =
            goNameLower.includes("001") && !goNameLower.includes("bip001");
          const isLeft =
            has001ButNotBip ||
            goNameLower.includes(".l") ||
            goNameLower.includes("_l") ||
            goNameLower.includes("left") ||
            goNameLower.endsWith("l") ||
            goNameLower.includes(" l ") ||
            goNameLower.includes(" l") ||
            goNameLower.includes("l_") ||
            goNameLower.includes("lthigh") ||
            goNameLower.includes("lcalf") ||
            goNameLower.includes("luparm") ||
            goNameLower.includes("lfore") ||
            goNameLower.includes("lhand");
          if (goNameLower.includes("uparm") || goNameLower.includes("upper")) {
            if (isLeft) {
              targets = [
                "Bip001 L UpperArm",
                "L_UpperArm",
                "LeftUpperArm",
                "L_UpArm",
                "UpperArm.L",
              ];
            } else if (isRight) {
              targets = [
                "Bip001 R UpperArm",
                "R_UpperArm",
                "RightUpperArm",
                "R_UpArm",
                "UpperArm.R",
              ];
            }
          } else if (
            goNameLower.includes("fore") ||
            goNameLower.includes("lowarm") ||
            goNameLower.includes("forearm")
          ) {
            if (isLeft) {
              targets = [
                "Bip001 L Forearm",
                "Bip001 L ForeArm",
                "L_ForeArm",
                "LeftLowerArm",
                "Forearm.L",
              ];
            } else if (isRight) {
              targets = [
                "Bip001 R Forearm",
                "Bip001 R ForeArm",
                "R_ForeArm",
                "RightLowerArm",
                "Forearm.R",
              ];
            }
          } else if (
            goNameLower.includes("thigh") ||
            goNameLower.includes("upleg") ||
            goNameLower.includes("upperleg")
          ) {
            if (isLeft) {
              targets = [
                "Bip001 L Thigh",
                "L_Thigh",
                "LeftUpperLeg",
                "Thigh.L",
              ];
            } else if (isRight) {
              targets = [
                "Bip001 R Thigh",
                "R_Thigh",
                "RightUpperLeg",
                "Thigh.R",
              ];
            }
          } else if (
            goNameLower.includes("calf") ||
            goNameLower.includes("lowleg") ||
            goNameLower.includes("lowerleg")
          ) {
            if (isLeft) {
              targets = ["Bip001 L Calf", "L_Calf", "LeftLowerLeg", "Calf.L"];
            } else if (isRight) {
              targets = ["Bip001 R Calf", "R_Calf", "RightLowerLeg", "Calf.R"];
            }
          }
          if (targets.length > 0) {
            const logicalParentPathId = findTransformIdInSameTree(
              path_idStr,
              targets,
              lookup,
            );
            if (logicalParentPathId && logicalParentPathId !== path_idStr) {
              (t as any).originalLocalPosition = t.m_LocalPosition
                ? { ...(t.m_LocalPosition as Record<string, number>) }
                : undefined;
              (t as any).originalLocalRotation = t.m_LocalRotation
                ? { ...(t.m_LocalRotation as Record<string, number>) }
                : undefined;
              (t as any).originalLocalScale = t.m_LocalScale
                ? { ...(t.m_LocalScale as Record<string, number>) }
                : undefined;
              const oldWorldMatrix = getRelativeMatrix(
                path_idStr,
                rootPathId,
                lookup.transforms as never as Map<string, UnityObject>,
              );
              const newParentWorldMatrix = getRelativeMatrix(
                logicalParentPathId,
                rootPathId,
                lookup.transforms as never as Map<string, UnityObject>,
              );
              const invNewParentWorldMatrix =
                Matrix.Invert(newParentWorldMatrix);
              const newLocalMatrix =
                invNewParentWorldMatrix.multiply(oldWorldMatrix);
              const newTranslation = new Vector3();
              const newRotation = new Quaternion();
              const newScaling = new Vector3();
              newLocalMatrix.decompose(newScaling, newRotation, newTranslation);
              t.m_LocalPosition = {
                x: newTranslation.x,
                y: newTranslation.y,
                z: newTranslation.z,
              };
              t.m_LocalRotation = {
                x: newRotation.x,
                y: newRotation.y,
                z: newRotation.z,
                w: newRotation.w,
              };
              t.m_LocalScale = {
                x: newScaling.x,
                y: newScaling.y,
                z: newScaling.z,
              };
              t.m_Father = {
                file_id: 0,
                path_id: logicalParentPathId,
                m_FileID: 0,
                m_PathID: logicalParentPathId,
              };
            }
          }
        }
      });
    }
  }
  private createTransformNodes(
    lookup: Lookup,
    meshSourceFiles: Set<string>,
  ): Map<string, TransformNode> {
    const transformNodes = new Map<string, TransformNode>();
    lookup.transforms.forEach((t, path_idStr) => {
      if (
        t.sourceFileName &&
        meshSourceFiles.size > 0 &&
        !meshSourceFiles.has(String(t.sourceFileName))
      )
        return;
      const gameObj = t.m_GameObject as Record<string, JSONValue> | undefined;
      const goPathIdStr = gameObj?.path_id ? String(gameObj.path_id) : "";
      const go = lookup.gameObjects.get(goPathIdStr);
      const node = new TransformNode(
        go?.name ? String(go.name) : `node_${path_idStr}`,
        this.scene,
      );
      const localPos = t.m_LocalPosition as Record<string, number> | undefined;
      const localRot = t.m_LocalRotation as Record<string, number> | undefined;
      const localScale = t.m_LocalScale as Record<string, number> | undefined;
      if (localPos)
        node.position = new Vector3(
          localPos.x ?? 0,
          localPos.y ?? 0,
          localPos.z ?? 0,
        );
      if (localRot)
        node.rotationQuaternion = new Quaternion(
          localRot.x ?? 0,
          localRot.y ?? 0,
          localRot.z ?? 0,
          localRot.w ?? 1,
        );
      if (localScale)
        node.scaling = new Vector3(
          localScale.x ?? 1,
          localScale.y ?? 1,
          localScale.z ?? 1,
        );
      node.metadata = {
        initialPosition: node.position.clone(),
        initialRotationQuaternion: node.rotationQuaternion
          ? node.rotationQuaternion.clone()
          : null,
        initialRotation: node.rotation ? node.rotation.clone() : null,
        initialScaling: node.scaling.clone(),
      };
      const renderer = lookup.renderersByGo.get(goPathIdStr);
      if (renderer) {
        const rendererIdStr = String(renderer.path_id || "");
        const trans = state.partTranslations.get(rendererIdStr);
        if (trans) {
          node.position.x += trans.x;
          node.position.y += trans.y;
          node.position.z += trans.z;
          node.metadata.partTranslation = trans;
        }
      }
      transformNodes.set(path_idStr, node);
      state.transformNodesByPathId.set(path_idStr, node);
    });
    return transformNodes;
  }
  private setupTransformHierarchy(
    lookup: Lookup,
    transformNodes: Map<string, TransformNode>,
    sceneRoot: TransformNode,
  ): void {
    lookup.transforms.forEach((t, path_idStr) => {
      const node = transformNodes.get(path_idStr);
      if (!node) return;
      const fatherObj = t.m_Father as Record<string, JSONValue> | undefined;
      if (fatherObj && fatherObj.path_id !== "0") {
        const fatherIdStr = String(fatherObj.path_id || "");
        const parent = transformNodes.get(fatherIdStr);
        if (parent) node.parent = parent;
      } else {
        node.parent = sceneRoot;
      }
    });
  }
  private identifyUniqueRenderers(
    objects: UnityObject[],
    lookup: Lookup,
  ): {
    uniqueRenderers: RendererRecord[];
    meshBestRendererMap: Map<
      string,
      { renderer: RendererRecord; textureCount: number }
    >;
  } {
    const getRendererTextureScore = (renderer: RendererRecord) => {
      const validTextures = (renderer.textures || []).filter((t) => {
        if (!t) return false;
        const texObj = t as Record<string, JSONValue>;
        const id = texObj.texture
          ? String((texObj.texture as Record<string, JSONValue>).path_id || "")
          : String(texObj.path_id || "");
        return isValidPathId(id);
      }) as Array<Record<string, JSONValue>>;
      const guessedTextureCount = validTextures.filter(
        (t) => t.isFallback === true,
      ).length;
      const resolvedTextureCount = validTextures.length - guessedTextureCount;
      const legacyTextureCount = (renderer.texture_path_ids || []).filter(
        (id: unknown) => isValidPathId(id as string),
      ).length;
      return (
        Math.max(resolvedTextureCount, legacyTextureCount) * 1000 +
        guessedTextureCount
      );
    };
    const bestRendererByMeshName = new Map<
      string,
      { renderer: RendererRecord; textureCount: number }
    >();
    objects.forEach((obj) => {
      const renderer = (obj?.SkinnedMeshRenderer || obj?.MeshRenderer) as
        | RendererRecord
        | undefined;
      if (!renderer) return;
      const name =
        renderer.name || renderer.mesh?.name || `part_${renderer.path_id}`;
      const key = `${name}_${renderer.sourceFileName || "default"}`;
      const textureCount = getRendererTextureScore(renderer);
      const current = bestRendererByMeshName.get(key);
      if (!current || textureCount > current.textureCount) {
        bestRendererByMeshName.set(key, { renderer, textureCount });
      }
    });
    const uniqueRenderers = Array.from(bestRendererByMeshName.values())
      .sort(
        createSorter(
          (v) =>
            v.renderer.name ||
            v.renderer.mesh?.name ||
            `part_${v.renderer.path_id}`,
        ),
      )
      .map((v) => v.renderer);
    const meshBestRendererMap = new Map<
      string,
      { renderer: RendererRecord; textureCount: number }
    >();
    uniqueRenderers.forEach((renderer) => {
      const goIdStr = renderer.m_GameObject?.path_id || "";
      const meshFilter = lookup.filtersByGo.get(goIdStr);
      const mMesh = meshFilter?.m_Mesh as Record<string, JSONValue> | undefined;
      const meshId = renderer.mesh_path_id || mMesh?.path_id;
      if (!meshId) return;
      const key = `${String(meshId)}_${renderer.sourceFileName || "default"}`;
      const textureCount = getRendererTextureScore(renderer);
      const existing = meshBestRendererMap.get(key);
      if (!existing || textureCount > existing.textureCount) {
        meshBestRendererMap.set(key, { renderer, textureCount });
      }
    });
    return { uniqueRenderers, meshBestRendererMap };
  }
  private async instantiateBabylonMeshes(
    uniqueRenderers: RendererRecord[],
    lookup: Lookup,
    transformNodes: Map<string, TransformNode>,
    transformChildrenMap: Map<string, Set<string>>,
    skeletons: Map<
      string,
      {
        skeleton: Skeleton;
        boneMap: Map<string, Bone>;
        hierarchyRootId: string;
      }
    >,
    allUsedBones: Set<string>,
    meshBestRendererMap: Map<
      string,
      { renderer: RendererRecord; textureCount: number }
    >,
    sceneRoot: TransformNode,
  ): Promise<Mesh[]> {
    const createdMeshes: Mesh[] = [];
    let rendererIndex = 0;
    for (const renderer of uniqueRenderers) {
      const percent = 85 + (rendererIndex / uniqueRenderers.length) * 14;
      updateProgress(
        percent,
        "Building Scene...",
        `Instantiating mesh ${rendererIndex + 1} of ${uniqueRenderers.length}: ${renderer.name || "part"}`,
      );
      const mesh = await instantiateMesh({
        renderer: renderer as never as UnityObject,
        scene: this.scene,
        lookup: lookup as never,
        transformNodes,
        transformChildrenMap,
        skeletons: skeletons as never,
        allUsedBones,
        meshBestRendererMap: meshBestRendererMap as never,
        sceneRoot,
        percentStart: 85,
        percentEnd: 99,
        rendererIndex,
        totalRenderers: uniqueRenderers.length,
      });
      if (mesh) {
        createdMeshes.push(mesh);
      }
      rendererIndex++;
    }
    return createdMeshes;
  }
}
