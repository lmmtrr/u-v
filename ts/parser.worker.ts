import init, { Environment } from "../pkg/u_v.js";
import type { MeshResponse, PathId, JSONValue } from "./types";
interface WorkerMessagePayload {
  type: string;
  id: number;
  payload?: JSONValue | MeshResponse | { raw: Uint8Array | null } | null;
  error?: string;
}
interface WebWorkerGlobalScope {
  postMessage(message: WorkerMessagePayload, transferables?: Transferable[]): void;
}
let environments: { name: string; env: Environment }[] = [];
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
