export const FFMPEG_CORE_VERSION = "0.12.10";
export const FFMPEG_WRAPPER_VERSION = "0.12.15";

export const CHUNK_SECONDS = Object.freeze([0.5, 1, 2]);
export const DEFAULT_SETTINGS = Object.freeze({
  recipe: "telephone",
  chunkSeconds: 1,
  outputLevel: 0.28,
});
export const MAX_QUEUED_CHUNKS = 2;
export const OVERLAP_SECONDS = 0.02;

export const RECIPES = Object.freeze([
  Object.freeze({
    id: "clean",
    label: "Clean relay",
    filter: "anull",
    description: "No creative filter.",
  }),
  Object.freeze({
    id: "telephone",
    label: "Pocket telephone",
    filter: "highpass=f=350,lowpass=f=3200,acompressor=threshold=0.1:ratio=3:attack=15:release=180",
    description: "Narrow, compressed voice.",
  }),
  Object.freeze({
    id: "tremolo",
    label: "Machine tremolo",
    filter: "tremolo=f=6:d=0.72",
    description: "6 Hz amplitude chop.",
  }),
  Object.freeze({
    id: "crusher",
    label: "Seven-bit crusher",
    filter: "acrusher=bits=7:mix=0.72:mode=lin",
    description: "Low-resolution digital rasp.",
  }),
  Object.freeze({
    id: "reverse",
    label: "Window reverse",
    filter: "areverse",
    description: "Each window plays backward.",
  }),
]);

const RECIPE_BY_ID = new Map(RECIPES.map((recipe) => [recipe.id, recipe]));

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value, minimum)));
}

export function recipeForId(id) {
  return RECIPE_BY_ID.get(String(id)) ?? RECIPE_BY_ID.get(DEFAULT_SETTINGS.recipe);
}

export function sanitizeSettings(settings = {}) {
  const requestedChunk = finiteNumber(settings.chunkSeconds, DEFAULT_SETTINGS.chunkSeconds);
  const chunkSeconds = CHUNK_SECONDS.reduce((nearest, candidate) => (
    Math.abs(candidate - requestedChunk) < Math.abs(nearest - requestedChunk)
      ? candidate
      : nearest
  ), CHUNK_SECONDS[0]);

  return Object.freeze({
    recipe: recipeForId(settings.recipe).id,
    chunkSeconds,
    outputLevel: Number.isFinite(Number(settings.outputLevel))
      ? clamp(settings.outputLevel, 0, 0.65)
      : DEFAULT_SETTINGS.outputLevel,
  });
}

export function safeSampleRate(value) {
  return Math.round(clamp(value, 8_000, 96_000));
}

export function createFilterGraph(settings = {}) {
  const sanitized = sanitizeSettings(settings);
  const recipe = recipeForId(sanitized.recipe);
  const duration = sanitized.chunkSeconds.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${recipe.filter},atrim=duration=${duration},asetpts=N/SR/TB,volume=0.82,alimiter=limit=0.9`;
}

function assertVirtualFilename(value, label) {
  const filename = String(value ?? "");
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(filename)) {
    throw new TypeError(`${label} must be a simple FFmpeg virtual filename.`);
  }
  return filename;
}

export function createFfmpegCommand({
  inputName,
  outputName,
  sampleRate,
  settings,
}) {
  const input = assertVirtualFilename(inputName, "Input name");
  const output = assertVirtualFilename(outputName, "Output name");
  const rate = String(safeSampleRate(sampleRate));

  return Object.freeze([
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "f32le",
    "-ar",
    rate,
    "-ac",
    "1",
    "-i",
    input,
    "-af",
    createFilterGraph(settings),
    "-ar",
    rate,
    "-ac",
    "1",
    "-c:a",
    "pcm_f32le",
    "-f",
    "f32le",
    output,
  ]);
}

export function float32ToBytes(samples) {
  const source = samples instanceof Float32Array ? samples : Float32Array.from(samples ?? []);
  const bytes = new Uint8Array(source.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < source.length; index += 1) {
    const sample = Number.isFinite(source[index])
      ? clamp(source[index], -1, 1)
      : 0;
    view.setFloat32(index * 4, sample, true);
  }
  return bytes;
}

export function bytesToFloat32(bytes, maximumFrames = 192_000) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? 0);
  const frameCount = Math.min(Math.floor(source.byteLength / 4), Math.max(0, Math.trunc(maximumFrames)));
  const samples = new Float32Array(frameCount);
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  for (let index = 0; index < frameCount; index += 1) {
    const sample = view.getFloat32(index * 4, true);
    samples[index] = Number.isFinite(sample)
      ? clamp(sample, -1, 1)
      : 0;
  }
  return samples;
}

export function encodeMonoWav(samples, sampleRate) {
  const source = samples instanceof Float32Array ? samples : Float32Array.from(samples ?? []);
  const rate = safeSampleRate(sampleRate);
  const bytes = new Uint8Array(44 + source.length * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + source.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, source.length * 2, true);

  for (let index = 0; index < source.length; index += 1) {
    const sample = Number.isFinite(source[index])
      ? clamp(source[index], -1, 1)
      : 0;
    const pcm = sample < 0 ? Math.round(sample * 32_768) : Math.round(sample * 32_767);
    view.setInt16(44 + index * 2, pcm, true);
  }
  return bytes;
}

export function downsampleWaveform(samples, pointCount = 96) {
  const source = samples instanceof Float32Array ? samples : Float32Array.from(samples ?? []);
  const count = Math.max(1, Math.trunc(pointCount));
  const result = new Float32Array(count);
  if (source.length === 0) return result;
  for (let point = 0; point < count; point += 1) {
    const start = Math.floor((point * source.length) / count);
    const end = Math.max(start + 1, Math.floor(((point + 1) * source.length) / count));
    let peak = 0;
    for (let index = start; index < Math.min(end, source.length); index += 1) {
      if (Math.abs(source[index]) > Math.abs(peak)) peak = source[index];
    }
    result[point] = Number.isFinite(peak) ? peak : 0;
  }
  return result;
}

export function pushBoundedQueue(queue, item, maximum = MAX_QUEUED_CHUNKS) {
  const limit = Math.max(0, Math.trunc(finiteNumber(maximum, MAX_QUEUED_CHUNKS)));
  const next = [...(Array.isArray(queue) ? queue : []), item];
  const excess = Math.max(0, next.length - limit);
  return Object.freeze({
    queue: Object.freeze(next.slice(excess)),
    dropped: excess ? Object.freeze(next.slice(0, excess)) : Object.freeze([]),
  });
}
