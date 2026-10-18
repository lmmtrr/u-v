export interface WorkerReply {
  payload?: unknown;
  transfer?: Transferable[];
}
export type WorkerHandler = (payload: never) => WorkerReply | void;
export type WorkerHandlers = Record<string, WorkerHandler>;
