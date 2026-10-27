import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import type { Material } from "@babylonjs/core/Materials/material";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Scene } from "@babylonjs/core/scene";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { DepthRenderer } from "@babylonjs/core/Rendering/depthRenderer";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { JSONValue, TextureMeta } from "./types";

type UnityColor = { r: number; g: number; b: number; a: number };
export interface UnityMaterialInfo {
  name: string;
  keywords: string[];
  floats: Record<string, number>;
  colors: Record<string, UnityColor>;
  normal: TextureMeta | null;
  rmo: TextureMeta | null;
  ramp: TextureMeta | null;
  blend: TextureMeta | null;
}
export type UnityToonMode = "toon" | "additive" | "multiply";

const readPairs = (value: JSONValue | undefined): Record<string, JSONValue> => {
  const out: Record<string, JSONValue> = {};
  if (Array.isArray(value)) {
    for (const entry of value as Array<Record<string, JSONValue>>) {
      if (entry?.first !== undefined) out[String(entry.first)] = entry.second;
    }
  } else if (value && typeof value === "object") {
    Object.assign(out, value as Record<string, JSONValue>);
  }
  return out;
};

export const readUnityMaterialInfo = (
  material: Record<string, JSONValue>,
  texEnvs: Record<string, JSONValue>,
  resolveTex: (
    texEnv: Record<string, JSONValue> | undefined,
  ) => TextureMeta | null,
): UnityMaterialInfo => {
  const saved = material.m_SavedProperties as
    | Record<string, JSONValue>
    | undefined;
  const floats: Record<string, number> = {};
  Object.entries(readPairs(saved?.m_Floats)).forEach(([k, v]) => {
    floats[k] = Number(v);
  });
  const colors: Record<string, UnityColor> = {};
  Object.entries(readPairs(saved?.m_Colors)).forEach(([k, v]) => {
    const c = v as Record<string, JSONValue> | null;
    if (c)
      colors[k] = {
        r: Number(c.r),
        g: Number(c.g),
        b: Number(c.b),
        a: Number(c.a),
      };
  });
  const rawKeywords =
    material.m_ValidKeywords ?? material.m_ShaderKeywords ?? [];
  const keywords = Array.isArray(rawKeywords)
    ? rawKeywords.map(String)
    : String(rawKeywords).split(/\s+/).filter(Boolean);
  const tex = (name: string) =>
    resolveTex(texEnvs[name] as Record<string, JSONValue> | undefined);
  return {
    name: String(material.name || material.m_Name || ""),
    keywords,
    floats,
    colors,
    normal: tex("_BumpMap"),
    rmo: tex("_RMOTex"),
    ramp: tex("_RampMap"),
    blend: tex("_BlendTex"),
  };
};

export const getUnityToonMode = (
  info: UnityMaterialInfo | null | undefined,
): UnityToonMode | null => {
  if (!info) return null;
  if (info.ramp) return "toon";
  if (/eye/i.test(info.name)) {
    if (/add$/i.test(info.name)) return "additive";
    if (/mul$/i.test(info.name)) return "multiply";
  }
  return null;
};

const OUTLINE_WIDTH_PROPS: Array<[name: string, scale: number]> = [
  ["_OutlineWidth", 1],
  ["_Outline_Width", 1],
  ["_Outline_Value", 10],
];
const OUTLINE_COLOR_PROPS = ["_OutlineColor", "_Outline_Color"];
const OUTLINE_KEYWORDS = ["OUTLINE_ON", "_OUTLINE_ON"];

export type OutlineWidthUnit = "pixels" | "world" | "screen";
export interface UnityOutlineSettings {
  unit: OutlineWidthUnit;
  width: number;
  r: number;
  g: number;
  b: number;
}

const MTOON_OUTLINE_UNITS: Record<number, OutlineWidthUnit> = {
  1: "world",
  2: "screen",
};

export const readUnityOutline = (
  info: UnityMaterialInfo,
): UnityOutlineSettings | null => {
  const flag = info.floats._EnableOutline ?? info.floats._UseOutline;
  const keywordOn = info.keywords.some((kw) => OUTLINE_KEYWORDS.includes(kw));
  if (flag !== undefined && flag <= 0 && !keywordOn) return null;
  const colorProp = OUTLINE_COLOR_PROPS.find((name) => info.colors[name]);
  const color = colorProp ? info.colors[colorProp] : { r: 0, g: 0, b: 0, a: 1 };
  const mtoonMode = info.floats._OutlineWidthMode;
  if (mtoonMode !== undefined) {
    const unit = MTOON_OUTLINE_UNITS[mtoonMode];
    const width = (info.floats._OutlineWidth ?? 0) * 0.01;
    if (!unit || !(width > 0)) return null;
    return { unit, width, r: color.r, g: color.g, b: color.b };
  }
  const widthProp = OUTLINE_WIDTH_PROPS.find(
    ([name]) => info.floats[name] !== undefined,
  );
  if (!widthProp) return null;
  const width = info.floats[widthProp[0]] * widthProp[1];
  if (!(width > 0)) return null;
  return { unit: "pixels", width, r: color.r, g: color.g, b: color.b };
};

export const unpackUnityNormal = (rgba: Uint8Array): void => {
  for (let i = 0; i < rgba.length; i += 4) {
    const packed = rgba[i] > 250;
    const x = (packed ? rgba[i + 3] : rgba[i]) / 127.5 - 1;
    const y = rgba[i + 1] / 127.5 - 1;
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    rgba[i] = Math.round((x + 1) * 127.5);
    rgba[i + 1] = Math.round((y + 1) * 127.5);
    rgba[i + 2] = Math.round((z + 1) * 127.5);
    rgba[i + 3] = 255;
  }
};

const RAMP_BAND_V = { default: 2 / 16, skin: 6 / 16 };

interface FaceFrame {
  forward: Vector3;
  right: Vector3;
}
const faceFrames = new WeakMap<AbstractMesh, FaceFrame | null>();

const computeFaceFrame = (
  mesh: AbstractMesh,
  material: Material,
): FaceFrame | null => {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  const uv2 = mesh.getVerticesData(VertexBuffer.UV2Kind);
  const indices = mesh.getIndices();
  if (!positions || !normals || !uv2 || !indices) return null;
  const subMeshes: SubMesh[] =
    mesh.metadata?.originalSubMeshes || mesh.subMeshes;
  const used = new Set<number>();
  subMeshes.forEach((sub) => {
    if (sub.getMaterial() !== material) return;
    for (let i = sub.indexStart; i < sub.indexStart + sub.indexCount; i++)
      used.add(indices[i]);
  });
  if (used.size < 3) return null;
  const mean = new Vector3();
  let meanU = 0;
  let meanV = 0;
  used.forEach((v) => {
    mean.addInPlaceFromFloats(
      positions[v * 3],
      positions[v * 3 + 1],
      positions[v * 3 + 2],
    );
    meanU += uv2[v * 2];
    meanV += uv2[v * 2 + 1];
  });
  mean.scaleInPlace(1 / used.size);
  meanU /= used.size;
  meanV /= used.size;
  const right = new Vector3();
  const up = new Vector3();
  const normal = new Vector3();
  used.forEach((v) => {
    const dx = positions[v * 3] - mean.x;
    const dy = positions[v * 3 + 1] - mean.y;
    const dz = positions[v * 3 + 2] - mean.z;
    const du = uv2[v * 2] - meanU;
    const dv = uv2[v * 2 + 1] - meanV;
    right.addInPlaceFromFloats(dx * du, dy * du, dz * du);
    up.addInPlaceFromFloats(dx * dv, dy * dv, dz * dv);
    normal.addInPlaceFromFloats(
      normals[v * 3],
      normals[v * 3 + 1],
      normals[v * 3 + 2],
    );
  });
  const forward = Vector3.Cross(right, up);
  if (forward.lengthSquared() < 1e-12 || right.lengthSquared() < 1e-12)
    return null;
  if (Vector3.Dot(forward, normal) < 0) forward.scaleInPlace(-1);
  forward.normalize();
  right.subtractInPlace(forward.scale(Vector3.Dot(right, forward))).normalize();
  return { forward, right };
};

const getFaceFrame = (
  mesh: AbstractMesh,
  material: Material,
): FaceFrame | null => {
  if (!faceFrames.has(mesh))
    faceFrames.set(mesh, computeFaceFrame(mesh, material));
  return faceFrames.get(mesh) ?? null;
};

const CAST_SHADOW_LENGTH = 0.025;
export type CastShadowRole = "hair" | "face" | "skin";
const SHADOW_CASTERS: Partial<Record<CastShadowRole, CastShadowRole[]>> = {
  face: ["hair"],
  skin: ["hair", "face"],
};
const depthMaps = new WeakMap<
  Camera,
  Map<CastShadowRole, RenderTargetTexture>
>();

const getMeshShadowRoles = (mesh: AbstractMesh): Set<CastShadowRole> => {
  const material = mesh.material;
  const materials =
    material instanceof MultiMaterial ? material.subMaterials : [material];
  const roles = new Set<CastShadowRole>();
  materials.forEach((mat) => {
    const role =
      mat?.pluginManager?.getPlugin<UnityToonPlugin>("UnityToon")?.shadowRole;
    if (role) roles.add(role);
  });
  return roles;
};

const getCasterDepthMap = (
  scene: Scene,
  receiver: CastShadowRole | null,
): RenderTargetTexture | null => {
  const casters = receiver && SHADOW_CASTERS[receiver];
  const camera = scene.activeCamera;
  if (!casters || !camera) return null;
  let maps = depthMaps.get(camera);
  if (!maps) depthMaps.set(camera, (maps = new Map()));
  let depthMap = maps.get(receiver);
  if (!depthMap) {
    const renderer = new DepthRenderer(
      scene,
      Constants.TEXTURETYPE_FLOAT,
      camera,
      false,
      Texture.NEAREST_SAMPLINGMODE,
      true,
      `toonCasters_${receiver}`,
    );
    depthMap = renderer.getDepthMap();
    depthMap.getCustomRenderList = (_pass, list, length) =>
      (list ?? [])
        .slice(0, length)
        .filter(
          (mesh) =>
            !mesh.metadata?.isOutlineHull &&
            [...getMeshShadowRoles(mesh)].some((role) =>
              casters.includes(role),
            ),
        );
    scene.customRenderTargets.push(depthMap);
    maps.set(receiver, depthMap);
  }
  return depthMap;
};

export class UnityToonPlugin extends MaterialPluginBase {
  public rampTexture: Texture | null = null;
  public rmoTexture: Texture | null = null;
  public faceTexture: Texture | null = null;
  public baseColor = { r: 1, g: 1, b: 1 };
  public rampV = RAMP_BAND_V.default;
  public flatten = 0;
  public shadowRole: CastShadowRole | null = null;
  private readonly lightDir = new Vector3();
  private readonly shadowStep = new Vector2();

  constructor(material: Material) {
    super(material, "UnityToon", 200, {
      UNITY_TOON: false,
      UNITY_TOON_RAMP: false,
      UNITY_TOON_RMO: false,
      UNITY_TOON_FACE: false,
      UNITY_TOON_CAST_SHADOW: false,
    });
    this._enable(true);
  }

  public override getClassName(): string {
    return "UnityToonPlugin";
  }

  public override prepareDefines(defines: MaterialDefines, scene: Scene): void {
    defines["UNITY_TOON_CAST_SHADOW"] = !!getCasterDepthMap(
      scene,
      this.shadowRole,
    );
    defines["UNITY_TOON"] = true;
    defines["UNITY_TOON_RAMP"] = !!this.rampTexture;
    defines["UNITY_TOON_RMO"] = !!this.rmoTexture;
    defines["UNITY_TOON_FACE"] = !!this.faceTexture && !!defines["UV2"];
  }

  public override isReadyForSubMesh(
    _defines: MaterialDefines,
    scene: Scene,
  ): boolean {
    const depthMap = getCasterDepthMap(scene, this.shadowRole);
    return (
      (!depthMap || depthMap.isReady()) &&
      (!this.rampTexture || this.rampTexture.isReady()) &&
      (!this.rmoTexture || this.rmoTexture.isReady()) &&
      (!this.faceTexture || this.faceTexture.isReady())
    );
  }

  public override getSamplers(samplers: string[]): void {
    samplers.push(
      "toonRampSampler",
      "toonRmoSampler",
      "toonFaceSampler",
      "toonDepthSampler",
    );
  }

  public override getUniforms() {
    return {
      ubo: [
        { name: "toonLightDir", size: 3, type: "vec3" },
        { name: "toonBaseColor", size: 3, type: "vec3" },
        { name: "toonRampV", size: 1, type: "float" },
        { name: "toonFlatten", size: 1, type: "float" },
        { name: "toonFaceForward", size: 3, type: "vec3" },
        { name: "toonFaceRight", size: 3, type: "vec3" },
        { name: "toonShadowStep", size: 2, type: "vec2" },
        { name: "toonScreenSize", size: 2, type: "vec2" },
      ],
      vertex: `#ifdef UNITY_TOON_FACE
uniform vec3 toonFaceForward;
uniform vec3 toonFaceRight;
#endif`,
      fragment: `#ifdef UNITY_TOON
uniform vec3 toonLightDir;
uniform vec3 toonBaseColor;
uniform float toonRampV;
uniform float toonFlatten;
uniform vec2 toonShadowStep;
uniform vec2 toonScreenSize;
#endif`,
    };
  }

  public override bindForSubMesh(
    uniformBuffer: UniformBuffer,
    scene: Scene,
    engine: AbstractEngine,
    subMesh: SubMesh,
  ): void {
    if (this.faceTexture) {
      const frame = getFaceFrame(subMesh.getMesh(), this._material);
      if (frame) {
        uniformBuffer.updateVector3("toonFaceForward", frame.forward);
        uniformBuffer.updateVector3("toonFaceRight", frame.right);
      }
      uniformBuffer.setTexture("toonFaceSampler", this.faceTexture);
    }
    const camera = scene.activeCamera;
    if (camera) {
      const forward = camera.getDirection(Vector3.Forward());
      const right = camera.getDirection(Vector3.Right());
      const up = camera.getDirection(Vector3.Up());
      this.lightDir
        .copyFrom(forward)
        .scaleInPlace(-1)
        .addInPlace(up.scale(0.6))
        .addInPlace(right.scale(-0.4))
        .normalize();
    } else {
      this.lightDir.set(0, 0.5, -1).normalize();
    }
    const depthMap = getCasterDepthMap(scene, this.shadowRole);
    if (depthMap && camera) {
      const lightView = Vector3.TransformNormal(
        this.lightDir,
        camera.getViewMatrix(),
      );
      const width = engine.getRenderWidth();
      const height = engine.getRenderHeight();
      const uvPerMeter = 1 / (2 * Math.tan(camera.fov / 2));
      this.shadowStep
        .set(lightView.x, lightView.y)
        .normalize()
        .multiplyInPlace(new Vector2((uvPerMeter * height) / width, uvPerMeter))
        .scaleInPlace(CAST_SHADOW_LENGTH);
      uniformBuffer.updateFloat2(
        "toonShadowStep",
        this.shadowStep.x,
        this.shadowStep.y,
      );
      uniformBuffer.updateFloat2("toonScreenSize", width, height);
      uniformBuffer.setTexture("toonDepthSampler", depthMap);
    }
    uniformBuffer.updateVector3("toonLightDir", this.lightDir);
    uniformBuffer.updateFloat3(
      "toonBaseColor",
      this.baseColor.r,
      this.baseColor.g,
      this.baseColor.b,
    );
    uniformBuffer.updateFloat("toonRampV", this.rampV);
    uniformBuffer.updateFloat("toonFlatten", this.flatten);
    if (this.rampTexture)
      uniformBuffer.setTexture("toonRampSampler", this.rampTexture);
    if (this.rmoTexture)
      uniformBuffer.setTexture("toonRmoSampler", this.rmoTexture);
  }

  public override dispose(forceDisposeTextures?: boolean): void {
    if (!forceDisposeTextures) return;
    this.rampTexture?.dispose();
    this.rmoTexture?.dispose();
    this.faceTexture?.dispose();
  }

  public override getActiveTextures(activeTextures: Texture[]): void {
    if (this.rampTexture) activeTextures.push(this.rampTexture);
    if (this.rmoTexture) activeTextures.push(this.rmoTexture);
    if (this.faceTexture) activeTextures.push(this.faceTexture);
  }

  public override hasTexture(texture: Texture): boolean {
    return (
      texture === this.rampTexture ||
      texture === this.rmoTexture ||
      texture === this.faceTexture
    );
  }

  public override getCustomCode(
    shaderType: string,
  ): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `
#ifdef UNITY_TOON_FACE
varying vec2 vToonUV2;
varying vec3 vToonFaceForward;
varying vec3 vToonFaceRight;
#endif`,
        CUSTOM_VERTEX_MAIN_END: `
#ifdef UNITY_TOON_FACE
vToonUV2 = uv2Updated;
vToonFaceForward = mat3(finalWorld) * toonFaceForward;
vToonFaceRight = mat3(finalWorld) * toonFaceRight;
#endif`,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
#define TOON_SHADOW_NDL 0.6
#ifdef UNITY_TOON_RAMP
uniform sampler2D toonRampSampler;
#endif
#ifdef UNITY_TOON_RMO
uniform sampler2D toonRmoSampler;
#endif
#ifdef UNITY_TOON_CAST_SHADOW
uniform sampler2D toonDepthSampler;
#endif
#ifdef UNITY_TOON_FACE
uniform sampler2D toonFaceSampler;
varying vec2 vToonUV2;
varying vec3 vToonFaceForward;
varying vec3 vToonFaceRight;
#endif`,
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
#ifdef UNITY_TOON
float toonNdl = mix(0.1, 1.0, dot(normalW, normalize(toonLightDir)) * 0.5 + 0.5);
#if defined(UNITY_TOON_RMO) && defined(DIFFUSE)
toonNdl *= mix(1.0, texture2D(toonRmoSampler, vDiffuseUV).b, 0.6);
#endif
#ifdef UNITY_TOON_FACE
vec3 toonL = normalize(toonLightDir);
float toonLightX = dot(toonL, normalize(vToonFaceRight));
float toonLightAngle = atan(abs(toonLightX), dot(toonL, normalize(vToonFaceForward))) / 3.14159265;
vec2 toonFaceUV = vec2(toonLightX >= 0.0 ? vToonUV2.x : 1.0 - vToonUV2.x, vToonUV2.y);
float toonFaceLit = smoothstep(toonLightAngle - 0.02, toonLightAngle + 0.02, texture2D(toonFaceSampler, toonFaceUV).r);
vec4 toonFaceMap = texture2D(toonFaceSampler, vToonUV2);
float toonFaceNdl = min(mix(TOON_SHADOW_NDL, 1.0, toonFaceLit), mix(toonNdl, 1.0, 0.5));
toonNdl = mix(toonNdl, toonFaceNdl, toonFaceMap.a);
float toonNose = (toonLightX >= 0.0 ? toonFaceMap.b : toonFaceMap.g) * smoothstep(0.05, 0.35, abs(toonLightX));
#endif
#ifndef UNITY_TOON_FACE
toonNdl = mix(toonNdl, 1.0, toonFlatten);
#endif
#ifdef UNITY_TOON_CAST_SHADOW
float toonViewZ = abs((view * vec4(vPositionW, 1.0)).z);
float toonOccluderZ = abs(texture2D(toonDepthSampler, gl_FragCoord.xy / toonScreenSize + toonShadowStep / toonViewZ).r);
float toonDepthGap = toonViewZ - toonOccluderZ;
if (toonOccluderZ > 0.0 && toonDepthGap > 0.01 && toonDepthGap < 0.15) toonNdl = min(toonNdl, TOON_SHADOW_NDL);
#endif
#ifdef UNITY_TOON_RAMP
vec3 toonShade = pow(texture2D(toonRampSampler, vec2(clamp(toonNdl, 0.02, 0.98), toonRampV)).rgb, vec3(1.0 / 2.2));
#else
vec3 toonShade = vec3(mix(0.75, 1.0, smoothstep(0.45, 0.55, toonNdl)));
#endif
color.rgb = baseColor.rgb * toonShade * toonBaseColor;
#ifdef UNITY_TOON_FACE
color.rgb += toonNose * 0.12;
#endif
#endif`,
    };
  }
}

export const usesFaceShadowMap = (info: UnityMaterialInfo): boolean =>
  !!info.blend &&
  info.keywords.includes("_USE_BLEND_TEX") &&
  info.keywords.includes("_BLEND_UV2");

export const configureUnityToonPlugin = (
  plugin: UnityToonPlugin,
  info: UnityMaterialInfo,
  mode: UnityToonMode,
): void => {
  const base = info.colors._BaseColor ||
    info.colors._Color || { r: 1, g: 1, b: 1, a: 1 };
  const tint = info.colors._FinalTint || { r: 1, g: 1, b: 1, a: 1 };
  plugin.baseColor = {
    r: base.r * tint.r,
    g: base.g * tint.g,
    b: base.b * tint.b,
  };
  plugin.rampV = /skin/i.test(info.name)
    ? RAMP_BAND_V.skin
    : RAMP_BAND_V.default;
  plugin.flatten = mode === "toon" ? (usesFaceShadowMap(info) ? 0.6 : 0) : 1;
  plugin.shadowRole =
    mode !== "toon"
      ? null
      : usesFaceShadowMap(info) || /face/i.test(info.name)
        ? "face"
        : /hair|fringe/i.test(info.name)
          ? "hair"
          : /skin/i.test(info.name)
            ? "skin"
            : null;
};
