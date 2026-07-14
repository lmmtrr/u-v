import { Bone } from "@babylonjs/core/Bones/bone";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
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
export const MUSCLE_TO_BONE: Record<number, { bone: number; axis: string }> =
  (() => {
    const map: Record<number, { bone: number; axis: string }> = {};
    map[7] = { bone: 0, axis: "pos_x" };
    map[8] = { bone: 0, axis: "pos_y" };
    map[9] = { bone: 0, axis: "pos_z" };
    map[10] = { bone: 0, axis: "quat_x" };
    map[11] = { bone: 0, axis: "quat_y" };
    map[12] = { bone: 0, axis: "quat_z" };
    map[13] = { bone: 0, axis: "quat_w" };
    const MUSCLES: Array<[number, string]> = [
      [7, "z"],
      [7, "y"],
      [7, "x"],
      [8, "z"],
      [8, "y"],
      [8, "x"],
      [54, "z"],
      [54, "y"],
      [54, "x"],
      [9, "z"],
      [9, "y"],
      [9, "x"],
      [10, "z"],
      [10, "y"],
      [10, "x"],
      [21, "z"],
      [21, "y"],
      [22, "z"],
      [22, "y"],
      [23, "z"],
      [23, "y"],
      [1, "z"],
      [1, "y"],
      [1, "x"],
      [3, "z"],
      [3, "x"],
      [5, "z"],
      [5, "x"],
      [19, "z"],
      [2, "z"],
      [2, "y"],
      [2, "x"],
      [4, "z"],
      [4, "x"],
      [6, "z"],
      [6, "x"],
      [20, "z"],
      [11, "z"],
      [11, "y"],
      [13, "z"],
      [13, "y"],
      [13, "x"],
      [15, "z"],
      [15, "x"],
      [17, "z"],
      [17, "y"],
      [12, "z"],
      [12, "y"],
      [14, "z"],
      [14, "y"],
      [14, "x"],
      [16, "z"],
      [16, "x"],
      [18, "z"],
      [18, "y"],
    ];
    MUSCLES.forEach(([bone, axis], i) => {
      map[42 + i] = { bone, axis };
    });
    let attr = 97;
    for (const handBase of [24, 39]) {
      for (let f = 0; f < 5; f++) {
        const proximal = handBase + f * 3;
        map[attr++] = { bone: proximal, axis: "z" };
        map[attr++] = { bone: proximal, axis: "y" };
        map[attr++] = { bone: proximal + 1, axis: "z" };
        map[attr++] = { bone: proximal + 2, axis: "z" };
      }
    }
    return map;
  })();
const PUBLIC_TO_INTERNAL_BONE_INDEX: Record<number, number> = (() => {
  const map: Record<number, number> = {};
  for (let i = 0; i <= 8; i++) map[i] = i;
  const afterChest = [
    9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
  ];
  afterChest.forEach((publicIdx, i) => {
    map[publicIdx] = 10 + i;
  });
  map[54] = 9;
  return map;
})();
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
  const internalIndex = PUBLIC_TO_INTERNAL_BONE_INDEX[humanBoneIndex];
  if (internalIndex === undefined) return -1;
  const nodeIdx = boneMap.get(internalIndex);
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
const getXformT = (
  xf: JSONValue | undefined,
): { x: number; y: number; z: number } | null => {
  if (!xf || typeof xf !== "object") return null;
  const x = ((xf as Record<string, JSONValue>).data ?? xf) as Record<
    string,
    JSONValue
  >;
  const t = (x.t ?? x.m_T) as Record<string, JSONValue> | undefined;
  if (!t) return null;
  const tv = ((t as Record<string, JSONValue>).data ?? t) as Record<
    string,
    number
  >;
  if (typeof tv.x !== "number") return null;
  return { x: tv.x, y: tv.y ?? 0, z: tv.z ?? 0 };
};
const getHumanScale = (avatar: UnityObject): number => {
  const avatarAsset = (avatar.m_Avatar || avatar) as
    | Record<string, JSONValue>
    | undefined;
  let human = (avatarAsset?.m_Human || avatar.m_Human) as
    | Record<string, JSONValue>
    | undefined;
  if (human && human.data) human = human.data as Record<string, JSONValue>;
  const s = Number(human?.m_Scale ?? 1);
  return isFinite(s) && s > 0 ? s : 1;
};
type RootX = { t: { x: number; y: number; z: number }; q: Quaternion };
const rootXCache = new Map<UnityObject, RootX | null>();
const getRootX = (avatar: UnityObject): RootX | null => {
  if (rootXCache.has(avatar)) return rootXCache.get(avatar)!;
  const result = (() => {
    const avatarAsset = (avatar.m_Avatar || avatar) as
      | Record<string, JSONValue>
      | undefined;
    let human = (avatarAsset?.m_Human || avatar.m_Human) as
      | Record<string, JSONValue>
      | undefined;
    if (human && human.data) human = human.data as Record<string, JSONValue>;
    let rootX = human?.m_RootX as Record<string, JSONValue> | undefined;
    if (rootX && rootX.data) rootX = rootX.data as Record<string, JSONValue>;
    if (!rootX) return null;
    const t = (rootX.t ?? rootX.m_T) as Record<string, number> | undefined;
    const q = (rootX.q ?? rootX.m_Q) as Record<string, number> | undefined;
    if (!t || !q || typeof t.x !== "number" || typeof q.x !== "number")
      return null;
    return {
      t: { x: t.x, y: t.y ?? 0, z: t.z ?? 0 },
      q: new Quaternion(q.x, q.y ?? 0, q.z ?? 0, q.w ?? 1),
    };
  })();
  rootXCache.set(avatar, result);
  return result;
};
type ResolvedBoneAxes = {
  preQData: Record<string, number>;
  postQData: Record<string, number>;
  limitMin: Record<string, number>;
  limitMax: Record<string, number>;
  sgnData: Record<string, number> | null;
  tposeT: { x: number; y: number; z: number } | null;
};
const resolvedBoneAxesCache = new Map<
  UnityObject,
  Map<number, ResolvedBoneAxes | null>
>();
const getResolvedBoneAxes = (
  avatar: UnityObject,
  humanBoneIndex: number,
): ResolvedBoneAxes | null => {
  let perAvatar = resolvedBoneAxesCache.get(avatar);
  if (!perAvatar) {
    perAvatar = new Map();
    resolvedBoneAxesCache.set(avatar, perAvatar);
  }
  if (perAvatar.has(humanBoneIndex)) {
    return perAvatar.get(humanBoneIndex)!;
  }
  const result = (() => {
    const avatarAsset = (avatar.m_Avatar || avatar) as
      | Record<string, JSONValue>
      | undefined;
    const hierarchyNodeIndex = getSkeletonNodeIndex(avatar, humanBoneIndex);
    if (hierarchyNodeIndex < 0) return null;
    let hierarchy = (avatarAsset?.m_AvatarSkeleton ||
      avatar.m_AvatarSkeleton) as Record<string, JSONValue> | undefined;
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
    if (!hierarchy || !hNode || hierarchyNodeIndex >= hNode.length) return null;
    let rigNodeIndex = -1;
    const reverseMap = avatarAsset?.m_HumanSkeletonReverseIndexArray as
      | number[]
      | undefined;
    if (reverseMap && hierarchyNodeIndex < reverseMap.length) {
      rigNodeIndex = reverseMap[hierarchyNodeIndex];
    }
    let tposeT: { x: number; y: number; z: number } | null = null;
    let skeletonPose = human
      ? (human.m_SkeletonPose as Record<string, JSONValue> | undefined)
      : undefined;
    if (skeletonPose && skeletonPose.data)
      skeletonPose = skeletonPose.data as Record<string, JSONValue>;
    const poseX = skeletonPose?.m_X as Array<JSONValue> | undefined;
    if (poseX && rigNodeIndex >= 0 && rigNodeIndex < poseX.length) {
      tposeT = getXformT(poseX[rigNodeIndex]);
    }
    if (!tposeT) {
      let defaultPose = avatarAsset?.m_DefaultPose as
        | Record<string, JSONValue>
        | undefined;
      if (defaultPose && defaultPose.data)
        defaultPose = defaultPose.data as Record<string, JSONValue>;
      const dX = defaultPose?.m_X as Array<JSONValue> | undefined;
      if (dX && hierarchyNodeIndex < dX.length) {
        tposeT = getXformT(dX[hierarchyNodeIndex]);
      }
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
    if (!swNode || nodeIdx < 0 || nodeIdx >= swNode.length) return null;
    const axesId = Number(swNode[nodeIdx].m_AxesId ?? -1);
    const swAxesArray = skeletonWithAxes.m_AxesArray as
      | Array<Record<string, JSONValue>>
      | undefined;
    if (axesId < 0 || !swAxesArray || axesId >= swAxesArray.length) return null;
    const axes = swAxesArray[axesId];
    if (!axes) return null;
    const limit = axes.m_Limit as Record<string, JSONValue> | undefined;
    if (!limit) return null;
    const limitMin = limit.m_Min as Record<string, number> | undefined;
    const limitMax = limit.m_Max as Record<string, number> | undefined;
    const preQData = axes.m_PreQ as Record<string, number> | undefined;
    const postQData = axes.m_PostQ as Record<string, number> | undefined;
    const sgnData = (axes.m_Sgn as Record<string, number> | undefined) || null;
    if (!preQData || !postQData || !limitMin || !limitMax) return null;
    return { preQData, postQData, limitMin, limitMax, sgnData, tposeT };
  })();
  perAvatar.set(humanBoneIndex, result);
  return result;
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
  if (humanBoneIndex === 0) {
    const rootX = getRootX(avatar);
    const metadata = node.metadata as
      | {
          initialRotationQuaternion?: Quaternion | null;
          initialPosition?: Vector3;
        }
      | null
      | undefined;
    const bindRot =
      metadata?.initialRotationQuaternion ?? Quaternion.Identity();
    const bindPos = metadata?.initialPosition ?? Vector3.Zero();
    if (
      muscleValues["quat_x"] !== undefined ||
      muscleValues["quat_y"] !== undefined ||
      muscleValues["quat_z"] !== undefined ||
      muscleValues["quat_w"] !== undefined
    ) {
      const q = new Quaternion(
        muscleValues["quat_x"] ?? 0,
        muscleValues["quat_y"] ?? 0,
        muscleValues["quat_z"] ?? 0,
        muscleValues["quat_w"] ?? 1,
      );
      if (q.length() > 1e-6) {
        q.normalize();
        const hipsRot = rootX
          ? q.multiply(Quaternion.Inverse(rootX.q)).multiply(bindRot)
          : q;
        node.rotationQuaternion.copyFrom(hipsRot);
      }
    }
    if (
      muscleValues["pos_x"] !== undefined ||
      muscleValues["pos_y"] !== undefined ||
      muscleValues["pos_z"] !== undefined
    ) {
      const scale = getHumanScale(avatar);
      const rawPos = new Vector3(
        (muscleValues["pos_x"] || 0) * scale,
        (muscleValues["pos_y"] || 0) * scale,
        (muscleValues["pos_z"] || 0) * scale,
      );
      const hipsPos = rootX
        ? rawPos
            .subtract(new Vector3(rootX.t.x, rootX.t.y, rootX.t.z))
            .add(bindPos)
        : rawPos;
      node.position.copyFrom(hipsPos);
    }
    return;
  }
  const resolved = getResolvedBoneAxes(avatar, humanBoneIndex);
  if (!resolved) return;
  const { preQData, postQData, limitMin, limitMax, sgnData } = resolved;
  const angles = { x: 0, y: 0, z: 0 };
  (["x", "y", "z"] as const).forEach((axis) => {
    const val = muscleValues[axis] || 0;
    const min = limitMin[axis] ?? 0;
    const max = limitMax[axis] ?? 0;
    const sgn = sgnData ? (sgnData[axis] ?? 1) : 1;
    angles[axis] = (val > 0 ? val * max : val * Math.abs(min)) * sgn;
  });
  const swingLen = Math.sqrt(angles.y * angles.y + angles.z * angles.z);
  let muscleRot: Quaternion;
  if (swingLen > 1e-8) {
    const swingAxis = new Vector3(0, angles.y / swingLen, angles.z / swingLen);
    muscleRot = Quaternion.RotationAxis(swingAxis, swingLen);
  } else {
    muscleRot = Quaternion.Identity();
  }
  if (angles.x !== 0) {
    muscleRot = muscleRot.multiply(Quaternion.RotationAxis(Axis.X, angles.x));
  }
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
};
