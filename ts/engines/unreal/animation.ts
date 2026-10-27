import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { MorphTarget } from "@babylonjs/core/Morph/morphTarget";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { unrealWorker } from "./worker_api";
import type { AnimationBoneData, AnimationCurveKey, AnimationData, AnimationClipItem, LoadedFile, UnityObject } from "../../types";
import { unrealData } from "./file_data";
import type { UnrealAnimationEntry, UnrealAnimationSamples } from "./types";

type ClipRef = UnrealAnimationEntry & { envId: number };

export interface UnrealClipData {
  UnrealAnimation: ClipRef & {
    companions: ClipRef[];
  };
}

export const unrealAnimationClips = (files: LoadedFile[], engine: string): AnimationClipItem[] =>
  files
    .filter((f) => !f.removedFromUI && unrealData(f))
    .flatMap((f) => {
      const { envId, animations } = unrealData(f)!;
      const anims = animations.map((a) => ({ ...a, envId }));
      const skeletonUse = new Map<string, number>();
      anims.forEach((a) => skeletonUse.set(a.skeleton ?? "", (skeletonUse.get(a.skeleton ?? "") ?? 0) + 1));
      const groups = new Map<string, ClipRef[]>();
      anims.forEach((a) => groups.set(a.name, [...(groups.get(a.name) ?? []), a]));
      return [...groups.values()].map((group) => {
        const [main, ...companions] = [...group].sort(
          (x, y) => (skeletonUse.get(y.skeleton ?? "") ?? 0) - (skeletonUse.get(x.skeleton ?? "") ?? 0),
        );
        const label = main.hasBoneTracks || companions.length > 0 ? main.name : `${main.name} (curves)`;
        const clipData: UnrealClipData = { UnrealAnimation: { ...main, companions } };
        return {
          name: main.additive ? `${label} (additive)` : label,
          engine,
          clipData: clipData as never as UnityObject,
        };
      });
    });

const sampleCache = new Map<string, Promise<UnrealAnimationSamples>>();

export const forgetUnrealSamples = (envId: number): void => {
  [...sampleCache.keys()]
    .filter((key) => key.startsWith(`${envId}|`))
    .forEach((key) => sampleCache.delete(key));
};

const loadSamples = (clip: ClipRef) => {
  const key = `${clip.envId}|${clip.path}`;
  let pending = sampleCache.get(key);
  if (!pending) {
    pending = unrealWorker.loadAnimation(clip.envId, clip.path);
    pending.catch(() => sampleCache.delete(key));
    sampleCache.set(key, pending);
  }
  return pending;
};

type RestPose = {
  position: TransformNode["position"];
  rotation: NonNullable<TransformNode["rotationQuaternion"]>;
  scaling: TransformNode["scaling"];
};

const restPoseOf = (node: TransformNode): RestPose | undefined => node.metadata?.unrealRest;

type Channels = [boolean, boolean, boolean];
type Track = { data: Float32Array; offset: number; channels: Channels };

const mulQuat = (
  ax: number, ay: number, az: number, aw: number,
  bx: number, by: number, bz: number, bw: number,
  out: Float32Array | Float64Array, o: number,
): void => {
  out[o] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
};

const addTranslationAndScale = (
  out: Float32Array, o: number, delta: Float32Array, d: number, rest: RestPose, channels: Channels,
): void => {
  const { position: p, scaling: s } = rest;
  out[o] = p.x + (channels[0] ? delta[d] : 0);
  out[o + 1] = p.y + (channels[0] ? delta[d + 1] : 0);
  out[o + 2] = p.z + (channels[0] ? delta[d + 2] : 0);
  out[o + 7] = s.x * (1 + (channels[2] ? delta[d + 7] : 0));
  out[o + 8] = s.y * (1 + (channels[2] ? delta[d + 8] : 0));
  out[o + 9] = s.z * (1 + (channels[2] ? delta[d + 9] : 0));
};

const applyAdditive = (
  samples: Float32Array, base: number, frames: number, rest: RestPose, channels: Channels,
): Float32Array => {
  const out = samples.slice(base, base + frames * 10);
  const { x: rx, y: ry, z: rz, w: rw } = rest.rotation;
  for (let f = 0; f < frames; f++) {
    const o = f * 10;
    addTranslationAndScale(out, o, samples, base + o, rest, channels);
    mulQuat(out[o + 3], out[o + 4], out[o + 5], out[o + 6], rx, ry, rz, rw, out, o + 3);
  }
  return out;
};

const meshSpaceAdditiveTracks = (meshes: Mesh[], samples: UnrealAnimationSamples): Map<TransformNode, Track> => {
  const result = new Map<TransformNode, Track>();
  const frames = samples.num_frames;
  const trackByName = new Map(samples.bones.map((name, i) => [name, i]));
  const none: Channels = [false, false, false];
  for (const mesh of meshes) {
    const skeletonBones = mesh.skeleton!.bones;
    const nodes = skeletonBones.map((b) => b.getTransformNode());
    const rests = nodes.map((n) => (n ? restPoseOf(n) : undefined));
    if (nodes.some((n) => !n || result.has(n)) || rests.some((r) => !r)) continue;
    const index = new Map(skeletonBones.map((b, i) => [b, i]));
    const parents = skeletonBones.map((b) => {
      const parent = b.getParent();
      return parent ? (index.get(parent) ?? -1) : -1;
    });
    const tracks = skeletonBones.map((b) => trackByName.get(b.name) ?? -1);
    const count = skeletonBones.length;
    const baseMs = new Float64Array(count * 4);
    rests.forEach((rest, i) => {
      const { x, y, z, w } = rest!.rotation;
      const p = parents[i] * 4;
      if (p < 0) baseMs.set([x, y, z, w], i * 4);
      else mulQuat(baseMs[p], baseMs[p + 1], baseMs[p + 2], baseMs[p + 3], x, y, z, w, baseMs, i * 4);
    });
    const outputs = nodes.map(() => new Float32Array(frames * 10));
    const ms = new Float64Array(count * 4);
    const s = samples.samples;
    for (let f = 0; f < frames; f++) {
      const o = f * 10;
      for (let i = 0; i < count; i++) {
        const t = tracks[i];
        const channels = t >= 0 ? samples.channels[t] : none;
        const d = t >= 0 ? (t * frames + f) * 10 : 0;
        const b = i * 4;
        if (channels[1]) {
          mulQuat(s[d + 3], s[d + 4], s[d + 5], s[d + 6], baseMs[b], baseMs[b + 1], baseMs[b + 2], baseMs[b + 3], ms, b);
        } else {
          ms.set(baseMs.subarray(b, b + 4), b);
        }
        const out = outputs[i];
        addTranslationAndScale(out, o, s, d, rests[i]!, channels);
        const p = parents[i] * 4;
        if (p < 0) out.set(ms.subarray(b, b + 4), o + 3);
        else mulQuat(-ms[p], -ms[p + 1], -ms[p + 2], ms[p + 3], ms[b], ms[b + 1], ms[b + 2], ms[b + 3], out, o + 3);
      }
    }
    nodes.forEach((node, i) => {
      const t = tracks[i];
      const [hasPos, , hasScale] = t >= 0 ? samples.channels[t] : none;
      result.set(node!, { data: outputs[i], offset: 0, channels: [hasPos, true, hasScale] });
    });
  }
  return result;
};

export const rememberUnrealRestPose = (node: TransformNode): void => {
  node.metadata = {
    ...(node.metadata ?? {}),
    unrealRest: {
      position: node.position.clone(),
      rotation: node.rotationQuaternion!.clone(),
      scaling: node.scaling.clone(),
    },
  };
};

const unrealBoneNodes = (meshes: Mesh[]): TransformNode[] =>
  meshes.flatMap((m) =>
    m.metadata?.unrealPath && m.skeleton
      ? m.skeleton.bones.map((b) => b.getTransformNode()).filter((n): n is TransformNode => !!n)
      : [],
  );

export const resetUnrealPose = (meshes: Mesh[]): void => {
  unrealBoneNodes(meshes).forEach((node) => {
    const rest = restPoseOf(node);
    if (!rest) return;
    node.position.copyFrom(rest.position);
    node.rotationQuaternion?.copyFrom(rest.rotation);
    node.scaling.copyFrom(rest.scaling);
  });
};

export const buildUnrealAnimationData = async (
  clipData: UnrealClipData,
  meshes: Mesh[],
): Promise<AnimationData> => {
  const clip = clipData.UnrealAnimation;
  const anim = await loadSamples(clip);
  const sources: Array<{ ref: ClipRef; samples: UnrealAnimationSamples }> = [{ ref: clip, samples: anim }];
  for (const companion of clip.companions ?? []) {
    try {
      sources.push({ ref: companion, samples: await loadSamples(companion) });
    } catch (err) {
      console.warn(`[unreal] ${companion.name} could not be loaded:`, err);
    }
  }
  const frames = anim.num_frames;
  const frameRate = anim.length > 0 && frames > 1 ? (frames - 1) / anim.length : 30;
  const unrealMeshes = meshes.filter((m) => m.metadata?.unrealPath && m.skeleton);
  const morphTargets = new Map<string, MorphTarget[]>();
  unrealMeshes.forEach((m) => {
    const manager = m.morphTargetManager;
    if (!manager) return;
    for (let i = 0; i < manager.numTargets; i++) {
      const target = manager.getTarget(i);
      morphTargets.set(target.name, [...(morphTargets.get(target.name) ?? []), target]);
    }
  });
  const bones = new Map<TransformNode, AnimationBoneData>();
  const morphs = new Map<MorphTarget, AnimationCurveKey[]>();
  sources.forEach(({ ref, samples }, sourceIndex) => {
    const sourceFrames = samples.num_frames;
    const sourceRate =
      samples.length > 0 && sourceFrames > 1 ? (sourceFrames - 1) / samples.length : frameRate;
    const sourceFrame = (f: number) => Math.min(Math.round((f / frameRate) * sourceRate), sourceFrames - 1);
    const keysFor = (read: (sf: number) => number, scale = 1): AnimationCurveKey[] => {
      const keys: AnimationCurveKey[] = new Array(frames);
      for (let f = 0; f < frames; f++) {
        keys[f] = { time: f / frameRate, frame: f, value: read(sourceFrame(f)) * scale };
      }
      return keys;
    };
    const sameSkeleton = unrealMeshes.filter(
      (m) => ref.skeleton && m.metadata?.unrealSkeleton === ref.skeleton,
    );
    const targets = sameSkeleton.length > 0 || sourceIndex > 0 ? sameSkeleton : unrealMeshes;
    const nodesByName = new Map<string, TransformNode[]>();
    targets.forEach((m) =>
      m.skeleton!.bones.forEach((b) => {
        const node = b.getTransformNode();
        if (node) nodesByName.set(b.name, [...(nodesByName.get(b.name) ?? []), node]);
      }),
    );
    const addBone = (node: TransformNode, { data, offset, channels }: Track) => {
      if (bones.has(node)) return;
      const [hasPos, hasRot, hasScale] = channels;
      const rest = restPoseOf(node);
      const channel = (c: number) => keysFor((sf) => data[offset + sf * 10 + c]);
      bones.set(node, {
        position: hasPos ? { x: channel(0), y: channel(1), z: channel(2) } : {},
        rotation: hasRot ? { x: channel(3), y: channel(4), z: channel(5), w: channel(6) } : {},
        scale: hasScale ? { x: channel(7), y: channel(8), z: channel(9) } : {},
        initialPos: rest ? { x: rest.position.x, y: rest.position.y, z: rest.position.z } : undefined,
        initialScale: rest ? { x: rest.scaling.x, y: rest.scaling.y, z: rest.scaling.z } : undefined,
      });
    };
    if (ref.additive === "AAT_RotationOffsetMeshSpace") {
      meshSpaceAdditiveTracks(targets, samples).forEach((track, node) => addBone(node, track));
    } else {
      samples.bones.forEach((name, track) => {
        const channels = samples.channels[track];
        const base = track * sourceFrames * 10;
        (nodesByName.get(name) ?? []).forEach((node) => {
          if (!ref.additive) return addBone(node, { data: samples.samples, offset: base, channels });
          const rest = restPoseOf(node);
          if (rest) addBone(node, { data: applyAdditive(samples.samples, base, sourceFrames, rest, channels), offset: 0, channels });
        });
      });
    }
    const curveBase = samples.bones.length * sourceFrames * 10;
    samples.curves.forEach((name, c) => {
      (morphTargets.get(name) ?? []).forEach((target) => {
        if (!morphs.has(target)) {
          morphs.set(target, keysFor((sf) => samples.samples[curveBase + c * sourceFrames + sf], 100));
        }
      });
    });
  });

  return {
    name: anim.name,
    frameRate,
    bones,
    muscles: new Map(),
    morphs,
    maxFrame: Math.max(frames - 1, 1),
  };
};
