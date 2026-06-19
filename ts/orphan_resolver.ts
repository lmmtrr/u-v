import type { MeshMeta, UnityObject, JSONValue } from "./types";
interface OrphanLookup {
  meshes: Map<string, MeshMeta[]>;
  materials: Map<string, UnityObject>;
  filtersByGo: Map<string, UnityObject>;
}
export const processOrphanedMeshes = (
  objects: UnityObject[],
  lookup: OrphanLookup,
) => {
  const referencedMeshIds = new Set<string>();
  objects.forEach((obj) => {
    const renderer = (obj?.SkinnedMeshRenderer || obj?.MeshRenderer) as Record<string, JSONValue> | undefined;
    if (renderer) {
      const go = renderer.m_GameObject as Record<string, JSONValue> | undefined;
      const goIdStr = String(go?.path_id || "");
      const filter = goIdStr ? lookup.filtersByGo.get(goIdStr) : undefined;
      const filterMesh = filter?.m_Mesh as Record<string, JSONValue> | undefined;
      const meshId =
        String(renderer.mesh_path_id || "") ||
        String(filterMesh?.path_id || "");
      if (meshId) referencedMeshIds.add(meshId);
    }
  });
  const enableOrphansByDefault = referencedMeshIds.size === 0;
  lookup.meshes.forEach((meshes: MeshMeta[], meshIdStr: string) => {
    if (!referencedMeshIds.has(meshIdStr)) {
      meshes.forEach((mesh) => {
        const meshPathIdStr = mesh.path_id;
        if (!meshPathIdStr) return;
        const dummyRenderer: Record<string, JSONValue> = {
          path_id: `orphan_${meshPathIdStr}`,
          name: mesh.name,
          m_GameObject: { path_id: "0" },
          mesh: mesh as never as JSONValue,
          mesh_path_id: mesh.path_id,
          m_Enabled: enableOrphansByDefault,
          m_Materials: [],
          textures: [],
          isOrphan: true,
        };
        const meshNameLower = (mesh.name || "").toLowerCase();
        if (meshNameLower.includes("face")) {
          let faceMatId: string | null = null;
          let eyeMatId: string | null = null;
          let eyeInfoMatId: string | null = null;
          lookup.materials.forEach((mat: UnityObject) => {
            const matName = String(mat.name || mat.m_Name || "").toLowerCase();
            const matId = String(mat.path_id || "");
            if (matId) {
              if (matName.includes("face") && !matName.includes("outline"))
                faceMatId = matId;
              else if (matName.includes("eye") && !matName.includes("info"))
                eyeMatId = matId;
              else if (matName.includes("eye_info")) eyeInfoMatId = matId;
            }
          });
          const materialsList = dummyRenderer.m_Materials as Record<string, JSONValue>[];
          if (faceMatId)
            materialsList.push({
              path_id: faceMatId,
            });
          if (eyeMatId)
            materialsList.push({
              path_id: eyeMatId,
            });
          if (eyeInfoMatId)
            materialsList.push({
              path_id: eyeInfoMatId,
            });
          if (materialsList.length === 0) {
            lookup.materials.forEach((mat: UnityObject) => {
              if (materialsList.length < 4) {
                const matId = String(mat.path_id || "");
                if (matId) {
                  materialsList.push({
                    path_id: matId,
                  });
                }
              }
            });
          }
        } else {
          let bestMatId: string | null = null;
          let bestScore = -9999;
          lookup.materials.forEach((mat: UnityObject) => {
            const matNameLower = String(mat.name || mat.m_Name || "").toLowerCase();
            let score = 0;
            if (matNameLower === meshNameLower) score += 1000;
            const meshTokens = meshNameLower.split(/[^a-z0-9]+/);
            const matTokens = matNameLower.split(/[^a-z0-9]+/);
            let matches = 0;
            matTokens.forEach((t: string) => {
              if (t.length > 2 && meshTokens.includes(t)) matches++;
            });
            score += matches * 100;
            if (meshTokens.includes("outline") && matTokens.includes("outline"))
              score += 200;
            if (
              !meshTokens.includes("outline") &&
              matTokens.includes("outline")
            )
              score -= 300;
            if (score > bestScore) {
              bestScore = score;
              bestMatId = String(mat.path_id || "");
            }
          });
          const materialsList = dummyRenderer.m_Materials as Record<string, JSONValue>[];
          if (bestMatId) {
            materialsList.push({
              path_id: bestMatId,
            });
          }
        }
        objects.push({ MeshRenderer: dummyRenderer });
      });
    }
  });
};
