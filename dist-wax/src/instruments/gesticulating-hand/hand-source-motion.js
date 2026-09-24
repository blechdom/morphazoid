/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Morphazoid contributors.
 * Original pure JavaScript quaternion sampler; no browser, Three.js or Node APIs.
 * Its separately imported animation data remains CC BY-SA 4.0, attributed to
 * Elena FF: https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e
 * Keep hand-source-motion-data.js and its attribution with any distribution.
 */
import { SOURCE_GRASP_LAYOUT as layout, SOURCE_GRASP_DATA } from './hand-source-motion-data.js';

export const SOURCE_GRASP_DURATION = layout.duration;
export const SOURCE_BONE_NAMES = Object.freeze([...layout.boneNames]);
const BONE_COUNT = SOURCE_BONE_NAMES.length;
export const SOURCE_ANCESTOR_NAMES = Object.freeze([...layout.ancestorNames]);
const STRIDE = (BONE_COUNT + SOURCE_ANCESTOR_NAMES.length) * 4;

// Decode little-endian Float32 values without atob, Buffer or fetch (AudioWorklet safe).
function decodeData(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i += 1) lookup[alphabet.charCodeAt(i)] = i;
  const bytes = new Uint8Array(Math.floor(text.length * 3 / 4));
  let bits = 0;
  let value = 0;
  let offset = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const digit = code < 128 ? lookup[code] : -1;
    if (digit < 0) continue;
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = (value >> bits) & 255;
    }
  }
  const view = new DataView(bytes.buffer, 0, offset);
  const floats = new Float32Array(offset / 4);
  for (let i = 0; i < floats.length; i += 1) floats[i] = view.getFloat32(i * 4, true);
  return floats;
}
const data = decodeData(SOURCE_GRASP_DATA);
const times = data.subarray(0, layout.keyCount);
const frames = data.subarray(layout.keyCount);

function normalize(q) {
  const norm = Math.hypot(q[0], q[1], q[2], q[3]);
  for (let i = 0; i < 4; i += 1) q[i] /= norm;
  return q;
}
export const SOURCE_OPEN_ROTATIONS = Object.freeze(SOURCE_BONE_NAMES.map((_, index) =>
  Object.freeze(normalize(Array.from(frames.subarray(index * 4, index * 4 + 4)))),
));

export const SOURCE_OPEN_ANCESTOR_ROTATIONS = Object.freeze(SOURCE_ANCESTOR_NAMES.map((_, index) => {
  const offset = (BONE_COUNT + index) * 4;
  return Object.freeze(normalize(Array.from(frames.subarray(offset, offset + 4))));
}));

function slerpAt(first, second, fraction, out) {
  let dot = 0;
  for (let i = 0; i < 4; i += 1) dot += frames[first + i] * frames[second + i];
  const sign = dot < 0 ? -1 : 1;
  dot = Math.min(1, Math.abs(dot));
  let a = 1 - fraction;
  let b = fraction;
  if (dot < 0.9995) {
    const angle = Math.acos(dot);
    const divisor = Math.sin(angle);
    a = Math.sin((1 - fraction) * angle) / divisor;
    b = Math.sin(fraction * angle) / divisor;
  }
  for (let i = 0; i < 4; i += 1) out[i] = a * frames[first + i] + b * sign * frames[second + i];
  return normalize(out);
}

// Signed twist of inverse(open) * pose about its calibrated local bend axis.
function bendDegrees(index, q) {
  const a = SOURCE_OPEN_ROTATIONS[index];
  const axis = layout.axes[index];
  const x = a[3] * q[0] - a[0] * q[3] - a[1] * q[2] + a[2] * q[1];
  const y = a[3] * q[1] + a[0] * q[2] - a[1] * q[3] - a[2] * q[0];
  const z = a[3] * q[2] - a[0] * q[1] + a[1] * q[0] - a[2] * q[3];
  const w = a[3] * q[3] + a[0] * q[0] + a[1] * q[1] + a[2] * q[2];
  const sign = w < 0 ? -1 : 1;
  return 2 * Math.atan2(sign * (x * axis[0] + y * axis[1] + z * axis[2]), sign * w) * 180 / Math.PI;
}

/**
 * Sample authored grasp choreography. phase01 wraps, including negatives; 1 -> 0.
 * rotations: 22 local [x,y,z,w] quaternions in SOURCE_BONE_NAMES order.
 * ancestorRotations: the one structural palm bone in SOURCE_ANCESTOR_NAMES order.
 * Apply it too: it cups the palm and parents the four non-thumb finger bases.
 * fingers: thumb,index,middle,ring,little, each {mcp,pip,dip,spread} in degrees.
 * The source has no separately isolated spread track, so spread is zero.
 * Pass a previous result as optional `out` for allocation-free control-rate use.
 */
export function sampleSourceGrasp(phase01, out) {
  const phase = Number.isFinite(phase01) ? ((phase01 % 1) + 1) % 1 : 0;
  const time = phase * SOURCE_GRASP_DURATION;
  let low = 0;
  let high = times.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (times[mid] <= time) low = mid;
    else high = mid;
  }
  const span = times[high] - times[low];
  const fraction = span > 0 ? (time - times[low]) / span : 0;
  const result = out ?? {
    rotations: Array.from({ length: BONE_COUNT }, () => [0, 0, 0, 1]),
    ancestorRotations: SOURCE_ANCESTOR_NAMES.map(() => [0, 0, 0, 1]),
    fingers: Array.from({ length: 5 }, () => ({ mcp: 0, pip: 0, dip: 0, spread: 0 })),
  };
  for (let index = 0; index < BONE_COUNT; index += 1) {
    slerpAt(low * STRIDE + index * 4, high * STRIDE + index * 4, fraction, result.rotations[index]);
  }
  for (let index = 0; index < SOURCE_ANCESTOR_NAMES.length; index += 1) {
    const offset = (BONE_COUNT + index) * 4;
    slerpAt(low * STRIDE + offset, high * STRIDE + offset, fraction, result.ancestorRotations[index]);
  }
  for (let finger = 0; finger < 5; finger += 1) {
    const [mcp, pip, dip] = layout.fingerBones[finger];
    const value = result.fingers[finger];
    value.mcp = bendDegrees(mcp, result.rotations[mcp]);
    value.pip = bendDegrees(pip, result.rotations[pip]);
    value.dip = bendDegrees(dip, result.rotations[dip]);
    value.spread = 0;
  }
  return result;
}
