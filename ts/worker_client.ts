import type { MeshRequest, MeshResponse, PathId, JSONValue, UnityObject } from "./types";
type WorkerResponsePayload =
  | void
  | MeshResponse
  | { raw: Uint8Array | null }
  | { fileIndex: number; name: string; objects: UnityObject[]; hash: Record<string, string> };
class WorkerClient {
  private worker: Worker;
  private pendingRequests: Map<
    number,
    { resolve: (val: WorkerResponsePayload) => void; reject: (err: Error) => void }
  >;
  private requestIdCounter: number;
  constructor() {
    this.worker = new Worker(new URL("./parser.worker.js", import.meta.url), { type: "module" });
    this.pendingRequests = new Map();
    this.requestIdCounter = 0;
    this.worker.onmessage = (event: MessageEvent) => {
      const { type, id, payload, error } = event.data as {
        type: string;
        id: number;
        payload?: WorkerResponsePayload;
        error?: string;
      };
      if (!this.pendingRequests.has(id)) {
        return;
      }
      const { resolve, reject } = this.pendingRequests.get(id)!;
      this.pendingRequests.delete(id);
      if (type === "ERROR" || error) {
        reject(new Error(error || "Worker error occurred."));
      } else {
        resolve(payload as WorkerResponsePayload);
      }
    };
    this.worker.onerror = (error: ErrorEvent) => {
      console.error("Worker error:", error);
    };
  }
  request<T extends WorkerResponsePayload>(
    type: string,
    payload: JSONValue = {},
    transferables: Transferable[] = [],
  ): Promise<T> {
    const id = ++this.requestIdCounter;
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (val: WorkerResponsePayload) => void,
        reject,
      });
      this.worker.postMessage({ type, id, payload }, transferables);
    });
  }
  async init(): Promise<void> {
    return this.request<void>("INIT");
  }
   async loadFile(
     arrayBuffer: ArrayBuffer,
     name: string,
   ): Promise<{
     fileIndex: number;
     name: string;
     objects: UnityObject[];
     hash: Record<string, string>;
   }> {
     return this.request<{
       fileIndex: number;
       name: string;
       objects: UnityObject[];
       hash: Record<string, string>;
     }>("LOAD_FILE", { arrayBuffer, name } as never as JSONValue, [arrayBuffer]);
   }
  async getMeshData(
    fileIndex: number,
    pathId: PathId,
    sourceFileName: string,
    matrix: Float32Array | number[] | null = null,
    normalMatrix: Float32Array | number[] | null = null,
  ): Promise<MeshResponse> {
    const payload = { fileIndex, pathId, sourceFileName, matrix, normalMatrix };
    return this.request<MeshResponse>("GET_MESH_DATA", payload as never as JSONValue);
  }
  async getTextureData(
    fileIndex: number,
    pathId: PathId,
    sourceFileName: string,
  ): Promise<{ raw: Uint8Array | null }> {
    return this.request<{ raw: Uint8Array | null }>("GET_TEXTURE_DATA", {
      fileIndex,
      pathId,
      sourceFileName,
    } as never as JSONValue);
  }
}
export const workerClient = new WorkerClient();
