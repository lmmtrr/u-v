import init, { Environment, UeEnvironment } from "../pkg/u_v.js";
import type {
  MeshResponse,
  PathId,
  JSONValue,
  UnrealMesh,
  UnrealMaterialSlot,
  UnrealSocket,
  UnrealTexture,
  UnrealAnimationEntry,
} from "./types";
import { pickBaseColorTexture, pickLineColorTexture } from "./ue_materials";
interface WorkerMessagePayload {
  type: string;
  id: number;
  payload?:
    | JSONValue
    | MeshResponse
    | { raw: Uint8Array | null }
    | {
        envId: number;
        meshes: UnrealMesh[];
        sockets: UnrealSocket[];
        textures: UnrealTexture[];
        animations: UnrealAnimationEntry[];
        errors: string[];
        needsMappings: boolean;
      }
    | null;
  error?: string;
}
interface WebWorkerGlobalScope {
  postMessage(message: WorkerMessagePayload, transferables?: Transferable[]): void;
}
let environments: { name: string; env: Environment }[] = [];
const unrealEnvironments = new Map<number, UeEnvironment>();
let nextUnrealEnvId = 1;
const wasmInitPromise = init();
const ctx = self as never as WebWorkerGlobalScope;
self.onmessage = async (event: MessageEvent) => {
  try {
    await wasmInitPromise;
  } catch (err) {
    ctx.postMessage({
      type: "ERROR",
      id: Number(event.data.id),
      error:
        "Failed to initialize WebAssembly: " +
        (err instanceof Error ? err.message : String(err)),
    });
    return;
  }
  const { type, id, payload } = event.data as { type: string; id: number; payload: Record<string, JSONValue> };
  try {
    switch (type) {
      case "INIT":
        ctx.postMessage({ type: "INIT_SUCCESS", id });
        break;
      case "LOAD_FILE": {
        const { arrayBuffer, name } = payload as never as { arrayBuffer: ArrayBuffer; name: string };
        const src = new Uint8Array(arrayBuffer);
        const env = new Environment(src);
        const objects = JSON.parse(env.getObjects()) as never as JSONValue[];
        const hash = JSON.parse(env.getObjectHash()) as never as Record<string, string>;
        let assetInfo: JSONValue = null;
        try {
          assetInfo = JSON.parse(env.getAssetInfo()) as never as JSONValue;
        } catch {
          assetInfo = null;
        }
        environments.push({ name, env });
        const fileIndex = environments.length - 1;
        ctx.postMessage({
          type: "LOAD_FILE_SUCCESS",
          id,
          payload: {
            fileIndex,
            name,
            objects,
            hash,
            assetInfo,
          } as never as JSONValue,
        });
        break;
      }
      case "GET_MESH_DATA": {
        const { fileIndex, pathId, sourceFileName, matrix, normalMatrix } =
          payload as never as {
            fileIndex: number;
            pathId: PathId;
            sourceFileName: string;
            matrix?: number[] | Float32Array;
            normalMatrix?: number[] | Float32Array;
          };
        const entry = environments[fileIndex];
        if (!entry)
          throw new Error(`Environment at index ${fileIndex} not found.`);
        const env = entry.env;
        let vertices: Float32Array | null, normals: Float32Array | null;
        if (matrix) {
          const matrixArr = Array.isArray(matrix)
            ? new Float32Array(matrix as number[])
            : Float32Array.from(matrix as Iterable<number>);
          vertices = env.getTransformedMeshVertices(
            pathId,
            sourceFileName,
            matrixArr,
          ) as Float32Array | null;
        } else {
          vertices = env.getMeshVertices(
            pathId,
            sourceFileName,
          ) as Float32Array | null;
        }
        if (normalMatrix) {
          const normalMatrixArr = Array.isArray(normalMatrix)
            ? new Float32Array(normalMatrix as number[])
            : Float32Array.from(normalMatrix as Iterable<number>);
          normals = env.getTransformedMeshNormals(
            pathId,
            sourceFileName,
            normalMatrixArr,
          ) as Float32Array | null;
        } else {
          normals = env.getMeshNormals(
            pathId,
            sourceFileName,
          ) as Float32Array | null;
        }
        const uvs = env.getMeshUVs(
          pathId,
          sourceFileName,
        ) as Float32Array | null;
        const indices = env.getMeshIndices(
          pathId,
          sourceFileName,
        ) as Uint32Array | null;
        const skinIndices = env.getMeshSkinIndices(
          pathId,
          sourceFileName,
        ) as Uint32Array | null;
        const skinWeights = env.getMeshSkinWeights(
          pathId,
          sourceFileName,
        ) as Float32Array | null;
        const transferables: ArrayBuffer[] = [];
        const responsePayload: MeshResponse = {};
        if (vertices) {
          responsePayload.vertices = vertices;
          transferables.push(vertices.buffer as ArrayBuffer);
        }
        if (normals) {
          responsePayload.normals = normals;
          transferables.push(normals.buffer as ArrayBuffer);
        }
        if (uvs) {
          responsePayload.uvs = uvs;
          transferables.push(uvs.buffer as ArrayBuffer);
        }
        if (indices) {
          responsePayload.indices = indices;
          transferables.push(indices.buffer as ArrayBuffer);
        }
        if (skinIndices) {
          responsePayload.skinIndices = skinIndices;
          transferables.push(skinIndices.buffer as ArrayBuffer);
        }
        if (skinWeights) {
          responsePayload.skinWeights = skinWeights;
          transferables.push(skinWeights.buffer as ArrayBuffer);
        }
        ctx.postMessage(
          { type: "GET_MESH_DATA_SUCCESS", id, payload: responsePayload },
          transferables as Transferable[],
        );
        break;
      }
      case "GET_TEXTURE_DATA": {
        const { fileIndex, pathId, sourceFileName } = payload as never as { fileIndex: number; pathId: PathId; sourceFileName: string };
        const entry = environments[fileIndex];
        if (!entry)
          throw new Error(`Environment at index ${fileIndex} not found.`);
        const env = entry.env;
        const raw = env.getTextureData(
          pathId,
          sourceFileName,
        ) as Uint8Array | null;
        if (raw) {
          ctx.postMessage(
            {
              type: "GET_TEXTURE_DATA_SUCCESS",
              id,
              payload: { raw },
            },
            [raw.buffer] as Transferable[],
          );
        } else {
          ctx.postMessage({
            type: "GET_TEXTURE_DATA_SUCCESS",
            id,
            payload: { raw: null },
          });
        }
        break;
      }
      case "LOAD_UNREAL_FILES": {
        const { files } = payload as never as {
          files: Array<{ path: string; arrayBuffer: ArrayBuffer }>;
        };
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
        ctx.postMessage(
          {
            type: "LOAD_UNREAL_FILES_SUCCESS",
            id,
            payload: {
              envId,
              animations,
              meshes,
              sockets,
              textures: [...textures.values()].filter((t): t is UnrealTexture => !!t),
              errors,
              needsMappings,
            },
          },
          transferables as Transferable[],
        );
        break;
      }
      case "LOAD_UNREAL_ANIMATION": {
        const { envId, path } = payload as never as { envId: number; path: string };
        const env = unrealEnvironments.get(envId);
        if (!env) throw new Error(`Unreal environment ${envId} not found.`);
        const meta = JSON.parse(env.loadAnimation(path));
        const samples = env.takeAnimationSamples(path)!;
        ctx.postMessage(
          {
            type: "LOAD_UNREAL_ANIMATION_SUCCESS",
            id,
            payload: { ...meta, samples } as never,
          },
          [samples.buffer as ArrayBuffer],
        );
        break;
      }
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    ctx.postMessage({
      type: "ERROR",
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
