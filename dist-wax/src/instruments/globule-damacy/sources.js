import { SOURCE_COUNT, clamp } from "./model.js";

export const SOURCE_NAMES = Object.freeze([
  "Pebble bells", "Undertow", "Paper thunder", "Wobble choir",
  "Dust hiss", "Rubber bass", "Wire birds", "Sea glass",
]);
export const MAX_FILE_BYTES = 12 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 24 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const TAU = 2 * Math.PI;

/** Small visual overview, not a second copy of the sound. */
export function waveformOf(channels, bins = 128) {
  const result = new Float32Array(Math.max(1, Math.min(512, Math.trunc(bins) || 128)));
  const data = channels?.[0];
  if (!data?.length) return result;
  for (let bin = 0; bin < result.length; bin++) {
    const start = Math.floor(bin * data.length / result.length);
    const end = Math.max(start + 1, Math.floor((bin + 1) * data.length / result.length));
    const stride = Math.max(1, Math.floor((end - start) / 48));
    let peak = 0;
    for (let frame = start; frame < end; frame += stride) {
      for (const channel of channels) peak = Math.max(peak, Math.abs(channel[frame] || 0));
    }
    result[bin] = clamp(peak, 0, 1);
  }
  return result;
}

/** Eight original, deterministic sounds. No context, permission, network or music asset. */
export function demoSource(index, sampleRate = 16000) {
  if (!Number.isInteger(index) || index < 0 || index >= SOURCE_COUNT)
    throw new RangeError("Unknown source ribbon.");
  sampleRate = Math.round(clamp(sampleRate, 8000, 48000));
  const duration = 6.4, length = Math.round(sampleRate * duration);
  const left = new Float32Array(length), right = new Float32Array(length);
  let seed = (index + 11) * 7717, smoothed = 0;
  for (let frame = 0; frame < length; frame++) {
    const t = frame / sampleRate, beat = t * 2.5, pulse = Math.exp(-(beat % 1) * 13);
    const bar = Math.floor(beat) % 16;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    smoothed = .9 * smoothed + .1 * noise;
    let value = 0;
    switch (index) {
      case 0:
        value = (bar % 3 === 0 ? pulse : 0) * (.68 * Math.sin(TAU * 418 * t)
          + .25 * Math.sin(TAU * 635 * t)) * .32;
        break;
      case 1:
        value = (Math.sin(TAU * 75 * t + .6 * Math.sin(TAU * .4 * t))
          + .28 * Math.sin(TAU * 151 * t)) * (.37 + .63 * Math.sin(Math.PI * t / duration) ** 2) * .19;
        break;
      case 2:
        value = bar % 4 === 2 ? (noise - .4 * smoothed) * pulse * .38 : 0;
        break;
      case 3:
        value = (Math.sin(TAU * 193 * t) + .44 * Math.sin(TAU * 289 * t)
          + .15 * Math.sin(TAU * 387 * t)) * (.26 + .74 * Math.sin(TAU * t / 3.2) ** 2) * .17;
        break;
      case 4:
        value = (noise - smoothed) * (.2 + .8 * pulse) * .21;
        break;
      case 5:
        value = Math.sin(TAU * [55, 65, 73, 49][Math.floor(bar / 4)] * t
          + 1.6 * Math.exp(-(beat % 1) * 9)) * (.22 + .78 * pulse) * .31;
        break;
      case 6:
        value = bar % 2 === 0 ? Math.sin(TAU * (350 + 210 * (beat % 1)) * t)
          * Math.exp(-(beat % 1) * 8) * .29 : 0;
        break;
      default:
        value = (.65 * smoothed + .35 * Math.sin(TAU * 238 * t))
          * (.3 + .7 * Math.sin(TAU * 2.5 * t) ** 2) * .31;
    }
    const fade = clamp(Math.min(t / .012, (duration - t) / .012), 0, 1);
    left[frame] = value * fade;
    right[frame] = value * fade * (.84 + .13 * Math.sin(TAU * (.24 + index * .03) * t));
  }
  const channels = [left, right];
  return { name: SOURCE_NAMES[index], kind: "demo", sampleRate, duration, channels,
    bytes: length * channels.length * Float32Array.BYTES_PER_ELEMENT,
    waveform: waveformOf(channels) };
}

/** The library contains eight original generated sounds, not third-party recordings. */
export function sampleSource(index) {
  return { ...demoSource(index), kind: "sample" };
}

/** Offline decoding has no audio output; a failed import never replaces its previous source. */
export async function decodeLocalSource(file, index, sources, Offline =
  globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext,
  { name = file?.name, kind = "file" } = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= SOURCE_COUNT || sources?.length !== SOURCE_COUNT)
    throw new RangeError("Choose a source ribbon first.");
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES)
    throw new RangeError("Choose a nonempty audio file of at most 12 MiB.");
  if (!Offline) throw new Error("This browser cannot decode local audio files.");
  const decoder = new Offline(2, 1, 22050);
  const buffer = await decoder.decodeAudioData(await file.arrayBuffer());
  const count = buffer.numberOfChannels, rate = buffer.sampleRate, length = buffer.length;
  if (![1, 2].includes(count) || !Number.isFinite(rate) || rate < 8000 || rate > 48000
    || length < rate * .1 || length > rate * 90)
    throw new RangeError("Use a mono or stereo clip between 0.1 and 90 seconds at 8–48 kHz.");
  const bytes = length * count * Float32Array.BYTES_PER_ELEMENT;
  const occupied = sources.reduce((sum, source) => sum + source.bytes, 0);
  if (bytes > MAX_SOURCE_BYTES || occupied - sources[index].bytes + bytes > MAX_TOTAL_BYTES)
    throw new RangeError("Decoded audio exceeds 24 MiB per source or 96 MiB total.");
  const channels = Array.from({ length: count }, (_, channel) =>
    new Float32Array(buffer.getChannelData(channel)));
  return { name: String(name || `Source ${index + 1}`).slice(0, 80),
    kind, sampleRate: rate, duration: length / rate, channels, bytes,
    waveform: waveformOf(channels) };
}

/** Stage the entire batch; callers place nothing on the floor unless every
 * file decodes and the final set fits the decoded-source limits. */
export async function decodeLocalSources(files, startIndex, sources, Offline =
  globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext) {
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= SOURCE_COUNT
    || sources?.length !== SOURCE_COUNT)
    throw new RangeError("Choose a source ribbon first.");
  const list = Array.from(files ?? []);
  if (!list.length || list.length > SOURCE_COUNT)
    throw new RangeError("Choose between one and eight audio files for the floor.");
  if (list.some(file => !Number.isSafeInteger(file?.size)
    || file.size < 1 || file.size > MAX_FILE_BYTES))
    throw new RangeError("Each audio file must be nonempty and at most 12 MiB.");
  const staged = sources.slice(), placements = [];
  for (const [offset, file] of list.entries()) {
    const index = (startIndex + offset) % SOURCE_COUNT;
    const source = await decodeLocalSource(file, index, staged, Offline);
    staged[index] = source;
    placements.push({ index, source });
  }
  return placements;
}
