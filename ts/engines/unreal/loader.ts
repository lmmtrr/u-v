import { unrealWorker } from "./worker_api";
import { updateProgress } from "../../progress";
import { showNotification } from "../../ui";
import type { UnityObject, ViewerState } from "../../types";
import type { UnrealFileData } from "./types";
import { filePath } from "../../drop_files";
import { hasSoftParts } from "./physics";

const MAPPINGS_EXTENSION = /\.usmap$/i;

let rememberedMappings: File | null = null;

const commonFolderName = (paths: string[]): string => {
  const first = paths[0]?.split("/") ?? [];
  return first.length > 1 && paths.every((p) => p.split("/")[0] === first[0])
    ? first[0]
    : "Unreal assets";
};

export const loadUnrealFiles = async (
  dropped: File[],
  state: ViewerState,
  engine: string,
): Promise<boolean> => {
  const mappings = dropped.filter((f) => MAPPINGS_EXTENSION.test(f.name)).pop();
  if (mappings) rememberedMappings = mappings;
  const packages = dropped.filter((f) => !MAPPINGS_EXTENSION.test(f.name));
  if (packages.length === 0) {
    showNotification(`Loaded ${mappings?.name}. Now drop the Unreal assets that need it.`, "success");
    return false;
  }
  const files = rememberedMappings ? [...packages, rememberedMappings] : packages;
  updateProgress(10, "Reading Unreal Packages...", `${packages.length} files`);
  const payload = await Promise.all(
    files.map(async (file) => ({ path: filePath(file), arrayBuffer: await file.arrayBuffer() })),
  );
  const paths = payload.filter((f) => !MAPPINGS_EXTENSION.test(f.path)).map((f) => f.path);
  updateProgress(30, "Parsing Unreal Packages...", "Reading meshes");
  let result;
  try {
    result = await unrealWorker.loadFiles(payload);
  } catch (err) {
    showNotification(`Failed to read Unreal packages: ${err instanceof Error ? err.message : String(err)}`, "error");
    return false;
  }
  const { envId, meshes, sockets, textures, animations, errors, needsMappings } = result;
  errors.forEach((e) => console.warn("[unreal]", e));
  if (needsMappings) {
    showNotification(
      "These packages were cooked with unversioned properties. Drop the game's .usmap mappings file to load their materials, textures, sockets and physics.",
      "error",
    );
  }
  if (meshes.length === 0 && (sockets.length > 0 || animations.length > 0)) {
    const engineData: UnrealFileData = { envId, meshes: [], sockets, textures: [], animations };
    state.loadedFiles.push({
      name: commonFolderName(paths),
      engine,
      engineData,
      objects: [],
      idSuffix: "",
    });
    showNotification(
      `Loaded ${animations.length} animation(s) and ${sockets.length} socket(s).`,
      "success",
    );
    return true;
  }
  if (meshes.length === 0) {
    showNotification(
      errors.length > 0
        ? `No mesh could be read: ${errors[0]}`
        : "No SkeletalMesh or StaticMesh was found. Drop the folder containing the .uasset and .uexp files.",
      "error",
    );
    return false;
  }
  if (errors.length > 0) {
    showNotification(`${errors.length} Unreal package(s) could not be read. See the console for details.`, "error");
  }
  const objects: UnityObject[] = meshes.map((m) => ({
    [m.isStatic ? "MeshRenderer" : "SkinnedMeshRenderer"]: {
      path_id: m.id,
      name: m.name,
      m_Enabled: true,
      texture_path_ids: [],
    },
  }));
  if (meshes.some((m) => hasSoftParts(m.bones, m.physicsBones))) {
    objects.push({ SpringBone: { path_id: `ue:physics:${envId}`, m_Enabled: true, label: "Physics" } });
  }
  const engineData: UnrealFileData = { envId, meshes, sockets, textures, animations };
  state.loadedFiles.push({
    name: commonFolderName(paths),
    engine,
    engineData,
    objects,
    idSuffix: "",
    isExpanded: true,
  });
  return true;
};
