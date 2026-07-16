import assert from "node:assert/strict";
import test from "node:test";

let ProcessorConstructor;
let processorName = "";

globalThis.sampleRate = 48_000;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { onmessage: null };
  }
};
globalThis.registerProcessor = (name, constructor) => {
  processorName = name;
  ProcessorConstructor = constructor;
};

await import(`../src/contour-synth-processor.js?test=${Date.now()}`);

function render(mode, overrides = {}, blocks = 48) {
  const processor = new ProcessorConstructor({ processorOptions: { maxVoices: 1 } });
  processor.port.onmessage({
    data: {
      type: "voices",
      voices: [{
        key: "test-contact",
        mode,
        frequency: 220,
        gain: 0.35,
        pan: 0,
        modulationIndex: 0,
        modulationRatio: 1,
        shepardRate: 0,
        shepardWidth: 4,
        ...overrides,
      }],
    },
  });

  const left = [];
  const right = [];
  for (let block = 0; block < blocks; block += 1) {
    const blockLeft = new Float32Array(128);
    const blockRight = new Float32Array(128);
    assert.equal(processor.process([], [[blockLeft, blockRight]]), true);
    left.push(...blockLeft);
    right.push(...blockRight);
  }
  return { left, right };
}

function rms(values) {
  return Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0) / values.length);
}

function differenceRms(first, second) {
  return rms(first.map((value, index) => value - second[index]));
}

test("worklet registers one stereo contour synth processor", () => {
  assert.equal(processorName, "morphazoid-contour-synth");
  assert.equal(typeof ProcessorConstructor, "function");
});

test("sine, FM, PM, and Shepard render finite, distinct simple patches", () => {
  const sine = render("sine");
  const fm = render("fm", { modulationIndex: 4, modulationRatio: 2 });
  const pm = render("pm", { modulationIndex: 2.5, modulationRatio: 1.5 });
  const shepard = render("shepard", { shepardRate: 1.25, shepardWidth: 4 });

  for (const rendered of [sine, fm, pm, shepard]) {
    assert.ok(rendered.left.every(Number.isFinite));
    assert.ok(rendered.right.every(Number.isFinite));
    assert.ok(rms(rendered.left) > 0.02);
    assert.ok(Math.max(...rendered.left.map(Math.abs)) < 0.36);
  }
  assert.ok(differenceRms(sine.left, fm.left) > 0.05);
  assert.ok(differenceRms(sine.left, pm.left) > 0.05);
  assert.ok(differenceRms(sine.left, shepard.left) > 0.05);
  assert.ok(differenceRms(fm.left, pm.left) > 0.05);
});

test("pan is equal-power and Shepard octave wraps remain click bounded", () => {
  const hardLeft = render("sine", { pan: -1 });
  assert.ok(rms(hardLeft.left) > 0.1);
  assert.ok(rms(hardLeft.right) < 1e-6);

  const shepard = render(
    "shepard",
    { shepardRate: 8, shepardWidth: 5, gain: 0.3 },
    120,
  );
  let largestStep = 0;
  for (let index = 1; index < shepard.left.length; index += 1) {
    largestStep = Math.max(largestStep, Math.abs(shepard.left[index] - shepard.left[index - 1]));
  }
  assert.ok(largestStep < 0.2, `Shepard wrap step was ${largestStep}`);
});
