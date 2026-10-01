import { Scene } from "@babylonjs/core/scene";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Vector3, Quaternion, Matrix } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { UnityObject, JSONValue } from "./types";
import { HUMAN_BONE_NAMES, getBonePathForHumanBone } from "./humanoid_system";
export const findRoot = (
  pathId: string,
  transformsByPathId: Map<string, UnityObject>,
): string => {
  let currentId = String(pathId);
  let rootId = String(pathId);
  while (true) {
    const transform = transformsByPathId.get(currentId);
    const transformFather = transform?.m_Father as Record<string, JSONValue> | undefined;
    if (transform && transformFather) {
      const fatherIdStr = String(transformFather.path_id || transformFather.m_PathID || "");
      if (fatherIdStr && fatherIdStr !== "0") {
        const fatherTransform = transformsByPathId.get(fatherIdStr);
        const fatherTransformFather = fatherTransform?.m_Father as Record<string, JSONValue> | undefined;
        const grandfatherIdStr = fatherTransformFather
          ? String(fatherTransformFather.path_id || fatherTransformFather.m_PathID || "0")
          : "0";
        if (grandfatherIdStr === "0") {
          rootId = currentId;
          break;
        }
        currentId = fatherIdStr;
        rootId = currentId;
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return rootId;
};
export const createSkeletonForBones = (
  bonePathIds: string[],
  scene: Scene,
  transformsByPathId: Map<string, UnityObject>,
  transformNodes: Map<string, TransformNode>,
  transformChildrenMap: Map<string, Set<string>>,
  skeletons: Map<
    string,
    { skeleton: Skeleton; boneMap: Map<string, Bone>; hierarchyRootId: string }
  >,
  allUsedBones?: Set<string>,
): {
  skeleton: Skeleton;
  boneMap: Map<string, Bone>;
  hierarchyRootId: string;
} | null => {
  if (!bonePathIds || bonePathIds.length === 0) return null;
  const hierarchyRootId = findRoot(bonePathIds[0], transformsByPathId);
  if (skeletons.has(hierarchyRootId)) {
    const existing = skeletons.get(hierarchyRootId);
    if (existing) return existing;
  }
  const targetBones = new Set<string>();
  if (allUsedBones && allUsedBones.size > 0) {
    allUsedBones.forEach((id) => {
      if (id !== undefined && id !== null) {
        targetBones.add(String(id));
      }
    });
  } else {
    bonePathIds.forEach((id) => {
      if (id !== undefined && id !== null) {
        targetBones.add(String(id));
      }
    });
  }
  const neededCache = new Map<string, boolean>();
  const isNodeNeeded = (id: string): boolean => {
    const idStr = String(id);
    if (neededCache.has(idStr)) return neededCache.get(idStr)!;
    const hasInTarget = targetBones.has(idStr);
    if (hasInTarget) {
      neededCache.set(idStr, true);
      return true;
    }
    const children = transformChildrenMap.get(idStr);
    if (children) {
      for (const childId of children) {
        if (isNodeNeeded(childId)) {
          neededCache.set(idStr, true);
          return true;
        }
      }
    }
    neededCache.set(idStr, false);
    return false;
  };
  const skeletonName = `skeleton_${hierarchyRootId}`;
  const skeletonId = `skel_${hierarchyRootId}`;
  const skeleton = new Skeleton(skeletonName, skeletonId, scene);
  const boneMap = new Map<string, Bone>();
  const buildBoneHierarchy = (
    currentPathId: string,
    parentBone: Bone | null,
    parentPath: string = "",
  ) => {
    const currentIdStr = String(currentPathId);
    if (!isNodeNeeded(currentIdStr)) {
      return;
    }
    const node = transformNodes.get(currentIdStr);
    const nodeName = node?.name || `bone_${currentIdStr}`;
    const fullPath = parentPath ? `${parentPath}/${nodeName}` : nodeName;
    const t = transformsByPathId.get(currentIdStr);
    const rot = t?.m_LocalRotation as Record<string, number> | undefined;
    const pos = t?.m_LocalPosition as Record<string, number> | undefined;
    const localMatrix = t
      ? Matrix.Compose(
          node ? node.scaling : new Vector3(1, 1, 1),
          new Quaternion(
            rot?.x ?? 0,
            rot?.y ?? 0,
            rot?.z ?? 0,
            rot?.w ?? 1,
          ),
          new Vector3(
            pos?.x ?? 0,
            pos?.y ?? 0,
            pos?.z ?? 0,
          ),
        )
      : Matrix.Identity();
    const bone = new Bone(nodeName, skeleton, parentBone, localMatrix);
    (bone as { fullPath?: string }).fullPath = fullPath;
    if (node) {
      bone.linkTransformNode(node);
    }
    bone.setBindPose(localMatrix);
    boneMap.set(currentIdStr, bone);
    const children = transformChildrenMap.get(currentIdStr);
    if (children) {
      children.forEach((childId) =>
        buildBoneHierarchy(childId, bone, fullPath),
      );
    }
  };
  buildBoneHierarchy(hierarchyRootId, null, "");
  const skeletonData = { skeleton, boneMap, hierarchyRootId };
  skeletons.set(hierarchyRootId, skeletonData);
  const missingBones: string[] = [];
  bonePathIds.forEach((id) => {
    if (!boneMap.has(String(id))) {
      missingBones.push(id);
    }
  });
  return skeletonData;
};
export type GenericPartAttachment = {
  partNode: TransformNode;
  humanBone: Bone;
  partBindAbsolute: Matrix;
  humanBoneBindAbsolute: Matrix;
};
const findDeepestNameMatch = (
  root: Bone,
  nameToHumanBone: Map<string, Bone>,
): { humanBone: Bone; depth: number } | null => {
  let best: { humanBone: Bone; depth: number } | null = null;
  const walk = (b: Bone, depth: number) => {
    const match = nameToHumanBone.get(b.name);
    if (match && (!best || depth > best.depth)) {
      best = { humanBone: match, depth };
    }
    b.getChildren().forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
  return best;
};
const HEAD_PART_PATTERN = /hair|tiara|helmet|head|face/i;
const HEAD_HUMAN_BONE_INDEX = HUMAN_BONE_NAMES.indexOf("Head");
const isHeadPart = (root: Bone): boolean => {
  const walk = (b: Bone): boolean =>
    HEAD_PART_PATTERN.test(b.name) || b.getChildren().some(walk);
  return walk(root);
};
const findAvatarHeadBone = (skeleton: Skeleton): Bone | null => {
  const avatar = (skeleton as { avatar?: UnityObject | null }).avatar;
  if (!avatar) return null;
  const path = getBonePathForHumanBone(avatar, HEAD_HUMAN_BONE_INDEX);
  if (!path) return null;
  const name = path.split("/").pop();
  let byName: Bone | null = null;
  for (const bone of skeleton.bones) {
    const fullPath = (bone as { fullPath?: string }).fullPath;
    if (
      fullPath &&
      (fullPath === path ||
        fullPath.endsWith("/" + path) ||
        path.endsWith("/" + fullPath))
    ) {
      return bone;
    }
    if (!byName && bone.name === name) byName = bone;
  }
  return byName;
};
export const computeGenericPartAttachments = (
  skeletons: Map<
    string,
    { skeleton: Skeleton; boneMap: Map<string, Bone>; hierarchyRootId: string }
  >,
): GenericPartAttachment[] => {
  const attachments: GenericPartAttachment[] = [];
  const humanSkeletons: Skeleton[] = [];
  skeletons.forEach(({ skeleton }) => {
    if ((skeleton as { avatarIsGenuine?: boolean }).avatarIsGenuine) {
      humanSkeletons.push(skeleton);
    }
  });
  if (humanSkeletons.length === 0) return attachments;
  humanSkeletons.forEach((s) => s.computeAbsoluteMatrices(true));
  const nameToHumanBone = new Map<string, Bone>();
  humanSkeletons.forEach((s) => {
    s.bones.forEach((b) => {
      if (!nameToHumanBone.has(b.name)) nameToHumanBone.set(b.name, b);
    });
  });
  let headBone: Bone | null = null;
  for (const s of humanSkeletons) {
    headBone = findAvatarHeadBone(s);
    if (headBone) break;
  }
  skeletons.forEach(({ skeleton }) => {
    if ((skeleton as { avatarIsGenuine?: boolean }).avatarIsGenuine) return;
    skeleton.computeAbsoluteMatrices(true);
    const roots = skeleton.bones.filter((b) => !b.getParent());
    roots.forEach((root) => {
      const humanBone =
        findDeepestNameMatch(root, nameToHumanBone)?.humanBone ??
        (headBone && isHeadPart(root) ? headBone : null);
      if (!humanBone) return;
      const partNode = root.getTransformNode();
      if (!partNode) return;
      attachments.push({
        partNode,
        humanBone,
        partBindAbsolute: root.getAbsoluteMatrix().clone(),
        humanBoneBindAbsolute: humanBone.getAbsoluteMatrix().clone(),
      });
    });
  });
  return attachments;
};
