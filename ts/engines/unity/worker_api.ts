import { workerClient } from "../../worker_client";
import type { AssetInfo, JSONValue, MeshResponse, PathId, UnityObject } from "../../types";

export interface UnityLoadResult {
  fileIndex: number;
  name: string;
  objects: UnityObject[];
  hash: Record<string, string>;
  assetInfo: AssetInfo | null;
}

export const unityWorker = {
  loadFile: (arrayBuffer: ArrayBuffer, name: string): Promise<UnityLoadResult> =>
    workerClient.request<UnityLoadResult>(
      "LOAD_FILE",
      { arrayBuffer, name } as never as JSONValue,
      [arrayBuffer],
    ),
  getMeshData: (
    fileIndex: number,
    pathId: PathId,
    sourceFileName: string,
    matrix: Float32Array | number[] | null = null,
    normalMatrix: Float32Array | number[] | null = null,
  ): Promise<MeshResponse> =>
    workerClient.request<MeshResponse>("GET_MESH_DATA", {
      fileIndex,
      pathId,
      sourceFileName,
      matrix,
      normalMatrix,
    } as never as JSONValue),
  freeFile: (fileIndex: number): Promise<void> =>
    workerClient.request<void>("FREE_FILE", { fileIndex }),
  getTextureData: (
    fileIndex: number,
    pathId: PathId,
    sourceFileName: string,
  ): Promise<{ raw: Uint8Array | null }> =>
    workerClient.request<{ raw: Uint8Array | null }>("GET_TEXTURE_DATA", {
      fileIndex,
      pathId,
      sourceFileName,
    } as never as JSONValue),
};
