import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { Material } from "@babylonjs/core/Materials/material";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Observer } from "@babylonjs/core/Misc/observable";

import type { OutlineWidthUnit } from "./unity_toon";

const OUTLINE_PIXELS_PER_UNIT = 0.6;

export interface UnityOutline {
  unit: OutlineWidthUnit;
  width: number;
  color: Color3;
}

export const getMaterialOutline = (
  material: Material | null | undefined,
): UnityOutline | null => {
  const outline = material?.metadata?.unityOutline as UnityOutline | undefined;
  if (!outline || material!.alpha < 1) return null;
  return outline;
};

class OutlineHullPlugin extends MaterialPluginBase {
  public unit: OutlineWidthUnit = "pixels";
  public width = 0;
  public color = new Color3();

  constructor(material: Material) {
    super(material, "UnityOutlineHull", 300, { UNITY_OUTLINE_HULL: false });
    this._enable(true);
  }

  public override getClassName(): string {
    return "OutlineHullPlugin";
  }

  public override prepareDefines(defines: MaterialDefines): void {
    defines["UNITY_OUTLINE_HULL"] = true;
  }

  public override getUniforms() {
    return {
      ubo: [
        { name: "outlineOffset", size: 1, type: "float" },
        { name: "outlineColor", size: 3, type: "vec3" },
      ],
      vertex: `#ifdef UNITY_OUTLINE_HULL
uniform float outlineOffset;
#endif`,
      fragment: `#ifdef UNITY_OUTLINE_HULL
uniform vec3 outlineColor;
#endif`,
    };
  }

  public override bindForSubMesh(
    uniformBuffer: UniformBuffer,
    scene: Scene,
    engine: AbstractEngine,
    subMesh: SubMesh,
  ): void {
    const camera = scene.activeCamera;
    let offset = this.unit === "world" ? this.width : 0;
    if (camera && this.unit !== "world") {
      const center = subMesh.getMesh().getBoundingInfo()
        .boundingSphere.centerWorld;
      const distance = camera.globalPosition.subtract(center).length();
      const halfScreenWorld = distance * Math.tan(camera.fov / 2);
      offset =
        this.unit === "screen"
          ? this.width * halfScreenWorld
          : (this.width * OUTLINE_PIXELS_PER_UNIT * 2 * halfScreenWorld) /
            Math.max(1, engine.getRenderHeight());
    }
    uniformBuffer.updateFloat("outlineOffset", offset);
    uniformBuffer.updateColor3("outlineColor", this.color);
  }

  public override getCustomCode(
    shaderType: string,
  ): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return {
        CUSTOM_VERTEX_UPDATE_POSITION: `
#if defined(UNITY_OUTLINE_HULL) && defined(NORMAL)
positionUpdated += normalize(normalUpdated) * outlineOffset;
#endif`,
      };
    }
    return {
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
#ifdef UNITY_OUTLINE_HULL
color = vec4(outlineColor, 1.0);
#endif`,
    };
  }
}

const windsAlongNormals = (mesh: Mesh): boolean => {
  const positions = mesh.getVerticesData("position");
  const normals = mesh.getVerticesData("normal");
  const indices = mesh.getIndices();
  if (!positions || !normals || !indices || indices.length < 3) return true;
  const triangles = Math.floor(indices.length / 3);
  const step = Math.max(1, Math.floor(triangles / 500));
  let score = 0;
  for (let t = 0; t < triangles; t += step) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = normals[a] + normals[b] + normals[c];
    const ny = normals[a + 1] + normals[b + 1] + normals[c + 1];
    const nz = normals[a + 2] + normals[b + 2] + normals[c + 2];
    score += Math.sign(
      (uy * vz - uz * vy) * nx +
        (uz * vx - ux * vz) * ny +
        (ux * vy - uy * vx) * nz,
    );
  }
  return score >= 0;
};

const createHullMaterial = (
  scene: Scene,
  name: string,
  outline: UnityOutline,
  windsAlong: boolean,
): StandardMaterial => {
  const mat = new StandardMaterial(name, scene);
  mat.backFaceCulling = true;
  mat.cullBackFaces = windsAlong;
  mat.zOffset = 1;
  mat.zOffsetUnits = 4;
  mat.specularColor = new Color3(0, 0, 0);
  const plugin = new OutlineHullPlugin(mat);
  plugin.unit = outline.unit;
  plugin.width = outline.width;
  plugin.color = outline.color;
  return mat;
};

interface Hull {
  hull: Mesh;
  subMeshMap: Map<SubMesh, SubMesh>;
  observer: Observer<Scene> | null;
}
const hulls = new Map<Mesh, Hull>();

const createHull = (scene: Scene, mesh: Mesh): Hull | null => {
  const source = mesh.material;
  const subMaterials =
    source instanceof MultiMaterial ? source.subMaterials : [source];
  const outlines = subMaterials.map((material) => getMaterialOutline(material));
  if (outlines.every((o) => !o)) return null;
  const windsAlong = windsAlongNormals(mesh);
  const hullMaterials = outlines.map((outline, i) =>
    outline
      ? createHullMaterial(
          scene,
          `${mesh.name}_outline_${i}`,
          outline,
          windsAlong,
        )
      : null,
  );
  const hull = mesh.clone(`${mesh.name}_outline`, mesh.parent, true);
  hull.metadata = { isOutlineHull: true };
  hull.isPickable = false;
  hull.alwaysSelectAsActiveMesh = true;
  if (source instanceof MultiMaterial) {
    const multi = new MultiMaterial(`${mesh.name}_outline`, scene);
    multi.subMaterials = hullMaterials;
    hull.material = multi;
  } else {
    hull.material = hullMaterials[0];
  }
  const originals: SubMesh[] =
    mesh.metadata?.originalSubMeshes || mesh.subMeshes;
  hull.subMeshes = [];
  const subMeshMap = new Map<SubMesh, SubMesh>();
  originals.forEach((sub) => {
    if (!hullMaterials[source instanceof MultiMaterial ? sub.materialIndex : 0])
      return;
    subMeshMap.set(
      sub,
      new SubMesh(
        sub.materialIndex,
        sub.verticesStart,
        sub.verticesCount,
        sub.indexStart,
        sub.indexCount,
        hull,
      ),
    );
  });
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (mesh.isDisposed()) return;
    hull.setEnabled(mesh.isEnabled());
    hull.isVisible = mesh.isVisible;
    const visible = mesh.subMeshes
      .map((sub) => subMeshMap.get(sub))
      .filter((sub): sub is SubMesh => !!sub);
    if (
      visible.length !== hull.subMeshes.length ||
      visible.some((sub, i) => sub !== hull.subMeshes[i])
    ) {
      hull.subMeshes = visible;
    }
  });
  return { hull, subMeshMap, observer };
};

const disposeHull = (scene: Scene, entry: Hull): void => {
  scene.onBeforeRenderObservable.remove(entry.observer);
  if (!entry.hull.isDisposed()) {
    const material = entry.hull.material;
    entry.hull.dispose(false, false);
    if (material instanceof MultiMaterial) material.dispose(false, false, true);
    else material?.dispose();
  }
};

export const disposeOutlines = (scene: Scene): void => {
  hulls.forEach((entry) => disposeHull(scene, entry));
  hulls.clear();
};

export const applyOutlines = (
  scene: Scene,
  meshes: Mesh[],
  enabled: boolean,
): void => {
  hulls.forEach((entry, mesh) => {
    if (mesh.isDisposed() || !enabled) {
      disposeHull(scene, entry);
      hulls.delete(mesh);
    }
  });
  if (!enabled) return;
  meshes.forEach((mesh) => {
    if (mesh.isDisposed() || hulls.has(mesh)) return;
    const entry = createHull(scene, mesh);
    if (entry) hulls.set(mesh, entry);
  });
};
