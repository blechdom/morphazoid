const finiteNumber = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clamp = (value, minimum, maximum, fallback) => Math.min(
  maximum,
  Math.max(minimum, finiteNumber(value, fallback)),
);

export const PLUGAZOID_LIMITS = Object.freeze({
  inputTrimDb: Object.freeze([-18, 12]),
  driveDb: Object.freeze([0, 24]),
  toneHz: Object.freeze([180, 14_000]),
  mix: Object.freeze([0, 1]),
  outputLevel: Object.freeze([0, 0.82]),
});

export const PLUGAZOID_PLUGIN_FORMATS = Object.freeze([
  Object.freeze({
    id: "vst3",
    label: "VST3",
    status: "source-port target",
    available: true,
  }),
  Object.freeze({
    id: "clap",
    label: "CLAP",
    status: "next adapter",
    available: false,
  }),
  Object.freeze({
    id: "audio-unit",
    label: "Audio Unit",
    status: "macOS adapter",
    available: false,
  }),
]);

export const PLUGAZOID_DEFAULTS = Object.freeze({
  format: "vst3",
  preset: "warm-port",
  inputTrimDb: 0,
  driveDb: 8,
  toneHz: 4_200,
  mix: 0.72,
  outputLevel: 0.52,
  bypassed: false,
});

export const PLUGAZOID_PRESETS = Object.freeze([
  Object.freeze({
    id: "clean-port",
    label: "Clean port",
    values: Object.freeze({ inputTrimDb: 0, driveDb: 1.5, toneHz: 9_200, mix: 0.38 }),
  }),
  Object.freeze({
    id: "warm-port",
    label: "Warm port",
    values: Object.freeze({ inputTrimDb: 0, driveDb: 8, toneHz: 4_200, mix: 0.72 }),
  }),
  Object.freeze({
    id: "feral-port",
    label: "Feral port",
    values: Object.freeze({ inputTrimDb: -4, driveDb: 18, toneHz: 1_350, mix: 0.92 }),
  }),
]);

const formatIds = new Set(PLUGAZOID_PLUGIN_FORMATS.map(({ id }) => id));
const presetIds = new Set(PLUGAZOID_PRESETS.map(({ id }) => id));

export function sanitizePlugazoidSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.freeze({
    format: formatIds.has(source.format) ? source.format : PLUGAZOID_DEFAULTS.format,
    preset: presetIds.has(source.preset) || source.preset === "custom"
      ? source.preset
      : PLUGAZOID_DEFAULTS.preset,
    inputTrimDb: clamp(
      source.inputTrimDb,
      ...PLUGAZOID_LIMITS.inputTrimDb,
      PLUGAZOID_DEFAULTS.inputTrimDb,
    ),
    driveDb: clamp(
      source.driveDb,
      ...PLUGAZOID_LIMITS.driveDb,
      PLUGAZOID_DEFAULTS.driveDb,
    ),
    toneHz: clamp(
      source.toneHz,
      ...PLUGAZOID_LIMITS.toneHz,
      PLUGAZOID_DEFAULTS.toneHz,
    ),
    mix: clamp(source.mix, ...PLUGAZOID_LIMITS.mix, PLUGAZOID_DEFAULTS.mix),
    outputLevel: clamp(
      source.outputLevel,
      ...PLUGAZOID_LIMITS.outputLevel,
      PLUGAZOID_DEFAULTS.outputLevel,
    ),
    bypassed: Boolean(source.bypassed),
  });
}

export function decibelsToGain(value) {
  const decibels = clamp(value, -96, 48, 0);
  return 10 ** (decibels / 20);
}

export function outputLevelToGain(value) {
  const level = clamp(value, 0, 1, PLUGAZOID_DEFAULTS.outputLevel);
  return level === 0 ? 0 : level ** 1.65;
}

export function rmsToDecibels(value) {
  const rms = Math.max(0, finiteNumber(value, 0));
  if (rms < 0.00001) return -100;
  return Math.max(-100, Math.min(0, 20 * Math.log10(rms)));
}

export function meterPercentage(value) {
  const decibels = rmsToDecibels(value);
  return Math.max(0, Math.min(100, (decibels + 60) / 60 * 100));
}

export function classifyPluginArtifact(filename) {
  const name = String(filename ?? "").trim();
  const lower = name.toLowerCase();
  if (!name) {
    return Object.freeze({
      kind: "empty",
      format: null,
      browserRunnable: false,
      message: "Choose a file to inspect its packaging. Nothing is uploaded.",
    });
  }

  const nativeFormats = [
    [".vst3", "VST3"],
    [".clap", "CLAP"],
    [".component", "Audio Unit"],
  ];
  const native = nativeFormats.find(([extension]) => lower.endsWith(extension));
  if (native) {
    return Object.freeze({
      kind: "native-bundle",
      format: native[1],
      browserRunnable: false,
      message: native[1] + " is a native bundle. Plugazoid needs its DSP source ported to AudioWorklet/WASM, or a local native bridge.",
    });
  }

  if (lower.endsWith(".wasm")) {
    return Object.freeze({
      kind: "wasm-module",
      format: "WebAssembly",
      browserRunnable: false,
      message: "WebAssembly can run here after an AudioWorklet adapter defines the audio buffers, parameters, state, and lifecycle ABI.",
    });
  }

  if (lower.endsWith(".json")) {
    return Object.freeze({
      kind: "descriptor",
      format: "WAM descriptor",
      browserRunnable: false,
      message: "A descriptor can identify a Web Audio Module, but its validated module and processor are also required.",
    });
  }

  if (lower.endsWith(".mjs") || lower.endsWith(".js")) {
    return Object.freeze({
      kind: "browser-module",
      format: "JavaScript module",
      browserRunnable: false,
      message: "A JavaScript module is only loadable after it passes the host's WAM/API and trust checks.",
    });
  }

  return Object.freeze({
    kind: "unknown",
    format: null,
    browserRunnable: false,
    message: "Unknown package. The MVP accepts no arbitrary executable plug-in code.",
  });
}
