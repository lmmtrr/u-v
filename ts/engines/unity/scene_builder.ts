import { Bone } from "@babylonjs/core/Bones/bone";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Matrix, Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { state } from "../../state";
import { setupSpringBones } from "../../physics_system";
import { computeCRC32, createSorter, normalizeHash } from "../../utils";
import { updateProgress } from "../../progress";
import type { MeshMeta, TextureMeta, UnityObject, JSONValue, LoadedFile } from "../../types";
import { processOrphanedMeshes } from "../../orphan_resolver";
import { resolveRendererTextures, isValidPathId } from "../../texture_resolver";
import { instantiateMesh, getRelativeMatrix } from "../../mesh_builder";
import { findRoot, computeGenericPartAttachments } from "../../bone_system";
import { buildExternalRefIndex, type ExternalRefIndex } from "../../external_refs";
import { normalizeLoadedFileIds, getRawPathId } from "../../id_space";
import type { EngineScene } from "../asset_engine";
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
export class UnitySceneBuilder {
  private files: LoadedFile[] = [];
  constructor(private scene: Scene) {}
  public async build(files: LoadedFile[], engine: string): Promise<EngineScene> {
    this.files = files;
    const objects = this.aggregateObjectsAndHashes();
    const lookup = this.classifyObjects(objects);
    this.applyGameObjectActiveState(objects, lookup);
    this.applyLODGroups(objects);
    const meshSourceFiles = new Set<string>();
    this.files.forEach((f) => {
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
            let remapped = false;
            smr.bone_path_ids = smr.bone_path_ids.map((boneId) => {
              const boneIdStr = String(boneId);
              const node = transformNodes.get(boneIdStr);
              if (node) {
                const name = node.name;
                const boneRootId = findRoot(boneIdStr, lookup.transforms);
                if (boneRootId !== mainRigRootId) {
                  const matchingMainBoneId = mainRigTransformsByName.get(name);
                  if (matchingMainBoneId) {
                    remapped = true;
                    return matchingMainBoneId;
                  }
                }
              }
              return boneIdStr;
            });
            if (remapped || originalRootId !== mainRigRootId) {
              smr.skipBindPoseCorrection = true;
            }
          }
        }
      });
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
    lookup.animationClips.sort(createSorter((a) => a.name));
    return {
      meshes: createdMeshes,
      skeletons: [...skeletons.values()].map((data) => data.skeleton),
      partAttachments: computeGenericPartAttachments(skeletons),
      animationClips: lookup.animationClips.map((clip) => ({
        name: clip.name,
        engine,
        clipData: clip.clipData as UnityObject,
      })),
      createPhysics: () =>
        setupSpringBones(objects, transformNodes, skeletons as never, lookup.transformsByGo as never),
    };
  }
  private aggregateObjectsAndHashes(): UnityObject[] {
    normalizeLoadedFileIds(this.files);
    const objects: UnityObject[] = [];
    this.files.forEach((f) => {
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
      const transform = lookup.transformsByGo.get(goIdStr);
      const father = transform?.m_Father as
        | Record<string, JSONValue>
        | undefined;
      const fatherIdStr = father
        ? String(father.path_id || father.m_PathID || "0")
        : "0";
      let fatherGoIdStr = "";
      if (fatherIdStr && fatherIdStr !== "0") {
        const fatherTransform = lookup.transforms.get(fatherIdStr);
        const fatherGo = fatherTransform?.m_GameObject as
          | Record<string, JSONValue>
          | undefined;
        fatherGoIdStr = fatherGo ? String(fatherGo.path_id || "") : "";
      }
      let active = fatherGoIdStr ? selfActive : true;
      if (active && fatherGoIdStr) active = isGameObjectActive(fatherGoIdStr);
      activeCache.set(goIdStr, active);
      return active;
    };
    const toDisable: Record<string, JSONValue>[] = [];
    let enabledCount = 0;
    objects.forEach((obj) => {
      const renderer = (obj?.SkinnedMeshRenderer || obj?.MeshRenderer) as
        | Record<string, JSONValue>
        | undefined;
      if (!renderer) return;
      if (renderer.m_Enabled === false) return;
      const go = renderer.m_GameObject as
        | Record<string, JSONValue>
        | undefined;
      const goIdStr = go ? String(go.path_id || "") : "";
      if (!goIdStr) return;
      if (isGameObjectActive(goIdStr)) enabledCount++;
      else toDisable.push(renderer);
    });
    if (enabledCount === 0) return;
    toDisable.forEach((renderer) => {
      renderer.m_Enabled = false;
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
      externalRefs: buildExternalRefIndex(this.files),
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
                (cleanGoName.length >= 4 && cleanTarget.endsWith(cleanGoName))
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
                oldWorldMatrix.multiply(invNewParentWorldMatrix);
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
    const getOwner = (renderer: RendererRecord) => {
      let goId = String(renderer.m_GameObject?.path_id || "");
      let transform = lookup.transformsByGo.get(goId);
      while (transform && !state.animatorsByGameObjectId.has(goId)) {
        const fatherId = String(
          (transform.m_Father as Record<string, JSONValue> | undefined)
            ?.path_id || "0",
        );
        const father = lookup.transforms.get(fatherId);
        if (fatherId === "0" || !father) break;
        transform = father;
        goId = String(
          (father.m_GameObject as Record<string, JSONValue> | undefined)
            ?.path_id || "",
        );
      }
      return { id: goId, name: String(lookup.gameObjects.get(goId)?.name || "") };
    };
    const renderers = objects
      .map((obj) => ({
        renderer: (obj?.SkinnedMeshRenderer || obj?.MeshRenderer) as
          | RendererRecord
          | undefined,
        isSkinned: !!obj?.SkinnedMeshRenderer,
      }))
      .filter(
        (r): r is { renderer: RendererRecord; isSkinned: boolean } =>
          !!r.renderer,
      )
      .map((r) => ({ ...r, owner: getOwner(r.renderer) }));
    const ownerKey = (r: (typeof renderers)[number]) =>
      `${r.owner.name}_${r.renderer.sourceFileName || "default"}`;
    const canonicalOwnerByName = new Map<string, string>();
    renderers.forEach((r) => {
      if (r.isSkinned && !canonicalOwnerByName.has(ownerKey(r)))
        canonicalOwnerByName.set(ownerKey(r), r.owner.id);
    });
    renderers.forEach((r) => {
      if (!canonicalOwnerByName.has(ownerKey(r)))
        canonicalOwnerByName.set(ownerKey(r), r.owner.id);
    });
    const bestRendererByMeshName = new Map<
      string,
      { renderer: RendererRecord; textureCount: number; isCanonical: boolean }
    >();
    renderers.forEach((r) => {
      const { renderer } = r;
      const name =
        renderer.name || renderer.mesh?.name || `part_${renderer.path_id}`;
      const key = `${r.owner.name}/${name}_${renderer.sourceFileName || "default"}`;
      const textureCount = getRendererTextureScore(renderer);
      const isCanonical = canonicalOwnerByName.get(ownerKey(r)) === r.owner.id;
      const current = bestRendererByMeshName.get(key);
      if (
        !current ||
        (isCanonical && !current.isCanonical) ||
        (isCanonical === current.isCanonical &&
          textureCount > current.textureCount)
      ) {
        bestRendererByMeshName.set(key, { renderer, textureCount, isCanonical });
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
