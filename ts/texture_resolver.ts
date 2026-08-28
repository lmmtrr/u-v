import type { TextureMeta, MeshMeta, UnityObject, JSONValue } from "./types";
import { pickBestMesh } from "./renderer_utils";
import {
  getPointerFileId,
  getPointerPathId,
  type ExternalRefIndex,
} from "./external_refs";
export const isValidPathId = (id: string | number | null | undefined) =>
  id !== undefined && id !== null && String(id) !== "0";
export function resolveRendererTextures(
  objects: UnityObject[],
  lookup: {
    gameObjects: Map<string, UnityObject>;
    transformsByGo: Map<string, UnityObject>;
    meshes: Map<string, MeshMeta[]>;
    textures: Map<string, TextureMeta>;
    materials: Map<string, UnityObject>;
    renderersByGo: Map<string, UnityObject>;
    filtersByGo: Map<string, UnityObject>;
    texturesByFile?: Map<string, Map<string, TextureMeta>>;
    materialsByFile?: Map<string, Map<string, UnityObject>>;
    meshesByFile?: Map<string, Map<string, MeshMeta[]>>;
    externalRefs?: ExternalRefIndex;
  },
) {
  const resolveRef = <T>(
    ptr: Record<string, JSONValue> | undefined | null,
    owner: Record<string, JSONValue> | undefined | null,
    byFile: Map<string, Map<string, T>> | undefined,
    global: Map<string, T>,
  ): T | null => {
    const pathId = getPointerPathId(ptr);
    if (!isValidPathId(pathId)) return null;
    const fileId = getPointerFileId(ptr);
    const ownerFile = String(owner?.sourceFileName || "");
    const target = lookup.externalRefs?.resolve(
      ownerFile,
      String(owner?.path_id || ""),
      fileId,
    );
    if (target?.known) {
      const hit = target.fileName
        ? byFile?.get(target.fileName)?.get(pathId)
        : undefined;
      if (hit) return hit;
      if (fileId !== 0) return null;
    }
    return global.get(pathId) || null;
  };
  objects.forEach((obj) => {
    const renderer = (obj?.SkinnedMeshRenderer || obj?.MeshRenderer) as Record<string, JSONValue> | undefined;
    if (!renderer) return;
    const goIdStr = String((renderer.m_GameObject as Record<string, JSONValue> | undefined)?.path_id || "");
    const filter = lookup.filtersByGo.get(goIdStr);
    const filterMesh = filter?.m_Mesh as Record<string, JSONValue> | undefined;
    const rendererMeshId = String(renderer.mesh_path_id || "");
    const meshPtr: Record<string, JSONValue> = rendererMeshId
      ? { path_id: rendererMeshId, file_id: Number(renderer.mesh_file_id ?? 0) }
      : filterMesh || {};
    const meshOwner = rendererMeshId ? renderer : filter || renderer;
    if (!renderer.mesh) {
      const meshCandidates = resolveRef<MeshMeta[]>(
        meshPtr,
        meshOwner,
        lookup.meshesByFile,
        lookup.meshes as Map<string, MeshMeta[]>,
      );
      renderer.mesh = pickBestMesh(meshCandidates) as never as JSONValue;
    }
    const rendererMaterials = (renderer.m_Materials || []) as Array<Record<string, JSONValue>>;
    renderer.textures = rendererMaterials.map((matPtr) => {
      const material = resolveRef<UnityObject>(
        matPtr,
        renderer,
        lookup.materialsByFile,
        lookup.materials,
      );
      if (material) {
        let texEnvs: Record<string, JSONValue> | Array<Record<string, JSONValue>> | null =
          (material.m_SavedProperties as Record<string, JSONValue> | undefined)?.m_TexEnvs as Record<string, JSONValue> | Array<Record<string, JSONValue>> | null || null;
        if (!texEnvs) return null;
        if (Array.isArray(texEnvs)) {
          const normalized: Record<string, JSONValue> = {};
          for (const entry of texEnvs) {
            if (entry?.first && entry.second)
              normalized[String(entry.first)] = entry.second;
          }
          texEnvs = normalized;
        }
        const propNames = [
          "_MainTex",
          "_BaseMap",
          "_BaseColorMap",
          "_Tex",
          "_MainTexture",
          "_MainTexture2D",
          "_BaseTexture",
          "_Diffuse",
          "_DiffuseMap",
          "_IrisTex",
        ];
        let bestTexEnv: Record<string, JSONValue> | null = null;
        for (const propName of propNames) {
          const texEnv = (texEnvs as Record<string, JSONValue>)[propName] as Record<string, JSONValue> | undefined;
          if (texEnv && isValidPathId((texEnv.m_Texture as Record<string, JSONValue> | undefined)?.path_id as string | undefined)) {
            bestTexEnv = texEnv;
            break;
          }
        }
        if (!bestTexEnv) {
          const entries: Array<[string, JSONValue]> = Object.entries(texEnvs as Record<string, JSONValue>);
          for (const [propName, rawTexEnv] of entries) {
            const texEnv = rawTexEnv as Record<string, JSONValue> | undefined;
            if (texEnv && isValidPathId((texEnv.m_Texture as Record<string, JSONValue> | undefined)?.path_id as string | undefined)) {
              const lowerName = propName.toLowerCase();
              if (
                lowerName.includes("iris") ||
                lowerName.includes("eye") ||
                lowerName.includes("albedo") ||
                lowerName.includes("diff") ||
                lowerName.includes("color")
              ) {
                bestTexEnv = texEnv;
                break;
              }
              if (
                !bestTexEnv &&
                !lowerName.includes("mask") &&
                !lowerName.includes("dissolve") &&
                !lowerName.includes("bump") &&
                !lowerName.includes("normal") &&
                !lowerName.includes("spec") &&
                !lowerName.includes("cube")
              ) {
                bestTexEnv = texEnv;
              }
            }
          }
        }
        if (bestTexEnv) {
          const texTexture = bestTexEnv.m_Texture as Record<string, JSONValue> | undefined;
          const tex = resolveRef<TextureMeta>(
            texTexture,
            material,
            lookup.texturesByFile,
            lookup.textures,
          );
          if (tex) {
            return {
              texture: tex,
              scale: bestTexEnv.m_Scale || { x: 1.0, y: 1.0 },
              offset: bestTexEnv.m_Offset || { x: 0.0, y: 0.0 },
            };
          }
        }
      }
      return null;
    }) as never as JSONValue;
    const rendererTextures = renderer.textures as Array<{ texture: TextureMeta; scale: { x: number; y: number }; offset: { x: number; y: number } } | null> | undefined;
    const texturePathIds = renderer.texture_path_ids as string[] | undefined;
    if (
      (!rendererTextures || rendererTextures.every((t) => t === null)) &&
      texturePathIds && texturePathIds.length > 0
    ) {
      renderer.textures = texturePathIds.map((texId) => {
        const texIdStr = String(texId);
        const tex = resolveRef<TextureMeta>(
          { path_id: texIdStr },
          renderer,
          lookup.texturesByFile,
          lookup.textures,
        );
        return tex
          ? {
              texture: tex,
              scale: { x: 1.0, y: 1.0 },
              offset: { x: 0.0, y: 0.0 },
            }
          : null;
      }) as never as JSONValue;
    }
    const go = lookup.gameObjects.get(goIdStr);
    const finalTextures = renderer.textures as Array<{ texture: TextureMeta; scale: { x: number; y: number }; offset: { x: number; y: number } } | null> | undefined;
    if (!finalTextures || finalTextures.every((t) => t === null)) {
      const searchNames = [
        String(renderer.name || "").toLowerCase(),
        String(go?.name || "").toLowerCase(),
        String((renderer.mesh as Record<string, JSONValue> | undefined)?.name || "").toLowerCase(),
        String(renderer.sourceFileName || "").toLowerCase(),
      ].filter((n) => n.length > 0);
      const rendererCategory = (() => {
        const names = [
          String(renderer.name || "").toLowerCase(),
          String(go?.name || "").toLowerCase(),
          String((renderer.mesh as Record<string, JSONValue> | undefined)?.name || "").toLowerCase(),
        ];
        for (const n of names) {
          if (n.includes("weapon") || n.includes("wpn")) return "weapon";
          if (n.includes("body")) return "body";
          if (
            n.includes("head") ||
            n.includes("face") ||
            n.includes("eye") ||
            n.includes("mouth") ||
            n.includes("hair")
          )
            return "head_parts";
        }
        return "other";
      })();
      let bestTex: TextureMeta | null = null;
      let maxScore = 0;
      const rendererFile = String(renderer.sourceFileName || "");
      const preferOnTie = (candidate: TextureMeta) => {
        if (!bestTex) return true;
        return String(candidate.path_id) < String(bestTex.path_id);
      };
      lookup.textures.forEach((tex: TextureMeta) => {
        const texName = String(tex?.name || tex?.m_Name || "").toLowerCase();
        if (!texName || tex.path_id === undefined || tex.path_id === null) return;
        const texCategory = (() => {
          if (texName.includes("weapon") || texName.includes("wpn"))
            return "weapon";
          if (texName.includes("body")) return "body";
          if (
            texName.includes("head") ||
            texName.includes("face") ||
            texName.includes("eye") ||
            texName.includes("mouth") ||
            texName.includes("hair")
          )
            return "head_parts";
          return "other";
        })();
        if (
          rendererCategory !== "other" &&
          texCategory !== "other" &&
          rendererCategory !== texCategory
        ) {
          return;
        }
        for (const sName of searchNames) {
          const idMatch =
            sName.match(/[a-z]{2,8}_?\d{4,8}(_\d{2,4})?/) ||
            sName.match(/[a-z]{2,8}_?\d{4,8}/);
          const id = idMatch
            ? idMatch[0]
            : sName.replace(/^(pfb|tex|mdl|mat)_/, "");
          if (texName.includes(id) || id.includes(texName)) {
            let score = id === texName ? 100 : 50;
            for (const sn of searchNames) {
              if (sn === String(renderer.sourceFileName || "").toLowerCase())
                continue;
              const part = sn.replace(/^m_/, "");
              if (part.length > 2 && texName.includes(part)) {
                score += 40;
                break;
              }
            }
            if (rendererFile && String(tex.sourceFileName || "") === rendererFile) {
              score += 10;
            }
            if (score > maxScore || (score === maxScore && preferOnTie(tex))) {
              maxScore = score;
              bestTex = tex;
            }
          }
        }
      });
      if (bestTex) {
        renderer.textures = [
          {
            texture: bestTex,
            scale: { x: 1.0, y: 1.0 },
            offset: { x: 0.0, y: 0.0 },
            isFallback: true,
          },
        ] as never as JSONValue;
      }
    }
  });
}
