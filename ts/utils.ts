const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c;
}
export const computeCRC32 = (str: string): number => {
  if (typeof str !== 'string') return 0;
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ str.charCodeAt(i)) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
};
export const normalizeHash = (h: number | string | null | undefined): string => {
  if (h === undefined || h === null) return "";
  const num = Number(h);
  if (isNaN(num)) return String(h);
  const unsigned = num < 0 ? num + 4294967296 : num;
  return String(unsigned);
};
import type { UnityObject, JSONValue } from "./types";
export const getBindingPath = (binding: UnityObject, allObjectHash?: Map<string, string>): string => {
  if (!binding) return "";
  if (typeof binding.path === 'string' && binding.path !== "") {
    return binding.path;
  }
  let pathHash: number | string | undefined = undefined;
  if (typeof binding.path === 'number') {
    pathHash = binding.path;
  } else if (binding.path_ !== undefined && binding.path_ !== null) {
    if (typeof binding.path_ === 'number' || typeof binding.path_ === 'string') {
      pathHash = binding.path_;
    }
  } else if (binding.m_Path !== undefined) {
    if (typeof binding.m_Path === 'number') {
      pathHash = binding.m_Path;
    } else if (typeof binding.m_Path === 'string' && binding.m_Path !== "") {
      return binding.m_Path;
    }
  }
  if (pathHash !== undefined && allObjectHash) {
    const normStr = normalizeHash(pathHash);
    const resolved = allObjectHash.get(normStr) || allObjectHash.get(String(pathHash));
    if (resolved && typeof resolved === 'string') {
      return resolved;
    }
  }
  if (typeof binding.path === 'string') return binding.path;
  if (typeof binding.m_Path === 'string') return binding.m_Path;
  if (pathHash !== undefined) return normalizeHash(pathHash);
  return "";
};
export function getSortableKey(str: string | number, padLength: number = 16): string {
  const s = String(str || '');
  return s.replace(/\d+/g, (match) => match.padStart(padLength, '0'));
}
export function createSorter<T>(keyExtractor: (item: T) => string | number): (a: T, b: T) => number {
  return (a: T, b: T) => {
    const keyA = getSortableKey(keyExtractor(a));
    const keyB = getSortableKey(keyExtractor(b));
    if (keyA < keyB) return -1;
    if (keyA > keyB) return 1;
    return 0;
  };
}
