export const interpolate = (
  keys: Array<{ frame: number; value: number }> & { _lastIdx?: number },
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
      const t = (frame - k.frame) / (next.frame - k.frame);
      return k.value + t * (next.value - k.value);
    }
    if (idx + 1 < last) {
      const kNext = keys[idx + 1];
      const kNext2 = keys[idx + 2];
      if (kNext.frame <= frame && kNext2.frame > frame) {
        keys._lastIdx = idx + 1;
        const t = (frame - kNext.frame) / (kNext2.frame - kNext.frame);
        return kNext.value + t * (kNext2.value - kNext.value);
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
        const next = keys[mid + 1];
        const t = (frame - k.frame) / (next.frame - k.frame);
        return k.value + t * (next.value - k.value);
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return keys[0].value;
};
