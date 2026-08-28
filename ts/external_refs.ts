import type { AssetInfo, LoadedFile, JSONValue } from "./types";
export interface RefTarget {
  fileName: string | null;
  known: boolean;
}
export interface ExternalRefIndex {
  resolve(
    ownerFileName: string,
    ownerPathId: string,
    fileId: number,
  ): RefTarget;
}
const UNKNOWN: RefTarget = { fileName: null, known: false };
export const buildExternalRefIndex = (
  files: LoadedFile[],
): ExternalRefIndex => {
  const fileNameByCab = new Map<string, string>();
  const infoByFileName = new Map<string, AssetInfo>();
  files.forEach((f) => {
    const fileName = f?.name;
    const info = f?.assetInfo;
    if (!fileName || !info || !info.assets) return;
    infoByFileName.set(fileName, info);
    Object.keys(info.assets).forEach((cabName) => {
      fileNameByCab.set(cabName.toLowerCase(), fileName);
    });
  });
  return {
    resolve(ownerFileName, ownerPathId, fileId) {
      if (!fileId)
        return ownerFileName
          ? { fileName: ownerFileName, known: true }
          : UNKNOWN;
      const info = infoByFileName.get(ownerFileName);
      if (!info) return UNKNOWN;
      const assetNames = Object.keys(info.assets);
      const ownerAsset =
        info.object_assets?.[String(ownerPathId)] ||
        (assetNames.length === 1 ? assetNames[0] : "");
      if (!ownerAsset) return UNKNOWN;
      const externalName = (info.assets[ownerAsset] || [])[fileId - 1];
      if (!externalName) return UNKNOWN;
      return {
        fileName: fileNameByCab.get(externalName.toLowerCase()) || null,
        known: true,
      };
    },
  };
};
export const getPointerFileId = (
  ptr: Record<string, JSONValue> | undefined | null,
): number => {
  if (!ptr) return 0;
  const raw = ptr.file_id ?? ptr.m_FileID;
  const fileId = Number(raw);
  return Number.isFinite(fileId) && fileId > 0 ? fileId : 0;
};
export const getPointerPathId = (
  ptr: Record<string, JSONValue> | undefined | null,
): string => {
  if (!ptr) return "";
  return String(ptr.path_id ?? ptr.m_PathID ?? "");
};
