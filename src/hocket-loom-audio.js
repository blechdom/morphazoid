const SOUND_SETS = new Set(["wood", "metal", "breath"]);

export const HOCKET_MARKER_SOURCE_LIMIT = 320;
export const HOCKET_MARKER_NODE_LIMIT = 16;

const WOOD_PROFILES = [
  { modeRatio: 2.08, impactHz: 1180, bodyDrop: 0.84, damping: 0.92 },
  { modeRatio: 2.31, impactHz: 1540, bodyDrop: 0.79, damping: 0.82 },
  { modeRatio: 2.57, impactHz: 2020, bodyDrop: 0.88, damping: 0.72 },
  { modeRatio: 2.87, impactHz: 2640, bodyDrop: 0.75, damping: 0.64 },
];

const METAL_PROFILES = [
  { ratios: [1, 2.41, 4.18], brightness: 0.78 },
  { ratios: [1, 2.67, 4.73], brightness: 0.9 },
  { ratios: [1, 3.09, 5.36], brightness: 1.03 },
  { ratios: [1, 3.46, 6.12], brightness: 1.15 },
];

const BREATH_PROFILES = [
  { formantHz: 620, airFloorHz: 170, airCeilingHz: 3150, drift: 1.22 },
  { formantHz: 910, airFloorHz: 260, airCeilingHz: 4050, drift: 1.16 },
  { formantHz: 1430, airFloorHz: 460, airCeilingHz: 5350, drift: 0.88 },
  { formantHz: 2180, airFloorHz: 720, airCeilingHz: 6800, drift: 0.74 },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function normalizedVoice(value) {
  return Math.round(clamp(Number(value), 0, 3));
}

function markerPan(voice, voiceCount) {
  const count = Math.round(clamp(Number(voiceCount), 2, 4));
  const index = Math.min(voice, count - 1);
  return -0.72 + (index / Math.max(1, count - 1)) * 1.44;
}

function estimateNodeCount(oscillators, noisePaths) {
  const fixedOutputNodes = 2;
  const oscillatorNodes = oscillators.length * 2;
  const noiseNodes = noisePaths.length
    ? 1 + noisePaths.reduce((total, path) => total + 1 + path.filters.length, 0)
    : 0;
  return fixedOutputNodes + oscillatorNodes + noiseNodes;
}

function woodPlan({ baseHz, duration, peak, profile, pan }) {
  const oscillators = [
    {
      kind: "wood-body",
      type: "triangle",
      frequency: baseHz,
      endFrequency: baseHz * profile.bodyDrop,
      amplitude: peak * 0.5,
      attack: 0.0014,
      duration: duration * profile.damping,
      envelope: "decay",
    },
    {
      kind: "wood-mode",
      type: "sine",
      frequency: baseHz * profile.modeRatio,
      endFrequency: baseHz * profile.modeRatio * 0.96,
      amplitude: peak * 0.2,
      attack: 0.001,
      duration: duration * 0.5,
      envelope: "decay",
    },
  ];
  const noisePaths = [
    {
      kind: "wood-impact",
      amplitude: peak * 0.23,
      attack: 0.0006,
      duration: Math.min(0.026, duration * 0.42),
      envelope: "impact",
      filters: [
        { type: "highpass", frequency: 420, q: 0.55 },
        { type: "bandpass", frequency: profile.impactHz, q: 0.9 },
      ],
    },
  ];
  return {
    material: "wood",
    label: "Dry wood clack",
    durationSeconds: duration,
    panStart: pan,
    panEnd: pan,
    oscillators,
    noisePaths,
    sourceKinds: ["wood-body", "wood-mode", "wood-impact"],
  };
}

function metalPlan({ baseHz, duration, peak, profile, pan }) {
  const tiltedAmplitudes = [
    0.36 / profile.brightness,
    0.18,
    0.11 * profile.brightness,
  ];
  const amplitudeScale = 0.65 / tiltedAmplitudes.reduce((sum, value) => sum + value, 0);
  const durationScales = [1, 0.82, 0.66];
  const oscillators = profile.ratios.map((ratio, index) => ({
    kind: "metal-mode-" + (index + 1),
    type: "sine",
    frequency: baseHz * ratio,
    endFrequency: baseHz * ratio * (1 - index * 0.002),
    amplitude: peak * tiltedAmplitudes[index] * amplitudeScale,
    attack: 0.002 + index * 0.0007,
    duration: duration * durationScales[index],
    envelope: "ring",
  }));
  const noisePaths = [
    {
      kind: "metal-strike",
      amplitude: peak * 0.075,
      attack: 0.0007,
      duration: Math.min(0.032, duration * 0.12),
      envelope: "impact",
      filters: [
        { type: "highpass", frequency: 1450, q: 0.5 },
        { type: "bandpass", frequency: 3900 * profile.brightness, q: 0.7 },
      ],
    },
  ];
  return {
    material: "metal",
    label: "Inharmonic metal ring",
    durationSeconds: duration,
    panStart: pan,
    panEnd: pan * 0.28,
    oscillators,
    noisePaths,
    sourceKinds: [
      "metal-mode-1",
      "metal-mode-2",
      "metal-mode-3",
      "metal-strike",
    ],
  };
}

function breathPlan({ duration, peak, profile, pan, voice }) {
  const noisePaths = [
    {
      kind: "breath-edge",
      amplitude: peak * (0.05 + voice * 0.008),
      attack: 0.0008,
      duration: Math.min(0.025, duration * 0.2),
      envelope: "impact",
      filters: [
        { type: "highpass", frequency: Math.max(900, profile.airFloorHz * 2.4), q: 0.5 },
        { type: "lowpass", frequency: profile.airCeilingHz * 1.18, q: 0.45 },
      ],
    },
    {
      kind: "breath-air",
      amplitude: peak * 0.31,
      attack: 0.012 + voice * 0.0013,
      duration,
      envelope: "breath",
      filters: [
        { type: "highpass", frequency: profile.airFloorHz, q: 0.5 },
        { type: "lowpass", frequency: profile.airCeilingHz, q: 0.55 },
      ],
    },
    {
      kind: "breath-formant",
      amplitude: peak * 0.16,
      attack: 0.016,
      duration: duration * 0.87,
      envelope: "breath",
      filters: [
        {
          type: "bandpass",
          frequency: profile.formantHz,
          endFrequency: profile.formantHz * profile.drift,
          q: 1.65,
        },
      ],
    },
  ];
  return {
    material: "breath",
    label: "Air breath",
    durationSeconds: duration,
    panStart: pan * 0.24,
    panEnd: pan * 0.76,
    oscillators: [],
    noisePaths,
    sourceKinds: ["breath-edge", "breath-air", "breath-formant"],
  };
}

export function hocketMarkerPlan({
  soundSet = "wood",
  pulseLengthMs = 92,
  voice = 0,
  tone = 1,
  voiceCount = 4,
  peak = 0.24,
} = {}) {
  const material = SOUND_SETS.has(soundSet) ? soundSet : "wood";
  const voiceIndex = normalizedVoice(voice);
  const pulseSeconds = clamp(Number(pulseLengthMs), 24, 260) / 1000;
  const safePeak = clamp(Number(peak), 0.005, 0.72);
  const pitchScale = 2 ** ((clamp(Number(tone), 1, 8) - 1) / 8);
  const baseHz = [128, 174, 232, 310][voiceIndex] * pitchScale;
  const pan = markerPan(voiceIndex, voiceCount);

  let plan;
  if (material === "metal") {
    const duration = clamp(0.18 + pulseSeconds * 1.3, 0.21, 0.52);
    plan = metalPlan({
      baseHz,
      duration,
      peak: safePeak,
      profile: METAL_PROFILES[voiceIndex],
      pan,
    });
  } else if (material === "breath") {
    const duration = clamp(0.08 + pulseSeconds * 0.85, 0.1, 0.31);
    plan = breathPlan({
      duration,
      peak: safePeak,
      profile: BREATH_PROFILES[voiceIndex],
      pan,
      voice: voiceIndex,
    });
  } else {
    const duration = clamp(0.026 + pulseSeconds * 0.4, 0.038, 0.14);
    plan = woodPlan({
      baseHz,
      duration,
      peak: safePeak,
      profile: WOOD_PROFILES[voiceIndex],
      pan,
    });
  }

  const sourceCount = plan.oscillators.length + (plan.noisePaths.length ? 1 : 0);
  const nodeEstimate = estimateNodeCount(plan.oscillators, plan.noisePaths);
  return {
    ...plan,
    voice: voiceIndex,
    voiceCount: Math.round(clamp(Number(voiceCount), 2, 4)),
    pulseLengthMs: pulseSeconds * 1000,
    tone: clamp(Number(tone), 1, 8),
    peak: safePeak,
    sourceCount,
    nodeEstimate,
  };
}

export function createHocketNoiseBuffer(context, seed = 0x484f434b) {
  const frameCount = Math.max(1, Math.round(context.sampleRate));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  let state = Number(seed) >>> 0;
  for (let index = 0; index < data.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[index] = (state / 0xffffffff) * 2 - 1;
  }
  return buffer;
}

function safeFrequency(context, value) {
  return clamp(Number(value), 20, context.sampleRate * 0.45);
}

function scheduleEnvelope(param, startTime, settings) {
  const duration = Math.max(0.008, settings.duration);
  const endTime = startTime + duration;
  const attackEnd = Math.min(endTime - 0.002, startTime + settings.attack);
  const amplitude = Math.max(0.0001, settings.amplitude);
  param.cancelScheduledValues(startTime);
  param.setValueAtTime(0.0001, startTime);
  param.linearRampToValueAtTime(amplitude, attackEnd);
  if (settings.envelope === "breath") {
    param.linearRampToValueAtTime(amplitude * 0.82, startTime + duration * 0.48);
  }
  param.exponentialRampToValueAtTime(0.0001, endTime);
}

function scheduleFrequency(context, param, startTime, duration, startValue, endValue) {
  const startFrequency = safeFrequency(context, startValue);
  const endFrequency = safeFrequency(context, endValue ?? startValue);
  param.setValueAtTime(startFrequency, startTime);
  if (Math.abs(endFrequency - startFrequency) > 0.01) {
    param.exponentialRampToValueAtTime(endFrequency, startTime + duration);
  }
}

export function scheduleHocketMarker(
  context,
  destination,
  plan,
  { when = context.currentTime, noiseBuffer = null } = {},
) {
  if (!context || !destination || !plan) {
    throw new TypeError("A context, destination, and marker plan are required.");
  }
  if (plan.nodeEstimate > HOCKET_MARKER_NODE_LIMIT) {
    throw new RangeError("Hocket marker plan exceeds its node budget.");
  }

  const startTime = Math.max(context.currentTime, Number(when) || context.currentTime);
  const sources = [];
  const nodes = [];
  let safetyGain = null;
  try {
    safetyGain = context.createGain();
    nodes.push(safetyGain);
    const panner = context.createStereoPanner?.() ?? context.createGain();
    nodes.push(panner);
    safetyGain.gain.setValueAtTime(1, startTime);
    if (panner.pan) {
      panner.pan.setValueAtTime(clamp(plan.panStart, -1, 1), startTime);
      panner.pan.linearRampToValueAtTime(
        clamp(plan.panEnd, -1, 1),
        startTime + plan.durationSeconds,
      );
    }
    safetyGain.connect(panner);
    panner.connect(destination);

    for (const oscillatorPlan of plan.oscillators) {
      const oscillator = context.createOscillator();
      sources.push(oscillator);
      nodes.push(oscillator);
      const gain = context.createGain();
      nodes.push(gain);
      oscillator.type = oscillatorPlan.type;
      scheduleFrequency(
        context,
        oscillator.frequency,
        startTime,
        oscillatorPlan.duration,
        oscillatorPlan.frequency,
        oscillatorPlan.endFrequency,
      );
      scheduleEnvelope(gain.gain, startTime, oscillatorPlan);
      oscillator.connect(gain);
      gain.connect(safetyGain);
      oscillator.start(startTime);
      oscillator.stop(startTime + oscillatorPlan.duration + 0.006);
    }

    if (plan.noisePaths.length) {
      const noise = context.createBufferSource();
      sources.push(noise);
      nodes.push(noise);
      noise.buffer = noiseBuffer ?? createHocketNoiseBuffer(context);
      noise.loop = true;
      for (const path of plan.noisePaths) {
        const gain = context.createGain();
        nodes.push(gain);
        let tail = noise;
        for (const filterPlan of path.filters) {
          const filter = context.createBiquadFilter();
          nodes.push(filter);
          filter.type = filterPlan.type;
          filter.Q.setValueAtTime(clamp(filterPlan.q, 0.0001, 30), startTime);
          scheduleFrequency(
            context,
            filter.frequency,
            startTime,
            path.duration,
            filterPlan.frequency,
            filterPlan.endFrequency,
          );
          tail.connect(filter);
          tail = filter;
        }
        scheduleEnvelope(gain.gain, startTime, path);
        tail.connect(gain);
        gain.connect(safetyGain);
      }
      noise.start(startTime);
      noise.stop(startTime + plan.durationSeconds + 0.006);
    }

    return {
      sources,
      nodes,
      safetyGain,
      startTime,
      endTime: startTime + plan.durationSeconds + 0.006,
    };
  } catch (error) {
    for (const source of sources) {
      source.onended = null;
      try {
        source.stop(context.currentTime);
      } catch {
        // A partially configured source might not have started.
      }
    }
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // A partially configured node might never have connected.
      }
    }
    throw error;
  }
}
