import type { JSONValue } from "./types";
class WorkerClient {
  private worker: Worker;
  private pendingRequests: Map<
    number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
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
        payload?: unknown;
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
        resolve(payload);
      }
    };
    this.worker.onerror = (error: ErrorEvent) => {
      console.error("Worker error:", error);
      const message = error.message || "Worker crashed.";
      this.pendingRequests.forEach(({ reject }) => reject(new Error(message)));
      this.pendingRequests.clear();
    };
  }
  request<T>(
    type: string,
    payload: JSONValue = {},
    transferables: Transferable[] = [],
  ): Promise<T> {
    const id = ++this.requestIdCounter;
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject,
      });
      this.worker.postMessage({ type, id, payload }, transferables);
    });
  }
  async init(): Promise<void> {
    return this.request<void>("INIT");
  }
}
export const workerClient = new WorkerClient();
