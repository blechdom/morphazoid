import {
  DEFAULT_TONGUE_STATE,
  sanitizeTongueState,
} from "./tongue-physics.js";

const TAU = Math.PI * 2;

const clamp = (value, minimum = 0, maximum = 1) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
};

const cycle = (value) => ((Number(value) || 0) % 1 + 1) % 1;
const sine = (phase) => Math.sin(cycle(phase) * TAU);
const raisedSine = (phase) => sine(phase) * 0.5 + 0.5;
const smoothstep = (edge0, edge1, value) => {
  const amount = clamp((value - edge0) / Math.max(1e-9, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
};

const preset = (id, label, symbol, description) => Object.freeze({
  id,
  label,
  symbol,
  description,
});

export const TONGUE_MOTION_PRESETS = Object.freeze({
  p: preset("p", "P P P", "P", "Unvoiced bilabial pressure holds with a real sealed release."),
  b: preset("b", "B B B", "B", "Voiced bilabial closures that buzz behind the lips before release."),
  l: preset("l", "Long L", "L", "A high front tip with a lateral side channel instead of a complete stop."),
  "rolled-r": preset("rolled-r", "Rolled R", "RR", "Worklet-rate tongue-tip contacts at a trill-like rate."),
  raspberry: preset("raspberry", "Raspberry", "BRR", "A stretched tongue, leaky lip seal, turbulence, and fast flutter."),
  "la-la": preset("la-la", "La la la", "LA", "Repeated lateral tip contacts alternating with an open vowel posture."),
  wiggle: preset("wiggle", "Wiggle", "~", "A loose side-to-side tip wag with independent body motion."),
  gyrate: preset("gyrate", "Gyrate", "@", "A large looping tongue orbit through the full oral space."),
  lick: preset("lick", "Lick", "LICK", "A long elastic reach, curl, palate sweep, and retraction."),
  suck: preset("suck", "Suck", "SUK", "Ingressive turbulence, a tight seal, and repeated wet release clicks."),
});

export const TONGUE_PARAMETER_LIMITS = Object.freeze({
  tonguePosition: Object.freeze([0, 1]),
  tongueHeight: Object.freeze([0, 1]),
  tongueShape: Object.freeze([0, 1]),
  tongueTip: Object.freeze([0, 1]),
  tongueExtension: Object.freeze([0, 1]),
  tongueCurl: Object.freeze([0, 1]),
  tongueLateral: Object.freeze([0, 1]),
});

export const FERAL_TONGUE_PRESETS = Object.freeze({
  "meat-tornado": Object.freeze({
    id: "meat-tornado",
    label: "Meat tornado",
    motion: "gyrate",
    host: Object.freeze({
      pressure: 0.94, tension: 0.13, adduction: 0.91, sourceScale: 0.96,
      tractLengthM: 0.74, mouthOpening: 0.93, cavityCoupling: 0.88,
      asymmetry: 0.96, sourceBalance: 0.08, roughness: 0.98,
      gestureRate: 2.35, loopGapMs: 0,
    }),
    tongue: Object.freeze({
      tonguePosition: 0.78, tongueHeight: 0.88, tongueShape: 0.94,
      tongueTip: 0.98, tongueExtension: 0.86, tongueCurl: 0.92, tongueLateral: 0.12,
    }),
    modulation: Object.freeze({ rateBase: 0.31, rateSpread: 2.17, depth: 0.86, shapes: ["sine", "triangle", "square"] }),
  }),
  "rubber-opera": Object.freeze({
    id: "rubber-opera",
    label: "Rubber opera",
    motion: "la-la",
    host: Object.freeze({
      pressure: 0.82, tension: 0.86, adduction: 0.77, sourceScale: 0.12,
      tractLengthM: 0.79, mouthOpening: 0.71, cavityCoupling: 0.96,
      asymmetry: 0.76, sourceBalance: 0.82, roughness: 0.69,
      gestureRate: 1.84, loopGapMs: 120,
    }),
    tongue: Object.freeze({
      tonguePosition: 0.42, tongueHeight: 0.74, tongueShape: 0.18,
      tongueTip: 0.94, tongueExtension: 0.58, tongueCurl: 0.78, tongueLateral: 0.92,
    }),
    modulation: Object.freeze({ rateBase: 0.09, rateSpread: 1.37, depth: 0.72, shapes: ["triangle", "sine", "sample-hold"] }),
  }),
  "panic-goblin": Object.freeze({
    id: "panic-goblin",
    label: "Panic goblin",
    motion: "raspberry",
    host: Object.freeze({
      pressure: 1, tension: 0.98, adduction: 0.18, sourceScale: 0.09,
      tractLengthM: 0.024, mouthOpening: 0.18, cavityCoupling: 0.12,
      asymmetry: 1, sourceBalance: 0.04, roughness: 1,
      gestureRate: 2.48, loopGapMs: 40,
    }),
    tongue: Object.freeze({
      tonguePosition: 0.97, tongueHeight: 0.32, tongueShape: 0.99,
      tongueTip: 0.83, tongueExtension: 1, tongueCurl: 0.16, tongueLateral: 0.42,
    }),
    modulation: Object.freeze({ rateBase: 1.7, rateSpread: 3.91, depth: 0.93, shapes: ["square", "sample-hold", "triangle"] }),
  }),
  "inside-out": Object.freeze({
    id: "inside-out",
    label: "Inside-out suck",
    motion: "suck",
    host: Object.freeze({
      pressure: 0.72, tension: 0.08, adduction: 0.94, sourceScale: 0.9,
      tractLengthM: 0.68, mouthOpening: 0.04, cavityCoupling: 1,
      asymmetry: 0.83, sourceBalance: 0.9, roughness: 0.78,
      gestureRate: 0.34, loopGapMs: 6_900,
    }),
    tongue: Object.freeze({
      tonguePosition: 0.04, tongueHeight: 0.97, tongueShape: 0.08,
      tongueTip: 0.12, tongueExtension: 0.02, tongueCurl: 0.06, tongueLateral: 0.02,
    }),
    modulation: Object.freeze({ rateBase: 0.04, rateSpread: 0.83, depth: 0.9, shapes: ["sample-hold", "triangle", "square"] }),
  }),
});

function plosiveEnvelope(time, voiced) {
  const phase = cycle(time * (voiced ? 2.65 : 2.9));
  const release = smoothstep(0.57, 0.66, phase);
  const reclose = smoothstep(0.91, 0.995, phase);
  const opening = clamp(release - reclose);
  return {
    tongue: {
      tonguePosition: 0.42,
      tongueHeight: 0.28,
      tongueShape: 0.48,
      tongueTip: 0.2,
      tongueExtension: 0.04,
      tongueCurl: 0.46,
      tongueLateral: 0,
    },
    host: {
      pressure: voiced ? 0.76 : 0.94,
      tension: voiced ? 0.38 : 0.72,
      adduction: voiced ? 0.84 : 0.04,
      mouthOpening: opening * (voiced ? 0.58 : 0.72),
      roughness: voiced ? 0.16 : 0.96,
    },
    articulation: {
      active: true,
      airwayGate: opening,
      gatePosition: 0.995,
      lateralBypass: 0,
      flutterHz: 0,
      flutterDepth: 0,
      turbulence: voiced ? 0.12 : 0.48,
      flowDirection: 1,
      voicing: voiced ? 1 : 0,
      burstGain: voiced ? 0.64 : 0.82,
      burstFrequencyHz: voiced ? 920 : 1_050,
    },
  };
}

/**
 * Resolve one independent tongue performance layer. Slow poses are sampled by
 * the UI; flutter parameters are handed to the AudioWorklet and run per sample.
 */
export function sampleTongueMotionPreset(id, elapsedSeconds = 0, fallback = DEFAULT_TONGUE_STATE) {
  const key = Object.hasOwn(TONGUE_MOTION_PRESETS, id) ? id : "";
  const time = Math.max(0, Number(elapsedSeconds) || 0);
  const base = sanitizeTongueState(fallback);
  if (!key) return Object.freeze({
    id: "",
    tongue: base,
    host: Object.freeze({}),
    articulation: Object.freeze({ active: false }),
  });

  let result;
  if (key === "p" || key === "b") {
    result = plosiveEnvelope(time, key === "b");
  } else if (key === "l") {
    const sway = sine(time * 0.72);
    result = {
      tongue: {
        tonguePosition: 0.86 + sway * 0.025, tongueHeight: 0.78,
        tongueShape: 0.82, tongueTip: 0.94, tongueExtension: 0.14,
        tongueCurl: 0.84, tongueLateral: 0.92,
      },
      host: { pressure: 0.68, tension: 0.48, adduction: 0.82, mouthOpening: 0.62, roughness: 0.08 },
      articulation: {
        active: true, airwayGate: 0.13, gatePosition: 0.87, lateralBypass: 0.58,
        flutterHz: 0, flutterDepth: 0, turbulence: 0.03, flowDirection: 1,
        voicing: 1, burstGain: 0,
      },
    };
  } else if (key === "rolled-r") {
    const wag = sine(time * 3.2);
    result = {
      tongue: {
        tonguePosition: 0.84 + wag * 0.035, tongueHeight: 0.91,
        tongueShape: 0.95, tongueTip: 0.98, tongueExtension: 0.12,
        tongueCurl: 0.93, tongueLateral: 0.14,
      },
      host: { pressure: 0.84, tension: 0.44, adduction: 0.86, mouthOpening: 0.67, roughness: 0.12 },
      articulation: {
        active: true, airwayGate: 0.08, gatePosition: 0.9, lateralBypass: 0.06,
        flutterHz: 24, flutterDepth: 0.94, turbulence: 0.08, flowDirection: 1,
        voicing: 1, burstGain: 0.1,
      },
    };
  } else if (key === "raspberry") {
    const heave = sine(time * 2.1);
    result = {
      tongue: {
        tonguePosition: 0.98, tongueHeight: 0.38 + heave * 0.1,
        tongueShape: 0.78, tongueTip: 0.8 + heave * 0.12,
        tongueExtension: 0.94, tongueCurl: 0.38 + heave * 0.18,
        tongueLateral: 0.34,
      },
      host: { pressure: 0.96, tension: 0.24, adduction: 0.52, mouthOpening: 0.28, roughness: 0.88 },
      articulation: {
        active: true, airwayGate: 0.04, gatePosition: 0.985, lateralBypass: 0.05,
        flutterHz: 18.5, flutterDepth: 0.98, turbulence: 0.86, flowDirection: 1,
        voicing: 0.66, burstGain: 0.08,
      },
    };
  } else if (key === "la-la") {
    const syllable = cycle(time * 5.1);
    const contact = 1 - smoothstep(0.18, 0.36, syllable);
    const curl = 0.42 + contact * 0.56;
    result = {
      tongue: {
        tonguePosition: 0.43 + contact * 0.43, tongueHeight: 0.42 + contact * 0.4,
        tongueShape: 0.36 + contact * 0.48, tongueTip: 0.2 + contact * 0.78,
        tongueExtension: 0.16 + (1 - contact) * 0.18,
        tongueCurl: curl, tongueLateral: 0.88,
      },
      host: { pressure: 0.72, tension: 0.52, adduction: 0.84, mouthOpening: 0.72 - contact * 0.16, roughness: 0.06 },
      articulation: {
        active: true, airwayGate: 1 - contact * 0.88, gatePosition: 0.88,
        lateralBypass: 0.56, flutterHz: 0, flutterDepth: 0,
        turbulence: 0.02, flowDirection: 1, voicing: 1, burstGain: 0.04,
      },
    };
  } else if (key === "wiggle") {
    result = {
      tongue: {
        tonguePosition: 0.5 + sine(time * 2.8) * 0.36,
        tongueHeight: 0.52 + sine(time * 4.15 + 0.21) * 0.3,
        tongueShape: 0.38 + raisedSine(time * 1.73) * 0.54,
        tongueTip: 0.5 + sine(time * 5.6 + 0.44) * 0.46,
        tongueExtension: 0.24 + raisedSine(time * 2.17) * 0.55,
        tongueCurl: 0.5 + sine(time * 3.7 + 0.33) * 0.48,
        tongueLateral: 0.18 + raisedSine(time * 1.31) * 0.72,
      },
      host: { pressure: 0.72, mouthOpening: 0.72, roughness: 0.28 },
      articulation: { active: true, lateralBypass: 0.12, turbulence: 0.14, flowDirection: 1, voicing: 0.9, burstGain: 0.02 },
    };
  } else if (key === "gyrate") {
    result = {
      tongue: {
        tonguePosition: 0.5 + sine(time * 0.91) * 0.48,
        tongueHeight: 0.5 + sine(time * 1.37 + 0.25) * 0.47,
        tongueShape: 0.1 + raisedSine(time * 0.43) * 0.88,
        tongueTip: 0.5 + sine(time * 1.83 + 0.6) * 0.49,
        tongueExtension: 0.08 + raisedSine(time * 0.71 + 0.12) * 0.91,
        tongueCurl: 0.5 + sine(time * 1.19 + 0.42) * 0.49,
        tongueLateral: 0.06 + raisedSine(time * 0.57) * 0.9,
      },
      host: { pressure: 0.82, mouthOpening: 0.68 + sine(time * 0.58) * 0.24, roughness: 0.52 },
      articulation: { active: true, lateralBypass: 0.1, turbulence: 0.24, flowDirection: 1, voicing: 0.88, burstGain: 0.04 },
    };
  } else if (key === "lick") {
    const reach = raisedSine(time * 0.62);
    result = {
      tongue: {
        tonguePosition: 0.18 + reach * 0.81,
        tongueHeight: 0.2 + raisedSine(time * 0.62 + 0.2) * 0.77,
        tongueShape: 0.64 + reach * 0.32,
        tongueTip: 0.16 + raisedSine(time * 0.62 + 0.34) * 0.82,
        tongueExtension: reach ** 1.7,
        tongueCurl: 0.08 + raisedSine(time * 0.62 + 0.28) * 0.9,
        tongueLateral: 0.52,
      },
      host: { pressure: 0.48, mouthOpening: 0.84, roughness: 0.24 },
      articulation: { active: true, lateralBypass: 0.16, turbulence: 0.18, flowDirection: 1, voicing: 0.62, burstGain: 0.02 },
    };
  } else {
    const phase = cycle(time * 1.65);
    const sealed = 1 - smoothstep(0.62, 0.78, phase);
    result = {
      tongue: {
        tonguePosition: 0.08 + (1 - sealed) * 0.3,
        tongueHeight: 0.76 + sealed * 0.22,
        tongueShape: 0.22, tongueTip: 0.24 + sealed * 0.5,
        tongueExtension: 0.03, tongueCurl: 0.14 + sealed * 0.24,
        tongueLateral: 0.01,
      },
      host: { pressure: 0.7, tension: 0.16, adduction: 0.46, mouthOpening: 0.04 + (1 - sealed) * 0.26, roughness: 0.58 },
      articulation: {
        active: true, airwayGate: 1 - sealed * 0.99, gatePosition: 0.62,
        lateralBypass: 0, flutterHz: 0, flutterDepth: 0,
        turbulence: 0.62, flowDirection: -1, voicing: 0.18,
        burstGain: 0.46, burstFrequencyHz: 720,
      },
    };
  }

  return Object.freeze({
    id: key,
    tongue: sanitizeTongueState({ ...base, ...result.tongue }, base),
    host: Object.freeze({ ...result.host }),
    articulation: Object.freeze({
      active: true,
      airwayGate: null,
      gatePosition: null,
      lateralBypass: 0,
      flutterHz: 0,
      flutterDepth: 0,
      turbulence: 0,
      flowDirection: 1,
      voicing: 1,
      burstGain: 0,
      burstFrequencyHz: 1_050,
      ...result.articulation,
    }),
  });
}

function modulationWave(shape, phase, seed = 0) {
  const position = cycle(phase);
  if (shape === "triangle") return 1 - Math.abs(position - 0.5) * 4;
  if (shape === "square") return position < 0.5 ? 1 : -1;
  if (shape === "sample-hold") {
    const bucket = Math.floor(Number(phase) || 0);
    const value = Math.sin((bucket + seed + 1) * 12.9898) * 43_758.5453;
    return (value - Math.floor(value)) * 2 - 1;
  }
  return sine(position);
}

export function modulateTongueState(candidate, modulators = [], elapsedSeconds = 0) {
  const base = sanitizeTongueState(candidate);
  const next = { ...base };
  modulators.forEach((modulator, index) => {
    const bounds = TONGUE_PARAMETER_LIMITS[modulator?.target];
    if (!modulator?.enabled || !bounds) return;
    const [minimum, maximum] = bounds;
    const wave = modulationWave(
      modulator.shape,
      elapsedSeconds * clamp(modulator.rateHz, 0.02, 30) + (Number(modulator.phase) || 0),
      index,
    );
    next[modulator.target] += wave * clamp(modulator.depth) * (maximum - minimum) * 0.48;
  });
  return sanitizeTongueState(next, base);
}
