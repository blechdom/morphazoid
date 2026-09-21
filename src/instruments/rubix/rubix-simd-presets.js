import { RUBIX_WEBGPU_303_DEFAULTS } from "./rubix-webgpu-303.js";

const clamp = (v, lo, hi, fallback = 0) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : fallback));

const CONTROLS = Object.freeze({
  cutoff: 980, resonance: 11.5, acidDecay: 0.18, drive: 2.4, stickerModulation: 0.68,
});

function patch(id, label, description, controls = {}, voice = {}, spectrumMorph = 0, surface = true) {
  return Object.freeze({
    id, label, description, surface, spectrumMorph,
    controls: Object.freeze({ ...CONTROLS, ...controls }),
    // No preset owns output, acidLevel, drumLevel, transport, tempo or geometry.
    voice: Object.freeze({ ...RUBIX_WEBGPU_303_DEFAULTS, lfo: 0, ...voice }),
  });
}

export const RUBIX_SIMD_PRESETS = Object.freeze([
  patch("color-circuit", "Color circuit", "Dry saw acid · color articulation · the visible surface steers tone.", {
    cutoff: 840, resonance: 10.8, acidDecay: 0.28, drive: 1.8,
  }, { ratio: 1.65, gain: 0.13 }),
  patch("rubber-corners", "Rubber corners", "Low, round square bass · long bodies and soft corners.", {
    cutoff: 480, resonance: 5.6, acidDecay: 0.48, drive: 1.3,
  }, { fundamental: 440, ratio: 1.15, gain: 0.17 }, 0.92),
  patch("silver-facets", "Silver facets", "Short, pointed saw accents · bright tilted facets.", {
    cutoff: 1380, resonance: 14.2, acidDecay: 0.15, drive: 2.6, stickerModulation: 0.85,
  }, { fundamental: 980, ratio: 2.05, gain: 0.14 }),
  patch("wooden-square", "Wooden square", "Hollow odd harmonics · dry, woody notes.", {
    cutoff: 660, resonance: 6.8, acidDecay: 0.33, drive: 1.5,
  }, { fundamental: 690, ratio: 2.8, gain: 0.16 }, 1),
  patch("pulse-prism", "Pulse prism", "Nasal pulse acid · clipped articulation and sharp edges.", {
    cutoff: 1960, resonance: 12.4, acidDecay: 0.18, drive: 2.9, stickerModulation: 0.9,
  }, { fundamental: 1000, ratio: 3.6, gain: 0.2 }, 2),
  patch("glass-wire", "Glass wire", "Thin, ringing upper partials · longer triangular notes.", {
    cutoff: 2420, resonance: 13.5, acidDecay: 0.55, drive: 2,
  }, { fundamental: 960, ratio: 1.2, sampOffset: 2, gain: 0.24 }, 2.65),
  patch("warm-diode", "Warm diode", "Broad driven saw body · a slow opening note envelope.", {
    cutoff: 1740, resonance: 7.2, acidDecay: 0.62, drive: 3.1,
  }, { fundamental: 580, ratio: 2.2, gain: 0.13 }, 0.3),
  patch("morphix-bloom", "Morphix bloom", "Full, sustained acid · curved and pointed surfaces open the tone.", {
    cutoff: 1180, resonance: 10.4, acidDecay: 0.46, drive: 2.2, stickerModulation: 0.82,
  }, { ratio: 1.8, gain: 0.16 }, 0.15),
  patch("original-sweep", "Original SIMD sweep", "The previous SIMD patch, including its independent filter LFO.", {},
    { ...RUBIX_WEBGPU_303_DEFAULTS }, 0, false),
]);

export const DEFAULT_RUBIX_SIMD_PRESET = "color-circuit";
export function rubixSimdPreset(id = DEFAULT_RUBIX_SIMD_PRESET) {
  return RUBIX_SIMD_PRESETS.find((preset) => preset.id === id) ?? RUBIX_SIMD_PRESETS[0];
}

export function rubixSimdVoiceParams(settings = {}) {
  const preset = rubixSimdPreset(settings.simdPreset);
  const controls = { ...preset.controls, ...settings };
  const position = (Math.log(clamp(controls.cutoff, 160, 4200, 980)) - Math.log(160))
    / (Math.log(4200) - Math.log(160));
  return {
    ...preset.voice,
    flt: -28 + position * 56,
    res: clamp(controls.resonance, 0, 18, 11.5) / 18 * 15,
    dur: clamp(controls.acidDecay, 0.06, 0.72, 0.18),
    dist: clamp(controls.drive, 0.5, 6, 2.4) * 0.58,
    swing: clamp(controls.swing, 0, 0.42),
  };
}

// Retain the established color pitches. Color now also has a repeatable
// articulation/filter identity instead of sharing one free-running sweep.
export const RUBIX_SIMD_COLOR_TONE = Object.freeze({
  white: Object.freeze({ filter: 15, resonance: 1.4, accent: 0.3, gate: 0.78 }),
  yellow: Object.freeze({ filter: -20, resonance: -2.4, accent: 0.1, gate: 1 }),
  green: Object.freeze({ filter: -5, resonance: 0.2, accent: 0.2, gate: 0.92 }),
  blue: Object.freeze({ filter: -12, resonance: 2.7, accent: 0.08, gate: 1 }),
  red: Object.freeze({ filter: 9, resonance: 3.2, accent: 0.48, gate: 0.64 }),
  orange: Object.freeze({ filter: 3, resonance: -0.8, accent: 0.25, gate: 0.84 }),
});

/**
 * Live tone comes from the drawn geometry, not a second invisible motion model.
 * Screen height/depth opens the filter, warped radial extent adds edge color,
 * and screen X balances stereo. Area/occlusion gain remains a separate gate.
 */
export function rubixSimdSurfaceTone(geometry, { width = 1, height = 1, size = 3 } = {}, amount = 0.68) {
  const influence = clamp(amount, 0, 1, 0.68);
  const extent = Math.max(1, Math.min(width, height) * 0.4);
  return Object.fromEntries(geometry.map((item) => {
    const x = clamp((item.projectedCenter.x - width * 0.5) / extent, -1, 1);
    const y = clamp((item.projectedCenter.y - height * 0.525) / extent, -1, 1);
    const depth = clamp(item.depth / 2, -1, 1);
    const radius = Math.hypot(item.center.x, item.center.y, item.center.z) / Math.max(1, size);
    return [item.sticker.id, {
      filter: influence * clamp(-y * 21 + depth * 10 + (radius - 0.65) * 40, -40, 40),
      pan: influence * x * 0.8,
    }];
  }));
}

/** Performer levels are not patch state, including mute/zero. */
export function rubixPerformerLevels(state) {
  return { output: state.output, acidLevel: state.acidLevel, drumLevel: state.drumLevel };
}
