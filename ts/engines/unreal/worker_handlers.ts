import { UeEnvironment } from "../../../pkg/u_v.js";
import type { WorkerHandlers } from "../../worker_protocol";
import type { UnrealAnimationEntry, UnrealMaterialSlot, UnrealMesh, UnrealSocket, UnrealTexture } from "./types";
import { pickBaseColorTexture, pickLineColorTexture } from "./materials";

const unrealEnvironments = new Map<number, UeEnvironment>();
let nextUnrealEnvId = 1;

export const unrealHandlers: WorkerHandlers = {
  LOAD_UNREAL_FILES: ({ files }: { files: Array<{ path: string; arrayBuffer: ArrayBuffer }> }) => {
    const env = new UeEnvironment();
    const envId = nextUnrealEnvId++;
    unrealEnvironments.set(envId, env);
    let animations: UnrealAnimationEntry[] = [];
    const meshes: UnrealMesh[] = [];
    let sockets: UnrealSocket[] = [];
    const textures = new Map<string, UnrealTexture | null>();
    const errors: string[] = [];
    let needsMappings = false;
    const transferables: ArrayBuffer[] = [];
    const loadTexture = (path: string | null | undefined): string | null => {
      if (!path) return null;
      if (!textures.has(path)) {
        try {
          const meta = JSON.parse(env.decodeTexture(path));
          const pixels = env.takeTexturePixels(path)!;
          textures.set(path, { path, ...meta, pixels });
          transferables.push(pixels.buffer as ArrayBuffer);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.endsWith("is not loaded")) errors.push(message);
          textures.set(path, null);
        }
      }
      return textures.get(path) ? path : null;
    };
    try {
      for (const f of files) {
        env.addFile(f.path, new Uint8Array(f.arrayBuffer));
      }
      const entries = JSON.parse(env.getMeshes()) as Array<{
        path: string;
        name: string;
        is_static: boolean;
      }>;
      errors.push(...(JSON.parse(env.getErrors()) as string[]));
      needsMappings = env.needsMappings();
      sockets = JSON.parse(env.getAllSockets()) as UnrealSocket[];
      for (const entry of entries) {
        try {
          const info = JSON.parse(env.loadMesh(entry.path));
          const mesh: UnrealMesh = {
            id: `ue:${entry.path}`,
            isStatic: entry.is_static,
            name: info.name,
            path: entry.path,
            version: info.version,
            skeleton: info.skeleton ?? null,
            sockets: info.sockets ?? [],
            physicsBones: info.physics_bones ?? [],
            bones: info.bones,
            materials: (info.materials as UnrealMaterialSlot[]).map((slot) => {
              const material = slot.material
                ? JSON.parse(env.getMaterial(slot.material))
                : null;
              return {
                ...slot,
                info: material,
                baseColor: material ? loadTexture(pickBaseColorTexture(material)) : null,
                lineColor: material ? loadTexture(pickLineColorTexture(material)) : null,
              };
            }),
            sections: info.sections,
            positions: env.getPositions(entry.path)!,
            normals: env.getNormals(entry.path)!,
            uvs: env.getUVs(entry.path)!,
            indices: env.getIndices(entry.path)!,
            skinIndices: env.getSkinIndices(entry.path)!,
            skinWeights: env.getSkinWeights(entry.path)!,
            morphNames: (info.morphs as Array<[string, number]>).map(([name]) => name),
            morphCounts: (info.morphs as Array<[string, number]>).map(([, count]) => count),
            morphData: env.getMorphData(entry.path)!,
          };
          meshes.push(mesh);
          for (const arr of [
            mesh.positions,
            mesh.normals,
            mesh.uvs,
            mesh.indices,
            mesh.skinIndices,
            mesh.skinWeights,
            mesh.morphData,
          ]) {
            transferables.push(arr.buffer as ArrayBuffer);
          }
        } catch (err) {
          errors.push(
            `${entry.path}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      animations = (
        JSON.parse(env.getAnimations()) as Array<
          Omit<UnrealAnimationEntry, "hasBoneTracks"> & {
            has_bone_tracks: boolean;
          }
        >
      )
        .filter(
          (a) =>
            (a.has_bone_tracks || a.curves.length > 0) &&
            (!a.additive || a.additive === "AAT_LocalSpaceBase" || a.additive === "AAT_RotationOffsetMeshSpace"),
        )
        .map(({ path, name, skeleton, num_frames, length, has_bone_tracks, curves, additive }) => ({
          path,
          name,
          skeleton,
          num_frames,
          length,
          hasBoneTracks: has_bone_tracks,
          curves,
          additive,
        }));
    } catch (err) {
      unrealEnvironments.delete(envId);
      env.free();
      throw err;
    }
    if (meshes.length === 0 && sockets.length === 0 && animations.length === 0) {
      unrealEnvironments.delete(envId);
      env.free();
    }
    return {
      payload: {
        envId,
        animations,
        meshes,
        sockets,
        textures: [...textures.values()].filter((t): t is UnrealTexture => !!t),
        errors,
        needsMappings,
      },
      transfer: transferables,
    };
  },
  FREE_UNREAL_ENV: ({ envId }: { envId: number }) => {
    unrealEnvironments.get(envId)?.free();
    unrealEnvironments.delete(envId);
  },
  LOAD_UNREAL_ANIMATION: ({ envId, path }: { envId: number; path: string }) => {
    const env = unrealEnvironments.get(envId);
    if (!env) throw new Error(`Unreal environment ${envId} not found.`);
    const meta = JSON.parse(env.loadAnimation(path));
    const samples = env.takeAnimationSamples(path)!;
    return { payload: { ...meta, samples }, transfer: [samples.buffer as ArrayBuffer] };
  },
};
