import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Space } from "@babylonjs/core/Maths/math.axis";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Bone } from "@babylonjs/core/Bones/bone";
import { MorphTarget } from "@babylonjs/core/Morph/morphTarget";
import { Observer } from "@babylonjs/core/Misc/observable";
import {
  MUSCLE_TO_BONE,
  applyHumanoidRotation,
  getBonePathForHumanBone,
} from "./humanoid_system";
import { computeCRC32, getBindingPath, normalizeHash } from "./utils";
import type { ViewerState, AnimationData, AnimationBoneData, UnityObject, JSONValue } from "./types";
import {
  preprocessAnimationClip,
  resolveAvatarForAnimation,
  getTOSKeyAndValue,
  StreamedFrame
} from "./animation_parser";
import { interpolate } from "./animation_interpolator";
type SkeletonWithAvatar = {
  avatar?: UnityObject;
  bones?: Bone[];
};
const TO_RAD = Math.PI / 180;
const getBoneHash = (bonePath: string | null | undefined): number | null => {
  if (!bonePath) return null;
  const str = String(bonePath);
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10);
  }
  return computeCRC32(str);
};
export const buildAnimationData = (
  clip: UnityObject,
  allObjectHash: Map<string, string>,
  createdMeshes: Mesh[],
  scene: Scene,
): AnimationData => {
  window._missingBones = new Set<string | number>();
  const clipData = clip.clipData as Record<string, JSONValue> | undefined;
  if (!clipData) {
    return {
      name: String(clip.name || ""),
      startTime: performance.now(),
      frameRate: 24,
      maxFrame: 0,
      curvesData: {},
      bones: new Map<Bone | TransformNode, AnimationBoneData>(),
      muscles: new Map<Bone | TransformNode, Array<{ axis: string; curve: { time: number; frame: number; value: number }[]; humanBoneIndex: number }>>(),
      morphs: new Map<MorphTarget, { time: number; frame: number; value: number }[]>(),
      avatar: null,
    };
  }
  preprocessAnimationClip(clipData);
  const frameRate = Number(clipData.m_SampleRate ?? 24);
  const curvesData: Record<
    number,
    { time: number; frame: number; value: number }[]
  > = {};
  let streamedFrames: StreamedFrame[] = (clipData.m_StreamedFrames as never as StreamedFrame[]) || [];
  for (let i = 1; i < streamedFrames.length - 1; i++) {
    const frame = streamedFrames[i];
    if (!frame || !frame.keyList) continue;
    for (const key of frame.keyList) {
      if (!curvesData[key.index]) curvesData[key.index] = [];
      curvesData[key.index].push({
        time: frame.time,
        frame: Math.round(frame.time * frameRate),
        value: key.value,
      });
    }
  }
  const mMuscleClip = clipData.m_MuscleClip as Record<string, JSONValue> | undefined;
  const mmClip = mMuscleClip?.m_Clip as Record<string, JSONValue> | undefined;
  const dense = mmClip?.m_DenseClip as Record<string, JSONValue> | undefined;
  if (dense) {
    const streamCurveCount = mmClip?.m_StreamedClip
      ? Number(
          (mmClip.m_StreamedClip as Record<string, JSONValue>).curveCount ||
          (mmClip.m_StreamedClip as Record<string, JSONValue>).m_CurveCount ||
          0
        )
      : 0;
    const frameCount = Number(dense.m_FrameCount ?? 0);
    const beginTime = Number(dense.m_BeginTime ?? 0);
    const sampleRate = Number(dense.m_SampleRate ?? 1);
    const curveCount = Number(dense.m_CurveCount ?? 0);
    const sampleArray = (dense.m_SampleArray as number[]) || [];
    for (let f = 0; f < frameCount; f++) {
      const time = beginTime + f / sampleRate;
      const frameIdx = Math.round(time * frameRate);
      for (let c = 0; c < curveCount; c++) {
        const curveIdx = streamCurveCount + c;
        const val = sampleArray[f * curveCount + c];
        if (!curvesData[curveIdx]) curvesData[curveIdx] = [];
        curvesData[curveIdx].push({
          time: time,
          frame: frameIdx,
          value: val,
        });
      }
    }
  }
  const constant = mmClip?.m_ConstantClip as Record<string, JSONValue> | undefined;
  if (constant) {
    const streamCurveCount = mmClip?.m_StreamedClip
      ? Number(
          (mmClip.m_StreamedClip as Record<string, JSONValue>).curveCount ||
          (mmClip.m_StreamedClip as Record<string, JSONValue>).m_CurveCount ||
          0
        )
      : 0;
    const denseCurveCount = dense ? Number(dense.m_CurveCount ?? 0) : 0;
    const constantData = (constant.data as number[]) || [];
    const stopTime = mMuscleClip ? Number(mMuscleClip.m_StopTime ?? 0) : 0.0;
    const times = [0.0, stopTime];
    for (const time of times) {
      const frameIdx = Math.round(time * frameRate);
      for (let c = 0; c < constantData.length; c++) {
        const curveIdx = streamCurveCount + denseCurveCount + c;
        const val = constantData[c];
        if (!curvesData[curveIdx]) curvesData[curveIdx] = [];
        curvesData[curveIdx].push({
          time: time,
          frame: frameIdx,
          value: val,
        });
      }
    }
  }
  let maxFrame = 0;
  for (const index in curvesData) {
    const curve = curvesData[index];
    curve.sort((a, b) => a.time - b.time);
    if (curve.length > 0) {
      const lastFrame = curve[curve.length - 1].frame;
      if (lastFrame > maxFrame) maxFrame = lastFrame;
    }
  }
  const bindingMap = new Map<number, { binding: Record<string, JSONValue>; componentIdx: number }>();
  let curves = 0;
  const bindingConstant = clipData.m_ClipBindingConstant as Record<string, JSONValue> | undefined;
  const genericBindings = bindingConstant?.genericBindings as Array<Record<string, JSONValue>> | undefined;
  if (genericBindings) {
    for (const b of genericBindings) {
      const startIdx = curves;
      const rawTypeID = b.typeID;
      const isTransform = rawTypeID === 4 || rawTypeID === "Transform" || String(rawTypeID) === "4";
      const attribute = Number(b.attribute ?? 0);
      if (isTransform) {
        switch (attribute) {
          case 1:
          case 3:
          case 4:
            curves += 3;
            break;
          case 2:
            curves += 4;
            break;
          default:
            curves += 1;
            break;
        }
      } else {
        curves += 1;
      }
      for (let i = startIdx; i < curves; i++) {
        bindingMap.set(i, { binding: b, componentIdx: i - startIdx });
      }
    }
  }
  const animationData: AnimationData = {
    name: String(clip.name || ""),
    startTime: performance.now(),
    frameRate: frameRate,
    maxFrame: maxFrame,
    curvesData: curvesData,
    bones: new Map<Bone | TransformNode, AnimationBoneData>(),
    muscles: new Map<Bone | TransformNode, Array<{ axis: string; curve: { time: number; frame: number; value: number }[]; humanBoneIndex: number }>>(),
    morphs: new Map<MorphTarget, { time: number; frame: number; value: number }[]>(),
    avatar: resolveAvatarForAnimation(createdMeshes, null),
  };
  const attributeToProperty: Record<
    number,
    { base: string; components: Array<"x" | "y" | "z" | "w"> }
  > = {
    1: { base: "position", components: ["x", "y", "z"] },
    2: { base: "rotationQuaternion", components: ["x", "y", "z", "w"] },
    3: { base: "scaling", components: ["x", "y", "z"] },
    4: { base: "rotation", components: ["x", "y", "z"] },
  };
  const bonePathCache = new Map<string, string | null>();
  const getCachedBonePath = (
    avatar: UnityObject,
    boneIdx: number,
  ): string | null => {
    const avatarPathId = String(avatar.path_id || "");
    const cacheKey = `${avatarPathId}_${boneIdx}`;
    if (!bonePathCache.has(cacheKey)) {
      const path = getBonePathForHumanBone(avatar, boneIdx);
      bonePathCache.set(cacheKey, path);
    }
    return bonePathCache.get(cacheKey)!;
  };
  const curveIndices = Object.keys(curvesData);
  for (const curveIndexStr of curveIndices) {
    const curveIndex = parseInt(curveIndexStr);
    const mappingData = bindingMap.get(curveIndex);
    if (!mappingData) continue;
    const binding = mappingData.binding;
    const typeID = binding.typeID;
    const attribute = Number(binding.attribute ?? 0);
    if (typeID === 95 || typeID === "Animator") {
      const muscleIdx = attribute;
      const mapping = MUSCLE_TO_BONE[muscleIdx];
      if (mapping) {
        for (const mesh of createdMeshes) {
          if (mesh.skeleton && mesh.metadata?.hashToBoneMap) {
            const skeletonAvatar =
              (mesh.skeleton as SkeletonWithAvatar).avatar ||
              animationData.avatar;
            if (!skeletonAvatar) {
              continue;
            }
            const bonePath = getCachedBonePath(skeletonAvatar, mapping.bone);
            if (bonePath) {
              const boneHash = computeCRC32(bonePath);
              const normBoneHashStr = normalizeHash(boneHash);
              const targetBone =
                mesh.metadata.hashToBoneMap.get(normBoneHashStr) ||
                mesh.metadata.hashToBoneMap.get(boneHash) ||
                mesh.skeleton.bones.find((b) => {
                  const shortName = bonePath.split("/").pop();
                  return (
                    b.name === bonePath ||
                    b.name === shortName ||
                    b.name.endsWith("/" + shortName)
                  );
                });
              if (targetBone) {
                (targetBone as { avatar?: UnityObject }).avatar = skeletonAvatar;
                if (!animationData.muscles.has(targetBone)) {
                  animationData.muscles.set(targetBone, []);
                }
                const _m = animationData.muscles.get(targetBone)!;
                _m.push({
                  axis: mapping.axis,
                  curve: curvesData[curveIndex] || [],
                  humanBoneIndex: mapping.bone,
                });
              }
            }
          }
        }
      }
    } else if (typeID === 4 || typeID === "Transform") {
      const propInfo = attributeToProperty[attribute];
      if (propInfo) {
        const globalBonePath = getBindingPath(binding as never as UnityObject, allObjectHash);
        let foundInAny = false;
        for (const mesh of createdMeshes) {
          if (!mesh.skeleton) continue;
          let bonePath: string | null = globalBonePath as string | null;
          if (!bonePath) {
            const skeletonAvatar =
              (mesh.skeleton as SkeletonWithAvatar).avatar ||
              animationData.avatar;
            if (skeletonAvatar) {
              const hash =
                binding.path_ !== undefined ? binding.path_ : binding.path;
              if (hash !== undefined && hash !== null) {
                const normHash = normalizeHash(hash as string | number);
                const tos = skeletonAvatar.m_TOS as JSONValue[] | undefined;
                const tosEntry = tos?.find((e) => {
                  const kv = getTOSKeyAndValue(e);
                  return kv && normalizeHash(String(kv.key)) === normHash;
                });
                if (tosEntry) {
                  const kv = getTOSKeyAndValue(tosEntry);
                  bonePath =
                    kv && kv.value !== undefined && kv.value !== null
                      ? String(kv.value)
                      : null;
                }
              }
            }
          }
          if (bonePath !== null && bonePath !== undefined) {
            bonePath = String(bonePath);
          } else {
            bonePath = null;
          }
          const boneHash = getBoneHash(bonePath);
          const simpleName = bonePath
            ? bonePath.includes("/")
              ? bonePath.split("/").pop()
              : bonePath
            : null;
          const bindingPathVal = binding.path_ as string | number | undefined;
          if (bonePath || bindingPathVal !== undefined) {
            const lookupHash = boneHash || bindingPathVal;
            if (lookupHash !== undefined && lookupHash !== null) {
              const normHashStr = normalizeHash(lookupHash);
              let isModelRoot = false;
              let foundNode: Bone | TransformNode | undefined =
                mesh.metadata.hashToBoneMap.get(normHashStr) ||
                mesh.metadata.hashToBoneMap.get(lookupHash as never) ||
                mesh.skeleton.bones.find(
                  (b) =>
                    b.name === bonePath ||
                    b.name === simpleName ||
                    (simpleName && b.name.endsWith("/" + simpleName)),
                );
              if (!foundNode && scene) {
                foundNode =
                  scene.getTransformNodeByName(bonePath || "") ||
                  scene.getTransformNodeByName(simpleName || "") ||
                  undefined;
              }
              if (!foundNode && (bonePath === "0" || bonePath === "" || !bonePath)) {
                isModelRoot = true;
                if (mesh.skeleton) {
                  const rootBone = mesh.skeleton.bones.find((b) => !b.getParent());
                  if (rootBone) {
                    foundNode = rootBone.getTransformNode() || rootBone;
                  }
                }
                if (!foundNode) {
                  let currentParent: any = mesh;
                  while (currentParent.parent && currentParent.parent.name !== "sceneRoot") {
                    currentParent = currentParent.parent;
                  }
                  foundNode = currentParent as TransformNode;
                }
              }
              if (foundNode) {
                foundInAny = true;
                const isTwist = simpleName && simpleName.toLowerCase().includes("twist");
                if (isTwist) {
                  continue;
                }
                if (!animationData.bones.has(foundNode)) {
                  let node = "getTransformNode" in foundNode
                    ? (foundNode as Bone).getTransformNode()
                    : (foundNode as TransformNode);
                  if (!node) node = foundNode as TransformNode;
                  const initialPos = node.position
                    ? node.position.clone()
                    : new Vector3();
                  const initialRot = node.rotationQuaternion
                    ? node.rotationQuaternion.clone()
                    : node.rotation
                      ? Quaternion.FromEulerVector(node.rotation)
                      : new Quaternion();
                  const initialScale = node.scaling
                    ? node.scaling.clone()
                    : new Vector3(1, 1, 1);
                  const t = window.state?.transformsByPathId?.get(String(binding.path_));
                  let originalInitialRot: Quaternion | undefined = undefined;
                  if (t && (t as any).originalLocalRotation) {
                    const origRot = (t as any).originalLocalRotation;
                    originalInitialRot = new Quaternion(
                      origRot.x ?? 0,
                      origRot.y ?? 0,
                      origRot.z ?? 0,
                      origRot.w ?? 1
                    );
                  }
                  animationData.bones.set(foundNode, {
                    position: {},
                    rotation: {},
                    scale: {},
                    initialPos,
                    initialRot,
                    initialScale,
                    originalInitialRot,
                    isRoot: isModelRoot,
                  } as any);
                }
                const boneData = animationData.bones.get(foundNode);
                if (boneData) {
                  const componentName =
                    propInfo.components[mappingData.componentIdx];
                  const curve = curvesData[curveIndex] || [];
                  const sampleVal = curve.length > 0 ? curve[0].value : null;
                  const isTwist = simpleName && simpleName.toLowerCase().includes("twist");
                  if (propInfo.base === "position") {
                    if (!isTwist) {
                      boneData.position[componentName as "x" | "y" | "z"] = curve;
                    }
                  } else if (
                    propInfo.base === "rotationQuaternion" ||
                    propInfo.base === "rotation"
                  ) {
                    boneData.rotation[componentName] = curve;
                  } else if (propInfo.base === "scaling") {
                    if (!isTwist) {
                      boneData.scale[componentName as "x" | "y" | "z"] = curve;
                    }
                  }
                }
              }
            }
          }
        }
        const bindingPathVal = binding.path_ as string | number | undefined;
        if (!foundInAny && (globalBonePath || bindingPathVal !== undefined)) {
          const lookupHash =
            getBoneHash(globalBonePath) ||
            bindingPathVal;
          if (lookupHash !== undefined && lookupHash !== null) {
            if (!window._missingBones)
              window._missingBones = new Set<string | number>();
            if (!window._missingBones.has(lookupHash)) {
              console.warn(
                `[Animation Debug] Bone not found for hash ${lookupHash} (path: "${globalBonePath}")`,
                {
                  binding,
                  typeID,
                  attribute,
                  lookupHash,
                  resolvedPath: globalBonePath
                }
              );
              window._missingBones.add(lookupHash);
            }
          }
        }
      }
    } else if (
      typeID === 137 ||
      typeID === "SkinnedMeshRenderer"
    ) {
      const targetHash = attribute;
      for (const mesh of createdMeshes) {
        if (mesh.morphTargetManager) {
          for (let i = 0; i < mesh.morphTargetManager.numTargets; i++) {
            const target = mesh.morphTargetManager.getTarget(i);
            const targetCrc = computeCRC32("blendShape." + target.name);
            if (targetCrc === targetHash) {
              animationData.morphs.set(target, curvesData[curveIndex] || []);
              break;
            }
          }
        }
      }
    } else if (typeID === 212 || typeID === "SpriteRenderer") {
      const globalBonePath = getBindingPath(binding as never as UnityObject, allObjectHash);
      for (const mesh of createdMeshes) {
        let bonePath: string | null = globalBonePath as string | null;
        if (!bonePath) {
          const skeletonAvatar =
            (mesh.skeleton as SkeletonWithAvatar)?.avatar ||
            animationData.avatar;
          if (skeletonAvatar) {
            const hash =
              binding.path_ !== undefined ? binding.path_ : binding.path;
            if (hash !== undefined && hash !== null) {
              const normHash = normalizeHash(hash as string | number);
              const tos = skeletonAvatar.m_TOS as JSONValue[] | undefined;
              const tosEntry = tos?.find((e) => {
                const kv = getTOSKeyAndValue(e);
                return kv && normalizeHash(String(kv.key)) === normHash;
              });
              if (tosEntry) {
                const kv = getTOSKeyAndValue(tosEntry);
                bonePath =
                  kv && kv.value !== undefined && kv.value !== null
                    ? String(kv.value)
                    : null;
              }
            }
          }
        }
        if (bonePath !== null && bonePath !== undefined) {
          bonePath = String(bonePath);
        } else {
          bonePath = null;
        }
        const boneHash = getBoneHash(bonePath);
        const simpleName = bonePath
          ? bonePath.includes("/")
            ? bonePath.split("/").pop()
            : bonePath
          : null;
        const normBoneHash = boneHash ? normalizeHash(boneHash) : null;
        let foundNode: Bone | TransformNode | undefined = undefined;
        if (mesh.metadata?.hashToBoneMap && normBoneHash) {
          foundNode =
            mesh.metadata.hashToBoneMap.get(normBoneHash) ||
            mesh.metadata.hashToBoneMap.get(boneHash!);
        }
        if (!foundNode && mesh.skeleton) {
          foundNode = mesh.skeleton.bones.find(
            (b) => b.name === bonePath || b.name === simpleName,
          );
        }
        if (!foundNode && scene) {
          foundNode =
            scene.getTransformNodeByName(bonePath || "") ||
            scene.getTransformNodeByName(simpleName || "") ||
            undefined;
        }
        if (!foundNode && (bonePath === "0" || bonePath === "" || !bonePath)) {
          foundNode = mesh;
        }
        if (foundNode) {
          if (!animationData.bones.has(foundNode)) {
            animationData.bones.set(foundNode, {
              position: {},
              rotation: {},
              scale: {},
              initialPos: foundNode instanceof TransformNode ? foundNode.position.clone() : new Vector3(),
              initialRot: foundNode instanceof TransformNode ? (foundNode.rotationQuaternion ? foundNode.rotationQuaternion.clone() : Quaternion.FromEulerVector(foundNode.rotation)) : new Quaternion(),
              initialScale: foundNode instanceof TransformNode ? foundNode.scaling.clone() : new Vector3(1, 1, 1),
            });
          }
        }
      }
    } else {
      const hashStr = normalizeHash(attribute);
      const resolvedAttr = allObjectHash.get(hashStr) || attribute;
      const pathHashStr = normalizeHash((binding.path_ !== undefined ? binding.path_ : binding.path) as string | number | null | undefined);
      const resolvedPath = allObjectHash.get(pathHashStr) || binding.path || binding.path_;
      console.warn(`[Animation Debug] Unsupported typeID ${typeID} for binding.`, {
        binding,
        typeID,
        attribute,
        resolvedAttributeName: resolvedAttr,
        resolvedPath: resolvedPath,
        curvesCount: curvesData[curveIndex]?.length ?? 0
      });
    }
  }
  const processUncompressedCurve = (
    uncompressedCurves: UnityObject[] | undefined,
    type: string,
  ) => {
    if (!uncompressedCurves) return;
    for (const uCurve of uncompressedCurves) {
      const path = String(uCurve.path || uCurve.m_Path || "");
      const attribute = uCurve.attribute || uCurve.m_Attribute;
      const globalBonePath =
        path ||
        (attribute
          ? getBindingPath(
              { path_: uCurve.path_ as never, typeID: (uCurve.typeID || 4) as never },
              allObjectHash,
            )
          : null);
      const components =
        type === "rotation" ? ["x", "y", "z", "w"] : ["x", "y", "z"];
      const propBase =
        type === "rotation"
          ? "rotation"
          : type === "position"
            ? "position"
            : "scaling";
      const preparedCurves: Record<string, { time: number; frame: number; value: number }[]> = {};
      const uCurveData = uCurve.curve as Record<string, JSONValue> | undefined;
      const mCurve = uCurveData?.m_Curve as Array<Record<string, JSONValue>> | undefined;
      if (mCurve) {
        components.forEach((comp) => {
          preparedCurves[comp] = mCurve.map((k) => {
            const kVal = k.value;
            const val = typeof kVal === "object" && kVal !== null ? Number((kVal as Record<string, number>)[comp]) : Number(kVal);
            const frameIdx = Math.round(Number(k.time ?? 0) * frameRate);
            if (frameIdx > animationData.maxFrame) {
              animationData.maxFrame = frameIdx;
            }
            return {
              time: Number(k.time ?? 0),
              frame: frameIdx,
              value: val,
            };
          });
        });
      }
      for (const mesh of createdMeshes) {
        if (!mesh.skeleton) continue;
        let bonePath: string | null = globalBonePath as string | null;
        if (!bonePath && uCurve.path_ !== undefined) {
          const skeletonAvatar =
            (mesh.skeleton as SkeletonWithAvatar).avatar ||
            animationData.avatar;
          if (skeletonAvatar) {
            const normHash = normalizeHash(uCurve.path_ as string | number);
            const tos = skeletonAvatar.m_TOS as JSONValue[] | undefined;
            const tosEntry = tos?.find((e) => {
              const kv = getTOSKeyAndValue(e);
              return kv && normalizeHash(String(kv.key)) === normHash;
            });
            if (tosEntry) {
              const kv = getTOSKeyAndValue(tosEntry);
              bonePath =
                kv && kv.value !== undefined && kv.value !== null
                  ? String(kv.value)
                  : null;
            }
          }
        }
        if (!bonePath) continue;
        const simpleName = bonePath.includes("/")
          ? bonePath.split("/").pop()
          : bonePath;
        const boneHash = getBoneHash(bonePath);
        const normBoneHash = normalizeHash(boneHash);
        let foundNode: Bone | TransformNode | undefined =
          mesh.metadata.hashToBoneMap.get(normBoneHash) ||
          mesh.metadata.hashToBoneMap.get(boneHash) ||
          mesh.skeleton.bones.find(
            (b) => b.name === bonePath || b.name === simpleName,
          );
        if (!foundNode && scene) {
          foundNode =
            scene.getTransformNodeByName(bonePath) ||
            scene.getTransformNodeByName(simpleName || "") ||
            undefined;
        }
        if (!foundNode && (bonePath === "0" || bonePath === "" || !bonePath)) {
          if (mesh.skeleton) {
            const rootBone = mesh.skeleton.bones.find((b) => !b.getParent());
            if (rootBone) {
              foundNode = rootBone.getTransformNode() || rootBone;
            }
          }
          if (!foundNode) {
            let currentParent: any = mesh;
            while (currentParent.parent && currentParent.parent.name !== "sceneRoot") {
              currentParent = currentParent.parent;
            }
            foundNode = currentParent as TransformNode;
          }
        }
        if (foundNode) {
          const isTwist = simpleName && simpleName.toLowerCase().includes("twist");
          if (isTwist) {
            continue;
          }
          if (!animationData.bones.has(foundNode)) {
            let node = "getTransformNode" in foundNode
              ? (foundNode as Bone).getTransformNode()
              : (foundNode as TransformNode);
            if (!node) node = foundNode as TransformNode;
            const initialPos = node.position
              ? node.position.clone()
              : new Vector3();
            const initialRot = node.rotationQuaternion
              ? node.rotationQuaternion.clone()
              : node.rotation
                ? Quaternion.FromEulerVector(node.rotation)
                : new Quaternion();
            const initialScale = node.scaling
              ? node.scaling.clone()
              : new Vector3(1, 1, 1);
            const t = window.state?.transformsByPathId?.get(String(uCurve.path_));
            let originalInitialRot: Quaternion | undefined = undefined;
            if (t && (t as any).originalLocalRotation) {
              const origRot = (t as any).originalLocalRotation;
              originalInitialRot = new Quaternion(
                origRot.x ?? 0,
                origRot.y ?? 0,
                origRot.z ?? 0,
                origRot.w ?? 1
              );
            }
            animationData.bones.set(foundNode, {
              position: {},
              rotation: {},
              scale: {},
              initialPos,
              initialRot,
              initialScale,
              originalInitialRot,
            } as any);
          }
          const boneData = animationData.bones.get(foundNode);
          if (boneData) {
            const isTwist = simpleName && simpleName.toLowerCase().includes("twist");
            components.forEach((comp) => {
              if (propBase === "rotation")
                boneData.rotation[comp as "x" | "y" | "z" | "w"] =
                  preparedCurves[comp];
              else if (propBase === "position") {
                if (!isTwist) {
                  boneData.position[comp as "x" | "y" | "z"] =
                    preparedCurves[comp];
                }
              } else if (propBase === "scaling") {
                if (!isTwist) {
                  boneData.scale[comp as "x" | "y" | "z"] =
                    preparedCurves[comp];
                }
              }
            });
          }
        }
      }
    }
  };
  processUncompressedCurve(clipData.m_RotationCurves as UnityObject[] | undefined, "rotation");
  processUncompressedCurve(clipData.m_PositionCurves as UnityObject[] | undefined, "position");
  processUncompressedCurve(clipData.m_ScaleCurves as UnityObject[] | undefined, "scaling");
  processUncompressedCurve(clipData.m_EulerCurves as UnityObject[] | undefined, "rotation");
  return animationData;
};
const tempVec = new Vector3();
const tempQuat = new Quaternion();
export const createAnimationObserver = (
  scene: Scene,
  state: ViewerState,
): Observer<Scene> | null => {
  return scene.onBeforeRenderObservable.add(() => {
    if (!state.currentAnimationData) return;
    if (
      state.currentAnimationData.bones.size === 0 &&
      state.currentAnimationData.muscles.size === 0 &&
      state.currentAnimationData.morphs.size === 0
    ) {
      if (!state._warnedEmptyAnim) {
        state._warnedEmptyAnim = true;
      }
      return;
    }
    if (state.currentAnimationData.accumulatedTime === undefined) {
      state.currentAnimationData.accumulatedTime = 0;
    }
    const now = performance.now();
    const speed = state.animationSpeed !== undefined ? state.animationSpeed : 1.0;
    if (state.animationPlaying) {
      const delta = ((now - (state.currentAnimationData.lastUpdateTime || now)) / 1000) * speed;
      state.currentAnimationData.accumulatedTime += delta;
    }
    state.currentAnimationData.lastUpdateTime = now;
    const frameRate = state.currentAnimationData.frameRate || 24;
    const maxFrame =
      state.currentAnimationData.maxFrame > 0
        ? state.currentAnimationData.maxFrame
        : 1;
    let frame = state.currentAnimationData.accumulatedTime * frameRate;
    if (state.animationLoop === false) {
      if (frame >= maxFrame) {
        frame = maxFrame;
        state.animationPlaying = false;
        state.currentAnimationData.accumulatedTime = maxFrame / frameRate;
        const win = window as unknown as Record<string, (playing: boolean) => void>;
        if (win.onAnimationToggle) {
          win.onAnimationToggle(false);
        }
      }
    } else {
      frame = frame % maxFrame;
    }
    const seekbar = document.getElementById("animation-seekbar") as HTMLInputElement | null;
    const label = document.getElementById("seekbar-label") as HTMLElement | null;
    if (seekbar) {
      seekbar.value = String(Math.floor(frame));
    }
    if (label) {
      label.textContent = `${Math.floor(frame)} / ${maxFrame}`;
    }
    state.currentAnimationData.bones.forEach(
      (boneData: AnimationBoneData, bone: Bone | TransformNode) => {
        const node = "getTransformNode" in bone ? (bone as Bone).getTransformNode() : (bone as TransformNode);
        const hasPos =
          boneData.position.x || boneData.position.y || boneData.position.z;
        if (hasPos) {
          const isRootNode = (boneData as any).isRoot === true;
          if (isRootNode) {
            if (boneData.initialPos) {
              tempVec.set(boneData.initialPos.x, boneData.initialPos.y, boneData.initialPos.z);
            } else {
              tempVec.set(0, 0, 0);
            }
          } else {
            const x = interpolate(boneData.position.x, frame);
            const y = interpolate(boneData.position.y, frame);
            const z = interpolate(boneData.position.z, frame);
            tempVec.set(
              x !== null ? x : (boneData.initialPos?.x ?? 0),
              y !== null ? y : (boneData.initialPos?.y ?? 0),
              z !== null ? z : (boneData.initialPos?.z ?? 0),
            );
          }
          if (node) {
            const metadata = node.metadata as { partTranslation?: { x: number; y: number; z: number } } | null;
            if (metadata && metadata.partTranslation) {
              node.position.set(
                tempVec.x + metadata.partTranslation.x,
                tempVec.y + metadata.partTranslation.y,
                tempVec.z + metadata.partTranslation.z,
              );
            } else {
              node.position.copyFrom(tempVec);
            }
          } else if ("setPosition" in bone) {
            (bone as Bone).setPosition(tempVec, Space.LOCAL);
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
                tempQuat.set(x, y, z, w);
                tempQuat.normalize();
              } else {
                Quaternion.FromEulerAnglesToRef(
                  x * TO_RAD,
                  y * TO_RAD,
                  z * TO_RAD,
                  tempQuat,
                );
              }
              if (boneData.originalInitialRot) {
                const invOrig = Quaternion.Inverse(boneData.originalInitialRot);
                const q_delta = invOrig.multiply(tempQuat);
                boneData.initialRot.multiplyToRef(q_delta, tempQuat);
              }
              if (node) {
                if (!node.rotationQuaternion) {
                  node.rotationQuaternion = tempQuat.clone();
                } else {
                  node.rotationQuaternion.copyFrom(tempQuat);
                }
              } else if ("setRotationQuaternion" in bone) {
                (bone as Bone).setRotationQuaternion(tempQuat, Space.LOCAL);
              }
            }
        }
        const hasScale =
          boneData.scale.x || boneData.scale.y || boneData.scale.z;
        if (hasScale) {
          const x = interpolate(boneData.scale.x, frame);
          const y = interpolate(boneData.scale.y, frame);
          const z = interpolate(boneData.scale.z, frame);
          tempVec.set(
            x !== null ? x : (boneData.initialScale?.x ?? 1),
            y !== null ? y : (boneData.initialScale?.y ?? 1),
            z !== null ? z : (boneData.initialScale?.z ?? 1),
          );
          if (node) {
            node.scaling.copyFrom(tempVec);
          } else if ("setScale" in bone) {
            (bone as Bone).setScale(tempVec);
          }
        }
        const customCurves = (boneData as any).customCurves;
        if (customCurves) {
          const alphaCurve = customCurves[304273561];
          if (alphaCurve) {
            const alphaVal = interpolate(alphaCurve, frame);
            if (alphaVal !== null) {
              if (bone instanceof Mesh) {
                bone.visibility = alphaVal;
                if (bone.material) {
                  bone.material.alpha = alphaVal;
                }
              } else if (node) {
                const sceneMeshes = scene.meshes;
                for (const m of sceneMeshes) {
                  if (m.parent === node || m === node) {
                    m.visibility = alphaVal;
                    if (m.material) {
                      m.material.alpha = alphaVal;
                    }
                  }
                }
              }
            }
          }
        }
      },
    );
    state.currentAnimationData.muscles.forEach(
      (muscleCurves: Array<{ axis: string; curve: { time: number; frame: number; value: number }[]; humanBoneIndex: number }>, targetBone: Bone | TransformNode) => {
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
          const avatarObj = "avatar" in targetBone ? (targetBone as { avatar?: UnityObject }).avatar : undefined;
          applyHumanoidRotation(
            targetBone,
            muscleVals,
            avatarObj || state.currentAnimationData!.avatar!,
            humanBoneIndex,
          );
        }
      },
    );
    state.currentAnimationData.morphs.forEach((curve: { time: number; frame: number; value: number }[], target: MorphTarget) => {
      const val = interpolate(curve, frame);
      if (val !== null) {
        target.influence = val / 100.0;
      }
    });
  });
};
