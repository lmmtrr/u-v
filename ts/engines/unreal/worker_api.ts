import { workerClient } from "../../worker_client";
import type { JSONValue } from "../../types";
import type { UnrealAnimationSamples, UnrealLoadResult } from "./types";

export const unrealWorker = {
  loadFiles: (files: Array<{ path: string; arrayBuffer: ArrayBuffer }>): Promise<UnrealLoadResult> =>
    workerClient.request<UnrealLoadResult>(
      "LOAD_UNREAL_FILES",
      { files } as never as JSONValue,
      files.map((f) => f.arrayBuffer),
    ),
  freeEnvironment: (envId: number): Promise<void> =>
    workerClient.request<void>("FREE_UNREAL_ENV", { envId }),
  loadAnimation: (envId: number, path: string): Promise<UnrealAnimationSamples> =>
    workerClient.request<UnrealAnimationSamples>("LOAD_UNREAL_ANIMATION", { envId, path }),
};
