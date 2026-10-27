type CurveKey = { frame: number; value: number; cubic?: [number, number, number] };
const evaluateSegment = (k: CurveKey, next: CurveKey, frame: number): number => {
  const cubic = k.cubic;
  if (cubic) {
    const d = frame - k.frame;
    const value = ((cubic[0] * d + cubic[1]) * d + cubic[2]) * d + k.value;
    return Number.isFinite(value) ? value : k.value;
  }
  const t = (frame - k.frame) / (next.frame - k.frame);
  return k.value + t * (next.value - k.value);
};
export const interpolate = (
  keys: Array<CurveKey> & { _lastIdx?: number },
  frame: number,
): number | null => {
  if (!keys || keys.length === 0) return null;
  if (frame <= keys[0].frame) return keys[0].value;
  const last = keys.length - 1;
  if (frame >= keys[last].frame) return keys[last].value;
  let idx = keys._lastIdx || 0;
  if (idx < last) {
    const k = keys[idx];
    const next = keys[idx + 1];
    if (k.frame <= frame && next.frame > frame) {
      return evaluateSegment(k, next, frame);
    }
    if (idx + 1 < last) {
      const kNext = keys[idx + 1];
      const kNext2 = keys[idx + 2];
      if (kNext.frame <= frame && kNext2.frame > frame) {
        keys._lastIdx = idx + 1;
        return evaluateSegment(kNext, kNext2, frame);
      }
    }
  }
  let low = 0;
  let high = last;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const k = keys[mid];
    if (k.frame <= frame) {
      if (keys[mid + 1].frame > frame) {
        keys._lastIdx = mid;
        return evaluateSegment(k, keys[mid + 1], frame);
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return keys[0].value;
};
