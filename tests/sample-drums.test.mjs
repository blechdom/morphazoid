import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_SAMPLE_DRUM_VOICES,
  SAMPLE_DRUM_SAMPLE_SOURCES,
  SampleDrumAudio,
  cloneDefaultSampleDrumVoices,
  mappedLatticeSampleDrumVoice,
  sampleDrumVoiceForFmVoice,
  sampleRateFromSemitones,
  sanitizeSampleDrumVoice,
} from "../src/sample-drums.js";

const root = new URL("../", import.meta.url);

test("Sample Drums exposes a pinned sixteen-slot 808 and 909 bank", () => {
  assert.equal(DEFAULT_SAMPLE_DRUM_VOICES.length, 16);
  assert.equal(new Set(DEFAULT_SAMPLE_DRUM_VOICES.map(({ id }) => id)).size, 16);
  assert.equal(
    DEFAULT_SAMPLE_DRUM_VOICES.map(({ key }) => key).join(""),
    "1234qwerasdfzxcv",
  );
  assert.equal(DEFAULT_SAMPLE_DRUM_VOICES.some(({ machine }) => machine === "tr-808"), true);
  assert.equal(DEFAULT_SAMPLE_DRUM_VOICES.some(({ machine }) => machine === "tr-909"), true);
  for (const voice of DEFAULT_SAMPLE_DRUM_VOICES) {
    assert.match(voice.url, /^https:\/\/unpkg\.com\/%40fluid-music\/tr-(?:808@0\.0\.2|909@0\.0\.4)\//);
    assert.equal(voice.url.endsWith(voice.samplePath), true);
  }
  assert.equal(SAMPLE_DRUM_SAMPLE_SOURCES["tr-808"].version, "0.0.2");
  assert.equal(SAMPLE_DRUM_SAMPLE_SOURCES["tr-909"].version, "0.0.4");
});

test("sample drum banks clone cleanly and sampler controls stay bounded", () => {
  const bank = cloneDefaultSampleDrumVoices();
  bank[0].pitch = 9;
  assert.notEqual(bank[0].pitch, DEFAULT_SAMPLE_DRUM_VOICES[0].pitch);
  const sanitized = sanitizeSampleDrumVoice({
    id: "808-bd-short",
    pitch: 90,
    attack: 8,
    decay: -2,
    tone: -3,
    level: 7,
    machine: "unknown",
    samplePath: "bad",
    url: "file:///bad.wav",
  });
  assert.equal(sanitized.pitch, 24);
  assert.equal(sanitized.attack, .25);
  assert.equal(sanitized.decay, .02);
  assert.equal(sanitized.tone, 0);
  assert.equal(sanitized.level, 1);
  assert.equal(sanitized.machine, "tr-808");
  assert.match(sanitized.url, /^https:\/\/unpkg\.com\/%40fluid-music\/tr-808@0\.0\.2\//);
});

test("sample playback rate and lattice FM translation are musical semitone mappings", () => {
  assert.equal(sampleRateFromSemitones(0), 1);
  assert.equal(sampleRateFromSemitones(12), 2);
  assert.equal(sampleRateFromSemitones(-12), .5);
  const translated = sampleDrumVoiceForFmVoice(
    DEFAULT_SAMPLE_DRUM_VOICES[0],
    {
      frequency: DEFAULT_SAMPLE_DRUM_VOICES[0].referenceFrequency * 2,
      tone: .9,
      level: .33,
    },
  );
  assert.equal(translated.pitch, 12);
  assert.equal(translated.tone, .9);
  assert.equal(translated.level, .33);
});

test("lattice sample mapping keeps the recorded voice character audible", () => {
  const mapped = mappedLatticeSampleDrumVoice(
    DEFAULT_SAMPLE_DRUM_VOICES[11],
    { y: .5, incidence: .9 },
    {
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      pitchDepth: 24,
      characterDepth: .8,
      contactCount: 8,
    },
  );
  assert.equal(mapped.id, "909-clap");
  assert.equal(mapped.pitch, 0);
  assert.ok(mapped.level >= DEFAULT_SAMPLE_DRUM_VOICES[11].level * .75);
  assert.ok(mapped.tone > DEFAULT_SAMPLE_DRUM_VOICES[11].tone);
});

test("SampleDrumAudio decodes samples once and reuses AudioBuffers from memory", async () => {
  let contextCount = 0;
  let fetchCount = 0;
  let startCount = 0;
  const param = (value = 0) => ({
    value,
    setValueAtTime(next) { this.value = next; },
    linearRampToValueAtTime(next) { this.value = next; },
    exponentialRampToValueAtTime(next) { this.value = next; },
    setTargetAtTime(next) { this.value = next; },
  });
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
      this.currentTime = 1;
      this.sampleRate = 44_100;
      this.destination = node();
    }

    createDynamicsCompressor() {
      return node({
        threshold: param(),
        knee: param(),
        ratio: param(),
        attack: param(),
        release: param(),
      });
    }

    createGain() {
      return node({ gain: param() });
    }

    createAnalyser() {
      return node({ fftSize: 0 });
    }

    createBufferSource() {
      return node({
        playbackRate: param(1),
        start() {
          startCount += 1;
        },
        stop() {},
      });
    }

    createBiquadFilter() {
      return node({ frequency: param(), Q: param(), type: "lowpass" });
    }

    decodeAudioData(_data, resolve) {
      const decoded = { duration: .75 };
      if (resolve) {
        queueMicrotask(() => resolve(decoded));
        return undefined;
      }
      return Promise.resolve(decoded);
    }

    async close() {
      this.state = "closed";
    }
  }
  const audio = new SampleDrumAudio({
    AudioContext: FakeContext,
    fetch: async () => {
      fetchCount += 1;
      return {
        ok: true,
        async arrayBuffer() {
          return new ArrayBuffer(16);
        },
      };
    },
  });
  const voice = DEFAULT_SAMPLE_DRUM_VOICES[0];
  await audio.trigger(voice);
  await audio.trigger(voice);
  assert.equal(contextCount, 1);
  assert.equal(fetchCount, 1);
  assert.equal(startCount, 2);
  assert.equal(audio.loadedSampleCount, 1);
  assert.equal(await audio.preload([voice, voice]), 1);
  assert.equal(fetchCount, 1);
  await audio.close();
  assert.equal(audio.context, null);
});

test("Sample Drums page exposes the standalone sampler and preload flow", async () => {
  const [html, css, app, notices] = await Promise.all([
    readFile(new URL("sample-drums.html", root), "utf8"),
    readFile(new URL("sample-drums.css", root), "utf8"),
    readFile(new URL("sample-drums-app.js", root), "utf8"),
    readFile(new URL("THIRD_PARTY_NOTICES.md", root), "utf8"),
  ]);
  assert.match(html, /id="sampleDrums"/);
  assert.match(html, /id="preloadSamples"/);
  assert.match(html, /id="sampleLoadState"/);
  assert.match(html, /src="sample-drums-app\.js"/);
  assert.match(html, /sample-drums\.css/);
  assert.match(css, /\.sample-load-state/);
  assert.match(app, /new SampleDrumAudio\(globalThis\)/);
  assert.match(app, /audio\.preload\(state\.voices\)/);
  assert.match(app, /audio\.hasBuffer\(voice\.url\)/);
  assert.match(app, /function isWaxMidiOnly\(\)/);
  assert.match(app, /if \(isWaxMidiOnly\(\)\) return;/);
  assert.match(app, /!state\.audioOn && !isWaxMidiOnly\(\)/);
  assert.match(app, /morphazoid-sample-drums-\$\{date\}\.json/);
  assert.match(notices, /Fluid Music Open Drums/);
  assert.match(notices, /does not vendor the TR-909 WAV files/);
});
