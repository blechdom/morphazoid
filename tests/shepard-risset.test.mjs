import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MORPHISMA_SWEEP_DEFAULTS,
  MORPHISMA_SWEEP_PRESETS,
  SHEPARD_DEFAULTS,
  SHEPARD_MODES,
  SHEPARD_PRESETS,
  ShepardRissetAudio,
  advanceUnitPosition,
  calculateMorphismaSweepVoices,
  calculateShepardPartials,
  createSoftCeilingCurve,
  morphismaAntiAliasWeight,
  morphismaSweepEnvelope,
  morphismaSweepFrequency,
  sanitizeMorphismaSweepParams,
  sanitizeShepardMode,
  sanitizeShepardParams,
  shepardWindow,
} from "../src/shepard-risset.js";

const EXPECTED_MODERN_PRESETS = [
  {
    id: "classic-rise",
    label: "Classic rise",
    centerFrequency: 220,
    rate: 0.12,
    width: 5,
    spread: 0.26,
    cutoff: 12_000,
  },
  {
    id: "classic-fall",
    label: "Classic fall",
    centerFrequency: 220,
    rate: -0.12,
    width: 5,
    spread: 0.26,
    cutoff: 12_000,
  },
  {
    id: "tight-spiral",
    label: "Tight spiral",
    centerFrequency: 330,
    rate: 0.42,
    width: 3.5,
    spread: 0.52,
    cutoff: 14_000,
  },
  {
    id: "deep-descent",
    label: "Deep descent",
    centerFrequency: 82,
    rate: -0.07,
    width: 7,
    spread: 0.18,
    cutoff: 8_500,
  },
];

const EXPECTED_MORPHISMA_PRESETS = [
  ["classic-rise", "Classic Rise", 8, 0.05, 100, 2, 1],
  ["classic-fall", "Classic Fall", 8, 0.05, 200, 1.5, -1],
  ["tight-spiral", "Tight Spiral", 2, 5, 135, 3.7, 1],
  ["micro-cluster", "Micro Cluster", 8, 0.06, 660, 0.12, -1],
  ["wide-staircase", "Wide Staircase", 6, 0.75, 212, 4, 1],
  ["swarm", "Swarm", 64, 0.15, 80, 2, 1],
  ["screaming-descent", "Screaming Descent", 12, 3.5, 2_400, 5, -1],
  ["sub-rumble", "Sub Rumble", 32, 0.02, 25, 2, 1],
  ["glass-shatter", "Glass Shatter", 16, 8, 1_200, 1.05, 1],
  ["alien-siren", "Alien Siren", 4, 2, 300, 7, -1],
  ["dense-cloud", "Dense Cloud", 48, 0.08, 55, 3, 1],
  ["wobble-saw", "Wobble Saw", 3, 6.5, 440, 0.5, -1],
].map(([
  id,
  label,
  voices,
  sweepRate,
  startFrequency,
  sweepRange,
  direction,
]) => ({
  id,
  label,
  voices,
  sweepRate,
  startFrequency,
  sweepRange,
  direction,
}));

test("Shepard parameters are finite and bounded", () => {
  assert.deepEqual(
    sanitizeShepardParams({
      centerFrequency: Number.NaN,
      rate: 99,
      width: -4,
      spread: 8,
      cutoff: Infinity,
      level: -2,
    }),
    {
      centerFrequency: SHEPARD_DEFAULTS.centerFrequency,
      rate: 2,
      width: 3,
      spread: 1,
      cutoff: SHEPARD_DEFAULTS.cutoff,
      level: 0,
    },
  );
});

test("two synthesis modes have stable names and independent defaults", () => {
  assert.deepEqual(SHEPARD_MODES, {
    OCTAVE: "octave",
    MORPHISMA: "morphisma",
  });
  assert.equal(sanitizeShepardMode("morphisma"), "morphisma");
  assert.equal(sanitizeShepardMode("octave"), "octave");
  assert.equal(sanitizeShepardMode("unknown"), "octave");
  assert.deepEqual(SHEPARD_DEFAULTS, {
    centerFrequency: 220,
    rate: 0.12,
    width: 5,
    spread: 0.26,
    cutoff: 12_000,
    level: 0.58,
  });
  assert.deepEqual(MORPHISMA_SWEEP_DEFAULTS, {
    voices: 8,
    sweepRate: 0.05,
    startFrequency: 100,
    sweepRange: 2,
    direction: 1,
    cutoff: 18_000,
  });
});

test("Morphisma sweep parameters preserve the complete old UI range", () => {
  assert.deepEqual(
    sanitizeMorphismaSweepParams({
      voices: 999,
      sweepRate: -4,
      startFrequency: 9_999,
      sweepRange: 99,
      direction: -0.01,
    }),
    {
      voices: 64,
      sweepRate: 0.01,
      startFrequency: 3_000,
      sweepRange: 8,
      direction: -1,
    },
  );
  assert.deepEqual(
    sanitizeMorphismaSweepParams({
      voices: Number.NaN,
      sweepRate: Infinity,
      startFrequency: Number.NaN,
      sweepRange: -Infinity,
      direction: Number.NaN,
    }),
    {
      voices: 8,
      sweepRate: 0.05,
      startFrequency: 100,
      sweepRange: 2,
      direction: 1,
    },
  );
  for (const preset of MORPHISMA_SWEEP_PRESETS) {
    const { id: _id, label: _label, ...parameters } = preset;
    assert.deepEqual(sanitizeMorphismaSweepParams(parameters), parameters);
  }
});

test("cosine window is symmetric with silent bank edges", () => {
  assert.equal(shepardWindow(-2.5, 5), 0);
  assert.equal(shepardWindow(2.5, 5), 0);
  assert.equal(shepardWindow(0, 5), 1);
  assert.ok(Math.abs(shepardWindow(-1.25, 5) - shepardWindow(1.25, 5)) < 1e-12);
});

test("unit position reports positive and negative octave wraps", () => {
  assert.deepEqual(advanceUnitPosition(0.9, 0.25), {
    position: 0.1499999999999999,
    wraps: 1,
  });
  assert.deepEqual(advanceUnitPosition(0.1, -0.25), {
    position: 0.8500000000000001,
    wraps: -1,
  });
  assert.deepEqual(advanceUnitPosition(0.2, 2.25), {
    position: 0.4500000000000002,
    wraps: 2,
  });
});

test("active Shepard partials remain octave spaced and power normalized", () => {
  const frame = calculateShepardPartials({
    position: 0.37,
    centerFrequency: 220,
    width: 7,
    spread: 0.4,
    sampleRate: 48_000,
  });
  const active = frame.partials.filter((partial) => partial.active);
  assert.ok(active.length >= 5);
  for (let index = 1; index < active.length; index += 1) {
    assert.ok(Math.abs(active[index].frequency / active[index - 1].frequency - 2) < 1e-12);
  }
  assert.ok(Math.abs(frame.normalization ** 2 * frame.weightPower - 1) < 1e-12);
  assert.ok(active.every((partial) => partial.frequency >= 20));
  assert.ok(active.every((partial) => partial.frequency <= 21_600));
});

test("preset bank includes balanced rising and falling directions", () => {
  assert.equal(SHEPARD_PRESETS.length, 4);
  assert.deepEqual(SHEPARD_PRESETS, EXPECTED_MODERN_PRESETS);
  assert.ok(SHEPARD_PRESETS.some((preset) => preset.rate > 0));
  assert.ok(SHEPARD_PRESETS.some((preset) => preset.rate < 0));
  assert.equal(new Set(SHEPARD_PRESETS.map((preset) => preset.id)).size, 4);
  assert.ok(Object.isFrozen(SHEPARD_PRESETS));
  assert.ok(SHEPARD_PRESETS.every(Object.isFrozen));
});

test("all twelve Morphisma sweep presets preserve their exact source tuples", () => {
  assert.equal(MORPHISMA_SWEEP_PRESETS.length, 12);
  assert.deepEqual(MORPHISMA_SWEEP_PRESETS, EXPECTED_MORPHISMA_PRESETS);
  assert.equal(
    new Set(MORPHISMA_SWEEP_PRESETS.map((preset) => preset.id)).size,
    12,
  );
  assert.ok(Object.isFrozen(MORPHISMA_SWEEP_PRESETS));
  assert.ok(MORPHISMA_SWEEP_PRESETS.every(Object.isFrozen));
});

test("Morphisma reference helpers reproduce the old sweep and bell formulas", () => {
  const parameters = {
    voices: 8,
    sweepRate: 0.05,
    startFrequency: 100,
    sweepRange: 2,
  };
  const golden = [
    [0, 0.0012525066979727772, 100, 1_700],
    [0.25, 0.5353686008338514, 200, 1_000],
    [0.5, 0.9987474933020273, 500, 500],
    [0.75, 0.46463139916614865, 1_000, 200],
  ];
  for (const [phase, envelope, rising, falling] of golden) {
    assert.ok(Math.abs(morphismaSweepEnvelope(phase) - envelope) < 1e-14);
    assert.equal(morphismaSweepFrequency(phase, {
      ...parameters,
      direction: 1,
    }), rising);
    assert.equal(morphismaSweepFrequency(phase, {
      ...parameters,
      direction: -1,
    }), falling);
  }
  assert.equal(
    morphismaSweepEnvelope(0),
    morphismaSweepEnvelope(1),
  );
});

test("Morphisma reference frames retain every requested voice", () => {
  for (const voices of [1, 8, 9, 12, 16, 32, 48, 64]) {
    const frame = calculateMorphismaSweepVoices({
      position: 0.31,
      voices,
      sweepRate: 0.2,
      startFrequency: 100,
      sweepRange: 0.01,
      direction: 1,
      sampleRate: 48_000,
    });
    assert.equal(frame.requestedVoices, voices);
    assert.equal(frame.voices.length, voices);
    assert.equal(frame.audibleVoices, voices);
    assert.deepEqual(
      frame.voices.map((voice) => voice.index),
      Array.from({ length: voices }, (_, index) => index),
    );
    assert.ok(frame.voices.every((voice) => (
      Number.isFinite(voice.frequency)
      && Number.isFinite(voice.envelope)
      && Number.isFinite(voice.gain)
    )));
    assert.ok(frame.voices.every((voice) => (
      Math.abs(voice.gain - voice.weight / voices) < 1e-15
    )));
  }
});

test("Morphisma anti-alias policy tapers then culls unsafe voices", () => {
  assert.equal(morphismaAntiAliasWeight(19, 48_000), 0);
  assert.equal(morphismaAntiAliasWeight(20, 48_000), 1);
  assert.equal(morphismaAntiAliasWeight(19_200, 48_000), 1);
  assert.ok(Math.abs(morphismaAntiAliasWeight(19_600, 48_000) - 0.5) < 1e-12);
  assert.equal(morphismaAntiAliasWeight(20_000, 48_000), 0);
  assert.equal(morphismaAntiAliasWeight(200_000, 48_000), 0);
  assert.equal(morphismaAntiAliasWeight(20_001, 96_000), 0);
  assert.ok(morphismaAntiAliasWeight(19_600, 96_000) > 0);
  assert.ok(morphismaAntiAliasWeight(19_600, 96_000) < 1);
  assert.equal(morphismaAntiAliasWeight(Number.NaN, 48_000), 0);

  const extreme = calculateMorphismaSweepVoices({
    ...MORPHISMA_SWEEP_PRESETS.find(
      (preset) => preset.id === "screaming-descent",
    ),
    position: 0,
    sampleRate: 48_000,
  });
  assert.equal(extreme.requestedVoices, 12);
  assert.ok(extreme.audibleVoices > 0);
  assert.ok(extreme.audibleVoices < extreme.requestedVoices);
  assert.ok(extreme.voices.every((voice) => (
    Number.isFinite(voice.frequency)
    && Number.isFinite(voice.weight)
    && voice.antiAlias >= 0
    && voice.antiAlias <= 1
  )));
});

test("soft ceiling is symmetric, monotonic, and bounded", () => {
  const curve = createSoftCeilingCurve(257);
  assert.equal(curve.length, 257);
  assert.ok(Math.abs(curve[0] + curve.at(-1)) < 1e-6);
  assert.ok(Math.abs(curve[128]) < 1e-7);
  assert.ok(Math.max(...curve.map(Math.abs)) <= 0.921);
  for (let index = 1; index < curve.length; index += 1) {
    assert.ok(curve[index] >= curve[index - 1]);
  }
});

test("audio wrapper retains independent mode parameters and posts both banks", () => {
  const audio = new ShepardRissetAudio({});
  assert.equal(audio.mode, SHEPARD_MODES.OCTAVE);
  assert.deepEqual(audio.params, {
    mode: SHEPARD_MODES.OCTAVE,
    ...SHEPARD_DEFAULTS,
  });

  const swarm = MORPHISMA_SWEEP_PRESETS.find(
    (preset) => preset.id === "swarm",
  );
  audio.setParameters({
    mode: SHEPARD_MODES.MORPHISMA,
    ...swarm,
    cutoff: 17_500,
    level: 0.7,
  });
  assert.deepEqual(audio.params, {
    mode: SHEPARD_MODES.MORPHISMA,
    voices: 64,
    sweepRate: 0.15,
    startFrequency: 80,
    sweepRange: 2,
    direction: 1,
    cutoff: 17_500,
    level: 0.7,
  });
  assert.equal(audio.octaveParams.cutoff, 12_000);

  let posted = null;
  let cutoffUpdate = null;
  let levelUpdate = null;
  audio.context = { state: "running", currentTime: 3 };
  audio.node = {
    port: {
      postMessage(message) {
        posted = message;
      },
    },
  };
  audio.lowpass = {
    frequency: {
      setTargetAtTime(...args) {
        cutoffUpdate = args;
      },
    },
  };
  audio.master = {
    gain: {
      setTargetAtTime(...args) {
        levelUpdate = args;
      },
    },
  };
  audio.enabled = true;
  audio.setParameters({
    mode: SHEPARD_MODES.MORPHISMA,
    voices: 12,
    sweepRate: 3.5,
    startFrequency: 2_400,
    sweepRange: 5,
    direction: -1,
  });
  assert.deepEqual(posted, {
    type: "parameters",
    parameters: {
      mode: "morphisma",
      octave: {
        centerFrequency: 220,
        rate: 0.12,
        width: 5,
        spread: 0.26,
      },
      morphisma: {
        voices: 12,
        sweepRate: 3.5,
        startFrequency: 2_400,
        sweepRange: 5,
        direction: -1,
      },
    },
  });
  assert.deepEqual(cutoffUpdate, [17_500, 3, 0.025]);
  assert.deepEqual(levelUpdate, [0.7, 3, 0.015]);

  audio.context = null;
  audio.node = null;
  audio.lowpass = null;
  audio.master = null;
  audio.enabled = false;
  audio.setParameters({ mode: SHEPARD_MODES.OCTAVE });
  assert.equal(audio.params.mode, SHEPARD_MODES.OCTAVE);
  assert.equal(audio.params.cutoff, 12_000);
  assert.equal(audio.params.level, 0.7);
  assert.equal(audio.morphismaParams.cutoff, 17_500);
});

test("worklet process retains typed-array state and allocates no collections", async () => {
  const source = await readFile(
    new URL("../src/shepard-risset.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("    process(_inputs, outputs) {");
  const end = source.indexOf("\n      return true;\n    }\n  };", start);
  assert.ok(start >= 0 && end > start);
  const processBody = source.slice(start, end);
  assert.doesNotMatch(processBody, /\bnew\s+/);
  assert.doesNotMatch(processBody, /Array\.from|\.(?:map|filter|reduce)\(/);
  assert.match(
    source,
    /morphismaOscillatorPhases = new Float64Array\(\s*MAX_MORPHISMA_VOICES/,
  );
  assert.match(
    source,
    /index < MAX_MORPHISMA_VOICES/,
  );
});

test("worklet crossfades rapid mode changes with finite extreme output", async () => {
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  let Processor = null;

  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage() {},
      };
    }
  }

  globalThis.AudioWorkletProcessor = MockAudioWorkletProcessor;
  globalThis.registerProcessor = (_name, ProcessorConstructor) => {
    Processor = ProcessorConstructor;
  };
  globalThis.sampleRate = 48_000;

  try {
    await import(`../src/shepard-risset.js?dual-mode-test=${Date.now()}`);
    assert.equal(typeof Processor, "function");
    const processor = new Processor({
      processorOptions: {
        mode: "octave",
        octave: SHEPARD_DEFAULTS,
        morphisma: MORPHISMA_SWEEP_DEFAULTS,
      },
    });
    const stateArrays = [
      processor.phases,
      processor.morphismaOscillatorPhases,
      processor.morphismaPhaseOffsets,
      processor.morphismaTargetPhaseOffsets,
      processor.morphismaVoiceGains,
      processor.morphismaTargetVoiceGains,
    ];
    assert.equal(stateArrays[0] instanceof Float64Array, true);
    for (const array of stateArrays.slice(1)) {
      assert.equal(array instanceof Float64Array, true);
      assert.equal(array.length, 64);
    }
    processor.port.onmessage({ data: { type: "active", value: true } });

    let peak = 0;
    const renderBlocks = (count) => {
      for (let block = 0; block < count; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        assert.equal(processor.process([], [[left, right]]), true);
        for (let index = 0; index < left.length; index += 1) {
          assert.ok(Number.isFinite(left[index]));
          assert.ok(Number.isFinite(right[index]));
          peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
        }
      }
    };

    for (let change = 0; change < 8; change += 1) {
      const morphisma = change % 2 === 0;
      processor.port.onmessage({
        data: {
          type: "parameters",
          parameters: morphisma
            ? {
              mode: "morphisma",
              voices: 64,
              sweepRate: 10,
              startFrequency: 3_000,
              sweepRange: 8,
              direction: change % 4 === 0 ? 1 : -1,
            }
            : {
              mode: "octave",
              centerFrequency: 2_000,
              rate: -2,
              width: 9,
              spread: 1,
            },
        },
      });
      renderBlocks(18);
    }

    processor.port.onmessage({
      data: {
        type: "parameters",
        parameters: {
          mode: "morphisma",
          ...MORPHISMA_SWEEP_PRESETS.find(
            (preset) => preset.id === "screaming-descent",
          ),
        },
      },
    });
    renderBlocks(260);
    assert.ok(processor.modeBlend > 0.99);
    assert.equal(processor.modeBlendTarget, 1);
    assert.ok(peak < 1, `unexpected dual-mode peak ${peak}`);

    processor.port.onmessage({
      data: {
        type: "parameters",
        parameters: { mode: "octave" },
      },
    });
    renderBlocks(220);
    assert.ok(processor.modeBlend < 0.001);
    assert.equal(processor.modeBlendTarget, 0);
    for (let index = 0; index < stateArrays.length; index += 1) {
      assert.strictEqual([
        processor.phases,
        processor.morphismaOscillatorPhases,
        processor.morphismaPhaseOffsets,
        processor.morphismaTargetPhaseOffsets,
        processor.morphismaVoiceGains,
        processor.morphismaTargetVoiceGains,
      ][index], stateArrays[index]);
    }
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});

test("worklet renders a finite normalized stereo bank through an octave seam", async () => {
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  let Processor = null;

  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage() {},
      };
    }
  }

  globalThis.AudioWorkletProcessor = MockAudioWorkletProcessor;
  globalThis.registerProcessor = (_name, ProcessorConstructor) => {
    Processor = ProcessorConstructor;
  };
  globalThis.sampleRate = 48_000;

  try {
    await import(`../src/shepard-risset.js?worklet-test=${Date.now()}`);
    assert.equal(typeof Processor, "function");
    const processor = new Processor({
      processorOptions: {
        centerFrequency: 220,
        rate: 2,
        width: 5,
        spread: 0.4,
      },
    });
    processor.port.onmessage({ data: { type: "active", value: true } });

    const rendered = [];
    let peak = 0;
    for (let block = 0; block < 220; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([], [[left, right]]), true);
      for (let index = 0; index < left.length; index += 1) {
        assert.ok(Number.isFinite(left[index]));
        assert.ok(Number.isFinite(right[index]));
        peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
        rendered.push(left[index]);
      }
    }

    const rms = Math.sqrt(
      rendered.reduce((sum, sample) => sum + sample * sample, 0) / rendered.length,
    );
    assert.ok(rms > 0.05, `unexpected Shepard RMS ${rms}`);
    assert.ok(rms < 0.4, `unexpected Shepard RMS ${rms}`);
    assert.ok(peak < 0.8, `unexpected Shepard peak ${peak}`);
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});

test("native page keeps audio creation behind the Audio gesture and cleans up", async () => {
  const root = new URL("../", import.meta.url);
  const [markup, app, audioModule] = await Promise.all([
    readFile(new URL("shepard-risset.html", root), "utf8"),
    readFile(new URL("shepard-risset-app.js", root), "utf8"),
    readFile(new URL("src/shepard-risset.js", root), "utf8"),
  ]);

  assert.match(markup, /id="audioButton"[^>]+aria-pressed="false"/);
  assert.match(markup, /id="audioState">off</);
  assert.match(markup, /src="shepard-risset-app\.js"/);
  assert.match(app, /audioButton"\)\.addEventListener\("click", toggleAudio\)/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(audioModule, /async start\(\)\s*\{\s*await this\.initialize\(\)/);
  assert.doesNotMatch(app, /new AudioContext/);
  assert.doesNotMatch(markup, /https?:\/\//);
});
