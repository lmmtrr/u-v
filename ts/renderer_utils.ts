import { Scene } from "@babylonjs/core/scene";
import { Material } from "@babylonjs/core/Materials/material";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { state } from "./state";
import { workerClient } from "./worker_client";
import type { TextureMeta, MeshMeta, PathId, MeshResponse, UnityObject } from "./types";
type TextureInfo =
  | TextureMeta
  | {
      texture?: TextureMeta;
      scale?: { x: number; y: number };
      offset?: { x: number; y: number };
    }
  | null;
type TextureSlot = TextureInfo;
export const rgbaToDataURL = (
  rgbaBytes: Uint8Array,
  width: number,
  height: number,
 ): string => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const imgData = ctx.createImageData(width, height);
  imgData.data.set(rgbaBytes);
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL("image/png");
};
export const toRGBABytes = async (
  texData: TextureMeta | null | undefined,
): Promise<Uint8Array | null> => {
  const width = texData?.m_Width || 0;
  const height = texData?.m_Height || 0;
  const expected = width * height * 4;
  if (!expected) return null;
  if (!texData?.image_data && texData?.sourceFileName) {
    const file = state.loadedFiles.find(
      (f) => f.name === texData.sourceFileName,
    );
    if (file && file.fileIndex !== undefined) {
      const pathId: PathId = texData.path_id || "";
        const result = await workerClient.getTextureData(
          file.fileIndex,
          pathId,
          texData.sourceFileName,
        );
      if (result && result.raw) {
        const raw = result.raw;
        const texName = (texData.name || texData.m_Name || "").toLowerCase();
        const needsAlpha =
          texName.includes("eye") ||
          texName.includes("iris") ||
          texName.includes("hi") ||
          texName.includes("overlay") ||
          texName.includes("mouth") ||
          texName.includes("brow");
        if (!needsAlpha) {
          for (let i = 3; i < raw.length; i += 4) {
            raw[i] = 255;
          }
        }
        return raw;
      }
    }
  }
  const src = texData?.image_data;
  if (!src) return null;
  if (typeof src === "string") {
    const binaryString = atob(src);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    if (len === expected) return bytes;
    if (len > expected) return bytes.slice(0, expected);
    const out = new Uint8Array(expected);
    out.set(bytes);
    return out;
  }
  if (src.length === expected) return new Uint8Array(src);
  if (src.length > expected) return new Uint8Array(src.slice(0, expected));
  const out = new Uint8Array(expected);
  out.set(src);
  return out;
};
export const pickBestMeshForRenderer = (
  meshPathId: string,
  meshesByPathId: Map<string, MeshMeta[]>,
): MeshMeta | null => {
  const meshPathIdStr = String(meshPathId);
  const candidates = meshesByPathId.get(meshPathIdStr);
  if (!candidates || candidates.length === 0) return null;
  const scored = candidates.map((mesh) => {
    const vertexCount = mesh?.m_VertexCount || 0;
    const hasVertices = vertexCount > 0;
    return { mesh, hasVertices, vertexCount };
  });
  scored.sort((a, b) => {
    if (a.hasVertices !== b.hasVertices) return a.hasVertices ? -1 : 1;
    return b.vertexCount - a.vertexCount;
  });
  return scored[0].mesh;
};
const resolveTexture = async (
  texData: TextureMeta | null | undefined,
  scene: Scene,
  textureCache?: Map<string, Texture>,
): Promise<Texture | null> => {
  if (!texData) return null;
  const texKeyStr = texData.path_id || "";
  if (textureCache && textureCache.has(texKeyStr)) {
    return textureCache.get(texKeyStr)!;
  }
  const width = texData.m_Width || 0;
  const height = texData.m_Height || 0;
  const maxTexSize = scene?.getEngine()?.getCaps()?.maxTextureSize || 8192;
  if (width > 0 && width <= maxTexSize && height > 0 && height <= maxTexSize) {
    const rgbaBytes = await toRGBABytes(texData);
    if (rgbaBytes) {
      if (rgbaBytes.length === width * height * 4) {
        const originalName = texData?.name || texData?.m_Name || "";
        const dataUrl = rgbaToDataURL(rgbaBytes, width, height);
        const texture = Texture.CreateFromBase64String(
          dataUrl,
          originalName || "Texture",
          scene,
          false,
          false,
          Texture.BILINEAR_SAMPLINGMODE,
        );
        texture.name = originalName || "Texture";
        const texName = originalName.toLowerCase();
        if (
          texName.includes("eye") ||
          texName.includes("iris") ||
          texName.includes("hi") ||
          texName.includes("overlay") ||
          texName.includes("mouth") ||
          texName.includes("brow")
        ) {
          texture.hasAlpha = true;
        }
        if (textureCache) textureCache.set(texKeyStr, texture);
        return texture;
      }
    }
  }
  return null;
};
const hasCustomTransform = (texInfo: TextureInfo): boolean => {
  if (!texInfo) return false;
  const scale = texInfo && "scale" in texInfo ? texInfo.scale : undefined;
  const offset = texInfo && "offset" in texInfo ? texInfo.offset : undefined;
  const hasScale = scale && (scale.x !== 1.0 || scale.y !== 1.0);
  const hasOffset = offset && (offset.x !== 0.0 || offset.y !== 0.0);
  return !!(hasScale || hasOffset);
};
export const createMaterial = async (
  textures: TextureSlot[],
  textureIdsKey: string,
  scene: Scene,
  materialCache: Map<string, Material>,
  textureCache: Map<string, Texture>,
): Promise<StandardMaterial> => {
  if (materialCache.has(textureIdsKey)) {
    return materialCache.get(textureIdsKey) as StandardMaterial;
  }
  const mat = new StandardMaterial("mat_" + textureIdsKey, scene);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  mat.emissiveColor = new Color3(0.1, 0.1, 0.1);
  const texInfo = textures[0] as TextureInfo | undefined;
  const texData =
    texInfo && "texture" in texInfo ? texInfo.texture : (texInfo as TextureMeta | undefined);
  const resolvedTexture = await resolveTexture(
    texData as TextureMeta | undefined,
    scene,
    textureCache,
  );
  if (resolvedTexture) {
    let activeTexture = resolvedTexture;
    if (hasCustomTransform(texInfo ?? null)) {
      activeTexture = resolvedTexture.clone();
      const custom = texInfo as { scale?: { x: number; y: number }; offset?: { x: number; y: number } };
      activeTexture.uScale = custom.scale?.x ?? 1.0;
      activeTexture.vScale = custom.scale?.y ?? 1.0;
      activeTexture.uOffset = custom.offset?.x ?? 0.0;
      activeTexture.vOffset = custom.offset?.y ?? 0.0;
    } else {
      activeTexture.uScale = 1.0;
      activeTexture.vScale = 1.0;
      activeTexture.uOffset = 0.0;
      activeTexture.vOffset = 0.0;
    }
    mat.diffuseTexture = activeTexture;
  }
  materialCache.set(textureIdsKey, mat);
  return mat;
};
export const createMultiMaterial = async (
  textures: TextureSlot[],
  textureIdsKey: string,
  subMeshes: Array<UnityObject>,
  meshName: string,
  scene: Scene,
  materialCache: Map<string, Material>,
  textureCache: Map<string, Texture>,
): Promise<MultiMaterial> => {
  if (materialCache.has(textureIdsKey)) {
    return materialCache.get(textureIdsKey) as MultiMaterial;
  }
  const multiMat = new MultiMaterial(
    "multiMat_" + (meshName || "custom"),
    scene,
  );
  for (let si = 0; si < subMeshes.length; si++) {
    const subMat = new StandardMaterial(`mat_${si}`, scene);
    subMat.specularColor = new Color3(0, 0, 0);
    subMat.backFaceCulling = false;
    subMat.twoSidedLighting = true;
    subMat.emissiveColor = new Color3(0.1, 0.1, 0.1);
    const texInfo =
      (textures[si] as TextureInfo) || (textures[0] as TextureInfo);
    const texData =
      texInfo && "texture" in texInfo ? texInfo.texture : (texInfo as TextureMeta | undefined);
    const resolvedTexture = await resolveTexture(
      texData as TextureMeta | undefined,
      scene,
      textureCache,
    );
    if (resolvedTexture) {
      let activeTexture = resolvedTexture;
      if (hasCustomTransform(texInfo ?? null)) {
        activeTexture = resolvedTexture.clone();
        const custom = texInfo as { scale?: { x: number; y: number }; offset?: { x: number; y: number } };
        activeTexture.uScale = custom.scale?.x ?? 1.0;
        activeTexture.vScale = custom.scale?.y ?? 1.0;
        activeTexture.uOffset = custom.offset?.x ?? 0.0;
        activeTexture.vOffset = custom.offset?.y ?? 0.0;
      } else {
        activeTexture.uScale = 1.0;
        activeTexture.vScale = 1.0;
        activeTexture.uOffset = 0.0;
        activeTexture.vOffset = 0.0;
      }
      subMat.diffuseTexture = activeTexture;
    }
    multiMat.subMaterials.push(subMat);
  }
  materialCache.set(textureIdsKey, multiMat);
  return multiMat;
};
