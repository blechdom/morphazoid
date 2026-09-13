import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  JULIE_SAW_DEFAULTS,
  applyJulieSawPreset,
  bendToFrequency,
  sanitizeJulieSawState,
  sweetSpotPosition,
} from "../src/julie-saw.js";

const RATE = 48_000;
const BLOCK_SIZE = 128;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "test-results");
const selectedPresetIds = [
  "julies-first-note",
  "low-fog",
  "high-wire",
  "continuous-silver",
  "mode-pair-mirage",
  "storm-window",
  "felt-mallets",
];

let Processor;
globalThis.sampleRate = RATE;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { onmessage: null, postMessage() {} };
  }
};
globalThis.registerProcessor = (name, implementation) => {
  if (name !== "julie-saw-physical-model") throw new Error(`Unexpected processor ${name}`);
  Processor = implementation;
};
await import(`../src/julie-saw-processor.js?characterization=${Date.now()}`);

function render(configuration, durationSeconds = 4) {
  const state = sanitizeJulieSawState({ ...configuration, autoPlay: true });
  const processor = new Processor({ processorOptions: { configuration: state } });
  processor._handleMessage({
    type: "auto",
    playing: true,
    step: 0,
    phase: 0,
    triggerCurrent: true,
  });
  const frameCount = Math.ceil(durationSeconds * RATE / BLOCK_SIZE) * BLOCK_SIZE;
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  let offset = 0;
  while (offset < frameCount) {
    const blockLeft = left.subarray(offset, offset + BLOCK_SIZE);
    const blockRight = right.subarray(offset, offset + BLOCK_SIZE);
    processor.process([], [[blockLeft, blockRight]]);
    offset += BLOCK_SIZE;
  }
  for (let index = 0; index < frameCount; index += 1) {
    left[index] *= state.level;
    right[index] *= state.level;
  }
  return { state, processor, left, right };
}

function metrics(left, right) {
  let peak = 0;
  let square = 0;
  let delta = 0;
  let clipped = 0;
  let channelDifference = 0;
  let previousLeft = left[0] || 0;
  let previousRight = right[0] || 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index];
    const r = right[index];
    if (!Number.isFinite(l) || !Number.isFinite(r)) throw new Error("Non-finite Julie Saw sample");
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    square += (l * l + r * r) * .5;
    delta = Math.max(delta, Math.abs(l - previousLeft), Math.abs(r - previousRight));
    channelDifference += Math.abs(l - r);
    if (Math.abs(l) >= .999 || Math.abs(r) >= .999) clipped += 1;
    previousLeft = l;
    previousRight = r;
  }
  return {
    peak,
    stereoRms: Math.sqrt(square / Math.max(1, left.length)),
    maxAdjacentDelta: delta,
    meanChannelDifference: channelDifference / Math.max(1, left.length),
    clippedSamples: clipped,
    finite: true,
  };
}

function measureReleaseTailSeconds() {
  const state = sanitizeJulieSawState({
    ...applyJulieSawPreset("bow-lift-halo"),
    autoPlay: false,
    vibratoDepthCents: 0,
  });
  const processor = new Processor({ processorOptions: { configuration: state } });
  processor._handleMessage({ type: "bow", gate: true, direction: 1 });
  for (let block = 0; block < Math.ceil(RATE / BLOCK_SIZE); block += 1) {
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    processor.process([], [[left, right]]);
  }
  processor._handleMessage({ type: "bow", gate: false });
  let lastAudibleFrame = 0;
  const totalBlocks = Math.ceil(RATE * 14 / BLOCK_SIZE);
  for (let block = 0; block < totalBlocks; block += 1) {
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    processor.process([], [[left, right]]);
    let square = 0;
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      square += (left[index] ** 2 + right[index] ** 2) * .5;
    }
    if (Math.sqrt(square / BLOCK_SIZE) * state.level > 1e-4) {
      lastAudibleFrame = (block + 1) * BLOCK_SIZE;
    }
  }
  return lastAudibleFrame / RATE;
}

function encodeWave(segments, gapSeconds = .2) {
  const gapFrames = Math.round(RATE * gapSeconds);
  const totalFrames = segments.reduce((sum, segment) => sum + segment.left.length, 0)
    + gapFrames * Math.max(0, segments.length - 1);
  const dataBytes = totalFrames * 4;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  let frame = 0;
  const writeSample = (value, byteOffset) => {
    const bounded = Math.max(-1, Math.min(1, value));
    buffer.writeInt16LE(Math.round(bounded * (bounded < 0 ? 32768 : 32767)), byteOffset);
  };
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    for (let index = 0; index < segment.left.length; index += 1) {
      writeSample(segment.left[index], 44 + frame * 4);
      writeSample(segment.right[index], 46 + frame * 4);
      frame += 1;
    }
    if (segmentIndex < segments.length - 1) frame += gapFrames;
  }
  return buffer;
}

const segments = selectedPresetIds.map((presetId) => render(
  applyJulieSawPreset(presetId),
  presetId === "storm-window" ? 5 : 4,
));
const presetMetrics = Object.fromEntries(segments.map((segment, index) => [
  selectedPresetIds[index],
  {
    ...metrics(segment.left, segment.right),
    targetFrequencyHz: bendToFrequency(segment.state),
    rhythmId: segment.state.rhythmId,
    level: segment.state.level,
  },
]));
for (const [presetId, values] of Object.entries(presetMetrics)) {
  if (!values.finite || values.clippedSamples > 0 || values.peak < 0.001 || values.stereoRms < 0.0001) {
    throw new Error(`Julie Saw characterization failed for ${presetId}: ${JSON.stringify(values)}`);
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  qualification: "automated characterization only; no human listening approval",
  sampleRate: RATE,
  channels: 2,
  durationSecondsPerPreset: "4 (Storm Window: 5)",
  presetOrder: selectedPresetIds,
  presets: presetMetrics,
  bowLiftHaloTailAboveMinus80DbSeconds: measureReleaseTailSeconds(),
  parameterSensitivity: {
    concertTenorFrequencyHz: {
      minimumBend: bendToFrequency({ ...JULIE_SAW_DEFAULTS, bend: .02 }),
      defaultBend: bendToFrequency(JULIE_SAW_DEFAULTS),
      maximumBend: bendToFrequency({ ...JULIE_SAW_DEFAULTS, bend: .98 }),
    },
    defaultSweetSpot: sweetSpotPosition(JULIE_SAW_DEFAULTS),
  },
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(
    path.join(outputDirectory, "julie-saw-characterization.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  ),
  writeFile(
    path.join(outputDirectory, "julie-saw-presets.wav"),
    encodeWave(segments),
  ),
]);

console.table(Object.entries(presetMetrics).map(([preset, values]) => ({
  preset,
  peak: values.peak.toFixed(4),
  rms: values.stereoRms.toFixed(4),
  delta: values.maxAdjacentDelta.toFixed(5),
  stereo: values.meanChannelDifference.toFixed(5),
  clipped: values.clippedSamples,
})));
console.log(`Release tail above -80 dB: ${report.bowLiftHaloTailAboveMinus80DbSeconds.toFixed(2)} s`);
console.log(`Wrote ${path.relative(root, path.join(outputDirectory, "julie-saw-characterization.json"))}`);
console.log(`Wrote ${path.relative(root, path.join(outputDirectory, "julie-saw-presets.wav"))}`);
