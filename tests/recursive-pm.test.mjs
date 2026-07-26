import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_RECURSIVE_PM_PRESET_ID,
  RECURSIVE_PM_LIMITS,
  RECURSIVE_PM_PRESETS,
  RecursivePmAudioEngine,
  deriveRecursivePmStack,
  formatRecursivePmFrequency,
  logarithmicRecursivePmPosition,
  logarithmicRecursivePmValue,
  sanitizeRecursivePmSettings,
  summarizeRecursivePmStack,
} from "../src/recursive-pm.js";

test("Recursive PM preserves all five exact Morphisma factory settings", () => {
  assert.equal(DEFAULT_RECURSIVE_PM_PRESET_ID, "chromium-swarm");
  assert.deepEqual(
    RECURSIVE_PM_PRESETS.map(({ settings }) => settings),
    [
      {
        depth: 3,
        carrierHz: 22,
        startModFrequencyHz: 0.16,
        frequencyDivisor: 1.4,
        startPhaseIndex: 3,
        indexDivisor: 1.46,
      },
      {
        depth: 3,
        carrierHz: 7.29,
        startModFrequencyHz: 372.64,
        frequencyDivisor: 4.98,
        startPhaseIndex: 5.14,
        indexDivisor: 6.25,
      },
      {
        depth: 4,
        carrierHz: 1.82,
        startModFrequencyHz: 10.94,
        frequencyDivisor: 7.16,
        startPhaseIndex: 4.29,
        indexDivisor: 2.44,
      },
      {
        depth: 4,
        carrierHz: 182,
        startModFrequencyHz: 12,
        frequencyDivisor: 3.14,
        startPhaseIndex: 1.5,
        indexDivisor: 2.67,
      },
      {
        depth: 4,
        carrierHz: 3,
        startModFrequencyHz: 0.488,
        frequencyDivisor: 0.34,
        startPhaseIndex: 7.18,
        indexDivisor: 5.26,
      },
    ],
  );
  assert.ok(Object.isFrozen(RECURSIVE_PM_PRESETS));
  assert.ok(Object.isFrozen(RECURSIVE_PM_PRESETS[0].settings));
});

test("Recursive PM sanitizer supports legacy names and contains unsafe input", () => {
  const settings = sanitizeRecursivePmSettings({
    steps: 99,
    carrierFreq: Number.POSITIVE_INFINITY,
    startModFreq: -10,
    freqDiv: 0,
    indexOfMod: 99,
    indexDiv: -2,
  }, { sampleRate: 32_000 });

  assert.equal(settings.depth, RECURSIVE_PM_LIMITS.maxDepth);
  assert.equal(settings.carrierHz, 7.29);
  assert.equal(settings.startModFrequencyHz, 0.01);
  assert.equal(settings.frequencyDivisor, 0.01);
  assert.equal(settings.startPhaseIndex, 20);
  assert.equal(settings.indexDivisor, 0.01);
  assert.equal(settings.maximumFrequencyHz, 14_400);
});

test("operator ledger follows phasor plus previous signal times phase index", () => {
  const stack = deriveRecursivePmStack(RECURSIVE_PM_PRESETS[0].settings);

  assert.equal(stack.actualDepth, 3);
  assert.equal(stack.operators.length, 4);
  assert.deepEqual(
    stack.operators.map(({ sourceIndex }) => sourceIndex),
    [null, 0, 1, 2],
  );
  assert.deepEqual(
    stack.operators.map(({ kind }) => kind),
    ["carrier", "phase-operator", "phase-operator", "phase-operator"],
  );
  assert.equal(stack.operators[0].frequencyHz, 22);
  assert.equal(stack.operators[1].frequencyHz, 0.16);
  assert.equal(stack.operators[1].phaseIndex, 3);
  assert.ok(Math.abs(stack.operators[2].frequencyHz - (0.16 / 1.4)) < 1e-12);
  assert.ok(Math.abs(stack.operators[2].phaseIndex - (3 / 1.46)) < 1e-12);
  assert.ok(stack.normalizedGain >= 0.24 && stack.normalizedGain <= 0.52);
});

test("derived stack bounds expanding frequency and phase series", () => {
  const frequencyBound = deriveRecursivePmStack({
    depth: 10,
    carrierHz: 3,
    startModFrequencyHz: 400,
    frequencyDivisor: 0.01,
    startPhaseIndex: 2,
    indexDivisor: 1,
  }, { sampleRate: 32_000 });

  assert.equal(frequencyBound.actualDepth, 1);
  assert.equal(frequencyBound.requestedDepth, 10);
  assert.equal(frequencyBound.boundedByFrequency, true);
  assert.match(summarizeRecursivePmStack(frequencyBound).label, /frequency bounded/);

  const indexBound = deriveRecursivePmStack({
    depth: 3,
    carrierHz: 3,
    startModFrequencyHz: 2,
    frequencyDivisor: 1,
    startPhaseIndex: 20,
    indexDivisor: 0.01,
  });
  assert.equal(indexBound.actualDepth, 3);
  assert.equal(indexBound.boundedByIndex, true);
  assert.equal(indexBound.operators[2].rawPhaseIndex, 2_000);
  assert.equal(
    indexBound.operators[2].phaseIndex,
    RECURSIVE_PM_LIMITS.maxInternalPhaseIndex,
  );
});

test("logarithmic parameter sliders round trip and readouts stay compact", () => {
  for (const [minimum, maximum, values] of [
    [0.01, 1_200, [0.01, 1.82, 182, 1_200]],
    [0.01, 400, [0.01, 0.488, 12, 372.64, 400]],
  ]) {
    for (const value of values) {
      const position = logarithmicRecursivePmPosition(value, minimum, maximum);
      assert.ok(
        Math.abs(
          logarithmicRecursivePmValue(position, minimum, maximum) - value,
        ) < 1e-8,
      );
    }
  }
  assert.equal(formatRecursivePmFrequency(0.488), "0.488 Hz");
  assert.equal(formatRecursivePmFrequency(372.64), "372.6 Hz");
  assert.equal(formatRecursivePmFrequency(1_200), "1.2 kHz");
});

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }

  cancelScheduledValues(time) {
    this.events.push(["cancel", time]);
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push(["set", value, time]);
  }

  setTargetAtTime(value, time, constant) {
    this.value = value;
    this.events.push(["target", value, time, constant]);
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push(["ramp", value, time]);
  }
}

class FakeNode {
  constructor() {
    this.connections = [];
    this.disconnected = false;
  }

  connect(node) {
    this.connections.push(node);
    return node;
  }

  disconnect() {
    this.disconnected = true;
  }
}

class FakeAudioWorkletNode extends FakeNode {
  constructor(context, name, options) {
    super();
    this.context = context;
    this.name = name;
    this.options = options;
    this.messages = [];
    this.port = {
      postMessage: (message) => {
        this.messages.push(message);
      },
    };
  }
}

class FakeAudioContext {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.sampleRate = 48_000;
    this.currentTime = 0;
    this.state = "suspended";
    this.destination = new FakeNode();
    this.modules = [];
    this.audioWorklet = {
      addModule: async (url) => {
        this.modules.push(String(url));
      },
    };
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    const node = new FakeNode();
    node.gain = new FakeAudioParam();
    return node;
  }

  createDynamicsCompressor() {
    const node = new FakeNode();
    for (const name of [
      "threshold",
      "knee",
      "ratio",
      "attack",
      "release",
    ]) {
      node[name] = new FakeAudioParam();
    }
    return node;
  }

  createAnalyser() {
    const node = new FakeNode();
    node.fftSize = 0;
    node.smoothingTimeConstant = 0;
    node.getByteTimeDomainData = (target) => target.fill(128);
    return node;
  }

  async resume() {
    this.state = "running";
  }

  async close() {
    this.state = "closed";
  }
}

test("audio engine starts once, updates smoothly, analyses, and fully closes", async () => {
  FakeAudioContext.instances.length = 0;
  const runtime = {
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeAudioWorkletNode,
    setTimeout: (callback) => callback(),
  };
  const engine = new RecursivePmAudioEngine(runtime);
  const firstSettings = RECURSIVE_PM_PRESETS[1].settings;

  await engine.start(firstSettings, 0.58);
  assert.equal(engine.running, true);
  assert.equal(FakeAudioContext.instances.length, 1);
  assert.equal(engine.context.options.latencyHint, "interactive");
  assert.match(engine.context.modules[0], /src\/recursive-pm\.js$/);
  assert.equal(engine.worklet.name, "morphazoid-recursive-pm");
  assert.equal(engine.worklet.messages[0].type, "settings");
  assert.equal(engine.worklet.messages[0].immediate, true);
  assert.equal(engine.worklet.messages[0].settings.depth, 3);
  assert.equal(engine.readWaveform()[0], 128);

  const worklet = engine.worklet;
  engine.updateSettings({ ...firstSettings, depth: 8 });
  assert.equal(worklet.messages.at(-1).settings.depth, 8);
  assert.equal(worklet.messages.at(-1).immediate, false);
  await engine.start(firstSettings, 0.4);
  assert.equal(FakeAudioContext.instances.length, 1);

  await engine.stop({ immediate: true });
  assert.equal(engine.running, false);
  assert.equal(engine.context, null);
  assert.equal(FakeAudioContext.instances[0].state, "closed");
  assert.equal(worklet.messages.at(-1).type, "shutdown");
  assert.equal(worklet.disconnected, true);
});

test("worklet uses exact recursive phase modulation without render allocations", async () => {
  const source = await readFile(
    new URL("../src/recursive-pm.js", import.meta.url),
    "utf8",
  );
  const processBody = source.slice(
    source.indexOf("  process(_inputs, outputs)"),
    source.indexOf("\n  }\n}\n\nif (typeof", source.indexOf("  process(_inputs, outputs)")),
  );

  assert.match(source, /signals\[turn\] \* safeIndex/);
  assert.match(source, /Math\.sin\(TWO_PI \* wrappedPhase\)/);
  assert.match(source, /this\.signals = new Float64Array/);
  assert.doesNotMatch(processBody, /new (?:Array|Float(?:32|64)Array)/);
  assert.match(processBody, /this\.current\.depth \+=/);
});

test("Recursive PM page is internal, gesture controlled, and cleans up audio", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../recursive-pm.html", import.meta.url), "utf8"),
    readFile(new URL("../recursive-pm-app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="audioButton"/);
  assert.match(html, /id="level"/);
  assert.match(html, /id="stage"/);
  assert.match(html, /href="chaotic-synth-ui\.css"/);
  assert.match(html, /class="chaotic-path-graph"/);
  assert.match(html, /id="recursivePmFlow"/);
  assert.match(app, /function updateSignalFlow\(stack\)/);
  assert.match(app, /× INDEX/);
  assert.match(app, />PHASOR</);
  assert.match(app, /chaotic-path-junction/);
  assert.match(app, /updateSignalFlow\(stack\)/);
  assert.match(html, /id="turnsReadout"/);
  assert.doesNotMatch(html, />Turn \d+</);
  assert.match(html, /data-preset="chromium-swarm"/);
  assert.match(html, /src="recursive-pm-app\.js"/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(app, /new RecursivePmAudioEngine\(window\)/);
  assert.match(app, /drawChaoticAnalysis/);
  assert.match(app, /createChaoticSpectrogram/);
  assert.match(app, /\$\("audioButton"\)\.addEventListener\("click"/);
  assert.match(app, /VISUAL_FRAME_INTERVAL = 1_000 \/ 30/);
  assert.match(app, /pagehide/);
  assert.match(app, /cancelAnimationFrame\(visualFrameId\)/);
  assert.match(app, /resizeObserver\?\.disconnect\(\)/);
  assert.match(app, /removeEventListener\("resize", resizeCanvas\)/);
  assert.match(app, /audioState"\)\.textContent = active \? "on" : "off"/);
  assert.doesNotMatch(app, /updatePreset.+audio/i);
});
