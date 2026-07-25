import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_WEIERSTRASS_PRESET_ID,
  WEIERSTRASS_DEFAULTS,
  WEIERSTRASS_FM_PRESETS,
  WEIERSTRASS_FREQUENCY_POLICY,
  WEIERSTRASS_LEGACY_FM_TUPLES,
  WEIERSTRASS_LEGACY_WAVE_TUPLES,
  WEIERSTRASS_LIMITS,
  WEIERSTRASS_WAVE_PRESETS,
  WeierstrassAudio,
  antiAliasTaper,
  boundedWeierstrassFmFrequency,
  deriveWeierstrassBank,
  deriveWeierstrassFmHeadroom,
  finiteAbsoluteWeightSum,
  sanitizeWeierstrassParams,
  weierstrassWaveAtTime,
} from "../src/weierstrass.js";

const ORIGINAL_WAVE_TUPLES = [
  [1.81, 9, 0.91, 7.07, 2],
  [137, 13, 0.71, 1.41, 0],
];

const ORIGINAL_FM_TUPLES = [
  [13.21, 28, 0.32, 5.01, 0, 700, 15.5],
  [85.21, 18, 0.87, 7.56, 10, 1_800, 10],
  [0.01, 23, 0.8, 5, 0, 500, 100],
  [2.91, 2, 0.07, 6.55, 0, 640, 140],
  [5, 33, 0.49, 2.96, 0, 3_000, 100],
];

test("all two Wave and five FM source tuples remain exact and immutable", () => {
  assert.deepEqual(WEIERSTRASS_LEGACY_WAVE_TUPLES, ORIGINAL_WAVE_TUPLES);
  assert.deepEqual(WEIERSTRASS_LEGACY_FM_TUPLES, ORIGINAL_FM_TUPLES);
  assert.equal(WEIERSTRASS_WAVE_PRESETS.length, 2);
  assert.equal(WEIERSTRASS_FM_PRESETS.length, 5);
  assert.equal(DEFAULT_WEIERSTRASS_PRESET_ID, "salt-lattice");

  for (const tuple of [
    ...WEIERSTRASS_LEGACY_WAVE_TUPLES,
    ...WEIERSTRASS_LEGACY_FM_TUPLES,
  ]) {
    assert.ok(Object.isFrozen(tuple));
  }
  for (const preset of [
    ...WEIERSTRASS_WAVE_PRESETS,
    ...WEIERSTRASS_FM_PRESETS,
  ]) {
    assert.ok(Object.isFrozen(preset));
    assert.ok(Object.isFrozen(preset.settings));
    assert.ok(Object.isFrozen(preset.source));
    assert.strictEqual(preset.sourceTuple, (
      preset.mode === "wave"
        ? WEIERSTRASS_LEGACY_WAVE_TUPLES
        : WEIERSTRASS_LEGACY_FM_TUPLES
    ).find((tuple) => tuple === preset.sourceTuple));
  }
});

test("legacy π-phasor values convert transparently to actual base Hz", () => {
  assert.equal(
    WEIERSTRASS_FREQUENCY_POLICY.id,
    "legacy-pi-phasor-half-rate",
  );
  assert.equal(WEIERSTRASS_WAVE_PRESETS[0].settings.baseFrequencyHz, 0.905);
  assert.equal(WEIERSTRASS_WAVE_PRESETS[1].settings.baseFrequencyHz, 68.5);
  assert.deepEqual(
    WEIERSTRASS_FM_PRESETS.map(({ settings }) => settings.baseFrequencyHz),
    [6.605, 42.605, 0.005, 1.455, 2.5],
  );
  assert.match(WEIERSTRASS_FREQUENCY_POLICY.description, /divided by two/i);
});

test("FM depth compensates exactly for normalized source-bank weights", () => {
  WEIERSTRASS_FM_PRESETS.forEach((preset, index) => {
    const tuple = ORIGINAL_FM_TUPLES[index];
    const expectedWeightSum = finiteAbsoluteWeightSum({
      terms: tuple[1],
      amplitudeRatio: tuple[2],
      startExponent: tuple[4],
    });
    assert.ok(
      Math.abs(preset.source.finiteAbsoluteWeightSum - expectedWeightSum)
      < 1e-12,
    );
    assert.ok(
      Math.abs(preset.settings.fmDepthHz - tuple[5] * expectedWeightSum)
      < 1e-9,
    );
  });

  assert.ok(
    Math.abs(WEIERSTRASS_FM_PRESETS[0].settings.fmDepthHz - 1029.411764705868)
    < 1e-9,
  );
  assert.ok(
    Math.abs(WEIERSTRASS_FM_PRESETS[4].settings.fmDepthHz - 5882.352940824892)
    < 1e-9,
  );
});

test("the nonportable exponent-10 FM tuple is retained but audibly adapted", () => {
  const preset = WEIERSTRASS_FM_PRESETS[1];
  assert.deepEqual(preset.sourceTuple, ORIGINAL_FM_TUPLES[1]);
  assert.equal(preset.source.legacyStartExponent, 10);
  assert.equal(preset.source.playableStartExponent, 0);
  assert.equal(preset.settings.startExponent, 0);
  assert.match(preset.source.adaptation, /no portable below-Nyquist terms/i);
  assert.match(preset.description, /rebuilt from exponent 0/i);
});

test("sanitizer accepts legacy keys and bounds hostile values", () => {
  const safe = sanitizeWeierstrassParams({
    mode: "fm",
    numVoices: 99,
    lowestFormant: -4,
    varA: Number.NaN,
    varB: Number.POSITIVE_INFINITY,
    fundamental: -2,
    modAmp: 99_999,
    startOffset: 99_999,
    output: 4,
  }, { sampleRate: 32_000 });

  assert.equal(safe.mode, "fm");
  assert.equal(safe.terms, WEIERSTRASS_LIMITS.maxTerms);
  assert.equal(safe.startExponent, 0);
  assert.equal(safe.amplitudeRatio, WEIERSTRASS_DEFAULTS.amplitudeRatio);
  assert.equal(safe.frequencyRatio, WEIERSTRASS_DEFAULTS.frequencyRatio);
  assert.equal(
    safe.baseFrequencyHz,
    WEIERSTRASS_LIMITS.minBaseFrequencyHz,
  );
  assert.equal(safe.fmDepthHz, WEIERSTRASS_LIMITS.maxFmDepthHz);
  assert.equal(safe.offsetHz, WEIERSTRASS_LIMITS.maxOffsetHz);
  assert.equal(safe.output, WEIERSTRASS_LIMITS.maxOutput);
  assert.equal(safe.maximumFrequencyHz, 14_400);
  assert.ok(Object.isFrozen(safe));
});

test("every requested term is included at 9 and 48 terms", () => {
  for (const terms of [9, 48]) {
    const bank = deriveWeierstrassBank({
      mode: "wave",
      terms,
      startExponent: 0,
      amplitudeRatio: 1,
      frequencyRatio: 1,
      baseFrequencyHz: 100,
    });
    assert.equal(bank.requestedCount, terms);
    assert.equal(bank.partials.length, terms);
    assert.equal(bank.activeCount, terms);
    assert.equal(bank.activeAbsoluteWeightSum, terms);
    assert.equal(bank.normalization, 1 / terms);
    assert.ok(
      Math.abs(
        bank.partials.reduce(
          (sum, partial) => sum + partial.normalizedWeight,
          0,
        ) - 1,
      ) < 1e-12,
    );
    assert.ok(Math.abs(weierstrassWaveAtTime(bank.settings, 0) - 1) < 1e-12);
  }
});

test("Nyquist culling and taper happen before active-bank normalization", () => {
  const bank = deriveWeierstrassBank({
    terms: 10,
    startExponent: 0,
    amplitudeRatio: 1,
    frequencyRatio: 2,
    baseFrequencyHz: 100,
  }, { sampleRate: 48_000 });

  assert.equal(bank.settings.maximumFrequencyHz, 20_000);
  assert.equal(bank.activeCount, 8);
  assert.equal(bank.culledCount, 2);
  assert.equal(bank.partials[7].frequencyHz, 12_800);
  assert.equal(bank.partials[7].taper, 1);
  assert.equal(bank.partials[8].frequencyHz, 25_600);
  assert.equal(bank.partials[8].taper, 0);
  assert.equal(bank.partials[8].normalizedWeight, 0);
  assert.ok(
    Math.abs(
      bank.partials.reduce(
        (sum, partial) => sum + Math.abs(partial.normalizedWeight),
        0,
      ) - 1,
    ) < 1e-12,
  );
  assert.equal(antiAliasTaper(10_000, 20_000), 1);
  assert.ok(antiAliasTaper(18_000, 20_000) > 0);
  assert.ok(antiAliasTaper(18_000, 20_000) < 1);
  assert.equal(antiAliasTaper(20_000, 20_000), 0);
});

test("FM frequency protection retains negative phase motion and finite bounds", () => {
  assert.equal(boundedWeierstrassFmFrequency(-1, 100, 500, 20_000), -400);
  assert.equal(boundedWeierstrassFmFrequency(1, 100, 500, 20_000), 600);
  assert.equal(
    boundedWeierstrassFmFrequency(1, 12_000, 12_000, 20_000),
    20_000,
  );
  assert.equal(
    boundedWeierstrassFmFrequency(-1, 0, 99_999, 20_000),
    -20_000,
  );
  assert.ok(Number.isFinite(
    boundedWeierstrassFmFrequency(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ),
  ));
});

test("FM headroom reports requested and actually rendered safe depth", () => {
  const unchanged = deriveWeierstrassFmHeadroom(
    WEIERSTRASS_FM_PRESETS[0].settings,
  );
  assert.equal(unchanged.limited, false);
  assert.equal(unchanged.effectiveDepthHz, unchanged.requestedDepthHz);
  assert.ok(unchanged.highestMaterialPartialHz > 4_000);

  const bounded = deriveWeierstrassFmHeadroom(
    WEIERSTRASS_FM_PRESETS[1].settings,
  );
  assert.equal(bounded.limited, true);
  assert.equal(
    bounded.requestedDepthHz,
    WEIERSTRASS_FM_PRESETS[1].settings.fmDepthHz,
  );
  assert.ok(bounded.effectiveDepthHz < bounded.requestedDepthHz);
  assert.ok(
    bounded.effectiveDepthHz
      + WEIERSTRASS_FM_PRESETS[1].settings.offsetHz
      + bounded.highestMaterialPartialHz
      <= bounded.maximumFrequencyHz + 1e-9,
  );
});

test("a = 0 above exponent zero is finite normalized silence", () => {
  const params = {
    mode: "wave",
    terms: 48,
    startExponent: 1,
    amplitudeRatio: 0,
    frequencyRatio: 2,
    baseFrequencyHz: 100,
  };
  const bank = deriveWeierstrassBank(params);
  assert.equal(bank.activeCount, 0);
  assert.equal(bank.activeAbsoluteWeightSum, 0);
  assert.equal(bank.normalization, 0);
  assert.ok(bank.partials.every(
    (partial) => Number.isFinite(partial.normalizedWeight),
  ));
  for (const time of [0, 0.001, 1, 60, 10_000]) {
    const sample = weierstrassWaveAtTime(params, time);
    assert.equal(sample, 0);
    assert.ok(Number.isFinite(sample));
  }
});

test("worklet renders finite extremes with fixed typed-array identities", async () => {
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
    await import(`../src/weierstrass.js?worklet-test=${Date.now()}`);
    assert.equal(typeof Processor, "function");
    const processor = new Processor({
      processorOptions: WEIERSTRASS_WAVE_PRESETS[0].settings,
    });
    const phaseStorage = processor.phases;
    const currentFrequencyStorage = processor.currentFrequencies;
    const targetFrequencyStorage = processor.targetFrequencies;
    const currentWeightStorage = processor.currentWeights;
    const targetWeightStorage = processor.targetWeights;
    processor.port.onmessage({ data: { type: "active", value: true } });

    let peak = 0;
    let energy = 0;
    let sampleCount = 0;
    for (let block = 0; block < 80; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([], [[left, right]]), true);
      for (let index = 0; index < left.length; index += 1) {
        assert.ok(Number.isFinite(left[index]));
        assert.equal(left[index], right[index]);
        peak = Math.max(peak, Math.abs(left[index]));
        energy += left[index] * left[index];
        sampleCount += 1;
      }
    }

    const phaseBeforeEdit = processor.phases[0];
    processor.port.onmessage({
      data: {
        type: "parameters",
        parameters: {
          mode: "fm",
          terms: 48,
          startExponent: 47,
          amplitudeRatio: 2,
          frequencyRatio: 11,
          baseFrequencyHz: 2_000,
          fmDepthHz: 12_000,
          offsetHz: 12_000,
        },
      },
    });
    for (let block = 0; block < 180; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      processor.process([], [[left, right]]);
      for (let index = 0; index < left.length; index += 1) {
        assert.ok(Number.isFinite(left[index]));
        assert.equal(left[index], right[index]);
        peak = Math.max(peak, Math.abs(left[index]));
        energy += left[index] * left[index];
        sampleCount += 1;
      }
    }

    assert.notEqual(processor.phases[0], 0);
    assert.notEqual(processor.phases[0], phaseBeforeEdit);
    assert.strictEqual(processor.phases, phaseStorage);
    assert.strictEqual(processor.currentFrequencies, currentFrequencyStorage);
    assert.strictEqual(processor.targetFrequencies, targetFrequencyStorage);
    assert.strictEqual(processor.currentWeights, currentWeightStorage);
    assert.strictEqual(processor.targetWeights, targetWeightStorage);
    assert.ok(peak <= 0.481, `unexpected raw worklet peak ${peak}`);
    assert.ok(
      Math.sqrt(energy / sampleCount) > 0.01,
      "Weierstrass worklet unexpectedly silent",
    );

    const source = await readFile(
      new URL("../src/weierstrass.js", import.meta.url),
      "utf8",
    );
    const processStart = source.indexOf("    process(_inputs, outputs) {");
    const processEnd = source.indexOf("\n      return true;\n    }", processStart);
    const processBody = source.slice(processStart, processEnd);
    assert.ok(processStart >= 0 && processEnd > processStart);
    assert.doesNotMatch(
      processBody,
      /\bnew\s+|Array\.from|\.map\(|\.filter\(|\.slice\(|\[\s*\]|\.\.\./,
    );
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});

test("audio graph is gesture-inert, resumes, suspends, and closes completely", async () => {
  class FakeParam {
    constructor(value = 0) {
      this.value = value;
    }

    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
    setTargetAtTime(value) { this.value = value; }
  }

  class FakeNode {
    constructor() {
      this.disconnected = false;
    }

    connect(node) {
      return node;
    }

    disconnect() {
      this.disconnected = true;
    }
  }

  class FakeAudioWorkletNode extends FakeNode {
    constructor() {
      super();
      this.messages = [];
      this.port = {
        postMessage: (message) => this.messages.push(message),
      };
    }
  }

  class FakeContext {
    constructor() {
      this.state = "suspended";
      this.currentTime = 0;
      this.sampleRate = 48_000;
      this.destination = new FakeNode();
      this.audioWorklet = {
        addModule: async () => {},
      };
    }

    createBiquadFilter() {
      const node = new FakeNode();
      node.frequency = new FakeParam();
      node.Q = new FakeParam();
      return node;
    }

    createDynamicsCompressor() {
      const node = new FakeNode();
      node.threshold = new FakeParam();
      node.knee = new FakeParam();
      node.ratio = new FakeParam();
      node.attack = new FakeParam();
      node.release = new FakeParam();
      return node;
    }

    createWaveShaper() {
      return new FakeNode();
    }

    createGain() {
      const node = new FakeNode();
      node.gain = new FakeParam();
      return node;
    }

    createAnalyser() {
      const node = new FakeNode();
      node.getFloatTimeDomainData = (target) => target.fill(0);
      return node;
    }

    async resume() {
      this.state = "running";
    }

    async suspend() {
      this.state = "suspended";
    }

    async close() {
      this.state = "closed";
    }
  }

  let scheduledSuspend = null;
  const runtime = {
    AudioContext: FakeContext,
    AudioWorkletNode: FakeAudioWorkletNode,
    setTimeout(callback) {
      scheduledSuspend = callback;
      return 9;
    },
    clearTimeout() {
      scheduledSuspend = null;
    },
  };
  const engine = new WeierstrassAudio(runtime);
  assert.equal(engine.context, null);
  assert.equal(engine.isInitialized, false);

  engine.setParameters(WEIERSTRASS_FM_PRESETS[0].settings);
  assert.equal(engine.context, null);
  await engine.start();
  assert.equal(engine.context.state, "running");
  assert.equal(engine.enabled, true);
  assert.ok(engine.node.messages.some(
    ({ type, value }) => type === "active" && value,
  ));

  const waveform = new Float32Array(16);
  assert.equal(engine.getWaveform(waveform), true);
  engine.stop();
  assert.equal(engine.enabled, false);
  assert.equal(typeof scheduledSuspend, "function");
  await scheduledSuspend();
  assert.equal(engine.context.state, "suspended");

  const context = engine.context;
  await engine.close();
  assert.equal(context.state, "closed");
  assert.equal(engine.context, null);
  assert.equal(engine.node, null);
  assert.equal(engine.analyser, null);
});

test("native page exposes only Wave and FM with a bounded transparent ledger", async () => {
  const root = new URL("../", import.meta.url);
  const [markup, app, stylesheet, moduleSource] = await Promise.all([
    readFile(new URL("weierstrass.html", root), "utf8"),
    readFile(new URL("weierstrass-app.js", root), "utf8"),
    readFile(new URL("weierstrass.css", root), "utf8"),
    readFile(new URL("src/weierstrass.js", root), "utf8"),
  ]);

  assert.match(markup, /id="audioButton"[^>]+aria-pressed="false"/);
  assert.match(markup, /id="audioState">off</);
  assert.match(markup, /id="output"/);
  assert.match(markup, /data-mode="wave"[^>]+>Wave</);
  assert.match(markup, /data-mode="fm"[^>]+>FM</);
  assert.doesNotMatch(markup, /data-mode="pm"/i);
  assert.match(markup, />Terms</);
  assert.match(markup, />Start exponent</);
  assert.match(markup, />Amplitude ratio a</);
  assert.match(markup, />Frequency ratio b</);
  assert.match(markup, />Base-term frequency</);
  assert.match(markup, />FM deviation</);
  assert.match(markup, />Frequency offset</);
  assert.match(markup, /requested · 4 active · 5 culled/);
  assert.match(markup, /requested · 1\.03 kHz rendered/);
  assert.match(markup, /source “fundamental” ÷ 2/i);
  assert.match(markup, /above-band terms taper out before normalization/i);
  assert.match(markup, /role="img"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /src="weierstrass-app\.js"/);
  assert.equal((markup.match(/data-preset="/g) ?? []).length, 7);
  assert.doesNotMatch(markup, /https?:\/\//);
  assert.doesNotMatch(markup, /\bexternal\b/i);
  assert.doesNotMatch(markup, /Listening/);

  assert.match(app, /FRAME_INTERVAL = 1_000 \/ 30/);
  assert.match(app, /deriveWeierstrassFmHeadroom/);
  assert.match(app, /requestedDepthHz/);
  assert.match(app, /effectiveDepthHz/);
  assert.match(app, /bank\.requestedCount/);
  assert.match(app, /bank\.activeCount/);
  assert.match(app, /bank\.culledCount/);
  assert.match(app, /fmMemory/);
  assert.match(app, /Shared lattice preserved/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(app, /audio\.close\(\)/);
  assert.doesNotMatch(app, /new AudioContext/);

  assert.match(moduleSource, /new Float64Array\(MAX_TERMS\)/);
  assert.match(moduleSource, /createBiquadFilter/);
  assert.match(moduleSource, /createDynamicsCompressor/);
  assert.match(moduleSource, /createSoftCeilingCurve/);
  assert.match(moduleSource, /async start\(\)\s*\{\s*await this\.initialize\(\)/);
  assert.match(moduleSource, /frequencyCeiling/);

  assert.match(stylesheet, /@media \(max-width: 960px\)/);
  assert.match(stylesheet, /@media \(max-width: 390px\)/);
  assert.match(stylesheet, /prefers-reduced-motion/);
  assert.match(stylesheet, /min-height: 4[02]px/);
});
