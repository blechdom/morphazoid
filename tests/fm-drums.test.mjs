import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cloneDefaultFmDrumVoices,
  DEFAULT_FM_DRUM_VOICES,
  FmDrumAudio,
  frequencyFromSlider,
  frequencySliderPosition,
  sanitizeFmDrumVoice,
} from "../src/fm-drums.js";

const root = new URL("../", import.meta.url);

test("FM Drums exposes sixteen uniquely keyed reusable voices", () => {
  assert.equal(DEFAULT_FM_DRUM_VOICES.length, 16);
  assert.equal(new Set(DEFAULT_FM_DRUM_VOICES.map(({ id }) => id)).size, 16);
  assert.deepEqual(
    DEFAULT_FM_DRUM_VOICES.map(({ key }) => key).join(""),
    "1234qwerasdfzxcv",
  );
  assert.equal(DEFAULT_FM_DRUM_VOICES.some(({ family }) => family === "kick"), true);
  assert.equal(DEFAULT_FM_DRUM_VOICES.some(({ family }) => family === "snare"), true);
  assert.equal(DEFAULT_FM_DRUM_VOICES.some(({ family }) => family === "hat"), true);
  assert.equal(DEFAULT_FM_DRUM_VOICES.some(({ family }) => family === "bell"), true);
});

test("FM drum banks clone cleanly and voice values stay bounded", () => {
  const bank = cloneDefaultFmDrumVoices();
  bank[0].frequency = 999;
  assert.notEqual(bank[0].frequency, DEFAULT_FM_DRUM_VOICES[0].frequency);
  assert.deepEqual(
    sanitizeFmDrumVoice({
      frequency: -2,
      attack: 8,
      decay: 0,
      modRatio: 30,
      modIndex: -1,
      pitchBend: 80,
      noise: 4,
      tone: -3,
      level: 7,
    }),
    {
      frequency: 20,
      attack: .25,
      decay: .1,
      modRatio: 8,
      modIndex: 0,
      pitchBend: 8,
      noise: 1,
      tone: 0,
      level: 1,
    },
  );
});

test("FM drum tuning slider is logarithmic and reversible", () => {
  assert.equal(frequencyFromSlider(0), 35);
  assert.equal(frequencyFromSlider(1), 6_000);
  for (const frequency of [48, 176, 784, 4_820]) {
    assert.ok(Math.abs(frequencyFromSlider(frequencySliderPosition(frequency)) - frequency) < 1e-8);
  }
});

test("FM drum audio recreates a context after page lifecycle closure", async () => {
  let contextCount = 0;
  let closeCount = 0;
  const node = (properties = {}) => ({
    ...properties,
    connect(destination) {
      return destination;
    },
  });
  class FakeContext {
    constructor() {
      contextCount += 1;
      this.state = "running";
      this.destination = node();
    }

    createDynamicsCompressor() {
      return node({
        threshold: {},
        knee: {},
        ratio: {},
        attack: {},
        release: {},
      });
    }

    createGain() {
      return node({ gain: { value: 0 } });
    }

    createAnalyser() {
      return node({ fftSize: 0 });
    }

    async close() {
      closeCount += 1;
      this.state = "closed";
    }
  }
  const audio = new FmDrumAudio({ AudioContext: FakeContext });
  const firstStart = audio.start();
  assert.equal(contextCount, 1, "the context is created synchronously inside the user gesture");
  const first = await firstStart;
  first.state = "closed";
  const second = await audio.start();
  assert.notEqual(second, first);
  assert.equal(contextCount, 2);
  await audio.close();
  assert.equal(closeCount, 1);
  assert.equal(audio.context, null);
  assert.equal(audio.master, null);
  const third = await audio.start();
  assert.notEqual(third, second);
  assert.equal(contextCount, 3);
});

test("FM drum audio resumes an interrupted context from a user gesture", async () => {
  let resumeCount = 0;
  const node = (properties = {}) => ({
    ...properties,
    connect(destination) {
      return destination;
    },
  });
  class InterruptedContext {
    constructor() {
      this.state = "interrupted";
      this.destination = node();
    }

    createDynamicsCompressor() {
      return node({
        threshold: {}, knee: {}, ratio: {}, attack: {}, release: {},
      });
    }

    createGain() {
      return node({ gain: { value: 0 } });
    }

    createAnalyser() {
      return node({ fftSize: 0 });
    }

    async resume() {
      resumeCount += 1;
      this.state = "running";
    }
  }

  const audio = new FmDrumAudio({ AudioContext: InterruptedContext });
  const context = await audio.start();
  assert.equal(resumeCount, 1);
  assert.equal(context.state, "running");
});

test("FM drum audio gives rattles a pitched bandpass and repeated noise strikes", async () => {
  const gainEvents = [];
  const filters = [];
  const audioParam = (value = 0) => ({
    value,
    setValueAtTime(next, time) {
      this.value = next;
      gainEvents.push({ method: "set", value: next, time });
    },
    linearRampToValueAtTime(next, time) {
      this.value = next;
      gainEvents.push({ method: "linear", value: next, time });
    },
    exponentialRampToValueAtTime(next, time) {
      this.value = next;
      gainEvents.push({ method: "exponential", value: next, time });
    },
    setTargetAtTime(next) {
      this.value = next;
    },
  });
  const node = (properties = {}) => ({
    ...properties,
    connect(destination) {
      return destination;
    },
  });
  class RattleContext {
    constructor() {
      this.state = "running";
      this.currentTime = 1;
      this.sampleRate = 1_000;
      this.destination = node();
    }

    createDynamicsCompressor() {
      return node({
        threshold: {}, knee: {}, ratio: {}, attack: {}, release: {},
      });
    }

    createGain() {
      return node({ gain: audioParam() });
    }

    createAnalyser() {
      return node({ fftSize: 0 });
    }

    createBiquadFilter() {
      const filter = node({ type: "", frequency: audioParam(), Q: audioParam() });
      filters.push(filter);
      return filter;
    }

    createOscillator() {
      return node({
        type: "sine",
        frequency: audioParam(),
        start() {},
        stop() {},
      });
    }

    createBuffer(channels, frameCount) {
      return { getChannelData: () => new Float32Array(frameCount) };
    }

    createBufferSource() {
      return node({ start() {}, stop() {}, buffer: null });
    }
  }

  const audio = new FmDrumAudio({ AudioContext: RattleContext });
  const voice = await audio.trigger({
    ...DEFAULT_FM_DRUM_VOICES[4],
    family: "rattle",
    frequency: 220,
    decay: 0.2,
    noise: 0.9,
  });
  assert.equal(voice.family, "rattle");
  assert.equal(filters.length, 2);
  assert.ok(filters.every(({ type }) => type === "bandpass"));
  assert.equal(filters[0].frequency.value, 1_100);
  assert.equal(filters[1].frequency.value, 1_320);
  assert.ok(
    gainEvents.filter(({ method }) => method === "linear").length >= 4,
    "the noise layer should contain several individual rattle strikes",
  );
});

test("FM drum audio cancels a suspended start when page lifecycle closure wins", async () => {
  let resolveResume;
  const resumeGate = new Promise((resolve) => {
    resolveResume = resolve;
  });
  const node = (properties = {}) => ({
    ...properties,
    connect(destination) {
      return destination;
    },
  });
  class SuspendedContext {
    constructor() {
      this.state = "suspended";
      this.destination = node();
    }

    createDynamicsCompressor() {
      return node({
        threshold: {}, knee: {}, ratio: {}, attack: {}, release: {},
      });
    }

    createGain() {
      return node({ gain: { value: 0 } });
    }

    createAnalyser() {
      return node({ fftSize: 0 });
    }

    async resume() {
      await resumeGate;
      this.state = "running";
    }

    async close() {
      this.state = "closed";
    }
  }

  const audio = new FmDrumAudio({ AudioContext: SuspendedContext });
  const pendingStart = audio.start();
  const pendingContext = audio.context;
  assert.equal(pendingContext.state, "suspended");

  await audio.close();
  assert.equal(audio.context, null);
  resolveResume();
  await assert.rejects(pendingStart, (error) => (
    error?.name === "AbortError"
    && /cancelled/i.test(error.message)
  ));
  assert.equal(audio.context, null, "the late resume must not restore a closed context");
});

test("FM Drums keeps compact preset controls without a page title block", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("fm-drums.html", root), "utf8"),
    readFile(new URL("fm-drums.css", root), "utf8"),
    readFile(new URL("fm-drums-app.js", root), "utf8"),
  ]);
  assert.match(html, /class="masthead"/);
  assert.match(html, /class="mobile-instrument-select"/);
  assert.match(html, /id="padGrid"/);
  assert.match(html, /id="randomizeSet"/);
  assert.match(html, /id="resetSet"/);
  assert.match(html, /id="downloadBank"/);
  assert.match(html, /src="nav\.js"/);
  assert.match(html, /src="fm-drums-app\.js"/);
  assert.match(html, /MIDI NOTES 36–51/);
  assert.match(html, /Controller Macros 1–8 · tune · decay · FM ratio · FM index · pitch sweep · noise · tone · level/);
  assert.match(html, /CC7 output · CC16 tune · CC73 attack · CC72 decay/);
  assert.match(html, /Computer pads · turn MIDI on, then use 1–4 \/ Q–R \/ A–F \/ Z–V/);
  assert.doesNotMatch(html, /id="fmDrumsTitle"|fm-drums-kicker|fm-drums-lede/);
  assert.doesNotMatch(css, /\.fm-drums-kicker|\.fm-drums-lede|\.fm-drums-intro h1/);
  assert.match(css, /\.fm-pad-grid[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(css, /\.fm-midi-map-note/);
  assert.match(app, /FM_DRUM_STORAGE_KEY/);
  assert.match(app, /getSharedMidiManager/);
  assert.match(app, /registerClient\(\{/);
  assert.match(app, /fmDrumMidiAction/);
  assert.match(app, /createFmDrumMidiTriggerVoice/);
  assert.match(app, /function refreshEditorControls\(voice\)/);
  assert.match(app, /Object\.assign\(voice, updated\)/);
  assert.match(app, /refreshPad\(voice\);[\s\S]+refreshEditorControls\(voice\)/);
  assert.match(app, /onPrepareEnable:[\s\S]+enableAudio\(\)/);
  assert.match(app, /let audioLifecycleGeneration = 0;/);
  assert.match(app, /lifecycleGeneration !== audioLifecycleGeneration/);
  assert.match(app, /pagehide[\s\S]+audioLifecycleGeneration \+= 1;[\s\S]+audioStartPromise = null;/);
  assert.match(app, /if \(midiManager\.enabled\) return;/);
  assert.match(app, /computerKeyboard: \{ layout: "pad-grid", baseNote: 36, velocity: 110 \}/);
  assert.match(app, /pagehide[\s\S]+unregisterMidi\?\.\(\)[\s\S]+audio\.close\(\)/);
  assert.match(app, /pageshow[\s\S]+registerMidiClient\(\)/);
  assert.doesNotMatch(html, /id="midiButton"|id="playModeMidi"/);
  assert.match(app, /new Blob\(\[data\], \{ type: "application\/json" \}\)/);
  assert.match(app, /morphazoid-fm-drums-\$\{date\}\.json/);
});
