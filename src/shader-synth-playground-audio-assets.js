const freeze = (value) => Object.freeze(value);

export const SHADER_SYNTH_PLAYGROUND_AUDIO_ASSET_SPECS = freeze({
  "uploaded-wavetable": freeze({
    kind: "wavetable",
    label: "Wavetable audio",
    chooseLabel: "Choose wavetable",
    maxFrames: 2048,
    selector: freeze({ paramId: "table", value: 5 }),
    emptyLabel: "Built-in tables",
  }),
  "gpu-sampler-granulator": freeze({
    kind: "sample",
    label: "Source audio",
    chooseLabel: "Choose sample",
    maxSeconds: 8,
    emptyLabel: "Built-in source sample",
  }),
  "convolution-space": freeze({
    kind: "impulse-response",
    label: "Impulse response",
    chooseLabel: "Choose response",
    maxFrames: 65536,
    selector: freeze({ paramId: "ir", value: 6 }),
    emptyLabel: "Built-in responses",
  }),
});

export function shaderSynthPlaygroundAudioAssetSpec(moduleId) {
  return SHADER_SYNTH_PLAYGROUND_AUDIO_ASSET_SPECS[String(moduleId ?? "")] ?? null;
}

function finiteSample(value) {
  const sample = Number(value);
  return Number.isFinite(sample) ? Math.max(-4, Math.min(4, sample)) : 0;
}

function resampleChannel(source, sourceRate, targetRate, frameLimit) {
  const sourceLength = Math.max(0, Number(source?.length) || 0);
  if (sourceLength === 0) return new Float32Array(0);
  const ratio = targetRate / sourceRate;
  const outputLength = Math.max(1, Math.min(frameLimit, Math.round(sourceLength * ratio)));
  const output = new Float32Array(outputLength);
  if (sourceLength === 1) {
    output.fill(finiteSample(source[0]));
    return output;
  }
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = Math.min(sourceLength - 1, index / ratio);
    const first = Math.floor(sourcePosition);
    const second = Math.min(sourceLength - 1, first + 1);
    const amount = sourcePosition - first;
    output[index] = finiteSample(source[first]) * (1 - amount) + finiteSample(source[second]) * amount;
  }
  return output;
}

function conditionPeriodicTable(left, right) {
  const frameCount = Math.min(left.length, right.length);
  const table = new Float32Array(frameCount);
  if (frameCount === 0) return table;
  const start = (left[0] + right[0]) * 0.5;
  const end = (left[frameCount - 1] + right[frameCount - 1]) * 0.5;
  let average = 0;
  for (let index = 0; index < frameCount; index += 1) {
    const amount = frameCount > 1 ? index / (frameCount - 1) : 0;
    const mono = (left[index] + right[index]) * 0.5;
    // Removing the line between both endpoints gives arbitrary recordings a
    // continuous table boundary instead of a hard click once per cycle.
    table[index] = mono - (start * (1 - amount) + end * amount);
    average += table[index];
  }
  average /= frameCount;
  let peak = 0;
  for (let index = 0; index < frameCount; index += 1) {
    table[index] -= average;
    peak = Math.max(peak, Math.abs(table[index]));
  }
  const gain = peak > 1e-6 ? Math.min(1, 0.98 / peak) : 1;
  if (gain !== 1) {
    for (let index = 0; index < frameCount; index += 1) table[index] *= gain;
  }
  return table;
}

function audioBufferChannel(audioBuffer, channel) {
  const channelCount = Math.max(1, Number(audioBuffer?.numberOfChannels) || 1);
  const index = Math.min(channelCount - 1, Math.max(0, channel));
  const data = audioBuffer?.getChannelData?.(index);
  if (!data || typeof data.length !== "number") throw new TypeError("The decoded audio has no readable sample data.");
  return data;
}

export function prepareShaderSynthPlaygroundAudioAsset(
  audioBuffer,
  moduleId,
  targetSampleRate = 44100,
) {
  const spec = shaderSynthPlaygroundAudioAssetSpec(moduleId);
  if (!spec) throw new RangeError(`Module ${moduleId} does not accept audio-file data.`);
  const sourceSampleRate = Math.max(1, Number(audioBuffer?.sampleRate) || 0);
  const sampleRate = Math.max(8000, Number(targetSampleRate) || 44100);
  const maxFrames = Math.max(1, spec.maxFrames ?? Math.ceil(sampleRate * spec.maxSeconds));
  const left = resampleChannel(audioBufferChannel(audioBuffer, 0), sourceSampleRate, sampleRate, maxFrames);
  const right = resampleChannel(audioBufferChannel(audioBuffer, 1), sourceSampleRate, sampleRate, maxFrames);
  if (left.length === 0 || right.length === 0) throw new RangeError("The decoded audio file is empty.");

  if (spec.kind === "wavetable") {
    const table = conditionPeriodicTable(left, right);
    return freeze({
      moduleId,
      kind: spec.kind,
      left: table,
      right: table.slice(),
      frameCount: table.length,
      sampleRate,
      sourceSampleRate,
      channelCount: 1,
      duration: table.length / sampleRate,
    });
  }

  return freeze({
    moduleId,
    kind: spec.kind,
    left,
    right,
    frameCount: Math.min(left.length, right.length),
    sampleRate,
    sourceSampleRate,
    channelCount: Math.min(2, Math.max(1, Number(audioBuffer?.numberOfChannels) || 1)),
    duration: Math.min(left.length, right.length) / sampleRate,
  });
}

export function formatShaderSynthPlaygroundAudioAsset(asset) {
  if (!asset) return "";
  if (asset.kind === "wavetable") return `${asset.frameCount.toLocaleString()}-sample table`;
  const duration = asset.duration < 1
    ? `${Math.round(asset.duration * 1000)} ms`
    : `${asset.duration.toFixed(asset.duration < 10 ? 2 : 1)} s`;
  const channelLabel = asset.channelCount > 1 ? "stereo" : "mono";
  return asset.kind === "impulse-response"
    ? `${duration} ${channelLabel} response`
    : `${duration} ${channelLabel} sample`;
}
