import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PhysicsEntry } from "../../physics_system";

const SOFT_PART = /hair|skirt|ribbon|cloth|tail|(^|[_-])ear\d|maedare|bust|breast|sode|sleeve|cape|coat|ahoge|scarf|frill|string/i;
export const hasSoftParts = (bones: Array<{ name: string }>, physicsBones: string[]): boolean =>
  bones.some((b) => SOFT_PART.test(b.name) && (physicsBones.length === 0 || physicsBones.includes(b.name)));
const STIFFNESS = 0.2 * 500;
const DRAG = 0.4;
const GRAVITY = new Vector3(0, -0.5, 0);
const isBoneNode = (n: unknown): n is TransformNode =>
  n instanceof TransformNode && !!n.metadata?.unrealRest;
const tipOf = (node: TransformNode): Vector3 => {
  const child = node.getChildren(isBoneNode, true)[0] as TransformNode | undefined;
  if (child) return child.getAbsolutePosition().clone();
  const self = node.getAbsolutePosition();
  const parent = node.parent as TransformNode | null;
  const dir = parent ? self.subtract(parent.getAbsolutePosition()) : new Vector3(0, -1, 0);
  return self.add(dir.lengthSquared() > 1e-6 ? dir.normalize().scale(0.05) : new Vector3(0, -0.05, 0));
};
export const buildUnrealSpringBones = (meshes: Mesh[]): PhysicsEntry[] => {
  const entries: PhysicsEntry[] = [];
  meshes.forEach((mesh) => {
    if (!mesh.metadata?.unrealPath || !mesh.skeleton) return;
    const bodies: string[] = mesh.metadata.unrealPhysicsBones ?? [];
    const candidates = bodies.length > 0 ? new Set(bodies) : null;
    mesh.skeleton.bones.forEach((bone) => {
      if (!SOFT_PART.test(bone.name) || (candidates && !candidates.has(bone.name))) return;
      const node = bone.getTransformNode();
      if (!node) return;
      if (node.getChildren(isBoneNode, true).length > 1) return;
      node.computeWorldMatrix(true);
      const tip = tipOf(node);
      const springLength = Vector3.Distance(node.getAbsolutePosition(), tip);
      if (springLength < 0.001) return;
      const boneAxis = Vector3.TransformCoordinates(tip, Matrix.Invert(node.computeWorldMatrix(true))).normalize();
      let depth = 0;
      for (let p = bone.getParent(); p; p = p.getParent()) depth++;
      entries.push({
        type: "SpringBone",
        node,
        targetBones: [{ bone, skeleton: mesh.skeleton! }],
        boneAxis,
        springLength,
        initialLocalRotation: node.rotationQuaternion?.clone() ?? Quaternion.Identity(),
        initialLocalScaling: node.scaling.clone(),
        currTipPos: tip.clone(),
        prevTipPos: tip.clone(),
        stiffnessForce: STIFFNESS,
        dragForce: DRAG,
        springForce: GRAVITY.clone(),
        depth,
      });
    });
  });
  return entries.sort((a, b) => a.depth - b.depth);
};
