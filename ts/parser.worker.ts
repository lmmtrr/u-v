import init from "../pkg/u_v.js";
import type { WorkerHandler, WorkerHandlers } from "./worker_protocol";
import { unityHandlers } from "./engines/unity/worker_handlers";
import { unrealHandlers } from "./engines/unreal/worker_handlers";
interface WorkerMessagePayload {
  type: string;
  id: number;
  payload?: unknown;
  error?: string;
}
interface WebWorkerGlobalScope {
  postMessage(message: WorkerMessagePayload, transferables?: Transferable[]): void;
}
const handlers: WorkerHandlers = {
  INIT: () => {},
  ...unityHandlers,
  ...unrealHandlers,
};
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
  const { type, id, payload } = event.data as { type: string; id: number; payload: unknown };
  try {
    const handler = handlers[type] as ((payload: unknown) => ReturnType<WorkerHandler>) | undefined;
    if (!handler) throw new Error(`Unknown message type: ${type}`);
    const reply = handler(payload) ?? {};
    ctx.postMessage({ type: `${type}_SUCCESS`, id, payload: reply.payload }, reply.transfer ?? []);
  } catch (error) {
    ctx.postMessage({
      type: "ERROR",
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
