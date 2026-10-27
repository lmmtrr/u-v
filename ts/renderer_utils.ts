import { Scene } from "@babylonjs/core/scene";
import { Material } from "@babylonjs/core/Materials/material";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import { findSourceFile } from "./state";
import { unityWorker } from "./engines/unity/worker_api";
import {
  UnityToonPlugin,
  configureUnityToonPlugin,
  getUnityToonMode,
  readUnityOutline,
  unpackUnityNormal,
  usesFaceShadowMap,
  type UnityMaterialInfo,
} from "./unity_toon";
import type { TextureMeta, MeshMeta, PathId, UnityObject } from "./types";
type TextureInfo =
  | TextureMeta
  | {
      texture?: TextureMeta;
      scale?: { x: number; y: number };
      offset?: { x: number; y: number };
      transparent?: boolean | null;
      unity?: UnityMaterialInfo;
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
const ALPHA_OPAQUE_THRESHOLD = 250;
const ALPHA_PIXEL_RATIO = 0.005;
export const hasMeaningfulAlpha = (rgbaBytes: Uint8Array): boolean => {
  const pixels = rgbaBytes.length >> 2;
  if (pixels === 0) return false;
  const needed = Math.max(1, Math.ceil(pixels * ALPHA_PIXEL_RATIO));
  let translucent = 0;
  for (let i = 3; i < rgbaBytes.length; i += 4) {
    if (rgbaBytes[i] < ALPHA_OPAQUE_THRESHOLD && ++translucent >= needed) {
      return true;
    }
  }
  return false;
};
export const toRGBABytes = async (
  texData: TextureMeta | null | undefined,
  allowAlpha?: boolean | null,
): Promise<Uint8Array | null> => {
  const width = texData?.m_Width || 0;
  const height = texData?.m_Height || 0;
  const expected = width * height * 4;
  if (!expected) return null;
  if (!texData?.image_data && texData?.sourceFileName) {
    const file = findSourceFile(texData);
    if (file && file.fileIndex !== undefined) {
      const pathId: PathId = texData.raw_path_id || texData.path_id || "";
        const result = await unityWorker.getTextureData(
          file.fileIndex,
          pathId,
          texData.sourceFileName,
        );
      if (result && result.raw) {
        const raw = result.raw;
        const keepAlpha =
          allowAlpha === false
            ? false
            : allowAlpha === true || hasMeaningfulAlpha(raw);
        if (!keepAlpha) {
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
): MeshMeta | null =>
  pickBestMesh(meshesByPathId.get(String(meshPathId)) || null);
export const pickBestMesh = (
  candidates: MeshMeta[] | null | undefined,
): MeshMeta | null => {
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
  allowAlpha?: boolean | null,
  isNormalMap = false,
): Promise<Texture | null> => {
  if (!texData) return null;
  const alphaKey = allowAlpha === true ? "1" : allowAlpha === false ? "0" : "?";
  const texKeyStr = `${texData.path_id || ""}|${alphaKey}${isNormalMap ? "|n" : ""}`;
  if (textureCache && textureCache.has(texKeyStr)) {
    return textureCache.get(texKeyStr)!;
  }
  const width = texData.m_Width || 0;
  const height = texData.m_Height || 0;
  const maxTexSize = scene?.getEngine()?.getCaps()?.maxTextureSize || 8192;
  if (width > 0 && width <= maxTexSize && height > 0 && height <= maxTexSize) {
    const rgbaBytes = await toRGBABytes(texData, isNormalMap ? true : allowAlpha);
    if (rgbaBytes) {
      if (rgbaBytes.length === width * height * 4) {
        if (isNormalMap) unpackUnityNormal(rgbaBytes);
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
        if (allowAlpha !== false && hasMeaningfulAlpha(rgbaBytes)) {
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
const applyTextureTransform = (
  texture: Texture,
  texInfo: TextureInfo | undefined,
): Texture => {
  if (!hasCustomTransform(texInfo ?? null)) {
    texture.uScale = 1.0;
    texture.vScale = 1.0;
    texture.uOffset = 0.0;
    texture.vOffset = 0.0;
    return texture;
  }
  const custom = texInfo as { scale?: { x: number; y: number }; offset?: { x: number; y: number } };
  const transformed = texture.clone();
  transformed.uScale = custom.scale?.x ?? 1.0;
  transformed.vScale = custom.scale?.y ?? 1.0;
  transformed.uOffset = custom.offset?.x ?? 0.0;
  transformed.vOffset = custom.offset?.y ?? 0.0;
  return transformed;
};
const applyUnityToon = async (
  mat: StandardMaterial,
  texInfo: TextureInfo | undefined,
  scene: Scene,
  textureCache: Map<string, Texture>,
): Promise<void> => {
  const info =
    texInfo && "unity" in texInfo ? (texInfo.unity as UnityMaterialInfo | undefined) : undefined;
  const mode = getUnityToonMode(info);
  if (!info || !mode) return;
  const plugin = new UnityToonPlugin(mat);
  configureUnityToonPlugin(plugin, info, mode);
  if (mode === "additive" || mode === "multiply") {
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    mat.alphaMode = mode === "additive" ? Constants.ALPHA_ADD : Constants.ALPHA_MULTIPLY;
    mat.disableDepthWrite = true;
    return;
  }
  const [ramp, rmo, normal, face] = await Promise.all([
    resolveTexture(info.ramp, scene, textureCache, true),
    resolveTexture(info.rmo, scene, textureCache, false),
    resolveTexture(info.normal, scene, textureCache, false, true),
    usesFaceShadowMap(info) ? resolveTexture(info.blend, scene, textureCache, true) : null,
  ]);
  if (ramp) {
    ramp.wrapU = Texture.CLAMP_ADDRESSMODE;
    ramp.wrapV = Texture.CLAMP_ADDRESSMODE;
    plugin.rampTexture = ramp;
  }
  if (rmo) plugin.rmoTexture = applyTextureTransform(rmo, texInfo);
  if (face) plugin.faceTexture = face;
  if (normal) mat.bumpTexture = applyTextureTransform(normal, texInfo);
  const baseAlpha = (info.colors._BaseColor || info.colors._Color)?.a ?? 1;
  if (info.floats._BlendMode !== undefined && baseAlpha < 0.999) mat.alpha = baseAlpha;
};
const configureMaterial = async (
  mat: StandardMaterial,
  texInfo: TextureInfo | undefined,
  scene: Scene,
  textureCache: Map<string, Texture>,
): Promise<void> => {
  mat.specularColor = new Color3(0, 0, 0);
  mat.specularPower = 0;
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  mat.emissiveColor = new Color3(0.1, 0.1, 0.1);
  const texData =
    texInfo && "texture" in texInfo ? texInfo.texture : (texInfo as TextureMeta | undefined);
  const resolvedTexture = await resolveTexture(
    texData as TextureMeta | undefined,
    scene,
    textureCache,
    texInfo && "transparent" in texInfo ? texInfo.transparent : null,
  );
  if (resolvedTexture) {
    mat.diffuseTexture = applyTextureTransform(resolvedTexture, texInfo);
  }
  await applyUnityToon(mat, texInfo, scene, textureCache);
  const info =
    texInfo && "unity" in texInfo ? (texInfo.unity as UnityMaterialInfo | undefined) : undefined;
  const outline = info ? readUnityOutline(info) : null;
  if (outline) {
    mat.metadata = {
      ...mat.metadata,
      unityOutline: {
        unit: outline.unit,
        width: outline.width,
        color: new Color3(outline.r, outline.g, outline.b),
      },
    };
  }
};
export const createMaterial = async (
  textures: TextureSlot[],
  textureIdsKey: string,
  scene: Scene,
  materialCache: Map<string, Material>,
  textureCache: Map<string, Texture>,
): Promise<StandardMaterial> => {
  const cacheKey = `single|${textureIdsKey}`;
  if (materialCache.has(cacheKey)) {
    return materialCache.get(cacheKey) as StandardMaterial;
  }
  const mat = new StandardMaterial("mat_" + textureIdsKey, scene);
  await configureMaterial(mat, textures[0] as TextureInfo | undefined, scene, textureCache);
  materialCache.set(cacheKey, mat);
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
  const cacheKey = `multi|${subMeshes.length}|${textureIdsKey}`;
  if (materialCache.has(cacheKey)) {
    return materialCache.get(cacheKey) as MultiMaterial;
  }
  const multiMat = new MultiMaterial(
    "multiMat_" + (meshName || "custom"),
    scene,
  );
  for (let si = 0; si < subMeshes.length; si++) {
    const subMat = new StandardMaterial(`mat_${si}`, scene);
    const texInfo =
      (textures[si] as TextureInfo) || (textures[0] as TextureInfo);
    await configureMaterial(subMat, texInfo, scene, textureCache);
    multiMat.subMaterials.push(subMat);
  }
  materialCache.set(cacheKey, multiMat);
  return multiMat;
};
