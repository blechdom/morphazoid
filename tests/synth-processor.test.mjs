import assert from "node:assert/strict";
import test from "node:test";

let ProcessorConstructor;
let processorName = "";

globalThis.sampleRate = 48_000;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = {
      onmessage: null,
      messages: [],
      postMessage(message) { this.messages.push(message); },
    };
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

const noteEnvelope = (attack = 0.08, releaseAt = 0.9) => [
  { time: 0, level: 0 }, { time: attack, level: 1 },
  { time: attack + 0.12, level: 0.55 }, { time: releaseAt - 0.25, level: 0.55 },
  { time: releaseAt, level: 0 },
];
function noteProcessor() {
  return new ProcessorConstructor({ processorOptions: { maxVoices: 16, smoothVoiceStealing: true } });
}
function sendNote(processor, overrides = {}) {
  processor.port.onmessage({ data: {
    type: "notes", voices: [{ key: "marker", mode: "sine", frequency: 220, gain: 0.3, modulationIndex: 2, modulationRatio: 1.5 }],
    envelope: noteEnvelope(), voiceLimit: 16, requestedVoiceCount: 16, startAt: processor.renderedSamples / sampleRate,
    ...overrides,
  } });
}
function noteBlock(processor) {
  const channels = [new Float32Array(128), new Float32Array(128)];
  processor.process([], [channels]);
  assert.ok(processor.voices.size <= 16);
  assert.ok(channels.every(channel => channel.every(value => Number.isFinite(value) && Math.abs(value) <= 0.780001)));
  return channels[0];
}

test("notes honour their long ADSR instead of a fixed short strike, and eventually release", () => {
  const processor = noteProcessor();
  sendNote(processor);
  let latePeak = 0;
  for (let i = 0; i < 410; i++) {
    const audio = noteBlock(processor);
    if (i > 180 && i < 270) latePeak = Math.max(latePeak, ...audio.map(Math.abs));
  }
  assert.ok(latePeak > 0.03, "a note still sounds well after the former 50ms strike");
  assert.equal(processor.voices.size, 0);
});

test("a swell rises before its marker and overlapping notes do not reset one another", () => {
  const processor = noteProcessor();
  // Marker at 200ms; the 100ms attack begins at 100ms.
  sendNote(processor, { startAt: 0.1, envelope: noteEnvelope(0.1, 0.9) });
  let beforeMarker = 0, peakGain = 0, peakAt = 0, firstVoice;
  for (let i = 0; i < 110; i++) {
    const now = processor.renderedSamples / sampleRate;
    const audio = noteBlock(processor);
    if (now < 0.095) assert.equal(Math.max(...audio.map(Math.abs)), 0);
    if (now > 0.13 && now < 0.19) beforeMarker = Math.max(beforeMarker, ...audio.map(Math.abs));
    firstVoice ??= [...processor.voices.values()][0];
    if (firstVoice?.gain > peakGain) { peakGain = firstVoice.gain; peakAt = now; }
  }
  assert.ok(beforeMarker > 0.01);
  assert.ok(peakAt >= 0.19 && peakAt <= 0.225, `smoothed envelope peaks near its 200ms marker, got ${peakAt}`);
  sendNote(processor);
  noteBlock(processor);
  assert.equal(processor.voices.size, 2);
  assert.equal(firstVoice.releasing, false, "the next marker does not reset the prior tail");
});

test("timed notes use genuinely distinct sine, FM, PM and Shepard renderers", () => {
  const signals = ["sine", "fm", "pm", "shepard"].map(mode => {
    const processor = noteProcessor();
    sendNote(processor, { voices: [{ key: "same", mode, frequency: 220, gain: 0.3, modulationIndex: 2, modulationRatio: 1.5, shepardRate: 0.4 }] });
    return Array.from({ length: 100 }, () => [...noteBlock(processor)]).flat();
  });
  for (let a = 0; a < signals.length; a++) for (let b = a + 1; b < signals.length; b++) {
    assert.ok(differenceRms(signals[a], signals[b]) > 0.01);
  }
});

test("held MIDI notes sustain and release through their ADSR; silence cancels future notes", () => {
  const processor = noteProcessor();
  sendNote(processor, { hold: true });
  for (let i = 0; i < 450; i++) noteBlock(processor);
  assert.ok([...processor.voices.values()][0].gain > 0.1);
  processor.port.onmessage({ data: { type: "release-notes" } });
  for (let i = 0; i < 150; i++) noteBlock(processor);
  assert.equal(processor.voices.size, 0);
  sendNote(processor, { startAt: 10 });
  processor.port.onmessage({ data: { type: "voices", voices: [], voiceLimit: 16 } });
  assert.equal(processor.noteQueue.length, 0);
});

test("geometry voice handoffs fade within the fixed pool instead of cutting full-volume tails", () => {
  const exercise = smoothVoiceStealing => {
    const processor = new ProcessorConstructor({ processorOptions: { maxVoices: 32, smoothVoiceStealing } });
    const specs = prefix => Array.from({ length: 32 }, (_, index) => ({
      key: `${prefix}:${index}`, mode: "sine", frequency: 110 + index * 0.5, gain: 0.02, pan: 0,
    }));
    const send = prefix => processor.port.onmessage({ data: { type: "voices", voices: specs(prefix), voiceLimit: 32, mode: "sine", durationSeconds: 0.075 } });
    const block = () => {
      const left = new Float32Array(128), right = new Float32Array(128);
      processor.process([], [[left, right]]);
      assert.ok(processor.voices.size <= 32, "release tails never add an extra DSP bank");
      return left;
    };
    send("old");
    let last;
    for (let index = 0; index < 120; index++) last = block();
    const steadyStep = largestStep(last), before = last.at(-1);
    send("new");
    const tails = [...processor.voices.values()].filter(v => v.releasing).length;
    const first = block();
    for (let index = 0; index < 24; index++) block();
    assert.ok([...processor.voices.keys()].every(key => key.startsWith("new:")));
    assert.equal(processor.pendingTargets.size, 0);
    return { steadyStep, boundaryStep: Math.abs(first[0] - before), tails };
  };
  const legacy = exercise(false), smooth = exercise(true);
  assert.equal(legacy.tails, 0, "the old full-pool path demonstrates the premature cut");
  assert.equal(smooth.tails, 32, "all outgoing voices retain an actual release");
  assert.ok(legacy.boundaryStep > legacy.steadyStep * 20);
  assert.ok(smooth.boundaryStep < smooth.steadyStep * 2);
  assert.ok(smooth.boundaryStep < legacy.boundaryStep * 0.05);
});

test("bounded handoff discards obsolete waiting geometry and retires cleanly on Audio off", () => {
  const processor = new ProcessorConstructor({ processorOptions: { maxVoices: 8, smoothVoiceStealing: true } });
  const send = (prefix, limit = 8) => processor.port.onmessage({ data: {
    type: "voices", mode: "sine", voiceLimit: limit,
    voices: Array.from({ length: limit }, (_, index) => ({ key: `${prefix}:${index}`, frequency: 220, gain: 0.05, mode: "sine" })),
  } });
  const block = () => processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  send("old");
  for (let i = 0; i < 30; i++) block();
  send("obsolete");
  assert.equal(processor.pendingTargets.size, 8);
  send("latest", 3);
  for (let i = 0; i < 30; i++) {
    block();
    assert.ok(processor.voices.size <= 8);
    assert.ok(processor.pendingTargets.size <= 3);
    assert.ok([...processor.voices.keys()].every(key => !key.startsWith("obsolete:")));
  }
  assert.equal(processor.voices.size, 3);
  send("silence", 0);
  for (let i = 0; i < 30; i++) block();
  assert.equal(processor.voices.size, 0);
  assert.equal(processor.pendingTargets.size, 0);
});

test("opt-in handoff leaves ongoing sine, FM, PM and Shepard voices sample-identical", () => {
  for (const mode of ["sine", "fm", "pm", "shepard"]) {
    const ordinary = new ProcessorConstructor({ processorOptions: { maxVoices: 8 } });
    const smooth = new ProcessorConstructor({ processorOptions: { maxVoices: 8, smoothVoiceStealing: true } });
    const data = { type: "voices", mode, voiceLimit: 8, durationSeconds: 0.075,
      voices: [{ key: "retained", mode, frequency: 220, gain: 0.3, modulationIndex: 2, modulationRatio: 1.5, shepardRate: 0.1 }] };
    for (const processor of [ordinary, smooth]) processor.port.onmessage({ data });
    for (let block = 0; block < 64; block++) {
      const buffers = [ordinary, smooth].map(processor => {
        const channels = [new Float32Array(128), new Float32Array(128)];
        processor.process([], [channels]); return channels;
      });
      assert.deepEqual(buffers[1], buffers[0], `${mode} block ${block}`);
    }
  }
});

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

test("worklet keeps outgoing voices alive during an explicitly budgeted crossfade", () => {
  const processor = new ProcessorConstructor({ processorOptions: { maxVoices: 4 } });
  const voice = (key) => ({
    key,
    mode: "sine",
    frequency: 220,
    gain: 0.25,
    pan: 0,
    gainSmoothingSeconds: 0.018,
  });
  processor.port.onmessage({
    data: {
      type: "voices",
      voices: [voice("old:a"), voice("old:b")],
      voiceLimit: 2,
    },
  });
  processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  processor.port.onmessage({
    data: {
      type: "voices",
      voices: [voice("new:a"), voice("new:b")],
      voiceLimit: 2,
      releaseVoiceAllowance: 2,
    },
  });
  assert.equal(processor.voices.size, 4);
  assert.equal(processor.voices.get("old:a").releasing, true);
  assert.equal(processor.voices.get("old:b").releasing, true);
});

test("peak-bounded point and line banks stay bounded through their crossfade", () => {
  const processor = new ProcessorConstructor({ processorOptions: { maxVoices: 8 } });
  const bank = (prefix) => [0, 1].map((index) => ({
    key: `${prefix}:${index}`,
    mode: "sine",
    frequency: 220,
    gain: 0.39,
    pan: -1,
  }));
  const send = (voices) => processor.port.onmessage({
    data: {
      type: "voices",
      voices,
      voiceLimit: 4,
      releaseVoiceAllowance: 2,
    },
  });

  send(bank("point"));
  for (let block = 0; block < 128; block += 1) {
    processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  }

  send(bank("line"));
  let transitionPeak = 0;
  for (let block = 0; block < 64; block += 1) {
    const left = new Float32Array(128);
    processor.process([], [[left, new Float32Array(128)]]);
    for (const sample of left) transitionPeak = Math.max(transitionPeak, Math.abs(sample));
  }

  assert.ok(
    transitionPeak <= 0.780001,
    `point-to-line crossfade exceeded its peak ceiling: ${transitionPeak}`,
  );
});

test("worklet admits a runtime-selected voice count and reports render load", () => {
  const processor = new ProcessorConstructor({ processorOptions: { maxVoices: 512 } });
  const voices = Array.from({ length: 300 }, (_, index) => ({
    key: `voice:${index}`,
    mode: "sine",
    frequency: 110 + index,
    gain: 0.001,
    pan: 0,
  }));
  processor.port.onmessage({
    data: {
      type: "voices",
      voices,
      requestedVoiceCount: 450,
      voiceLimit: 300,
      mode: "sine",
    },
  });
  assert.equal(processor.activeTargetCount, 300);
  assert.equal(processor.voices.size, 300);
  for (let block = 0; block < 96; block += 1) {
    processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  }
  const report = processor.port.messages.find((message) => message.type === "render-load");
  assert.equal(report.supported, true);
  assert.equal(report.activeVoices, 300);
  assert.equal(report.requestedVoices, 450);
  assert.equal(report.voiceLimit, 300);
  assert.ok(Number.isFinite(report.averageLoad));
  assert.ok(Number.isFinite(report.peakLoad));
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
