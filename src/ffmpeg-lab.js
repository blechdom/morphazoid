const DEFAULT_FILTER_GRAPH = [
  "highpass=f=120",
  "lowpass=f=3200",
  "acompressor=threshold=-20dB:ratio=2.2:attack=8:release=90:makeup=1.2",
  "aecho=0.74:0.35:42:0.22",
].join(",");

function freezePreset(preset) {
  return Object.freeze({ ...preset });
}

export const FFMPEG_LAB_FILTER_PRESETS = Object.freeze([
  freezePreset({
    id: "tin-can-relay",
    label: "Tin can relay",
    filterGraph: [
      "highpass=f=450",
      "lowpass=f=2400",
      "acompressor=threshold=-24dB:ratio=2.8:attack=4:release=80:makeup=1.4",
      "aecho=0.76:0.42:36:0.26",
    ].join(","),
    detail: "Narrowband, compressed, and short metallic echo.",
  }),
  freezePreset({
    id: "chorus-ladder",
    label: "Chorus ladder",
    filterGraph: [
      "highpass=f=140",
      "lowpass=f=6800",
      "chorus=0.58:0.78:30|44:0.18|0.13:0.32|0.24",
      "acompressor=threshold=-22dB:ratio=2.1:attack=9:release=120:makeup=1.1",
    ].join(","),
    detail: "Broader spectral body with moving duplicate voices.",
  }),
  freezePreset({
    id: "spectral-smear",
    label: "Spectral smear",
    filterGraph: [
      "highpass=f=90",
      "lowpass=f=5400",
      "aecho=0.72:0.48:60|120:0.24|0.16",
      "vibrato=f=5.2:d=0.42",
    ].join(","),
    detail: "Slowly blurred formants with a pitch-wobbled tail.",
  }),
  freezePreset({
    id: "octave-drift",
    label: "Octave drift",
    filterGraph: [
      "asetrate=sample_rate*1.5",
      "aresample=sample_rate",
      "highpass=f=180",
      "lowpass=f=5200",
      "aecho=0.78:0.3:55:0.18",
    ].join(","),
    detail: "Faster, brighter chunk transposition with short ghosting.",
  }),
  freezePreset({
    id: "custom",
    label: "Custom filtergraph",
    filterGraph: DEFAULT_FILTER_GRAPH,
    detail: "Edit the ffmpeg -af graph directly below.",
  }),
]);

export const FFMPEG_LAB_VIDEO_FORMATS = Object.freeze([
  Object.freeze({ id: "mkv", label: "Matroska / FFV1 + PCM" }),
  Object.freeze({ id: "webm", label: "WebM / VP9 + Opus" }),
]);

export const FFMPEG_LAB_DEFAULTS = Object.freeze({
  presetId: "tin-can-relay",
  filterGraph: DEFAULT_FILTER_GRAPH,
  inputLevel: 1,
  outputLevel: 0.62,
  chunkMs: 240,
  maxQueue: 6,
  historySeconds: 8,
  clipSeconds: 6,
  videoFps: 12,
  videoFormat: "mkv",
});

function clamp(value, minimum, maximum, fallback = minimum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

export function levelToGain(value) {
  const normalized = clamp(value, 0, 1, FFMPEG_LAB_DEFAULTS.outputLevel);
  return normalized === 0 ? 0 : normalized ** 1.7;
}

export function chunkFramesForMs(chunkMs, sampleRate = 48_000) {
  const boundedMs = clamp(chunkMs, 80, 750, FFMPEG_LAB_DEFAULTS.chunkMs);
  const boundedRate = Math.round(clamp(sampleRate, 8_000, 192_000, 48_000));
  const rawFrames = Math.round(boundedRate * boundedMs / 1_000);
  return Math.max(2_048, Math.round(rawFrames / 128) * 128);
}

export function sanitizeFfmpegLabState(state = {}) {
  const source = state && typeof state === "object" ? state : {};
  const presetId = typeof source.presetId === "string" ? source.presetId : FFMPEG_LAB_DEFAULTS.presetId;
  const videoFormat = FFMPEG_LAB_VIDEO_FORMATS.some(({ id }) => id === source.videoFormat)
    ? source.videoFormat
    : FFMPEG_LAB_DEFAULTS.videoFormat;
  const preset = filterPresetById(presetId);
  const filterGraph = String(source.filterGraph ?? preset.filterGraph ?? DEFAULT_FILTER_GRAPH)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 512);
  return Object.freeze({
    presetId: preset.id,
    filterGraph: filterGraph || DEFAULT_FILTER_GRAPH,
    inputLevel: clamp(source.inputLevel, 0, 4, FFMPEG_LAB_DEFAULTS.inputLevel),
    outputLevel: clamp(source.outputLevel, 0, 0.85, FFMPEG_LAB_DEFAULTS.outputLevel),
    chunkMs: clamp(source.chunkMs, 80, 750, FFMPEG_LAB_DEFAULTS.chunkMs),
    maxQueue: Math.round(clamp(source.maxQueue, 2, 12, FFMPEG_LAB_DEFAULTS.maxQueue)),
    historySeconds: clamp(source.historySeconds, 2, 12, FFMPEG_LAB_DEFAULTS.historySeconds),
    clipSeconds: clamp(source.clipSeconds, 2, 8, FFMPEG_LAB_DEFAULTS.clipSeconds),
    videoFps: Math.round(clamp(source.videoFps, 6, 24, FFMPEG_LAB_DEFAULTS.videoFps)),
    videoFormat,
  });
}

export function filterPresetById(id) {
  return FFMPEG_LAB_FILTER_PRESETS.find((preset) => preset.id === id)
    ?? FFMPEG_LAB_FILTER_PRESETS[0];
}

export function floatToPcm16(samples) {
  const source = samples instanceof Float32Array ? samples : Float32Array.from(samples ?? []);
  const output = new Int16Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, Number(source[index]) || 0));
    output[index] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return output;
}

export function appendHistory(history, chunk, maxFrames) {
  const safeHistory = Array.isArray(history) ? [...history] : [];
  const safeChunk = chunk instanceof Float32Array ? chunk : Float32Array.from(chunk ?? []);
  if (safeChunk.length) safeHistory.push(safeChunk);
  let frames = safeHistory.reduce((total, entry) => total + entry.length, 0);
  while (frames > maxFrames && safeHistory.length > 1) {
    frames -= safeHistory.shift()?.length ?? 0;
  }
  if (frames > maxFrames && safeHistory[0]) {
    safeHistory[0] = safeHistory[0].subarray(frames - maxFrames);
  }
  return safeHistory;
}

export function concatHistory(history, maxFrames = Infinity) {
  const chunks = Array.isArray(history) ? history.filter((chunk) => chunk?.length) : [];
  if (!chunks.length) return new Float32Array(0);
  const limited = Number.isFinite(maxFrames) ? Math.max(0, Math.floor(maxFrames)) : Infinity;
  let frames = 0;
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    frames += chunks[index].length;
    if (frames >= limited) {
      const startIndex = index;
      const selected = chunks.slice(startIndex);
      const total = selected.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Float32Array(total);
      let offset = 0;
      for (const chunk of selected) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      return limited < total ? combined.subarray(total - limited) : combined;
    }
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

export function rmsLevel(samples) {
  const source = samples instanceof Float32Array ? samples : Float32Array.from(samples ?? []);
  if (!source.length) return 0;
  let sum = 0;
  for (let index = 0; index < source.length; index += 1) sum += source[index] * source[index];
  return Math.sqrt(sum / source.length);
}

export function peakLevel(samples) {
  const source = samples instanceof Float32Array ? samples : Float32Array.from(samples ?? []);
  let peak = 0;
  for (let index = 0; index < source.length; index += 1) peak = Math.max(peak, Math.abs(source[index]));
  return peak;
}

export function buildFfmpegAudioArgs({
  sampleRate = 48_000,
  filterGraph = DEFAULT_FILTER_GRAPH,
  inputPath = "input.wav",
  outputPath = "output.wav",
} = {}) {
  return [
    "-i",
    inputPath,
    "-af",
    filterGraph || DEFAULT_FILTER_GRAPH,
    "-c:a",
    "pcm_s16le",
    "-ar",
    String(Math.round(clamp(sampleRate, 8_000, 192_000, 48_000))),
    "-ac",
    "1",
    outputPath,
  ];
}

export function buildFfmpegVideoArgs({
  fps = FFMPEG_LAB_DEFAULTS.videoFps,
  framePattern = "frame-%03d.ppm",
  audioPath = "audio.wav",
  outputPath = "clip.mkv",
  format = FFMPEG_LAB_DEFAULTS.videoFormat,
} = {}) {
  const safeFps = Math.round(clamp(fps, 6, 24, FFMPEG_LAB_DEFAULTS.videoFps));
  if (format === "webm") {
    return [
      "-framerate",
      String(safeFps),
      "-i",
      framePattern,
      "-i",
      audioPath,
      "-shortest",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libvpx-vp9",
      "-crf",
      "34",
      "-b:v",
      "0",
      "-c:a",
      "libopus",
      outputPath,
    ];
  }
  return [
    "-framerate",
    String(safeFps),
    "-i",
    framePattern,
    "-i",
    audioPath,
    "-shortest",
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "ffv1",
    "-level",
    "3",
    "-g",
    "1",
    "-c:a",
    "pcm_s16le",
    outputPath,
  ];
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function createPpmFrame(width, height, pixels) {
  const safeWidth = Math.max(16, Math.round(width || 0));
  const safeHeight = Math.max(16, Math.round(height || 0));
  const header = `P6\n${safeWidth} ${safeHeight}\n255\n`;
  const headerBytes = new TextEncoder().encode(header);
  const body = pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels ?? []);
  const output = new Uint8Array(headerBytes.length + body.length);
  output.set(headerBytes, 0);
  output.set(body, headerBytes.length);
  return output;
}

function rgb(hex) {
  const value = String(hex).replace("#", "");
  const parsed = Number.parseInt(value, 16);
  return value.length === 6 && Number.isFinite(parsed)
    ? [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255]
    : [8, 11, 15];
}

export function createTelemetryFrame(history, {
  width = 320,
  height = 180,
  frameIndex = 0,
  totalFrames = 1,
} = {}) {
  const safeWidth = Math.max(64, Math.round(width));
  const safeHeight = Math.max(64, Math.round(height));
  const pixels = new Uint8Array(safeWidth * safeHeight * 3);
  const background = rgb("#070b0d");
  const inputColor = rgb("#58d5ff");
  const outputColor = rgb("#ffd479");
  const queueColor = rgb("#ff73ba");
  for (let index = 0; index < pixels.length; index += 3) {
    pixels[index] = background[0];
    pixels[index + 1] = background[1];
    pixels[index + 2] = background[2];
  }
  const entries = Array.isArray(history) ? history : [];
  if (!entries.length) return createPpmFrame(safeWidth, safeHeight, pixels);
  const span = Math.max(1, Math.min(entries.length, safeWidth));
  const start = Math.max(
    0,
    Math.min(
      entries.length - span,
      Math.round((entries.length - span) * (frameIndex / Math.max(1, totalFrames - 1))),
    ),
  );
  for (let column = 0; column < span; column += 1) {
    const entry = entries[start + column];
    if (!entry) continue;
    const x = Math.round(column / Math.max(1, span - 1) * (safeWidth - 1));
    const inputHeight = Math.max(1, Math.round(clamp(entry.inputLevel, 0, 1, 0) * safeHeight * 0.45));
    const outputHeight = Math.max(1, Math.round(clamp(entry.outputLevel, 0, 1, 0) * safeHeight * 0.45));
    const queueHeight = Math.max(0, Math.round(clamp(entry.backlogRatio, 0, 1, 0) * safeHeight * 0.18));
    for (let y = 0; y < inputHeight; y += 1) {
      const row = safeHeight - 1 - y;
      const offset = (row * safeWidth + x) * 3;
      pixels[offset] = inputColor[0];
      pixels[offset + 1] = inputColor[1];
      pixels[offset + 2] = inputColor[2];
    }
    for (let y = 0; y < outputHeight; y += 1) {
      const row = Math.floor(safeHeight * 0.48) - y;
      if (row < 0 || row >= safeHeight) continue;
      const offset = (row * safeWidth + x) * 3;
      pixels[offset] = outputColor[0];
      pixels[offset + 1] = outputColor[1];
      pixels[offset + 2] = outputColor[2];
    }
    for (let y = 0; y < queueHeight; y += 1) {
      const row = Math.floor(safeHeight * 0.16) - y;
      if (row < 0 || row >= safeHeight) continue;
      const offset = (row * safeWidth + x) * 3;
      pixels[offset] = queueColor[0];
      pixels[offset + 1] = queueColor[1];
      pixels[offset + 2] = queueColor[2];
    }
  }
  return createPpmFrame(safeWidth, safeHeight, pixels);
}

export function formatMilliseconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `${Math.round(numeric)} ms`;
}

export function formatPercent(value) {
  return `${Math.round(clamp(value, 0, 1, 0) * 100)}%`;
}

export function createWaveFileHeader(sampleCount, sampleRate) {
  const dataBytes = Math.max(0, Math.floor(sampleCount)) * 2;
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}
