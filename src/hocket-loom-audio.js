const SOUND_SETS = new Set(["relay", "wood", "metal", "breath"]);
const RELAY_MATERIALS = Object.freeze(["wood", "metal", "breath", "wood"]);

export const HOCKET_MARKER_SOURCE_LIMIT = 320;
export const HOCKET_MARKER_NODE_LIMIT = 16;

const WOOD_PROFILES = [
  { modeRatio: 2.08, impactHz: 1180, bodyDrop: 0.74, damping: 0.82 },
  { modeRatio: 2.31, impactHz: 1540, bodyDrop: 0.68, damping: 0.75 },
  { modeRatio: 2.57, impactHz: 2020, bodyDrop: 0.63, damping: 0.68 },
  { modeRatio: 2.87, impactHz: 2640, bodyDrop: 0.58, damping: 0.62 },
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
      amplitude: peak * 0.44,
      attack: 0.0014,
      duration: duration * profile.damping,
      envelope: "decay",
    },
    {
      kind: "wood-mode",
      type: "sine",
      frequency: baseHz * profile.modeRatio,
      endFrequency: baseHz * profile.modeRatio * 0.92,
      amplitude: peak * 0.13,
      attack: 0.001,
      duration: duration * 0.35,
      envelope: "decay",
    },
  ];
  const noisePaths = [
    {
      kind: "wood-impact",
      amplitude: peak * 0.39,
      attack: 0.0006,
      duration: Math.min(0.014, duration * 0.27),
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
  const modalAmplitudes = [0.16, 0.24, 0.25];
  const durationScales = [1, 0.85, 0.69];
  const oscillators = profile.ratios.map((ratio, index) => ({
    kind: "metal-mode-" + (index + 1),
    type: "sine",
    frequency: baseHz * ratio * 2.15,
    endFrequency: baseHz * ratio * 2.15 * (1 - index * 0.0012),
    amplitude: peak * modalAmplitudes[index],
    attack: 0.002 + index * 0.0007,
    duration: duration * durationScales[index],
    envelope: "ring",
  }));
  const noisePaths = [
    {
      kind: "metal-strike",
      amplitude: peak * 0.1,
      attack: 0.0007,
      duration: Math.min(0.026, duration * 0.08),
      envelope: "impact",
      filters: [
        { type: "highpass", frequency: 1900, q: 0.5 },
        { type: "bandpass", frequency: 6200 * profile.brightness, q: 0.7 },
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
  const airFloorStart = Math.max(520, profile.airFloorHz * 2.5);
  const airFloorEnd = Math.max(820, profile.airFloorHz * 4.04);
  const airCeilingStart = Math.min(9200, profile.airCeilingHz * 1.78);
  const airCeilingEnd = Math.min(6800, profile.airCeilingHz * 1.28);
  const noisePaths = [
    {
      kind: "breath-edge",
      amplitude: peak * (0.016 + voice * 0.004),
      attack: 0.0008,
      duration: Math.min(0.014, duration * 0.08),
      envelope: "impact",
      filters: [
        { type: "highpass", frequency: 2500, q: 0.5 },
        { type: "lowpass", frequency: 9000, q: 0.45 },
      ],
    },
    {
      kind: "breath-air",
      amplitude: peak * 0.34,
      attack: 0.026 + voice * 0.002,
      duration,
      envelope: "breath",
      filters: [
        {
          type: "highpass",
          frequency: airFloorStart,
          endFrequency: airFloorEnd,
          q: 0.5,
        },
        {
          type: "lowpass",
          frequency: airCeilingStart,
          endFrequency: airCeilingEnd,
          q: 0.55,
        },
      ],
    },
    {
      kind: "breath-formant",
      amplitude: peak * 0.12,
      attack: 0.04,
      duration: duration * 0.84,
      envelope: "breath",
      filters: [
        {
          type: "bandpass",
          frequency: profile.formantHz,
          endFrequency: profile.formantHz * profile.drift,
          q: 0.9,
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
  soundSet = "relay",
  pulseLengthMs = 92,
  voice = 0,
  tone = 1,
  voiceCount = 4,
  peak = 0.24,
} = {}) {
  const selectedSoundSet = SOUND_SETS.has(soundSet) ? soundSet : "relay";
  const voiceIndex = normalizedVoice(voice);
  const material = selectedSoundSet === "relay"
    ? RELAY_MATERIALS[voiceIndex]
    : selectedSoundSet;
  const pulseSeconds = clamp(Number(pulseLengthMs), 24, 260) / 1000;
  const safePeak = clamp(Number(peak), 0.005, 0.72);
  const pitchScale = 2 ** ((clamp(Number(tone), 1, 8) - 1) / 8);
  const baseHz = [128, 174, 232, 310][voiceIndex] * pitchScale;
  const pan = markerPan(voiceIndex, voiceCount);

  let plan;
  if (material === "metal") {
    const duration = clamp(0.26 + pulseSeconds * 2.6, 0.32, 0.52);
    plan = metalPlan({
      baseHz,
      duration,
      peak: safePeak,
      profile: METAL_PROFILES[voiceIndex],
      pan,
    });
  } else if (material === "breath") {
    const duration = clamp(0.14 + pulseSeconds * 1.75, 0.18, 0.4);
    plan = breathPlan({
      duration,
      peak: safePeak,
      profile: BREATH_PROFILES[voiceIndex],
      pan,
      voice: voiceIndex,
    });
  } else {
    const duration = clamp(0.018 + pulseSeconds * 0.3, 0.03, 0.09);
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
    soundSet: selectedSoundSet,
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
