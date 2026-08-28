import type { LoadedFile, UnityObject, JSONValue } from "./types";
import { getPointerFileId } from "./external_refs";
export const getRawPathId = (
  data: Record<string, JSONValue> | undefined | null,
): string => {
  if (!data) return "";
  return String(data.raw_path_id ?? data.path_id ?? "");
};
const isPointer = (value: unknown): value is Record<string, JSONValue> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Record<string, JSONValue>;
  return (
    node.path_id !== undefined &&
    (node.m_PathID !== undefined ||
      node.file_id !== undefined ||
      node.m_FileID !== undefined)
  );
};
const suffixLocalPointers = (value: JSONValue, suffix: string): void => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === "number") return;
    value.forEach((entry) => suffixLocalPointers(entry, suffix));
    return;
  }
  const node = value as Record<string, JSONValue>;
  if (isPointer(node)) {
    if (getPointerFileId(node) === 0) {
      const pathId = String(node.path_id ?? node.m_PathID ?? "");
      if (pathId && pathId !== "0") {
        node.path_id = pathId + suffix;
        if (node.m_PathID !== undefined) node.m_PathID = pathId + suffix;
      }
    }
    return;
  }
  Object.keys(node).forEach((key) => suffixLocalPointers(node[key], suffix));
};
const suffixFlatIds = (
  data: Record<string, JSONValue>,
  suffix: string,
): void => {
  if (
    data.mesh_path_id !== undefined &&
    Number(data.mesh_file_id ?? 0) === 0
  ) {
    const meshId = String(data.mesh_path_id);
    if (meshId && meshId !== "0") data.mesh_path_id = meshId + suffix;
  }
  const boneIds = data.bone_path_ids;
  if (Array.isArray(boneIds)) {
    const boneFileIds = Array.isArray(data.bone_file_ids)
      ? (data.bone_file_ids as JSONValue[])
      : null;
    data.bone_path_ids = boneIds.map((boneId, i) => {
      if (boneFileIds && Number(boneFileIds[i] ?? 0) !== 0) return boneId;
      const id = String(boneId ?? "");
      return id && id !== "0" ? id + suffix : boneId;
    });
  }
  const textureIds = data.texture_path_ids;
  if (Array.isArray(textureIds)) {
    data.texture_path_ids = textureIds.map((texId) => {
      const id = String(texId ?? "");
      return id && id !== "0" ? id + suffix : texId;
    });
  }
};
const objectData = (
  obj: UnityObject | null | undefined,
): Record<string, JSONValue> | null => {
  if (!obj) return null;
  const type = Object.keys(obj)[0];
  const data = obj[type] as Record<string, JSONValue> | undefined;
  return data && typeof data === "object" ? data : null;
};
const REFERENCED_TYPES = new Set([
  "GameObject",
  "Transform",
  "Mesh",
  "MeshFilter",
  "MeshRenderer",
  "SkinnedMeshRenderer",
  "Material",
  "Texture2D",
  "AnimationClip",
  "Animator",
  "Avatar",
  "SpringBone",
  "DynamicBone",
]);
const collectRawIds = (file: LoadedFile): string[] => {
  const ids: string[] = [];
  file.objects.forEach((obj) => {
    if (!obj || !REFERENCED_TYPES.has(Object.keys(obj)[0])) return;
    const id = getRawPathId(objectData(obj));
    if (id && id !== "0") ids.push(id);
  });
  return ids;
};
export const normalizeLoadedFileIds = (files: LoadedFile[]): void => {
  const ownerByRawId = new Map<string, string>();
  const claim = (file: LoadedFile, ids: string[]) => {
    ids.forEach((id) => {
      if (!ownerByRawId.has(id)) ownerByRawId.set(id, String(file.name || ""));
    });
  };
  files.forEach((file) => {
    if (file.idSuffix !== undefined) claim(file, collectRawIds(file));
  });
  files.forEach((file, index) => {
    if (file.idSuffix !== undefined) return;
    const rawIds = collectRawIds(file);
    const fileName = String(file.name || "");
    const collides = rawIds.some((id) => {
      const owner = ownerByRawId.get(id);
      return owner !== undefined && owner !== fileName;
    });
    const suffix = collides ? `@${file.fileIndex ?? index}` : "";
    if (suffix) {
      file.objects.forEach((obj) => {
        const data = objectData(obj);
        if (!data) return;
        const rawId = String(data.path_id ?? "");
        Object.keys(data).forEach((key) => {
          if (key !== "path_id") suffixLocalPointers(data[key], suffix);
        });
        suffixFlatIds(data, suffix);
        if (rawId && rawId !== "0") {
          data.raw_path_id = rawId;
          data.path_id = rawId + suffix;
        }
      });
    }
    file.idSuffix = suffix;
    claim(file, rawIds);
  });
};
