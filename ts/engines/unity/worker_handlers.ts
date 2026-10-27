import { Environment } from "../../../pkg/u_v.js";
import type { JSONValue, MeshResponse, PathId } from "../../types";
import type { WorkerHandlers } from "../../worker_protocol";

const environments: { name: string; env: Environment }[] = [];

const environmentAt = (fileIndex: number): Environment => {
  const entry = environments[fileIndex];
  if (!entry) throw new Error(`Environment at index ${fileIndex} not found.`);
  return entry.env;
};

const toFloat32 = (values: number[] | Float32Array): Float32Array =>
  Array.isArray(values) ? new Float32Array(values) : Float32Array.from(values);

export const unityHandlers: WorkerHandlers = {
  LOAD_FILE: ({ arrayBuffer, name }: { arrayBuffer: ArrayBuffer; name: string }) => {
    const env = new Environment(new Uint8Array(arrayBuffer));
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
    return { payload: { fileIndex, name, objects, hash, assetInfo } };
  },
  GET_MESH_DATA: ({
    fileIndex,
    pathId,
    sourceFileName,
    matrix,
    normalMatrix,
  }: {
    fileIndex: number;
    pathId: PathId;
    sourceFileName: string;
    matrix?: number[] | Float32Array;
    normalMatrix?: number[] | Float32Array;
  }) => {
    const env = environmentAt(fileIndex);
    const vertices = (
      matrix
        ? env.getTransformedMeshVertices(pathId, sourceFileName, toFloat32(matrix))
        : env.getMeshVertices(pathId, sourceFileName)
    ) as Float32Array | null;
    const normals = (
      normalMatrix
        ? env.getTransformedMeshNormals(pathId, sourceFileName, toFloat32(normalMatrix))
        : env.getMeshNormals(pathId, sourceFileName)
    ) as Float32Array | null;
    const uv0 = env.getMeshUV0s(pathId, sourceFileName) as Float32Array | null;
    const uv1 = env.getMeshUV1s(pathId, sourceFileName) as Float32Array | null;
    const indices = env.getMeshIndices(pathId, sourceFileName) as Uint32Array | null;
    const skinIndices = env.getMeshSkinIndices(pathId, sourceFileName) as Uint32Array | null;
    const skinWeights = env.getMeshSkinWeights(pathId, sourceFileName) as Float32Array | null;
    const transfer: ArrayBuffer[] = [];
    const payload: MeshResponse = {};
    if (vertices) {
      payload.vertices = vertices;
      transfer.push(vertices.buffer as ArrayBuffer);
    }
    if (normals) {
      payload.normals = normals;
      transfer.push(normals.buffer as ArrayBuffer);
    }
    if (uv0) {
      payload.uv0 = uv0;
      transfer.push(uv0.buffer as ArrayBuffer);
    }
    if (uv1) {
      payload.uv1 = uv1;
      transfer.push(uv1.buffer as ArrayBuffer);
    }
    if (indices) {
      payload.indices = indices;
      transfer.push(indices.buffer as ArrayBuffer);
    }
    if (skinIndices) {
      payload.skinIndices = skinIndices;
      transfer.push(skinIndices.buffer as ArrayBuffer);
    }
    if (skinWeights) {
      payload.skinWeights = skinWeights;
      transfer.push(skinWeights.buffer as ArrayBuffer);
    }
    return { payload, transfer };
  },
  GET_TEXTURE_DATA: ({
    fileIndex,
    pathId,
    sourceFileName,
  }: {
    fileIndex: number;
    pathId: PathId;
    sourceFileName: string;
  }) => {
    const raw = environmentAt(fileIndex).getTextureData(pathId, sourceFileName) as Uint8Array | null;
    return raw ? { payload: { raw }, transfer: [raw.buffer as ArrayBuffer] } : { payload: { raw: null } };
  },
};
