import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WEBGPU_CHIPTUNE_CREDIT,
  WEBGPU_CHIPTUNE_DEFAULTS,
  WEBGPU_CHIPTUNE_INTEGER_PARAMS,
  WEBGPU_CHIPTUNE_LIMITS,
  WEBGPU_CHIPTUNE_OUTPUT_CEILING,
  WEBGPU_CHIPTUNE_PARAM_ORDER,
  WEBGPU_CHIPTUNE_SHADER,
  WEBGPU_CHIPTUNE_WORKGROUP_SIZES,
  WebGpuChiptuneAudio,
  formatWebGpuChiptuneValue,
  sanitizeWebGpuChiptuneParams,
  webGpuChiptuneParamArray,
  webGpuChiptunePatternValue,
  webGpuChiptuneScaleLock,
  webGpuChiptuneStepSnapshot,
  webGpuChiptuneSupport,
} from "../src/webgpu-chiptune.js";

const root = new URL("../", import.meta.url);
const near = (actual, expected, epsilon = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    String(actual) + " should be within " + String(epsilon) + " of " + String(expected),
  );
};

test("WebGPU Chiptune preserves exact source credit and active parameter order", () => {
  assert.deepEqual(WEBGPU_CHIPTUNE_CREDIT, {
    sourceTitle: "Chiptune (sound)",
    creator: "srtuss",
    year: 2015,
    platform: "Shadertoy",
    shaderId: "MljSRt",
    href: "https://www.shadertoy.com/view/MljSRt",
  });
  assert.equal(WEBGPU_CHIPTUNE_PARAM_ORDER.length, 73);
  assert.deepEqual(WEBGPU_CHIPTUNE_PARAM_ORDER, [
    "tempo",
    "transpose",
    "patternSeed",
    "pitchRange",
    "gateRate",
    "gateLength",
    "pulseWidth",
    "pwmDepth",
    "pwmRate",
    "upperOneLevel",
    "upperTwoLevel",
    "bassPulseLevel",
    "bassSineLevel",
    "leadLevel",
    "arpLevel",
    "noiseLevel",
    "stereoWidth",
    "kickLevel",
    "snareLevel",
    "hatLevel",
    "shakerLevel",
    "kickTone",
    "snareTone",
    "drumDecay",
    "drumMix",
    "ghostDrums",
    "echoTaps",
    "echoTime",
    "echoDecay",
    "echoStereo",
    "fadeIn",
    "gain",
    "scaleMask",
    "upperOneSpan",
    "upperTwoSpan",
    "bassSpan",
    "upperOneRegister",
    "bassRegister",
    "arpRegister",
    "sectionUnits",
    "pitchClock",
    "bassClock",
    "gateFastRatio",
    "gateSwitchShortUnits",
    "gateSwitchLongUnits",
    "leadTrillRate",
    "leadInterval",
    "leadPhraseUnits",
    "arpRate",
    "arpSpan",
    "arpOctaveRate",
    "arpOctaves",
    "bassPulseWidth",
    "drumRate",
    "echoCrossfeed",
    "gateAttack",
    "gateRelease",
    "texturePeriod",
    "textureDecay",
    "kickCycle",
    "kickSubcycle",
    "snareNoiseMix",
    "hatBalance",
    "ghostDelayDivisor",
    "ghostPan",
    "gateA0",
    "gateA1",
    "gateA2",
    "gateA3",
    "gateB0",
    "gateB1",
    "gateB2",
    "gateB3",
  ]);
  assert.ok(Object.isFrozen(WEBGPU_CHIPTUNE_PARAM_ORDER));
  assert.ok(Object.isFrozen(WEBGPU_CHIPTUNE_INTEGER_PARAMS));

  const packed = webGpuChiptuneParamArray(
    Object.fromEntries(WEBGPU_CHIPTUNE_PARAM_ORDER.map((key, index) => [key, index / 10])),
  );
  assert.ok(packed instanceof Float32Array);
  assert.equal(packed.length, WEBGPU_CHIPTUNE_PARAM_ORDER.length);
  WEBGPU_CHIPTUNE_PARAM_ORDER.forEach((key, index) => {
    const [minimum, maximum] = WEBGPU_CHIPTUNE_LIMITS[key];
    const bounded = Math.min(maximum, Math.max(minimum, index / 10));
    const expected = WEBGPU_CHIPTUNE_INTEGER_PARAMS.includes(key) ? Math.round(bounded) : bounded;
    near(packed[index], expected, 1e-5);
  });
});

test("WebGPU Chiptune defaults retain the active Shadertoy song", () => {
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.tempo, 1.3);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.patternSeed, 1.79425579);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.pulseWidth, 0.4);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.pwmDepth, 0.25);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.pwmRate, 0.3);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.echoTaps, 8);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.echoTime, 0.33);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.echoDecay, 0.3);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.fadeIn, 1);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.gain, 0.8);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.scaleMask, 1717);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.upperOneSpan, 20);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.bassRegister, -36);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.leadInterval, 7);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.drumRate, 1);
  assert.deepEqual(
    ["gateA0", "gateA1", "gateA2", "gateA3"].map((key) => WEBGPU_CHIPTUNE_DEFAULTS[key]),
    [12547, 784, 8323, 8754],
  );
  assert.equal(formatWebGpuChiptuneValue("tempo", 1.3), "78 BPM");
  assert.equal(formatWebGpuChiptuneValue("pwmRate", 0.3), "0.30 rad/s");
  assert.equal(formatWebGpuChiptuneValue("scaleMask", 1717), "0x6B5");
});

test("WebGPU Chiptune sanitizes hostile parameters and keeps taps bounded", () => {
  const sanitized = sanitizeWebGpuChiptuneParams({
    tempo: -99,
    transpose: 400,
    patternSeed: Number.NaN,
    pitchRange: Number.POSITIVE_INFINITY,
    gateLength: 99,
    pulseWidth: -2,
    pwmDepth: 4,
    kickLevel: -5,
    drumDecay: 0,
    echoTaps: 900,
    echoTime: -10,
    echoDecay: 9,
    gain: 5,
    scaleMask: 0,
    gateA0: 100000,
  });
  assert.equal(sanitized.tempo, 0.4);
  assert.equal(sanitized.transpose, 12);
  assert.equal(sanitized.patternSeed, WEBGPU_CHIPTUNE_DEFAULTS.patternSeed);
  assert.equal(sanitized.pitchRange, WEBGPU_CHIPTUNE_DEFAULTS.pitchRange);
  assert.equal(sanitized.gateLength, 2);
  assert.equal(sanitized.pulseWidth, 0.05);
  assert.equal(sanitized.pwmDepth, 0.45);
  assert.equal(sanitized.kickLevel, 0);
  assert.equal(sanitized.drumDecay, 0.3);
  assert.equal(sanitized.echoTaps, 8);
  assert.equal(sanitizeWebGpuChiptuneParams({ echoTaps: 2.6 }).echoTaps, 3);
  assert.equal(sanitized.echoTime, 0.05);
  assert.equal(sanitized.echoDecay, 0.78);
  assert.equal(sanitized.gain, 1);
  assert.equal(sanitized.scaleMask, 1);
  assert.equal(sanitized.gateA0, 65535);

  for (const key of WEBGPU_CHIPTUNE_PARAM_ORDER) {
    assert.ok(Number.isFinite(sanitized[key]), key + " must remain finite");
  }
  assert.deepEqual(WEBGPU_CHIPTUNE_WORKGROUP_SIZES, [32, 64, 128, 256]);
  const audio = new WebGpuChiptuneAudio({}, { chunkDuration: 99, workgroupSize: 7 });
  assert.equal(audio.chunkDurationInSeconds, 0.5);
  assert.equal(audio.workgroupSize, 256);
});

test("procedural score helpers match scale and fast lead/arpeggio substeps", () => {
  assert.equal(webGpuChiptuneScaleLock(1), 0);
  assert.equal(webGpuChiptuneScaleLock(3), 2);
  assert.equal(webGpuChiptuneScaleLock(-1), -2);
  assert.equal(webGpuChiptuneScaleLock(0, 2), 1);
  assert.equal(webGpuChiptuneScaleLock(11, 1), 12);
  near(webGpuChiptunePatternValue(7), (49 * WEBGPU_CHIPTUNE_DEFAULTS.patternSeed) % 1);

  const early = webGpuChiptuneStepSnapshot(3, WEBGPU_CHIPTUNE_DEFAULTS, 0.1);
  const late = webGpuChiptuneStepSnapshot(3, WEBGPU_CHIPTUNE_DEFAULTS, 0.9);
  assert.equal(early.upperOne, late.upperOne);
  assert.equal(early.upperTwo, late.upperTwo);
  assert.equal(early.bass, late.bass);
  assert.notEqual(early.lead, late.lead);
  assert.notEqual(early.arp, late.arp);
  for (const value of Object.values(early).concat(Object.values(late))) {
    assert.ok(Number.isFinite(value));
  }
});

test("WGSL renders a bounded stereo active path without dormant source branches", () => {
  assert.equal(WEBGPU_CHIPTUNE_OUTPUT_CEILING, 0.88);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /Chiptune \(sound\).*srtuss \(2015\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /shadertoy\.com\/view\/MljSRt/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /@compute/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /@workgroup_size\(WORKGROUP_SIZE\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /sound_chunk: array<vec2<f32>>/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /@binding\(2\) var<storage, read> audio_param/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /fn synthVoices/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /fn beatTwo/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /for \(var tap = 0u; tap < 8u; tap \+= 1u\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /p\.ghostDelayDivisor/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /fn packedGateDuration/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /p\.scaleMask/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /p\.echoCrossfeed/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /p\.drumRate/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /const OUTPUT_CEILING: f32 = 0\.88/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /return clamp\(output, vec2\(-OUTPUT_CEILING\), vec2\(OUTPUT_CEILING\)\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /frequency \/ SAMPLE_RATE/);
  assert.doesNotMatch(WEBGPU_CHIPTUNE_SHADER, /fn adsr|fn oscc|fn osc\(|fn beat\(/);
});

test("WebGPU Chiptune output is gated independently from transport", () => {
  const events = [];
  const audio = new WebGpuChiptuneAudio({});
  audio.context = { currentTime: 4 };
  audio.master = {
    gain: {
      setTargetAtTime(value, time, constant) {
        events.push({ value, time, constant });
      },
    },
  };

  audio.setOutput(0.62);
  assert.equal(events.at(-1).value, 0);
  audio.setPlaybackEnabled(true);
  assert.equal(events.at(-1).value, 0.62);
  audio.setOutput(0.31);
  assert.equal(events.at(-1).value, 0.31);
  audio.setPlaybackEnabled(false);
  assert.equal(events.at(-1).value, 0);
  assert.deepEqual(webGpuChiptuneSupport({}), {
    audio: false,
    webgpu: false,
    supported: false,
  });
});

test("start options preserve offsets and failed setup releases owned audio", async () => {
  const destination = {};
  const sharedContext = {
    currentTime: 2,
    sampleRate: 48000,
    state: "running",
    createGain() {
      return {
        gain: { value: 0 },
        connect() {},
        disconnect() {},
      };
    },
  };
  const runtime = { navigator: { gpu: { requestAdapter() {} } } };
  const shared = new WebGpuChiptuneAudio(runtime);
  shared.initGpu = async () => {
    shared.device = {};
  };
  await shared.start({ context: sharedContext, destination, offset: 12, autoStart: false });
  assert.equal(shared.renderOffset, 12);
  assert.equal(shared.ownsContext, false);
  await shared.stop();

  let closeCount = 0;
  class OwnedContext {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.state = "running";
    }
    async close() {
      closeCount += 1;
      this.state = "closed";
    }
  }
  const owned = new WebGpuChiptuneAudio({
    AudioContext: OwnedContext,
    navigator: { gpu: { requestAdapter() {} } },
  });
  owned.createAudioGraph = () => {};
  owned.initGpu = async () => {
    throw new Error("GPU setup failed");
  };
  await assert.rejects(owned.start(WEBGPU_CHIPTUNE_DEFAULTS, { autoStart: false }), /GPU setup failed/);
  assert.equal(closeCount, 1);
  assert.equal(owned.context, null);
  assert.equal(owned.device, null);
});

test("restartTimeline primes one exact stereo chunk and cleanup stops it", async () => {
  const starts = [];
  const stops = [];
  const timers = [];
  const context = {
    currentTime: 10,
    sampleRate: 20,
    createBuffer() {
      const channels = [new Float32Array(2), new Float32Array(2)];
      return {
        duration: 0.1,
        length: 2,
        getChannelData(index) {
          return channels[index];
        },
      };
    },
    createBufferSource() {
      return {
        connect() {},
        start(when) {
          starts.push(when);
        },
        stop(when) {
          stops.push(when);
        },
      };
    },
  };
  const audio = new WebGpuChiptuneAudio({
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout() {},
  }, { chunkDuration: 0.1 });
  audio.context = context;
  audio.input = {};
  audio.device = {};
  audio.chunkNumSamplesPerChannel = 2;
  audio.sampleRate = context.sampleRate;
  audio.renderChunk = async () => new Float32Array([0.1, -0.1, 0.2, -0.2]);

  const actualStart = await audio.restartTimeline({ startAt: 10.05, offset: 3 });
  assert.equal(actualStart, 10.05);
  assert.deepEqual(starts, [10.05]);
  assert.equal(audio.scheduledChunks[0].offset, 3);
  near(audio.renderOffset, 3.1);
  assert.equal(audio.running, true);
  assert.equal(timers.length, 1);

  const pausedAt = audio.pauseTimeline();
  assert.equal(pausedAt, 3);
  assert.equal(audio.running, false);
  assert.deepEqual(stops, [10]);
});

test("WebGPU Chiptune ships as a separate accessible and credited page", async () => {
  const [html, css, app, source, notices, readme, buildScript] = await Promise.all([
    readFile(new URL("webgpu-chiptune.html", root), "utf8"),
    readFile(new URL("webgpu-chiptune.css", root), "utf8"),
    readFile(new URL("webgpu-chiptune-app.js", root), "utf8"),
    readFile(new URL("src/webgpu-chiptune.js", root), "utf8"),
    readFile(new URL("THIRD_PARTY_NOTICES.md", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
  ]);

  assert.match(html, /id="webgpuChiptune"/);
  assert.match(html, /<title>WebGPU Chiptune - Morphazoid<\/title>/);
  assert.match(html, /id="audioButton"[^>]*aria-pressed="false"/);
  assert.match(html, /id="synthPlayButton"[\s\S]*?data-primary-transport/);
  assert.match(html, /id="stage"[\s\S]*?role="application"[\s\S]*?tabindex="0"/);
  assert.match(html, /trackerInstructions/);
  assert.match(html, /<h1 class="sr-only" id="webgpuChiptuneTitle">/);
  assert.match(html, /id="advancedState"/);
  assert.match(html, /id="scaleControls"/);
  assert.match(html, /id="gateControls"/);
  assert.match(html, /Chiptune \(sound\) by srtuss, 2015 · Shadertoy MljSRt/);
  assert.match(html, /src="webgpu-chiptune-app\.js"/);
  assert.match(css, /#stage:focus-visible/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*overflow-x: auto/);
  assert.match(app, /new WebGpuChiptuneAudio\(globalThis/);
  assert.match(app, /Audio is off — turn it on to hear playback\./);
  assert.match(app, /id: "webgpu-chiptune"/);
  assert.match(app, /subscribeState/);
  assert.match(app, /pointercancel/);
  assert.match(app, /stageKeyDown/);
  assert.match(app, /pageKeyDown/);
  assert.match(app, /restartSynchronizedAudio/);
  assert.match(app, /trackerNotesForLane/);
  assert.match(app, /createScaleEditor/);
  assert.match(app, /createGateEditor/);
  assert.match(app, /engine\?\.updateParams\(state\.params\)/);
  assert.match(source, /connectAudioOutput/);
  assert.doesNotMatch(source, /createDynamicsCompressor/);
  assert.match(notices, /## WebGPU Chiptune \/ Chiptune \(sound\) lineage/);
  assert.match(notices, /did not state a reuse license/);
  assert.match(readme, /\*\*WebGPU Chiptune\*\* joins the Sequencers/);

  const stopAudio = app.slice(
    app.indexOf("async function stopAudio"),
    app.indexOf("async function toggleAudio"),
  );
  assert.doesNotMatch(stopAudio, /synthPlaying\s*=\s*false|pauseTransport/);
  const playTransport = app.slice(
    app.indexOf("async function playTransport"),
    app.indexOf("async function toggleSynthPlay"),
  );
  assert.doesNotMatch(playTransport, /startAudio|new AudioContext/);

  for (const key of WEBGPU_CHIPTUNE_PARAM_ORDER.filter(
    (candidate) => !/^gate[AB][0-3]$/.test(candidate),
  )) {
    assert.match(app, new RegExp('makeSpec\\("' + key + '"'), key + " needs a visible control");
  }
  for (const key of WEBGPU_CHIPTUNE_PARAM_ORDER.filter(
    (candidate) => /^gate[AB][0-3]$/.test(candidate),
  )) {
    assert.match(source, new RegExp(key + ": f32"), key + " needs a packed gate field");
  }
  for (const file of [
    "webgpu-chiptune.html",
    "webgpu-chiptune.css",
    "webgpu-chiptune-app.js",
    "src/webgpu-chiptune.js",
  ]) {
    assert.ok(buildScript.includes(file), file + " must ship in the WAX build");
  }
});
