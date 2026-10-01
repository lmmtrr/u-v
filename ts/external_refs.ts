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
  assetName(
    ownerFileName: string,
    ownerPathId: string,
    fileId: number,
  ): string | null;
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
  const getOwnerAsset = (ownerFileName: string, ownerPathId: string) => {
    const info = infoByFileName.get(ownerFileName);
    if (!info) return null;
    const assetNames = Object.keys(info.assets);
    const ownerAsset =
      info.object_assets?.[String(ownerPathId)] ||
      (assetNames.length === 1 ? assetNames[0] : "");
    return ownerAsset ? { info, ownerAsset } : null;
  };
  const getAssetName = (
    ownerFileName: string,
    ownerPathId: string,
    fileId: number,
  ): string | null => {
    const owner = getOwnerAsset(ownerFileName, ownerPathId);
    if (!owner) return null;
    const name = fileId
      ? (owner.info.assets[owner.ownerAsset] || [])[fileId - 1]
      : owner.ownerAsset;
    return name ? name.toLowerCase() : null;
  };
  return {
    assetName: getAssetName,
    resolve(ownerFileName, ownerPathId, fileId) {
      if (!fileId)
        return ownerFileName
          ? { fileName: ownerFileName, known: true }
          : UNKNOWN;
      const externalName = getAssetName(ownerFileName, ownerPathId, fileId);
      if (!externalName) return UNKNOWN;
      return {
        fileName: fileNameByCab.get(externalName) || null,
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
