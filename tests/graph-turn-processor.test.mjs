import assert from "node:assert/strict";
import test from "node:test";

let ProcessorConstructor;
let processorName = "";

globalThis.sampleRate = 48_000;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = {
      onmessage: null,
      postMessage() {},
    };
  }
};
globalThis.registerProcessor = (name, constructor) => {
  processorName = name;
  ProcessorConstructor = constructor;
};

await import(`../src/graph-turn-processor.js?test=${Date.now()}`);

function renderTone(processor, {
  semitones,
  inputFrequency = 220,
  seconds = 2.5,
} = {}) {
  processor.port.onmessage({
    data: { type: "turns", semitones: [[semitones]] },
  });
  const blockSize = 128;
  const frameTotal = Math.ceil(seconds * globalThis.sampleRate);
  const rendered = new Float32Array(frameTotal);
  for (let offset = 0; offset < frameTotal; offset += blockSize) {
    const frameCount = Math.min(blockSize, frameTotal - offset);
    const input = Float32Array.from(
      { length: frameCount },
      (_, frame) => Math.sin(
        2 * Math.PI * inputFrequency * (offset + frame) / globalThis.sampleRate,
      ) * 0.5,
    );
    const output = new Float32Array(frameCount);
    processor.process([[input]], [[output]]);
    rendered.set(output, offset);
  }
  return rendered.slice(-32_768);
}

function spectralPower(samples, frequency) {
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const window = Math.sin(Math.PI * index / samples.length) ** 2;
    const phase = 2 * Math.PI * frequency * index / globalThis.sampleRate;
    real += samples[index] * window * Math.cos(phase);
    imaginary -= samples[index] * window * Math.sin(phase);
  }
  return real * real + imaginary * imaginary;
}

function renderSerialTone(first, second, {
  firstSemitones,
  secondSemitones,
  inputFrequency = 220,
  seconds = 3,
} = {}) {
  first.port.onmessage({
    data: { type: "turns", semitones: [[firstSemitones]] },
  });
  second.port.onmessage({
    data: { type: "turns", semitones: [[secondSemitones]] },
  });
  const blockSize = 128;
  const frameTotal = Math.ceil(seconds * globalThis.sampleRate);
  const rendered = new Float32Array(frameTotal);
  for (let offset = 0; offset < frameTotal; offset += blockSize) {
    const frameCount = Math.min(blockSize, frameTotal - offset);
    const input = Float32Array.from(
      { length: frameCount },
      (_, frame) => Math.sin(
        2 * Math.PI * inputFrequency * (offset + frame) / globalThis.sampleRate,
      ) * 0.35,
    );
    const middle = new Float32Array(frameCount);
    const output = new Float32Array(frameCount);
    first.process([[input]], [[middle]]);
    second.process([[middle]], [[output]]);
    rendered.set(output, offset);
  }
  return rendered.slice(-32_768);
}

test("graph turn processor preserves a merge source per input and a mix per output", () => {
  assert.equal(processorName, "morphazoid-graph-turns");
  const processor = new ProcessorConstructor({
    processorOptions: { sourceCount: 2, outputCount: 2 },
  });
  processor.port.onmessage({
    data: {
      type: "turns",
      semitones: [
        [0, 0],
        [0, 0],
      ],
    },
  });
  const first = Float32Array.from({ length: 128 }, (_, index) => Math.sin(index * 0.1));
  const second = Float32Array.from({ length: 128 }, (_, index) => Math.cos(index * 0.07) * 0.5);
  const outputA = new Float32Array(128);
  const outputB = new Float32Array(128);
  assert.equal(processor.process(
    [[first], [second]],
    [[outputA], [outputB]],
  ), true);
  for (let index = 0; index < outputA.length; index += 1) {
    assert.ok(Math.abs(outputA[index] - (first[index] + second[index])) < 1e-6);
    assert.equal(outputA[index], outputB[index]);
  }
});

test("graph turn processor accepts a distinct pitch interval for every input-output pair", () => {
  const processor = new ProcessorConstructor({
    processorOptions: { sourceCount: 2, outputCount: 2 },
  });
  processor.port.onmessage({
    data: {
      type: "turns",
      semitones: [
        [7, -5],
        [-12, 19],
      ],
    },
  });
  for (let block = 0; block < 80; block += 1) {
    const first = Float32Array.from(
      { length: 128 },
      (_, index) => Math.sin((block * 128 + index) * 0.03),
    );
    const second = Float32Array.from(
      { length: 128 },
      (_, index) => Math.sin((block * 128 + index) * 0.047) * 0.5,
    );
    const outputs = [[new Float32Array(128)], [new Float32Array(128)]];
    processor.process([[first], [second]], outputs);
    assert.ok([...outputs[0][0], ...outputs[1][0]].every(Number.isFinite));
  }
  assert.ok(Math.abs(processor.currentSemitones[0] - 7) < 0.2);
  assert.ok(Math.abs(processor.currentSemitones[1] + 5) < 0.2);
  assert.ok(Math.abs(processor.currentSemitones[2] + 12) < 0.2);
  assert.ok(Math.abs(processor.currentSemitones[3] - 19) < 0.2);
});

test("graph turn processor accepts the UI pitch-glide time", () => {
  const processor = new ProcessorConstructor({
    processorOptions: { sourceCount: 1, outputCount: 1 },
  });
  processor.port.onmessage({
    data: {
      type: "turns",
      semitones: [[7]],
      smoothingMs: 240,
    },
  });
  assert.equal(processor.parameterSmoothingSeconds, 0.24);
});

test("small pitch intervals fade into granular processing instead of hard-switching", () => {
  const subtle = new ProcessorConstructor({
    processorOptions: { sourceCount: 1, outputCount: 1 },
  });
  renderTone(subtle, { semitones: 0.3, seconds: 1 });
  assert.ok(subtle.shiftMixes[0] > 0.02);
  assert.ok(subtle.shiftMixes[0] < 0.25);

  const explicit = new ProcessorConstructor({
    processorOptions: { sourceCount: 1, outputCount: 1 },
  });
  renderTone(explicit, { semitones: 1.5, seconds: 1 });
  assert.ok(explicit.shiftMixes[0] > 0.95);
});

test("graph turn grains remain 110 ms at every context sample rate", () => {
  globalThis.sampleRate = 48_000;
  const standard = new ProcessorConstructor({
    processorOptions: { sourceCount: 1, outputCount: 1 },
  });
  assert.equal(standard.windowSamples, 5_280);
  assert.equal(standard.bufferSize, 8_192);
  assert.equal(standard.bufferSize & (standard.bufferSize - 1), 0);
  assert.ok(standard.bufferSize >= standard.windowSamples + 8);

  globalThis.sampleRate = 96_000;
  const highRate = new ProcessorConstructor({
    processorOptions: { sourceCount: 1, outputCount: 1 },
  });
  assert.equal(highRate.windowSamples, 10_560);
  assert.equal(highRate.bufferSize, 16_384);
  assert.equal(highRate.bufferSize & (highRate.bufferSize - 1), 0);
  assert.ok(highRate.bufferSize >= highRate.windowSamples + 8);
  globalThis.sampleRate = 48_000;
});

test("graph nodes use decorrelated but repeatable grain phases", () => {
  const first = new ProcessorConstructor({
    processorOptions: { sourceCount: 2, outputCount: 2, phaseSeed: 3 },
  });
  const repeated = new ProcessorConstructor({
    processorOptions: { sourceCount: 2, outputCount: 2, phaseSeed: 3 },
  });
  const anotherNode = new ProcessorConstructor({
    processorOptions: { sourceCount: 2, outputCount: 2, phaseSeed: 4 },
  });
  assert.deepEqual([...first.phases], [...repeated.phases]);
  assert.notDeepEqual([...first.phases], [...anotherNode.phases]);
  assert.equal(new Set(first.phases).size, first.routeCount);
});

test("110 ms grains move octave artifacts out of the old pitched-buzz band", () => {
  const smooth = new ProcessorConstructor({
    processorOptions: { sourceCount: 1, outputCount: 1, phaseSeed: 2 },
  });
  const short = new ProcessorConstructor({
    processorOptions: { sourceCount: 1, outputCount: 1, phaseSeed: 2 },
  });
  short.windowSamples = 1_024;
  const smoothOutput = renderTone(smooth, { semitones: 12 });
  const shortOutput = renderTone(short, { semitones: 12 });
  const target = 440;
  const oldBuzzRate = globalThis.sampleRate / 1_024;
  const smoothFarSidebands = spectralPower(smoothOutput, target - oldBuzzRate)
    + spectralPower(smoothOutput, target + oldBuzzRate);
  const shortFarSidebands = spectralPower(shortOutput, target - oldBuzzRate)
    + spectralPower(shortOutput, target + oldBuzzRate);
  assert.ok(
    smoothFarSidebands < shortFarSidebands * 0.15,
    `long grains should strongly reduce the old 47 Hz buzz sidebands (${smoothFarSidebands} vs ${shortFarSidebands})`,
  );
});

test("serial graph turns still accumulate into the intended pitch", () => {
  const first = new ProcessorConstructor({
    processorOptions: { sourceCount: 1, outputCount: 1, phaseSeed: 4 },
  });
  const second = new ProcessorConstructor({
    processorOptions: { sourceCount: 1, outputCount: 1, phaseSeed: 9 },
  });
  const output = renderSerialTone(first, second, {
    firstSemitones: 7,
    secondSemitones: 5,
  });
  let dominantFrequency = 0;
  let dominantPower = -Infinity;
  for (let frequency = 420; frequency <= 460; frequency += 1) {
    const power = spectralPower(output, frequency);
    if (power > dominantPower) {
      dominantPower = power;
      dominantFrequency = frequency;
    }
  }
  assert.ok(output.every(Number.isFinite));
  assert.ok(
    Math.abs(dominantFrequency - 440) <= 2,
    `a +7 then +5 path should peak near 440 Hz, received ${dominantFrequency} Hz`,
  );
});
