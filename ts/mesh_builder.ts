import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { Matrix, Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { MorphTargetManager } from "@babylonjs/core/Morph/morphTargetManager";
import { MorphTarget } from "@babylonjs/core/Morph/morphTarget";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { createSkeletonForBones, findRoot } from "./bone_system";
import { createMaterial, createMultiMaterial } from "./renderer_utils";
import { computeCRC32, normalizeHash } from "./utils";
import { workerClient } from "./worker_client";
import { state } from "./state";
import type { MeshMeta, UnityObject, JSONValue, PathId } from "./types";
export const getRelativeMatrix = (
  startPathId: string,
  endPathId: string,
  transformsByPathId: Map<string, UnityObject>,
): Matrix => {
  let matrix = Matrix.Identity();
  let currentId = String(startPathId);
  const targetId = String(endPathId);
  const endTransform = transformsByPathId.get(targetId);
  const endFather = endTransform?.m_Father as Record<string, JSONValue> | undefined;
  const endParentId = endFather
    ? String(endFather.path_id || endFather.m_PathID || "0")
    : "0";
  while (currentId !== "0" && currentId !== endParentId) {
    const t = transformsByPathId.get(currentId);
    if (!t) break;
    const scale = t.m_LocalScale as Record<string, JSONValue> | undefined;
    const rot = t.m_LocalRotation as Record<string, JSONValue> | undefined;
    const pos = t.m_LocalPosition as Record<string, JSONValue> | undefined;
    const local = Matrix.Compose(
      scale
        ? new Vector3(Number(scale.x), Number(scale.y), Number(scale.z))
        : new Vector3(1, 1, 1),
      rot
        ? new Quaternion(
            Number(rot.x),
            Number(rot.y),
            Number(rot.z),
            Number(rot.w),
          )
        : Quaternion.Identity(),
      pos
        ? new Vector3(
            Number(pos.x),
            Number(pos.y),
            Number(pos.z),
          )
        : Vector3.Zero(),
    );
    matrix = local.multiply(matrix);
    const father = t.m_Father as Record<string, JSONValue> | undefined;
    currentId = String(father?.path_id || father?.m_PathID || "0");
  }
  return matrix;
};
interface MeshLookup {
  filtersByGo: Map<string, UnityObject>;
  transformsByGo: Map<string, UnityObject>;
  transforms: Map<string, UnityObject>;
}
export interface MeshInstanceParams {
  renderer: UnityObject;
  scene: Scene;
  lookup: MeshLookup;
  transformNodes: Map<string, TransformNode>;
  transformChildrenMap: Map<string, Set<string>>;
  skeletons: Map<
    string,
    { skeleton: Skeleton; boneMap: Map<string, Bone>; hierarchyRootId: string }
  >;
  allUsedBones: Set<string>;
  meshBestRendererMap: Map<string, { renderer: UnityObject }>;
  sceneRoot: TransformNode;
  percentStart: number;
  percentEnd: number;
  rendererIndex: number;
  totalRenderers: number;
}
export async function instantiateMesh(
  params: MeshInstanceParams,
): Promise<Mesh | null> {
  const {
    renderer,
    scene,
    lookup,
    transformNodes,
    transformChildrenMap,
    skeletons,
    allUsedBones,
    meshBestRendererMap,
    sceneRoot,
  } = params;
  if (!renderer.mesh) {
    return null;
  }
  const mesh_data = renderer.mesh as never as MeshMeta;
  const go = renderer.m_GameObject as Record<string, JSONValue> | undefined;
  const goIdStr = String(go?.path_id || "");
  const filter = lookup.filtersByGo.get(goIdStr);
  const filterMesh = filter?.m_Mesh as Record<string, JSONValue> | undefined;
  const meshId =
    String(renderer.mesh_path_id || "") || String(filterMesh?.path_id || "");
  const key = `${meshId}_${String(renderer.sourceFileName || "default")}`;
  const isBest = meshBestRendererMap.get(key)?.renderer === renderer;
  const customMesh = new Mesh(
    String(renderer.name || mesh_data.name || `part_${renderer.path_id || ""}`),
    scene,
  );
  customMesh.alwaysSelectAsActiveMesh = true;
  customMesh.setEnabled(renderer.m_Enabled !== false);
  let activeSkeleton: Skeleton | null = null;
  let activeLocalToGlobal: Int32Array | null = null;
  customMesh.isVisible = isBest;
  customMesh.metadata = {
    gameObjectId: goIdStr,
    rendererPathId: String(renderer.path_id || ""),
    isBest,
  };
  let meshMatrix = Matrix.Identity();
  const transform = lookup.transformsByGo.get(goIdStr);
  const bonePathIds = renderer.bone_path_ids as string[] | undefined;
  const hasSkin =
    bonePathIds && bonePathIds.length > 0 && !!mesh_data.m_BindPose;
  if (transform) {
    const transformIdStr = String(transform.path_id || "");
    if (hasSkin) {
      const rootId = findRoot(transformIdStr, state.transformsByPathId);
      meshMatrix = getRelativeMatrix(
        transformIdStr,
        rootId,
        state.transformsByPathId,
      );
    } else {
      const node = transformNodes.get(transformIdStr);
      if (node) customMesh.parent = node;
    }
  } else {
    customMesh.parent = sceneRoot;
  }
  const normalMatrix = mesh_data.m_Normals
    ? Matrix.Invert(meshMatrix).transpose()
    : null;
  if (!renderer.transformedPositions) {
    const file = state.loadedFiles.find(
      (f) => f.name === mesh_data.sourceFileName,
    );
    if (file && file.fileIndex !== undefined) {
      const pathId = mesh_data.path_id || "";
      const matrixArray = hasSkin ? meshMatrix.toArray() : null;
      const normalMatrixArray =
        hasSkin && normalMatrix ? normalMatrix.toArray() : null;
      const data = await workerClient.getMeshData(
        file.fileIndex,
        pathId as PathId,
        mesh_data.sourceFileName || "",
        matrixArray,
        normalMatrixArray,
      );
      if (data) {
        if (data.vertices) renderer.transformedPositions = data.vertices as never as JSONValue;
        if (data.normals) renderer.transformedNormals = data.normals as never as JSONValue;
        if (data.uvs) mesh_data.m_UV0 = data.uvs;
        if (data.indices) mesh_data.m_Indices = data.indices;
        if (data.skinIndices && data.skinWeights) {
          const skinData = [];
          for (let i = 0; i < data.skinIndices.length; i += 4) {
            skinData.push({
              boneIndex: [
                data.skinIndices[i],
                data.skinIndices[i + 1],
                data.skinIndices[i + 2],
                data.skinIndices[i + 3],
              ] as [number, number, number, number],
              weight: [
                Math.round(data.skinWeights[i] * 255.0),
                Math.round(data.skinWeights[i + 1] * 255.0),
                Math.round(data.skinWeights[i + 2] * 255.0),
                Math.round(data.skinWeights[i + 3] * 255.0),
              ] as [number, number, number, number],
            });
          }
          mesh_data.m_Skin = skinData;
        }
      }
    }
  }
  const transformedPositions =
    (renderer.transformedPositions as Float32Array | undefined) || mesh_data.m_Vertices;
  const transformedNormals = (renderer.transformedNormals as Float32Array | undefined) || mesh_data.m_Normals;
  if (!transformedPositions || transformedPositions.length === 0) {
    customMesh.dispose();
    return null;
  }
  if (!mesh_data.m_Indices || mesh_data.m_Indices.length === 0) {
    customMesh.dispose();
    return null;
  }
  if (hasSkin) {
    const skeletonData = createSkeletonForBones(
      bonePathIds,
      scene,
      lookup.transforms,
      transformNodes,
      transformChildrenMap,
      skeletons,
      allUsedBones,
    );
    if (skeletonData) {
      const { skeleton, boneMap, hierarchyRootId } = skeletonData;
      customMesh.skeleton = skeleton;
      (customMesh as { useDualQuaternionSkinning?: boolean }).useDualQuaternionSkinning = true;
      let skeletonAvatar: Record<string, JSONValue> | null = null;
      let currentGoId = goIdStr;
      while (currentGoId && currentGoId !== "0") {
        const animator = state.animatorsByGameObjectId?.get(currentGoId);
        const animatorAvatar = animator?.m_Avatar as Record<string, JSONValue> | undefined;
        if (
          animatorAvatar &&
          animatorAvatar.path_id &&
          animatorAvatar.path_id !== "0"
        ) {
          skeletonAvatar = state.avatarsByPathId?.get(
            String(animatorAvatar.path_id),
          ) || null;
          if (skeletonAvatar) break;
        }
        const transform = state.transformsByGameObjectId?.get(currentGoId);
        const tfFather = transform?.m_Father as Record<string, JSONValue> | undefined;
        if (
          transform &&
          tfFather &&
          tfFather.path_id &&
          tfFather.path_id !== "0"
        ) {
          const fatherTransform = state.transformsByPathId?.get(
            String(tfFather.path_id),
          );
          const ftGo = fatherTransform?.m_GameObject as Record<string, JSONValue> | undefined;
          currentGoId = ftGo ? String(ftGo.path_id) : "0";
        } else {
          break;
        }
      }
      if (!skeletonAvatar && hierarchyRootId) {
        let currentTransformId = String(hierarchyRootId);
        while (currentTransformId && currentTransformId !== "0") {
          const transform = state.transformsByPathId?.get(currentTransformId);
          if (!transform) break;
          const trGo = transform.m_GameObject as Record<string, JSONValue> | undefined;
          const goId = trGo ? String(trGo.path_id) : "0";
          const animator = state.animatorsByGameObjectId?.get(goId);
          const animatorAvatar = animator?.m_Avatar as Record<string, JSONValue> | undefined;
          if (
            animator &&
            animatorAvatar &&
            animatorAvatar.path_id &&
            animatorAvatar.path_id !== "0"
          ) {
            skeletonAvatar = state.avatarsByPathId?.get(
              String(animatorAvatar.path_id),
            ) || null;
            if (skeletonAvatar) break;
          }
          currentTransformId = String((transform.m_Father as Record<string, JSONValue> | undefined)?.path_id || "0");
        }
      }
      if (
        !skeletonAvatar &&
        state.avatarsByPathId &&
        state.avatarsByPathId.size > 0
      ) {
        skeletonAvatar = state.avatarsByPathId.values().next().value || null;
      }
      (skeleton as { avatar?: Record<string, JSONValue> | null }).avatar = skeletonAvatar;
      const rootNode = transformNodes.get(hierarchyRootId);
      if (rootNode) customMesh.parent = hasSkin ? sceneRoot : rootNode;
      const rendererIdStr = String(renderer.path_id || "");
      const trans = state.partTranslations.get(rendererIdStr);
      if (trans) customMesh.position.set(trans.x, trans.y, trans.z);
      const pathHashToBone = new Map<number, Bone>();
      skeleton.bones.forEach((b) => {
        if ("fullPath" in b) {
          let currentPath = (b as { fullPath: string }).fullPath;
          while (true) {
            pathHashToBone.set(computeCRC32(currentPath), b);
            const nextSlash = currentPath.indexOf("/");
            if (nextSlash === -1) break;
            currentPath = currentPath.substring(nextSlash + 1);
          }
        }
      });
      customMesh.metadata.hashToBoneMap = boneMap;
      let localToGlobal = new Int32Array(0);
      if (mesh_data.m_BindPose) {
        localToGlobal = new Int32Array(mesh_data.m_BindPose.length);
        const invMeshMatrix = Matrix.Invert(meshMatrix);
        mesh_data.m_BindPose.forEach(
          (pose: { m?: number[] } | number[], i: number) => {
            let targetBone =
              bonePathIds && bonePathIds[i]
                ? boneMap.get(String(bonePathIds[i]))
                : null;
            if (targetBone) {
              localToGlobal[i] = skeleton.bones.indexOf(targetBone);
              const arr = ("m" in pose ? pose.m : pose) as number[];
              const bindPose = Matrix.FromArray(arr).transpose();
              (targetBone as { _invertedBindMatrix?: Matrix })._invertedBindMatrix =
                bindPose.multiply(invMeshMatrix);
            } else {
              const missingId = bonePathIds ? bonePathIds[i] : "undefined";
              console.warn(
                `[main.ts] Mesh "${mesh_data.name}": local bone index ${i} (pathId: ${missingId}) not found in skeleton! Defaulting localToGlobal to 0.`,
              );
              localToGlobal[i] = 0;
            }
          },
        );
      }
      activeSkeleton = skeleton;
      activeLocalToGlobal = localToGlobal;
      if (mesh_data.m_Skin && mesh_data.m_Skin.length > 0) {
        const indices: number[] = [],
          weights: number[] = [];
        mesh_data.m_Skin.forEach(
          (skin: {
            boneIndex: [number, number, number, number];
            weight: [number, number, number, number];
          }) => {
            indices.push(
              localToGlobal[skin.boneIndex[0]],
              localToGlobal[skin.boneIndex[1]],
              localToGlobal[skin.boneIndex[2]],
              localToGlobal[skin.boneIndex[3]],
            );
            const w = Array.from(skin.weight).map((v: number) => v / 255.0);
            const total = w.reduce((a: number, b: number) => a + b, 0);
            weights.push(
              ...(total > 0.001
                ? w.map((v: number) => v / total)
                : [1, 0, 0, 0]),
            );
          },
        );
        customMesh.setVerticesData(
          VertexBuffer.MatricesIndicesKind,
          new Float32Array(indices),
          false,
        );
        customMesh.setVerticesData(
          VertexBuffer.MatricesWeightsKind,
          new Float32Array(weights),
          false,
        );
      }
      const hashToBoneMap = new Map<string, Bone>();
      bonePathIds.forEach((id: string | number | null | undefined, i: number) => {
        const bone = boneMap.get(String(id));
        if (bone && mesh_data.m_BoneNameHashes?.[i]) {
          hashToBoneMap.set(normalizeHash(mesh_data.m_BoneNameHashes[i]), bone);
        }
      });
      pathHashToBone.forEach((bone, hash) => {
        hashToBoneMap.set(normalizeHash(hash), bone);
      });
      customMesh.metadata = {
        hashToBoneMap,
        gameObjectId: goIdStr,
        rendererPathId: String(renderer.path_id || ""),
        isBest,
      };
    }
  }
  let transformedIndices = mesh_data.m_Indices;
  const subMeshDefinitions: Array<{
    materialIndex: number;
    indexStart: number;
    indexCount: number;
    boneIndex: number;
  }> = [];
  if (mesh_data.m_SubMeshes && mesh_data.m_SubMeshes.length > 0) {
    if (mesh_data.m_Skin && mesh_data.m_Skin.length > 0 && activeSkeleton && activeLocalToGlobal && activeLocalToGlobal.length > 0) {
      const vertexDominantBone = new Int32Array(mesh_data.m_VertexCount ?? 0);
      vertexDominantBone.fill(-1);
      mesh_data.m_Skin.forEach((skin, vi) => {
        if (vi < vertexDominantBone.length) {
          let maxWeight = -1;
          let bestBoneLocalIdx = 0;
          for (let b = 0; b < 4; b++) {
            if (skin.weight[b] > maxWeight) {
              maxWeight = skin.weight[b];
              bestBoneLocalIdx = skin.boneIndex[b];
            }
          }
          vertexDominantBone[vi] = activeLocalToGlobal![bestBoneLocalIdx] ?? -1;
        }
      });
      const newIndices: number[] = [];
      mesh_data.m_SubMeshes.forEach((sub, si: number) => {
        if (!sub || sub.topology !== 0) return;
        const start = sub.firstByte ? (sub.firstByte >> 1) : 0;
        let count = sub.indexCount;
        if (start >= 0 && count !== undefined && count > 0) {
          const triCount = Math.floor(count / 3);
          const triGroups = new Map<number, number[]>();
          for (let t = 0; t < triCount; t++) {
            const v0 = mesh_data.m_Indices![start + t * 3];
            const v1 = mesh_data.m_Indices![start + t * 3 + 1];
            const v2 = mesh_data.m_Indices![start + t * 3 + 2];
            const b0 = vertexDominantBone[v0] ?? -1;
            const b1 = vertexDominantBone[v1] ?? -1;
            const b2 = vertexDominantBone[v2] ?? -1;
            let dominantBone = b0;
            if (b0 === b1 || b0 === b2) {
              dominantBone = b0;
            } else if (b1 === b2) {
              dominantBone = b1;
            }
            if (!triGroups.has(dominantBone)) {
              triGroups.set(dominantBone, []);
            }
            triGroups.get(dominantBone)!.push(t);
          }
          triGroups.forEach((triOffsets, boneIndex) => {
            const subMeshStart = newIndices.length;
            const subMeshCount = triOffsets.length * 3;
            triOffsets.forEach((t) => {
              newIndices.push(
                mesh_data.m_Indices![start + t * 3],
                mesh_data.m_Indices![start + t * 3 + 1],
                mesh_data.m_Indices![start + t * 3 + 2]
              );
            });
            subMeshDefinitions.push({
              materialIndex: si,
              indexStart: subMeshStart,
              indexCount: subMeshCount,
              boneIndex
            });
          });
        }
      });
      transformedIndices = new Uint32Array(newIndices);
    } else {
      mesh_data.m_SubMeshes.forEach((sub, si: number) => {
        if (!sub || sub.topology !== 0) return;
        const start = sub.firstByte ? (sub.firstByte >> 1) : 0;
        let count = sub.indexCount;
        if (start >= 0 && count !== undefined && count > 0) {
          subMeshDefinitions.push({
            materialIndex: si,
            indexStart: start,
            indexCount: count - (count % 3),
            boneIndex: -1
          });
        }
      });
    }
  }
  const vertexData = new VertexData();
  vertexData.positions = transformedPositions;
  vertexData.indices = transformedIndices;
  if (transformedNormals) vertexData.normals = transformedNormals;
  if (mesh_data.m_UV0) vertexData.uvs = mesh_data.m_UV0;
  vertexData.applyToMesh(customMesh);
  const hasNormals = transformedNormals && transformedNormals.length > 0;
  if (!hasNormals) {
    customMesh.createNormals(true);
  }
  if (mesh_data.m_Shapes?.channels && mesh_data.m_Shapes.channels.length > 0) {
    const morphManager = new MorphTargetManager(scene);
    customMesh.morphTargetManager = morphManager;
    mesh_data.m_Shapes.channels.forEach((rawChannel: Record<string, JSONValue> | null, channelIdx: number) => {
      const channel = rawChannel as { name?: string; frameCount?: number; frameIndex?: number } | null;
      if (channel && channel.frameCount && channel.frameCount > 0 && channel.frameIndex !== undefined && mesh_data.m_Shapes) {
        const shapes = mesh_data.m_Shapes.shapes;
        const vertices = mesh_data.m_Shapes.vertices;
        if (shapes && vertices) {
          const shape = shapes[channel.frameIndex];
          if (shape && shape.vertexCount !== undefined && shape.firstVertex !== undefined) {
            const target = new MorphTarget(channel.name || `shape_${channelIdx}`, 0, scene);
            const targetPositions = new Float32Array(transformedPositions.length);
            targetPositions.set(transformedPositions);
            for (let i = 0; i < shape.vertexCount; i++) {
              const mv = vertices[shape.firstVertex + i] as { index?: number; vertex?: [number, number, number] | number[] } | undefined;
              if (mv && mv.vertex && mv.index !== undefined) {
                const vIdx = mv.index * 3;
                if (vIdx < targetPositions.length) {
                  const delta = new Vector3(
                    mv.vertex[0],
                    mv.vertex[1],
                    mv.vertex[2],
                  );
                  const transformedDelta = Vector3.TransformNormal(
                    delta,
                    meshMatrix,
                  );
                  targetPositions[vIdx] += transformedDelta.x;
                  targetPositions[vIdx + 1] += transformedDelta.y;
                  targetPositions[vIdx + 2] += transformedDelta.z;
                }
              }
            }
            target.setPositions(targetPositions);
            const weights = renderer.m_BlendShapeWeights as number[] | undefined;
            if (
              weights &&
              weights[channelIdx] !== undefined
            ) {
              target.influence = weights[channelIdx] / 100.0;
            }
            morphManager.addTarget(target);
          }
        }
      }
    });
  }
  const textures = (renderer.textures as Array<{ texture?: { path_id?: string }; path_id?: string } | null>) || [];
  const textureIdsKey = textures
    .map((t) => (t ? (t.texture ? t.texture.path_id : t.path_id) : "0"))
    .join(",");
  if (subMeshDefinitions.length > 1) {
    if (textures.length > 0) {
      customMesh.material = await createMultiMaterial(
        textures,
        textureIdsKey,
        mesh_data.m_SubMeshes as never as UnityObject[],
        mesh_data.name || "",
        scene,
        state.materialCache,
        state.textureCache,
      );
    } else {
      customMesh.material = await createMaterial(
        textures,
        textureIdsKey,
        scene,
        state.materialCache,
        state.textureCache,
      );
    }
    customMesh.subMeshes = [];
    subMeshDefinitions.forEach((def) => {
      const subMesh = new SubMesh(
        def.materialIndex,
        0,
        mesh_data.m_VertexCount ?? 0,
        def.indexStart,
        def.indexCount,
        customMesh,
      );
      if (def.boneIndex !== -1 && activeSkeleton) {
        const bone = activeSkeleton.bones[def.boneIndex];
        if (bone) {
          const boneName = bone.name;
          const cleanedName = boneName.split(/[\/_:]/).pop() || boneName;
          (subMesh as any).friendlyName = cleanedName;
        }
      }
    });
    customMesh.metadata.originalSubMeshes = [...customMesh.subMeshes];
  } else {
    customMesh.material = await createMaterial(
      textures,
      textureIdsKey,
      scene,
      state.materialCache,
      state.textureCache,
    );
  }
  return customMesh;
}
