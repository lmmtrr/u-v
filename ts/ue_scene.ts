import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Material } from "@babylonjs/core/Materials/material";
import { MorphTargetManager } from "@babylonjs/core/Morph/morphTargetManager";
import { MorphTarget } from "@babylonjs/core/Morph/morphTarget";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { rgbaToDataURL } from "./renderer_utils";
import { rememberUnrealRestPose } from "./ue_animation";
import type { JSONValue, LoadedFile, UnrealMesh, UnrealSocket, UnrealTexture } from "./types";
import { state } from "./state";

const createSkeleton = (data: UnrealMesh, scene: Scene): Skeleton => {
  const skeleton = new Skeleton(`${data.name}_skeleton`, data.id, scene);
  const bones: Bone[] = [];
  const nodes: TransformNode[] = [];
  data.bones.forEach((b) => {
    const local = Matrix.Compose(
      new Vector3(...b.scale),
      new Quaternion(...b.rotation),
      new Vector3(...b.translation),
    );
    const parent = b.parent ?? -1;
    const bone = new Bone(b.name, skeleton, parent >= 0 ? bones[parent] : null, local);
    const node = new TransformNode(b.name, scene);
    node.position = new Vector3(...b.translation);
    node.rotationQuaternion = new Quaternion(...b.rotation);
    node.scaling = new Vector3(...b.scale);
    if (parent >= 0) node.parent = nodes[parent];
    rememberUnrealRestPose(node);
    bone.linkTransformNode(node);
    bones.push(bone);
    nodes.push(node);
  });
  return skeleton;
};

const OUTLINE_MATERIAL = /(^|_)OL(_|$)|outline|^MatLine/i;

type TextureLookup = (path: string | null | undefined) => Texture | null;

let previousResources: Array<{ dispose: () => void }> = [];
const pngCache = new WeakMap<UnrealTexture, { dataUrl: string; hasAlpha: boolean }>();

const hasTranslucentPixels = (pixels: Uint8Array): boolean => {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 250) return true;
  }
  return false;
};

const createTextureLookup = (scene: Scene, files: LoadedFile[]): TextureLookup => {
  const sources = new Map<string, UnrealTexture>();
  files.forEach((f) => f.unrealTextures?.forEach((t) => sources.set(t.path, t)));
  const created = new Map<string, Texture>();
  return (path) => {
    if (!path) return null;
    const cached = created.get(path);
    if (cached) return cached;
    const src = sources.get(path);
    if (!src) return null;
    let encoded = pngCache.get(src);
    if (!encoded) {
      encoded = {
        dataUrl: rgbaToDataURL(src.pixels, src.width, src.height),
        hasAlpha: hasTranslucentPixels(src.pixels),
      };
      pngCache.set(src, encoded);
    }
    const name = path.split("/").pop() || path;
    const texture = Texture.CreateFromBase64String(
      encoded.dataUrl,
      name,
      scene,
      false,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    texture.name = name;
    texture.hasAlpha = encoded.hasAlpha;
    created.set(path, texture);
    previousResources.push(texture);
    return texture;
  };
};

const createMaterials = (data: UnrealMesh, scene: Scene, textureFor: TextureLookup): MultiMaterial => {
  const multi = new MultiMaterial(`${data.name}_materials`, scene);
  previousResources.push(multi);
  data.materials.forEach((slot, i) => {
    const name = slot.material?.split(/[./]/).pop() || slot.slot_name || `Material ${i + 1}`;
    const mat = new StandardMaterial(name, scene);
    previousResources.push(mat);
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    const info = slot.info;
    if (OUTLINE_MATERIAL.test(name) || OUTLINE_MATERIAL.test(slot.slot_name)) {
      mat.diffuseColor = Color3.Black();
      mat.disableLighting = true;
      mat.cullBackFaces = false;
      const line = textureFor(slot.lineColor);
      if (line) mat.emissiveTexture = line;
      multi.subMaterials.push(mat);
      return;
    }
    const base = textureFor(slot.baseColor);
    if (base) {
      mat.diffuseTexture = base;
      mat.diffuseColor = Color3.White();
    } else {
      const hue = (i * 0.61803398875) % 1;
      mat.diffuseColor = Color3.FromHSV(hue * 360, 0.15, 0.95);
    }
    if (info?.two_sided) mat.backFaceCulling = false;
    if (base && info?.blend_mode === "BLEND_Masked" && base.hasAlpha) {
      mat.transparencyMode = Material.MATERIAL_ALPHATEST;
      mat.useAlphaFromDiffuseTexture = true;
      mat.alphaCutOff = info.opacity_mask_clip_value ?? 0.3333;
    } else if (base && info?.blend_mode === "BLEND_Translucent" && base.hasAlpha) {
      mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
      mat.useAlphaFromDiffuseTexture = true;
    } else if (base) {
      mat.transparencyMode = Material.MATERIAL_OPAQUE;
    }
    if (info?.shading_model === "MSM_Unlit" && base) {
      mat.disableLighting = true;
      mat.emissiveTexture = base;
    }
    mat.metadata = { unrealMaterial: info ?? null };
    multi.subMaterials.push(mat);
  });
  return multi;
};

const createMorphTargets = (data: UnrealMesh, mesh: Mesh, scene: Scene): void => {
  if (data.morphNames.length === 0) return;
  const manager = new MorphTargetManager(scene);
  let offset = 0;
  data.morphNames.forEach((name, i) => {
    const positions = new Float32Array(data.positions);
    const normals = new Float32Array(data.normals);
    const touched: number[] = [];
    for (let k = 0; k < data.morphCounts[i]; k++, offset += 7) {
      const v = data.morphData[offset] * 3;
      for (let c = 0; c < 3; c++) {
        positions[v + c] += data.morphData[offset + 1 + c];
        normals[v + c] += data.morphData[offset + 4 + c];
      }
      touched.push(v);
    }
    for (const v of touched) {
      const len = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
      normals[v] /= len;
      normals[v + 1] /= len;
      normals[v + 2] /= len;
    }
    const target = new MorphTarget(name, 0, scene);
    target.setPositions(positions);
    target.setNormals(normals);
    manager.addTarget(target);
  });
  mesh.morphTargetManager = manager;
};

const buildMesh = (data: UnrealMesh, scene: Scene, textureFor: TextureLookup): Mesh => {
  const mesh = new Mesh(data.name, scene);
  mesh.alwaysSelectAsActiveMesh = true;
  const vertexData = new VertexData();
  vertexData.positions = data.positions;
  vertexData.normals = data.normals;
  vertexData.uvs = data.uvs;
  vertexData.indices = data.indices;
  if (!data.isStatic) {
    vertexData.matricesIndices = Float32Array.from(data.skinIndices);
    vertexData.matricesWeights = data.skinWeights;
  }
  vertexData.applyToMesh(mesh);
  if (!data.isStatic) {
    mesh.skeleton = createSkeleton(data, scene);
    createMorphTargets(data, mesh, scene);
    mesh.numBoneInfluencers = 4;
  }
  mesh.material = createMaterials(data, scene, textureFor);
  const vertexCount = data.positions.length / 3;
  mesh.subMeshes = [];
  data.sections.forEach((section, i) => {
    const sub = new SubMesh(
      section.material_index,
      0,
      vertexCount,
      section.first_index,
      section.index_count,
      mesh,
    );
    const slot = data.materials[section.material_index];
    (sub as SubMesh & { friendlyName?: string }).friendlyName = slot?.slot_name || `Section ${i + 1}`;
  });
  mesh.metadata = {
    rendererPathId: data.id,
    unrealPath: data.path,
    unrealVersion: data.version,
    unrealSkeleton: data.skeleton?.split(".")[0] ?? null,
    unrealPhysicsBones: data.physicsBones,
  };
  return mesh;
};

type BuiltMesh = { data: UnrealMesh; mesh: Mesh };

const absoluteRotation = (data: UnrealMesh, index: number): Quaternion => {
  let q = Quaternion.Identity();
  for (let i = index; i >= 0; i = data.bones[i].parent ?? -1) {
    q = new Quaternion(...data.bones[i].rotation).multiply(q);
  }
  return q;
};

const socketKeyMatches = (socketName: string, meshName: string): boolean => {
  const key = socketName.toLowerCase().replace(/^socket_?/, "");
  return key.length > 0 && meshName.includes(key);
};

const HEAD_BONE = /(^|[-_ ])head$/i;
const HEAD_PART = /face|head/i;

const attachToSockets = (
  built: BuiltMesh[],
  looseSockets: UnrealSocket[],
  animatedSkeletons: Set<string>,
): void => {
  const rank = (h: BuiltMesh) =>
    (animatedSkeletons.has(h.mesh.metadata?.unrealSkeleton) ? 2 : 0) + (h.mesh.isEnabled() ? 1 : 0);
  built.forEach(({ data, mesh }) => {
    const rootBone = data.bones[0]?.name;
    const meshName = data.name.toLowerCase();
    const hosts = built
      .filter((h) => h.mesh !== mesh && h.mesh.skeleton && !h.data.bones.some((b) => b.name === rootBone))
      .sort((a, b) => rank(b) - rank(a));
    const attach = (host: BuiltMesh, boneName: string, label: string): Bone | null => {
      const bone = host.mesh.skeleton!.bones.find((b) => b.name === boneName);
      if (!bone) return null;
      mesh.attachToBone(bone, host.mesh);
      mesh.metadata.attachedTo = `${host.data.name}:${label}`;
      return bone;
    };
    const place = (socket: UnrealSocket) => {
      mesh.position = new Vector3(...socket.translation);
      mesh.rotationQuaternion = new Quaternion(...socket.rotation);
      mesh.scaling = new Vector3(...socket.scale);
    };
    for (const host of hosts) {
      const socket =
        host.data.sockets.find((s) => socketKeyMatches(s.name, meshName)) ??
        looseSockets.find(
          (s) => socketKeyMatches(s.name, meshName) && host.data.bones.some((b) => b.name === s.bone),
        );
      if (socket && attach(host, socket.bone, socket.name)) return place(socket);
    }
    if (!HEAD_PART.test(meshName)) return;
    for (const host of hosts) {
      const headIndex = host.data.bones.findIndex((b) => HEAD_BONE.test(b.name));
      if (headIndex < 0) continue;
      if (attach(host, host.data.bones[headIndex].name, `${host.data.bones[headIndex].name} (approximate)`)) {
        mesh.rotationQuaternion = Quaternion.Inverse(absoluteRotation(host.data, headIndex));
        console.warn(
          `[unreal] No socket found for ${data.name}; placed on ${host.data.name}'s head bone. ` +
            "Load the Skeleton asset that defines its socket for the exact position.",
        );
        return;
      }
    }
  });
};

export const buildUnrealMeshes = (scene: Scene, files: LoadedFile[]): Mesh[] => {
  previousResources.forEach((r) => r.dispose());
  previousResources = [];
  const textureFor = createTextureLookup(scene, files);
  const built: BuiltMesh[] = [];
  const looseSockets: UnrealSocket[] = [];
  files.forEach((file) => {
    if (file.removedFromUI) return;
    looseSockets.push(...(file.unrealSockets ?? []));
    if (!file.unreal || file.removedFromUI) return;
    file.unreal.forEach((data) => {
      const part = file.objects
        .map((obj) => (obj?.SkinnedMeshRenderer ?? obj?.MeshRenderer) as Record<string, JSONValue> | undefined)
        .find((r) => r && (r.raw_path_id ?? r.path_id) === data.id);
      if (!part) return;
      const mesh = buildMesh(data, scene, textureFor);
      mesh.metadata.rendererPathId = String(part.path_id);
      mesh.setEnabled(part.m_Enabled !== false);
      built.push({ data, mesh });
    });
  });
  const animatedSkeletons = new Set(
    files.flatMap((f) => (f.removedFromUI ? [] : (f.unrealAnimations ?? []).map((a) => a.skeleton ?? ""))),
  );
  attachToSockets(built, looseSockets, animatedSkeletons);
  built.forEach(({ data, mesh }) => {
    const offset = state.partTranslations.get(data.id);
    if (offset) mesh.position.addInPlace(new Vector3(offset.x, offset.y, offset.z));
  });
  return built.map((b) => b.mesh);
};
