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

function largestStep(values) {
  let largest = 0;
  for (let index = 1; index < values.length; index += 1) {
    largest = Math.max(largest, Math.abs(values[index] - values[index - 1]));
  }
  return largest;
}

function renderShepardTrajectory({
  start,
  end,
  width,
  rate = 0,
  durationSeconds = 0.12,
}) {
  const processor = new ProcessorConstructor({ processorOptions: { maxVoices: 1 } });
  const spec = (position) => {
    const result = {
      key: "shepard-trajectory",
      mode: "shepard",
      frequency: 220,
      gain: 0.3,
      pan: 0,
      shepardRate: rate,
      shepardPosition: position,
    };
    if (width !== undefined) result.shepardWidth = width;
    return result;
  };
  processor.port.onmessage({
    data: {
      type: "voices",
      voices: [spec(start)],
      nextVoices: [spec(end)],
      durationSeconds,
    },
  });

  const left = [];
  let minimumContributors = Infinity;
  const blocks = Math.ceil(durationSeconds * sampleRate / 128) + 20;
  for (let block = 0; block < blocks; block += 1) {
    const blockLeft = new Float32Array(128);
    processor.process([], [[blockLeft, new Float32Array(128)]]);
    left.push(...blockLeft);
    minimumContributors = Math.min(
      minimumContributors,
      processor.voices.get("shepard-trajectory").shepardContributorCount,
    );
  }
  return {
    left,
    minimumContributors,
    finalPosition: processor.voices.get("shepard-trajectory").shepardPosition,
  };
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

test("Shepard keeps overlapping partials through narrow and wide crossfades", () => {
  for (const width of [1, undefined, 15]) {
    const trajectory = renderShepardTrajectory({ start: 0.45, end: 0.55, width });
    assert.ok(
      trajectory.minimumContributors >= 2,
      `width ${width ?? "default"} fell to ${trajectory.minimumContributors} contributors`,
    );
    assert.ok(
      largestStep(trajectory.left) < (width === 15 ? 0.1 : 0.08),
      `width ${width ?? "default"} midpoint step was ${largestStep(trajectory.left)}`,
    );
  }
});

test("Shepard externally driven octave seams remain click safe", () => {
  const trajectory = renderShepardTrajectory({
    start: 0.95,
    end: 0.05,
    width: 1,
    rate: 1,
  });
  assert.ok(
    largestStep(trajectory.left) < 0.08,
    `externally driven seam step was ${largestStep(trajectory.left)}`,
  );
  assert.ok(
    Math.abs(trajectory.finalPosition - 0.05) < 0.01,
    `externally driven seam stopped at ${trajectory.finalPosition}`,
  );
});

test("Shepard power normalization keeps level consistent around the contour", () => {
  const levels = [0, 0.25, 0.5, 0.75].map((shepardPosition) => {
    const rendered = render(
      "shepard",
      { shepardPosition, shepardWidth: 1, gain: 0.3 },
      160,
    );
    return rms(rendered.left.slice(48 * 128));
  });
  const quietest = Math.min(...levels);
  const loudest = Math.max(...levels);
  assert.ok(quietest > 0.1, `unexpected Shepard levels: ${levels.join(", ")}`);
  assert.ok(
    loudest / quietest < 1.2,
    `Shepard RMS varied too much: ${levels.join(", ")}`,
  );
});

test("external Shepard position locks octave phase to playhead angle", () => {
  const processor = new ProcessorConstructor({ processorOptions: { maxVoices: 1 } });
  const sendPosition = (position) => processor.port.onmessage({
    data: {
      type: "voices",
      voices: [{
        key: "angle-locked",
        mode: "shepard",
        frequency: 110,
        gain: 0.25,
        pan: 0,
        shepardRate: 8,
        shepardWidth: 4,
        shepardPosition: position,
      }],
    },
  });
  const processBlocks = (count) => {
    for (let block = 0; block < count; block += 1) {
      processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    }
  };

  sendPosition(0.125);
  processBlocks(80);
  const voice = processor.voices.get("angle-locked");
  assert.ok(Math.abs(voice.shepardPosition - 0.125) < 1e-6);

  sendPosition(0.625);
  processBlocks(160);
  assert.ok(Math.abs(voice.shepardPosition - 0.625) < 0.01);
  assert.equal(voice.shepardExternallyDriven, true);
});

test("external Shepard trajectories preserve direction beyond a half octave", () => {
  const processTrajectory = (rate, start, end) => {
    const processor = new ProcessorConstructor({ processorOptions: { maxVoices: 1 } });
    const spec = (position) => ({
      key: "fast-angle-locked",
      mode: "shepard",
      frequency: 110,
      gain: 0.25,
      pan: 0,
      shepardRate: rate,
      shepardWidth: 4,
      shepardPosition: position,
    });
    processor.port.onmessage({
      data: {
        type: "voices",
        voices: [spec(start)],
        nextVoices: [spec(end)],
        durationSeconds: 0.075,
      },
    });
    processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    return processor.voices.get("fast-angle-locked").shepardPosition;
  };

  const forward = processTrajectory(8, 0, 0.6);
  assert.ok(forward > 0 && forward < 0.1, `expected forward motion, received ${forward}`);

  const reverse = processTrajectory(-8, 0, 0.4);
  assert.ok(reverse > 0.9 && reverse < 1, `expected reverse motion, received ${reverse}`);
});

test("unwrapped Shepard travel drives exact multi-octave trajectories", () => {
  const processor = new ProcessorConstructor({ processorOptions: { maxVoices: 1 } });
  const spec = (travel) => ({
    key: "signed-turn-travel",
    mode: "shepard",
    frequency: 110,
    gain: 0.25,
    pan: 0,
    // This fallback points upward, so the assertion also proves explicit
    // travel takes precedence over the inferred rate trajectory.
    shepardRate: 8,
    shepardWidth: 4,
    shepardPosition: 0.25,
    shepardTravel: travel,
  });
  processor.port.onmessage({
    data: {
      type: "voices",
      voices: [spec(3)],
      nextVoices: [spec(1)],
      durationSeconds: 0.075,
    },
  });

  processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  const voice = processor.voices.get("signed-turn-travel");
  assert.equal(voice.target.shepardTravel, 3);
  assert.equal(voice.nextTarget.shepardTravel, 1);
  assert.ok(
    voice.shepardPosition < 0.25,
    `expected two-octave downward motion, received ${voice.shepardPosition}`,
  );
});
