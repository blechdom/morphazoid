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
  outputLevel: Object.freeze([0, 0.82]),
});

export const PLUGAZOID_WAM_ENDPOINTS = Object.freeze({
  catalog: "https://www.webaudiomodules.com/community/plugins.json",
  plugins: "https://www.webaudiomodules.com/community/plugins/",
  sdk: "https://www.webaudiomodules.com/sdk/2.0.0-alpha.6/src/initializeWamHost.js",
});

export const PLUGAZOID_STARTER_WAMS = Object.freeze([
  Object.freeze({
    identifier: "com.sequencerParty.simpleDistortion",
    name: "Simple Distortion",
    vendor: "Sequencer Party",
    description: "Waveshaper distortion with variable curve and gain.",
    category: Object.freeze(["Effect", "Distortion"]),
    path: "burns-audio/distortion/index.js",
  }),
  Object.freeze({
    identifier: "com.sequencerParty.simpleDelay",
    name: "Simple Delay",
    vendor: "Sequencer Party",
    description: "Stereo filtered delay.",
    category: Object.freeze(["Effect", "Delay"]),
    path: "burns-audio/delay/index.js",
  }),
  Object.freeze({
    identifier: "com.sequencerParty.simpleEQ",
    name: "Simple EQ",
    vendor: "Sequencer Party",
    description: "Three-band equalizer.",
    category: Object.freeze(["Effect", "Equalizer & Filter"]),
    path: "burns-audio/simpleEQ/index.js",
  }),
]);

export const PLUGAZOID_DEFAULTS = Object.freeze({
  inputTrimDb: 0,
  outputLevel: 0.52,
  bypassed: false,
});

const preferredWamOrder = new Map(
  PLUGAZOID_STARTER_WAMS.map(({ identifier }, index) => [identifier, index]),
);

export function sanitizePlugazoidSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.freeze({
    inputTrimDb: clamp(
      source.inputTrimDb,
      ...PLUGAZOID_LIMITS.inputTrimDb,
      PLUGAZOID_DEFAULTS.inputTrimDb,
    ),
    outputLevel: clamp(
      source.outputLevel,
      ...PLUGAZOID_LIMITS.outputLevel,
      PLUGAZOID_DEFAULTS.outputLevel,
    ),
    bypassed: Boolean(source.bypassed),
  });
}

export function resolveWamModuleUrl(path, pluginBaseUrl = PLUGAZOID_WAM_ENDPOINTS.plugins) {
  try {
    const base = new URL(pluginBaseUrl);
    const target = new URL(String(path ?? "").trim(), base);
    const supportedProtocol = base.protocol === "https:" || base.protocol === "http:";
    const insideBase = target.origin === base.origin && target.pathname.startsWith(base.pathname);
    if (!supportedProtocol || !insideBase || target.username || target.password || target.hash) return null;
    return target.href;
  } catch {
    return null;
  }
}

export function prepareWamCatalog(value, options = {}) {
  const source = Array.isArray(value) ? value : [];
  const pluginBaseUrl = options.pluginBaseUrl ?? PLUGAZOID_WAM_ENDPOINTS.plugins;
  const seen = new Set();
  const modules = [];

  for (const candidate of source) {
    if (!candidate || typeof candidate !== "object") continue;
    const identifier = String(candidate.identifier ?? "").trim();
    const name = String(candidate.name ?? "").trim();
    const vendor = String(candidate.vendor ?? "Unknown vendor").trim() || "Unknown vendor";
    const description = String(candidate.description ?? "").trim();
    const category = Array.isArray(candidate.category)
      ? candidate.category.map((entry) => String(entry).trim()).filter(Boolean)
      : [];
    const moduleUrl = resolveWamModuleUrl(candidate.path, pluginBaseUrl);
    if (!identifier || !name || !moduleUrl || seen.has(identifier)) continue;
    seen.add(identifier);
    modules.push(Object.freeze({
      identifier,
      name,
      vendor,
      description,
      category: Object.freeze(category),
      moduleUrl,
      isEffect: category[0]?.toLowerCase() === "effect",
    }));
  }

  const effects = modules
    .filter(({ isEffect }) => isEffect)
    .sort((left, right) => {
      const leftPreferred = preferredWamOrder.get(left.identifier) ?? Number.MAX_SAFE_INTEGER;
      const rightPreferred = preferredWamOrder.get(right.identifier) ?? Number.MAX_SAFE_INTEGER;
      if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
      return left.name.localeCompare(right.name) || left.vendor.localeCompare(right.vendor);
    });

  return Object.freeze({
    totalCount: modules.length,
    effectCount: effects.length,
    effects: Object.freeze(effects),
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
