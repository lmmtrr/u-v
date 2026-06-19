import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { state } from "./state";
import type { JSONValue, UnityObject } from "./types";
export class JSBinaryReader {
  private view: DataView;
  public pos: number;
  constructor(bufferOrView: ArrayBuffer | ArrayBufferView | DataView) {
    if (bufferOrView instanceof ArrayBuffer) {
      this.view = new DataView(bufferOrView);
    } else if (
      bufferOrView &&
      (bufferOrView as ArrayBufferView).buffer instanceof ArrayBuffer
    ) {
      const b = bufferOrView as ArrayBufferView;
      this.view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    } else {
      this.view = bufferOrView as DataView;
    }
    this.pos = 0;
  }
  readInt32(): number {
    if (this.pos + 4 > this.view.byteLength) return 0;
    const val = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return val;
  }
  readUInt32(): number {
    if (this.pos + 4 > this.view.byteLength) return 0;
    const val = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return val;
  }
  readFloat32(): number {
    if (this.pos + 4 > this.view.byteLength) return 0.0;
    const val = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return val;
  }
  align(n: number) {
    const mod = this.pos % n;
    if (mod !== 0) {
      this.pos += n - mod;
    }
  }
  readUInt32Array(): number[] {
    const size = this.readInt32();
    const arr: number[] = [];
    if (size < 0 || size > 1000000) return arr;
    for (let i = 0; i < size; i++) {
      arr.push(this.readUInt32());
    }
    this.align(4);
    return arr;
  }
  readFloat32Array(): number[] {
    const size = this.readInt32();
    const arr: number[] = [];
    if (size < 0 || size > 1000000) return arr;
    for (let i = 0; i < size; i++) {
      arr.push(this.readFloat32());
    }
    this.align(4);
    return arr;
  }
}
export class StreamedCurveKey {
  public index: number;
  public coeff: number[];
  public outSlope: number;
  public value: number;
  public inSlope: number;
  constructor(reader: JSBinaryReader) {
    this.index = reader.readInt32();
    this.coeff = [];
    for (let i = 0; i < 4; i++) {
      this.coeff.push(reader.readFloat32());
    }
    this.outSlope = this.coeff[2];
    this.value = this.coeff[3];
    this.inSlope = 0;
  }
  calculateNextInSlope(dx: number, rhs: StreamedCurveKey): number {
    if (this.coeff[0] === 0 && this.coeff[1] === 0 && this.coeff[2] === 0) {
      return Infinity;
    }
    dx = Math.max(dx, 0.0001);
    const dy = rhs.value - this.value;
    const length = 1.0 / (dx * dx);
    const d1 = this.outSlope * dx;
    const d2 = dy + dy + dy - d1 - d1 - this.coeff[1] / length;
    return d2 / dx;
  }
}
export class StreamedFrame {
  public time: number;
  public keyList: StreamedCurveKey[];
  constructor(reader: JSBinaryReader) {
    this.time = reader.readFloat32();
    const numKeys = reader.readInt32();
    this.keyList = [];
    if (numKeys >= 0 && numKeys < 100000) {
      for (let i = 0; i < numKeys; i++) {
        this.keyList.push(new StreamedCurveKey(reader));
      }
    }
  }
}
export const getTOSKeyAndValue = (
  e: JSONValue | undefined | null,
): { key: JSONValue; value: JSONValue } | null => {
  if (!e) return null;
  if (Array.isArray(e)) {
    return { key: e[0], value: e[1] };
  }
  if (typeof e === "object" && e !== null) {
    const obj = e as Record<string, JSONValue>;
    if (obj.first !== undefined && obj.second !== undefined) {
      return { key: obj.first, value: obj.second };
    } else if (obj.m_First !== undefined && obj.m_Second !== undefined) {
      return { key: obj.m_First, value: obj.m_Second };
    }
  }
  return null;
};
export const readStreamedData = (
  m_StreamedClip: UnityObject | null | undefined,
): StreamedFrame[] => {
  if (
    !m_StreamedClip ||
    !m_StreamedClip.data ||
    (m_StreamedClip.data as number[]).length === 0
  ) {
    return [];
  }
  const streamedClipBuffer = new ArrayBuffer((m_StreamedClip.data as number[]).length * 4);
  const streamedClipView = new DataView(streamedClipBuffer);
  for (let i = 0; i < (m_StreamedClip.data as number[]).length; i++) {
    streamedClipView.setUint32(i * 4, (m_StreamedClip.data as number[])[i], true);
  }
  const reader = new JSBinaryReader(streamedClipBuffer);
  const frameList: StreamedFrame[] = [];
  while (reader.pos < streamedClipBuffer.byteLength) {
    frameList.push(new StreamedFrame(reader));
  }
  for (let frameIndex = 2; frameIndex < frameList.length - 1; frameIndex++) {
    const frame = frameList[frameIndex];
    for (const curveKey of frame.keyList) {
      for (let i = frameIndex - 1; i >= 0; i--) {
        const preFrame = frameList[i];
        const preCurveKey = preFrame.keyList.find(
          (x) => x.index === curveKey.index,
        );
        if (preCurveKey) {
          curveKey.inSlope = preCurveKey.calculateNextInSlope(
            frame.time - preFrame.time,
            curveKey,
          );
          break;
        }
      }
    }
  }
  return frameList;
};
export const preprocessAnimationClip = (clipData: UnityObject) => {
  const muscleClip = clipData.m_MuscleClip as Record<string, JSONValue> | undefined;
  if (!muscleClip) {
    return;
  }
  if (!muscleClip.m_Clip) {
    return;
  }
  const m_Clip = muscleClip.m_Clip as Record<string, JSONValue>;
  if (m_Clip.m_StreamedClip || m_Clip.m_DenseClip) {
    const streamedClip = m_Clip.m_StreamedClip as UnityObject | undefined;
    if (streamedClip && streamedClip.data && !clipData.m_StreamedFrames) {
      clipData.m_StreamedFrames = readStreamedData(streamedClip) as never;
    }
    return;
  }
  const m_ClipData = m_Clip.data as Record<string, JSONValue> | undefined;
  if (!m_ClipData) {
    return;
  }
  if (
    m_ClipData &&
    typeof m_ClipData === "object" &&
    !Array.isArray(m_ClipData) &&
    !(m_ClipData instanceof Uint8Array) &&
    !(m_ClipData instanceof ArrayBuffer) &&
    (m_ClipData.m_StreamedClip || m_ClipData.m_DenseClip)
  ) {
    m_Clip.m_StreamedClip = m_ClipData.m_StreamedClip;
    m_Clip.m_DenseClip = m_ClipData.m_DenseClip;
    m_Clip.m_ConstantClip = m_ClipData.m_ConstantClip;
    const streamedClip = m_Clip.m_StreamedClip as UnityObject | undefined;
    if (streamedClip && streamedClip.data) {
      clipData.m_StreamedFrames = readStreamedData(streamedClip) as never;
    } else {
      clipData.m_StreamedFrames = [] as never;
    }
  } else {
    let uint8View: Uint8Array | null = null;
    const rawData = m_Clip.data;
    if (rawData instanceof Uint8Array) {
      uint8View = rawData;
    } else if (Array.isArray(rawData)) {
      uint8View = new Uint8Array(rawData as number[]);
    } else if (
      rawData &&
      typeof rawData === "object" &&
      "buffer" in rawData
    ) {
      const obj = rawData as Record<string, unknown>;
      if (obj.buffer instanceof ArrayBuffer) {
        uint8View = new Uint8Array(
          obj.buffer,
          (obj.byteOffset as number) || 0,
          (obj.byteLength as number) || 0,
        );
      }
    }
    if (!uint8View || uint8View.length === 0) return;
    const reader = new JSBinaryReader(uint8View);
    const streamedData = reader.readUInt32Array();
    const streamedCurveCount = reader.readUInt32();
    m_Clip.m_StreamedClip = {
      data: streamedData as never,
      curveCount: streamedCurveCount,
    };
    const denseFrameCount = reader.readInt32();
    const denseCurveCount = reader.readUInt32();
    const denseSampleRate = reader.readFloat32();
    const denseBeginTime = reader.readFloat32();
    const denseSampleArray = reader.readFloat32Array();
    m_Clip.m_DenseClip = {
      m_FrameCount: denseFrameCount,
      m_CurveCount: denseCurveCount,
      m_SampleRate: denseSampleRate,
      m_BeginTime: denseBeginTime,
      m_SampleArray: denseSampleArray as never,
    };
    if (reader.pos < uint8View.byteLength) {
      const constantData = reader.readFloat32Array();
      m_Clip.m_ConstantClip = { data: constantData as never };
    }
    clipData.m_StreamedFrames = readStreamedData(m_Clip.m_StreamedClip as never) as never;
  }
};
export const resolveAvatarForAnimation = (
  createdMeshes: Mesh[],
  defaultAvatar: UnityObject | null,
): UnityObject | null => {
  for (const mesh of createdMeshes) {
    if (mesh.metadata && mesh.metadata.gameObjectId) {
      let currentGoId = String(mesh.metadata.gameObjectId);
      while (currentGoId && currentGoId !== "0") {
        const animator = state.animatorsByGameObjectId?.get(currentGoId);
        if (
          animator &&
          animator.m_Avatar &&
          typeof animator.m_Avatar === "object" &&
          (animator.m_Avatar as Record<string, JSONValue>).path_id &&
          String((animator.m_Avatar as Record<string, JSONValue>).path_id) !== "0"
        ) {
          const avatar = state.avatarsByPathId?.get(
            String((animator.m_Avatar as Record<string, JSONValue>).path_id),
          );
          if (avatar) return avatar;
        }
        const transform = state.transformsByGameObjectId?.get(currentGoId);
        if (
          transform &&
          transform.m_Father &&
          typeof transform.m_Father === "object" &&
          (transform.m_Father as Record<string, JSONValue>).path_id &&
          String((transform.m_Father as Record<string, JSONValue>).path_id) !== "0"
        ) {
          const fatherTransform = state.transformsByPathId?.get(
            String((transform.m_Father as Record<string, JSONValue>).path_id),
          );
          currentGoId = fatherTransform && fatherTransform.m_GameObject && typeof fatherTransform.m_GameObject === "object"
            ? String((fatherTransform.m_GameObject as Record<string, JSONValue>).path_id)
            : "0";
        } else {
          break;
        }
      }
    }
  }
  if (state.avatarsByPathId && state.avatarsByPathId.size > 0) {
    return state.avatarsByPathId.values().next().value || null;
  }
  return defaultAvatar;
};
