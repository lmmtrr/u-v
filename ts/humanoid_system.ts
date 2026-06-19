import { Bone } from "@babylonjs/core/Bones/bone";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { normalizeHash } from "./utils";
import type { UnityObject, JSONValue } from "./types";
const getTOSKeyAndValue = (
  e: JSONValue,
): { key: JSONValue; value: JSONValue } | null => {
  if (!e) return null;
  if (Array.isArray(e)) {
    return { key: e[0], value: e[1] };
  }
  const obj = e as Record<string, JSONValue>;
  if (obj.first !== undefined && obj.second !== undefined) {
    return { key: obj.first, value: obj.second };
  } else if (obj.m_First !== undefined && obj.m_Second !== undefined) {
    return { key: obj.m_First, value: obj.m_Second };
  }
  return null;
};
export const HUMAN_BONE_NAMES = [
  "Hips",
  "LeftUpperLeg",
  "RightUpperLeg",
  "LeftLowerLeg",
  "RightLowerLeg",
  "LeftFoot",
  "RightFoot",
  "Spine",
  "Chest",
  "Neck",
  "Head",
  "LeftShoulder",
  "RightShoulder",
  "LeftUpperArm",
  "RightUpperArm",
  "LeftLowerArm",
  "RightLowerArm",
  "LeftHand",
  "RightHand",
  "LeftToes",
  "RightToes",
  "LeftEye",
  "RightEye",
  "Jaw",
  "LeftThumbProximal",
  "LeftThumbIntermediate",
  "LeftThumbDistal",
  "LeftIndexProximal",
  "LeftIndexIntermediate",
  "LeftIndexDistal",
  "LeftMiddleProximal",
  "LeftMiddleIntermediate",
  "LeftMiddleDistal",
  "LeftRingProximal",
  "LeftRingIntermediate",
  "LeftRingDistal",
  "LeftLittleProximal",
  "LeftLittleIntermediate",
  "LeftLittleDistal",
  "RightThumbProximal",
  "RightThumbIntermediate",
  "RightThumbDistal",
  "RightIndexProximal",
  "RightIndexIntermediate",
  "RightIndexDistal",
  "RightMiddleProximal",
  "RightMiddleIntermediate",
  "RightMiddleDistal",
  "RightRingProximal",
  "RightRingIntermediate",
  "RightRingDistal",
  "RightLittleProximal",
  "RightLittleIntermediate",
  "RightLittleDistal",
  "UpperChest",
  "LastBone",
];
export const MUSCLE_TO_BONE: Record<number, { bone: number; axis: string }> = {
  0: { bone: 0, axis: "pos_x" },
  1: { bone: 0, axis: "pos_y" },
  2: { bone: 0, axis: "pos_z" },
  3: { bone: 0, axis: "x" },
  4: { bone: 0, axis: "y" },
  5: { bone: 0, axis: "z" },
  6: { bone: 1, axis: "z" },
  7: { bone: 1, axis: "y" },
  8: { bone: 1, axis: "pos_z" },
  9: { bone: 3, axis: "pos_x" },
  10: { bone: 3, axis: "pos_y" },
  11: { bone: 3, axis: "pos_z" },
  12: { bone: 5, axis: "pos_x" },
  13: { bone: 5, axis: "pos_y" },
  14: { bone: 5, axis: "pos_z" },
  21: { bone: 1, axis: "x" },
  22: { bone: 1, axis: "z" },
  23: { bone: 1, axis: "y" },
  24: { bone: 3, axis: "x" },
  25: { bone: 3, axis: "y" },
  26: { bone: 5, axis: "x" },
  27: { bone: 5, axis: "y" },
  28: { bone: 19, axis: "x" },
  15: { bone: 2, axis: "z" },
  16: { bone: 2, axis: "y" },
  17: { bone: 2, axis: "pos_z" },
  18: { bone: 4, axis: "pos_x" },
  19: { bone: 4, axis: "pos_y" },
  20: { bone: 4, axis: "pos_z" },
  29: { bone: 2, axis: "x" },
  30: { bone: 2, axis: "z" },
  31: { bone: 2, axis: "y" },
  32: { bone: 4, axis: "x" },
  33: { bone: 4, axis: "y" },
  34: { bone: 6, axis: "x" },
  35: { bone: 6, axis: "y" },
  36: { bone: 20, axis: "x" },
  37: { bone: 7, axis: "x" },
  38: { bone: 7, axis: "z" },
  39: { bone: 7, axis: "y" },
  40: { bone: 8, axis: "x" },
  41: { bone: 8, axis: "z" },
  42: { bone: 8, axis: "y" },
  43: { bone: 54, axis: "x" },
  44: { bone: 54, axis: "z" },
  45: { bone: 54, axis: "y" },
  46: { bone: 9, axis: "x" },
  47: { bone: 9, axis: "z" },
  48: { bone: 9, axis: "y" },
  49: { bone: 10, axis: "x" },
  50: { bone: 10, axis: "z" },
  51: { bone: 10, axis: "y" },
  56: { bone: 11, axis: "z" },
  57: { bone: 11, axis: "y" },
  58: { bone: 13, axis: "x" },
  59: { bone: 13, axis: "z" },
  60: { bone: 13, axis: "y" },
  61: { bone: 15, axis: "x" },
  62: { bone: 15, axis: "y" },
  63: { bone: 17, axis: "x" },
  64: { bone: 17, axis: "z" },
  65: { bone: 12, axis: "z" },
  66: { bone: 12, axis: "y" },
  67: { bone: 14, axis: "x" },
  68: { bone: 14, axis: "z" },
  69: { bone: 14, axis: "y" },
  70: { bone: 16, axis: "x" },
  71: { bone: 16, axis: "y" },
  72: { bone: 18, axis: "x" },
  73: { bone: 18, axis: "z" },
  74: { bone: 24, axis: "x" },
  75: { bone: 24, axis: "y" },
  76: { bone: 24, axis: "z" },
  77: { bone: 25, axis: "x" },
  78: { bone: 25, axis: "y" },
  79: { bone: 26, axis: "x" },
  80: { bone: 26, axis: "y" },
  81: { bone: 27, axis: "x" },
  82: { bone: 27, axis: "y" },
  83: { bone: 28, axis: "x" },
  84: { bone: 28, axis: "y" },
  85: { bone: 29, axis: "x" },
  86: { bone: 29, axis: "y" },
  87: { bone: 30, axis: "x" },
  88: { bone: 30, axis: "y" },
  89: { bone: 31, axis: "x" },
  90: { bone: 31, axis: "y" },
  91: { bone: 32, axis: "x" },
  92: { bone: 32, axis: "y" },
  93: { bone: 33, axis: "x" },
  94: { bone: 33, axis: "y" },
  95: { bone: 34, axis: "x" },
  96: { bone: 34, axis: "y" },
  97: { bone: 35, axis: "x" },
  98: { bone: 35, axis: "y" },
  99: { bone: 36, axis: "x" },
  100: { bone: 36, axis: "y" },
  101: { bone: 37, axis: "x" },
  102: { bone: 37, axis: "y" },
  103: { bone: 38, axis: "x" },
  104: { bone: 38, axis: "y" },
  105: { bone: 39, axis: "x" },
  106: { bone: 39, axis: "y" },
  107: { bone: 39, axis: "z" },
  108: { bone: 40, axis: "x" },
  109: { bone: 40, axis: "y" },
  110: { bone: 41, axis: "x" },
  111: { bone: 41, axis: "y" },
  112: { bone: 42, axis: "x" },
  113: { bone: 42, axis: "y" },
  114: { bone: 43, axis: "x" },
  115: { bone: 43, axis: "y" },
  116: { bone: 44, axis: "x" },
  117: { bone: 44, axis: "y" },
  118: { bone: 45, axis: "x" },
  119: { bone: 45, axis: "y" },
  120: { bone: 46, axis: "x" },
  121: { bone: 46, axis: "y" },
  122: { bone: 47, axis: "x" },
  123: { bone: 47, axis: "y" },
  124: { bone: 48, axis: "x" },
  125: { bone: 48, axis: "y" },
  126: { bone: 49, axis: "x" },
  127: { bone: 49, axis: "y" },
  128: { bone: 50, axis: "x" },
  129: { bone: 50, axis: "y" },
  130: { bone: 51, axis: "x" },
  131: { bone: 51, axis: "y" },
  132: { bone: 52, axis: "x" },
  133: { bone: 52, axis: "y" },
  134: { bone: 53, axis: "x" },
  135: { bone: 53, axis: "y" },
};
const avatarBoneMapCache = new Map<UnityObject, Map<number, number>>();
const getSkeletonNodeIndex = (
  avatar: UnityObject,
  humanBoneIndex: number,
): number => {
  if (!avatarBoneMapCache.has(avatar)) {
    const map = new Map<number, number>();
    const avatarAsset = avatar.m_Avatar as
      | Record<string, JSONValue>
      | undefined;
    let human = (avatarAsset?.m_Human || avatar.m_Human) as
      | Record<string, JSONValue>
      | undefined;
    if (human && human.data) human = human.data as Record<string, JSONValue>;
    const hsia = avatarAsset?.m_HumanSkeletonIndexArray as number[] | undefined;
    const mHumanBoneIndex = human?.m_HumanBoneIndex as number[] | undefined;
    if (human && mHumanBoneIndex) {
      for (let i = 0; i < mHumanBoneIndex.length; i++) {
        const humanSkeletonNodeIndex = mHumanBoneIndex[i];
        if (humanSkeletonNodeIndex >= 0) {
          if (hsia && hsia.length > 0) {
            if (humanSkeletonNodeIndex < hsia.length) {
              const avatarSkeletonNodeIndex = hsia[humanSkeletonNodeIndex];
              if (avatarSkeletonNodeIndex >= 0) {
                map.set(i, avatarSkeletonNodeIndex);
              }
            }
          } else {
            map.set(i, humanSkeletonNodeIndex);
          }
        }
      }
    }
    avatarBoneMapCache.set(avatar, map);
  }
  const boneMap = avatarBoneMapCache.get(avatar)!;
  const nodeIdx = boneMap.get(humanBoneIndex);
  return nodeIdx === undefined ? -1 : nodeIdx;
};
export const getBonePathForHumanBone = (
  avatar: UnityObject,
  humanBoneIndex: number,
): string | null => {
  const skeletonNodeIndex = getSkeletonNodeIndex(avatar, humanBoneIndex);
  if (skeletonNodeIndex < 0) return null;
  const avatarAsset = avatar.m_Avatar as Record<string, JSONValue> | undefined;
  let skeleton = (avatarAsset?.m_AvatarSkeleton || avatar.m_AvatarSkeleton) as
    | Record<string, JSONValue>
    | undefined;
  if (skeleton && skeleton.data)
    skeleton = skeleton.data as Record<string, JSONValue>;
  const mID = skeleton?.m_ID as number[] | undefined;
  if (!skeleton || !mID || skeletonNodeIndex >= mID.length) return null;
  const hash = mID[skeletonNodeIndex];
  const normHash = normalizeHash(hash);
  const tos = avatar.m_TOS as JSONValue[] | undefined;
  const tosEntry = tos?.find((entry) => {
    const kv = getTOSKeyAndValue(entry);
    return kv && normalizeHash(kv.key as string | number) === normHash;
  });
  if (tosEntry) {
    const kv = getTOSKeyAndValue(tosEntry);
    return kv ? String(kv.value) : null;
  }
  return null;
};
export const applyHumanoidRotation = (
  bone: Bone | TransformNode,
  muscleValues: Record<string, number>,
  avatar: UnityObject,
  humanBoneIndex: number,
) => {
  if (!bone) return;
  const node = (bone as Bone).getTransformNode
    ? (bone as Bone).getTransformNode()!
    : (bone as TransformNode);
  if (!node.rotationQuaternion) {
    node.rotationQuaternion = Quaternion.Identity();
  }
  const avatarAsset = (avatar.m_Avatar || avatar) as Record<string, JSONValue> | undefined;
  const humanoidBones = avatarAsset?.humanoidBones as Record<string, any> | undefined;
  const boneInfo = humanoidBones?.[String(humanBoneIndex)];
  let preQData: any = null;
  let postQData: any = null;
  let limitMin: any = null;
  let limitMax: any = null;
  if (boneInfo) {
    preQData = boneInfo.preQ;
    postQData = boneInfo.postQ;
    limitMin = boneInfo.limitMin;
    limitMax = boneInfo.limitMax;
  } else {
    const hierarchyNodeIndex = getSkeletonNodeIndex(avatar, humanBoneIndex);
    if (hierarchyNodeIndex < 0) return;
    let hierarchy = (avatarAsset?.m_AvatarSkeleton || avatar.m_AvatarSkeleton) as
      | Record<string, JSONValue>
      | undefined;
    if (hierarchy && hierarchy.data)
      hierarchy = hierarchy.data as Record<string, JSONValue>;
    let human = (avatarAsset?.m_Human || avatar.m_Human) as
      | Record<string, JSONValue>
      | undefined;
    if (human && human.data) human = human.data as Record<string, JSONValue>;
    let humanRig = human
      ? (human.m_Skeleton as Record<string, JSONValue> | undefined)
      : null;
    if (humanRig && humanRig.data)
      humanRig = humanRig.data as Record<string, JSONValue>;
    const hNode = hierarchy?.m_Node as
      | Array<Record<string, JSONValue>>
      | undefined;
    if (!hierarchy || !hNode || hierarchyNodeIndex >= hNode.length) return;
    let rigNodeIndex = -1;
    const reverseMap = avatarAsset?.m_HumanSkeletonReverseIndexArray as
      | number[]
      | undefined;
    if (reverseMap && hierarchyNodeIndex < reverseMap.length) {
      rigNodeIndex = reverseMap[hierarchyNodeIndex];
    }
    const hrAxesArray = humanRig?.m_AxesArray as
      | Record<string, JSONValue>[]
      | undefined;
    const skeletonWithAxes =
      rigNodeIndex !== -1 && humanRig && hrAxesArray && hrAxesArray.length > 0
        ? humanRig
        : hierarchy;
    const nodeIdx =
      skeletonWithAxes === humanRig ? rigNodeIndex : hierarchyNodeIndex;
    const swNode = skeletonWithAxes.m_Node as
      | Array<Record<string, JSONValue>>
      | undefined;
    if (!swNode || nodeIdx < 0 || nodeIdx >= swNode.length) return;
    const axesId = Number(swNode[nodeIdx].m_AxesId ?? -1);
    const swAxesArray = skeletonWithAxes.m_AxesArray as
      | Array<Record<string, JSONValue>>
      | undefined;
    if (axesId < 0 || !swAxesArray || axesId >= swAxesArray.length) return;
    const axes = swAxesArray[axesId];
    if (!axes) return;
    const limit = axes.m_Limit as Record<string, JSONValue> | undefined;
    if (!limit) return;
    limitMin = limit.m_Min as Record<string, number> | undefined;
    limitMax = limit.m_Max as Record<string, number> | undefined;
    preQData = axes.m_PreQ as Record<string, number> | undefined;
    postQData = axes.m_PostQ as Record<string, number> | undefined;
  }
  if (!preQData || !postQData || !limitMin || !limitMax) return;
  const angles = { x: 0, y: 0, z: 0 };
  (["x", "y", "z"] as const).forEach((axis) => {
    const val = muscleValues[axis] || 0;
    const min = limitMin[axis] ?? 0;
    const max = limitMax[axis] ?? 0;
    angles[axis] = val > 0 ? val * max : val * Math.abs(min);
  });
  const qx = Quaternion.RotationAxis(Axis.X, angles.x);
  const qy = Quaternion.RotationAxis(Axis.Y, angles.y);
  const qz = Quaternion.RotationAxis(Axis.Z, angles.z);
  const muscleRot = qy.multiply(qx).multiply(qz);
  const preQ = new Quaternion(
    preQData.x ?? 0,
    preQData.y ?? 0,
    preQData.z ?? 0,
    preQData.w ?? 1,
  );
  const postQ = new Quaternion(
    postQData.x ?? 0,
    postQData.y ?? 0,
    postQData.z ?? 0,
    postQData.w ?? 1,
  );
  const invPostQ = Quaternion.Inverse(postQ);
  node.rotationQuaternion.copyFrom(preQ.multiply(muscleRot).multiply(invPostQ));
  if (humanBoneIndex === 0) {
    const pos =
      "m_Translation" in bone
        ? (bone as { m_Translation?: { x: number; y: number; z: number } })
            .m_Translation
        : undefined;
    const posX = muscleValues["pos_x"] || 0;
    const posY = muscleValues["pos_y"] || 0;
    const posZ = muscleValues["pos_z"] || 0;
    if (
      muscleValues["pos_x"] !== undefined ||
      muscleValues["pos_y"] !== undefined ||
      muscleValues["pos_z"] !== undefined
    ) {
      node.position.set(posX, posY, -posZ);
    } else if (pos) {
      node.position.set(pos.x, pos.y, -pos.z);
    }
  }
};
