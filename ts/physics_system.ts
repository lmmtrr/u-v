import { Vector3, Quaternion, Matrix } from "@babylonjs/core/Maths/math.vector";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Observer } from "@babylonjs/core/Misc/observable";
import { state } from "./state";
import type { UnityObject, JSONValue } from "./types";
const V_ROTATED_AXIS = new Vector3();
const V_ORIENTED_INIT = new Vector3();
const V_FORCE = new Vector3();
const V_TEMP_PREV = new Vector3();
const V_VELOCITY = new Vector3();
const V_HEAD_TO_TAIL = new Vector3();
const V_WORLD_BONE = new Vector3();
const V_LOCAL_BONE = new Vector3();
const Q_AIM_ROT = new Quaternion();
const Q_FINAL_ROT = new Quaternion();
const M_BASE_LOCAL = new Matrix();
const M_BASE_WORLD = new Matrix();
const M_INV_BASE_WORLD = new Matrix();
export interface PhysicsEntry {
  type: string;
  node: TransformNode;
  targetBones: { bone: Bone; skeleton: Skeleton }[];
  boneAxis: Vector3;
  springLength: number;
  initialLocalRotation: Quaternion;
  initialLocalScaling: Vector3;
  currTipPos: Vector3;
  prevTipPos: Vector3;
  stiffnessForce: number;
  dragForce: number;
  springForce: Vector3;
  depth: number;
}
export const setupSpringBones = (
  objects: UnityObject[],
  transformNodes: Map<string, TransformNode>,
  skeletons: Map<string, { skeleton: Skeleton; boneMap: Map<string, Bone> }>,
  transformsByGameObjectId: Map<string, UnityObject>,
): PhysicsEntry[] => {
  const entries: PhysicsEntry[] = [];
  const processedBones = new Set<string>();
  for (let obj of objects) {
    if (!obj) continue;
    const type = Object.keys(obj)[0];
    if (type !== "SpringBone" && type !== "DynamicBone") continue;
    const sb = obj[type] as Record<string, JSONValue> | undefined;
    if (!sb || sb.m_Enabled === false) continue;
    const roots: Record<string, JSONValue>[] = [];
    if (type === "DynamicBone") {
      if (sb.m_Root) {
        const root = sb.m_Root as Record<string, JSONValue>;
        const rootIdStr = String(root.path_id || root.m_PathID || "");
        if (rootIdStr && rootIdStr !== "0") roots.push(root);
      }
      if (sb.m_Roots) {
        const rawRoots = sb.m_Roots as Record<string, JSONValue>[];
        for (const r of rawRoots) {
          const rIdStr = String(r.path_id || r.m_PathID || "");
          if (rIdStr && rIdStr !== "0") roots.push(r);
        }
      }
    } else {
      const go = sb.m_GameObject as Record<string, JSONValue> | undefined;
      const goPathIdStr = go ? String(go.path_id || go.m_PathID || "") : "";
      if (goPathIdStr) {
        const t = transformsByGameObjectId.get(goPathIdStr);
        if (t) roots.push(t);
      }
    }
    if (roots.length === 0) continue;
    for (const rootPtr of roots) {
      const rootPathIdStr = String(rootPtr.path_id || rootPtr.m_PathID || "");
      if (!rootPathIdStr) continue;
      const exclusions = new Set<string>(
        ((sb.m_Exclusions as Record<string, JSONValue>[]) || [])
          .map((e) => String(e.path_id || e.m_PathID || ""))
          .filter((id): id is string => !!id),
      );
      const addBoneChain = (
        currentPathId: string,
        depth: number,
        maxDepth: number,
      ) => {
        const currentPathIdStr = String(currentPathId);
        if (exclusions.has(currentPathIdStr)) return;
        const node = transformNodes.get(currentPathIdStr);
        if (!node) return;
        const boneKey =
          currentPathIdStr + "_" + String(sb.path_id || "default");
        if (processedBones.has(boneKey)) return;
        processedBones.add(boneKey);
        const targetBones: { bone: Bone; skeleton: Skeleton }[] = [];
        const nodeName = node.name;
        const scene = node.getScene();
        if (scene && scene.skeletons) {
          for (const skel of scene.skeletons) {
            const b = skel.bones.find((bone) => bone.name === nodeName);
            if (b) {
              targetBones.push({ bone: b, skeleton: skel });
            }
          }
        }
        if (targetBones.length === 0) {
          for (const [, skelData] of skeletons) {
            const targetBone = skelData.boneMap.get(currentPathIdStr);
            if (targetBone) {
              targetBones.push({
                bone: targetBone,
                skeleton: skelData.skeleton,
              });
            }
          }
        }
        if (targetBones.length > 0) {
          const childNodes: TransformNode[] = [];
          for (const [, n] of transformNodes) {
            if (n.parent === node) childNodes.push(n);
          }
          let childWorldPos: Vector3;
          if (childNodes.length === 0) {
            const selfPos = node.getAbsolutePosition();
            if (node.parent) {
              const parentPos = (
                node.parent as TransformNode
              ).getAbsolutePosition();
              const dir = selfPos.subtract(parentPos);
              childWorldPos = selfPos.add(
                dir.lengthSquared() > 0.000001
                  ? dir.normalize().scale(0.05)
                  : Vector3.TransformNormal(
                      new Vector3(0, 0.05, 0),
                      node.getWorldMatrix(),
                    ),
              );
            } else {
              childWorldPos = node
                .getAbsolutePosition()
                .add(new Vector3(0, 0.05, 0));
            }
          } else {
            childWorldPos = childNodes[0].getAbsolutePosition().clone();
          }
          const springLength = Vector3.Distance(
            node.getAbsolutePosition(),
            childWorldPos,
          );
          if (springLength >= 0.001) {
            const worldMatrix = node.computeWorldMatrix(true);
            const invWorld = Matrix.Invert(worldMatrix);
            const boneAxis = Vector3.TransformCoordinates(
              childWorldPos,
              invWorld,
            ).normalize();
            let stiffness =
              (sb.stiffness_force !== undefined
                ? Number(sb.stiffness_force)
                : sb.m_Stiffness !== undefined
                  ? Number(sb.m_Stiffness)
                  : 0.1) + Number(sb.m_Elasticity || 0);
            let drag =
              sb.drag_force !== undefined
                ? Number(sb.drag_force)
                : sb.m_Damping !== undefined
                  ? Number(sb.m_Damping)
                  : 0.4;
            const gravity = (sb.m_Gravity as Record<string, JSONValue> | undefined) || { x: 0, y: -0.5, z: 0 };
            const gravityVec = {
              x: Number(gravity.x || 0),
              y: Number(gravity.y || 0),
              z: Number(gravity.z || 0),
            };
            if (stiffness < 0.1) stiffness = 0.1;
            if (stiffness > 1.0) stiffness = 1.0;
            stiffness *= 500.0;
            entries.push({
              type: "SpringBone",
              node,
              targetBones,
              boneAxis,
              springLength,
              initialLocalRotation: node.rotationQuaternion
                ? node.rotationQuaternion.clone()
                : Quaternion.Identity(),
              initialLocalScaling: node.scaling.clone(),
              currTipPos: childWorldPos.clone(),
              prevTipPos: childWorldPos.clone(),
              stiffnessForce: stiffness,
              dragForce: drag,
              springForce: new Vector3(
                gravityVec.x,
                gravityVec.y,
                gravityVec.z,
              ),
              depth,
            });
          }
        }
        if (type === "DynamicBone" && depth < 20) {
          const children: string[] = [];
          for (const [pid, n] of transformNodes) {
            if (n.parent === node) children.push(pid);
          }
          for (const childId of children) {
            addBoneChain(childId, depth + 1, maxDepth);
          }
        }
      };
      addBoneChain(rootPathIdStr, 0, 20);
    }
  }
  entries.sort((a, b) => a.depth - b.depth);
  return entries;
};
export const setupDynamicBones = (
  objects: UnityObject[],
  transformNodes: Map<string, TransformNode>,
  skeletons: Map<string, { skeleton: Skeleton; boneMap: Map<string, Bone> }>,
  transformsByGameObjectId: Map<string, UnityObject>,
): PhysicsEntry[] => {
  return [];
};
const updateSpringBone = (sb: PhysicsEntry, fixedDtSqr: number) => {
  const node = sb.node;
  const headPos = node.getAbsolutePosition();
  const parentNode = node.parent as TransformNode | null;
  const parentWorldMatrix = parentNode
    ? parentNode.computeWorldMatrix(true)
    : Matrix.IdentityReadOnly;
  Matrix.ComposeToRef(
    sb.initialLocalScaling,
    sb.initialLocalRotation,
    node.position,
    M_BASE_LOCAL,
  );
  M_BASE_LOCAL.multiplyToRef(parentWorldMatrix, M_BASE_WORLD);
  Vector3.TransformNormalToRef(sb.boneAxis, M_BASE_WORLD, V_ROTATED_AXIS);
  V_ROTATED_AXIS.normalize();
  V_ROTATED_AXIS.scaleToRef(sb.springLength, V_ORIENTED_INIT);
  V_ORIENTED_INIT.addInPlace(headPos);
  V_ORIENTED_INIT.subtractToRef(sb.currTipPos, V_FORCE);
  V_FORCE.scaleInPlace(sb.stiffnessForce);
  V_FORCE.addInPlace(sb.springForce);
  V_FORCE.scaleInPlace(fixedDtSqr);
  V_TEMP_PREV.copyFrom(sb.currTipPos);
  sb.currTipPos.subtractToRef(sb.prevTipPos, V_VELOCITY);
  V_VELOCITY.scaleInPlace(1 - sb.dragForce);
  sb.currTipPos.addInPlace(V_VELOCITY).addInPlace(V_FORCE);
  sb.prevTipPos.copyFrom(V_TEMP_PREV);
  sb.currTipPos.subtractToRef(headPos, V_HEAD_TO_TAIL);
  let mag = V_HEAD_TO_TAIL.length();
  if (mag > 0.001) {
    V_HEAD_TO_TAIL.scaleInPlace(1 / mag);
  } else {
    V_HEAD_TO_TAIL.copyFrom(V_ROTATED_AXIS);
  }
  V_HEAD_TO_TAIL.scaleInPlace(sb.springLength);
  sb.currTipPos
    .copyFrom(headPos)
    .addInPlace(V_HEAD_TO_TAIL);
  sb.currTipPos.subtractToRef(headPos, V_WORLD_BONE);
  M_BASE_WORLD.invertToRef(M_INV_BASE_WORLD);
  Vector3.TransformNormalToRef(V_WORLD_BONE, M_INV_BASE_WORLD, V_LOCAL_BONE);
  V_LOCAL_BONE.normalize();
  Quaternion.FromUnitVectorsToRef(sb.boneAxis, V_LOCAL_BONE, Q_AIM_ROT);
  sb.initialLocalRotation.multiplyToRef(Q_AIM_ROT, Q_FINAL_ROT);
  Q_FINAL_ROT.normalize();
  if (!node.rotationQuaternion) {
    node.rotationQuaternion = Q_FINAL_ROT.clone();
  } else {
    node.rotationQuaternion.copyFrom(Q_FINAL_ROT);
  }
  if (sb.targetBones) {
    for (const tb of sb.targetBones) {
      if (!tb.bone.rotationQuaternion) {
        tb.bone.rotationQuaternion = Q_FINAL_ROT.clone();
      } else {
        tb.bone.rotationQuaternion.copyFrom(Q_FINAL_ROT);
      }
      const linkedNode = tb.bone.getTransformNode
        ? tb.bone.getTransformNode()
        : null;
      if (linkedNode && linkedNode !== node) {
        if (!linkedNode.rotationQuaternion) {
          linkedNode.rotationQuaternion = Q_FINAL_ROT.clone();
        } else {
          linkedNode.rotationQuaternion.copyFrom(Q_FINAL_ROT);
        }
        linkedNode.computeWorldMatrix(true);
      }
    }
  }
  node.computeWorldMatrix(true);
};
export const createPhysicsObserver = (
  scene: Scene,
  allPhysicsEntries: PhysicsEntry[],
): Observer<Scene> | null => {
  if (!allPhysicsEntries || allPhysicsEntries.length === 0) return null;
  let lastTime = performance.now();
  let accumulator = 0;
  const fixedDt = 1 / 60;
  const fixedDtSqr = fixedDt * fixedDt;
  let wasPhysicsEnabled = false;
  const camera = scene.activeCamera as ArcRotateCamera | null;
  let prevAlpha = camera ? camera.alpha : 0;
  let prevBeta = camera ? camera.beta : 0;
  let prevTarget = camera
    ? camera.target?.clone() ||
      (camera.getTarget && camera.getTarget().clone()) ||
      Vector3.Zero()
    : Vector3.Zero();
  const tempRotY = new Quaternion();
  const tempRotX = new Quaternion();
  const tempCombinedRot = new Quaternion();
  const rel = new Vector3();
  return scene.onBeforeRenderObservable.add(() => {
    if (!state.physicsEnabled) {
      if (scene.activeCamera) {
        const camera = scene.activeCamera as ArcRotateCamera;
        prevAlpha = camera.alpha;
        prevBeta = camera.beta;
        prevTarget.copyFrom(
          camera.target ||
            (camera.getTarget && camera.getTarget()) ||
            Vector3.Zero(),
        );
      }
      wasPhysicsEnabled = false;
      lastTime = performance.now();
      return;
    }
    if (!wasPhysicsEnabled) {
      for (const entry of allPhysicsEntries) {
        if (entry.type === "SpringBone") {
          const node = entry.node;
          if (node.rotationQuaternion) {
            entry.initialLocalRotation.copyFrom(node.rotationQuaternion);
          } else {
            entry.initialLocalRotation.copyFrom(
              Quaternion.FromEulerVector(node.rotation),
            );
          }
          const worldMatrix = node.computeWorldMatrix(true);
          const rotatedAxis = new Vector3();
          Vector3.TransformNormalToRef(
            entry.boneAxis,
            worldMatrix,
            rotatedAxis,
          );
          rotatedAxis.normalize();
          const currentTipPos = node
            .getAbsolutePosition()
            .add(rotatedAxis.scale(entry.springLength));
          entry.currTipPos.copyFrom(currentTipPos);
          entry.prevTipPos.copyFrom(currentTipPos);
        }
      }
      wasPhysicsEnabled = true;
    }
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    const camera = scene.activeCamera as ArcRotateCamera | null;
    if (camera) {
      const currentTarget =
        camera.target ||
        (camera.getTarget && camera.getTarget()) ||
        Vector3.Zero();
      const dAlpha = camera.alpha - prevAlpha;
      const dBeta = camera.beta - prevBeta;
      const dTarget = currentTarget.subtract(prevTarget);
      const pivot = currentTarget;
      if (Math.abs(dAlpha) > 0.00001 || Math.abs(dBeta) > 0.00001) {
        Quaternion.RotationAxisToRef(Axis.Y, -dAlpha, tempRotY);
        const lookDir = camera.position.subtract(pivot).normalize();
        const rightDir = Vector3.Cross(lookDir, Axis.Y).normalize();
        Quaternion.RotationAxisToRef(rightDir, -dBeta, tempRotX);
        tempRotX.multiplyToRef(tempRotY, tempCombinedRot);
        for (const entry of allPhysicsEntries) {
          if (entry.type === "SpringBone") {
            entry.currTipPos.subtractToRef(pivot, rel);
            rel.rotateByQuaternionToRef(tempCombinedRot, rel);
            entry.currTipPos.copyFrom(pivot).addInPlace(rel);
            entry.prevTipPos.subtractToRef(pivot, rel);
            rel.rotateByQuaternionToRef(tempCombinedRot, rel);
            entry.prevTipPos.copyFrom(pivot).addInPlace(rel);
          }
        }
      }
      if (dTarget.lengthSquared() > 0.000001) {
        for (const entry of allPhysicsEntries) {
          if (entry.type === "SpringBone") {
            entry.currTipPos.subtractInPlace(dTarget);
            entry.prevTipPos.subtractInPlace(dTarget);
          }
        }
      }
      prevAlpha = camera.alpha;
      prevBeta = camera.beta;
      prevTarget.copyFrom(pivot);
    }
    accumulator += dt;
    while (accumulator >= fixedDt) {
      for (const entry of allPhysicsEntries) {
        if (entry.type === "SpringBone") {
          updateSpringBone(entry, fixedDtSqr);
        }
      }
      accumulator -= fixedDt;
    }
  });
};
