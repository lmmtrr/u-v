import type { LoadedFile } from "../../types";
import type { UnrealFileData } from "./types";

export const unrealData = (file: LoadedFile): UnrealFileData | undefined =>
  file.engineData as UnrealFileData | undefined;
