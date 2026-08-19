import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WEBGPU_303_CREDIT,
  WEBGPU_303_BUFFER_PARAM_ORDER,
  WEBGPU_303_DEFAULT_STEP_MODULATION,
  WEBGPU_303_DEFAULTS,
  WEBGPU_303_PARAM_ORDER,
  WEBGPU_303_SEQUENCE_LENGTH,
  WEBGPU_303_SHADER,
  WEBGPU_303_SOURCE_SEQUENCE,
  WEBGPU_303_SOURCE_FUNDAMENTAL_CONTROL,
  WEBGPU_303_WORKGROUP_SIZES,
  WebGpu303Audio,
  sanitizeWebGpu303Params,
  sanitizeWebGpu303Sequence,
  sanitizeWebGpu303StepModulation,
  webGpu303FundamentalFromSourceControl,
  webGpu303ParamArray,
  webGpu303SequenceArray,
  webGpu303SequenceValue,
  webGpu303StepModulationArray,
  webGpu303SourceControlFromFundamental,
  webGpu303SwingTime,
  webGpu303Support,
} from "../src/webgpu-303.js";

const root = new URL("../", import.meta.url);
const near = (actual, expected, epsilon = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} should be within ${epsilon} of ${expected}`,
  );
};
const fract = (value) => value - Math.floor(value);

test("WebGPU 303 preserves the acid shader credit and parameter buffer order", () => {
  assert.equal(WEBGPU_303_CREDIT.sourceTitle, "sound - acid jam");
  assert.equal(WEBGPU_303_CREDIT.creator, "srtuss");
  assert.equal(WEBGPU_303_CREDIT.platform, "Shadertoy");
  assert.equal(WEBGPU_303_CREDIT.href, "https://www.shadertoy.com/view/ldfSW2");
  assert.equal(WEBGPU_303_SOURCE_FUNDAMENTAL_CONTROL, 80);
  near(webGpu303FundamentalFromSourceControl(80), 251.18864315095783);
  near(webGpu303SourceControlFromFundamental(webGpu303FundamentalFromSourceControl(80)), 80);
  assert.match(WEBGPU_303_SHADER, /sound - acid jam/);
  assert.match(WEBGPU_303_SHADER, /srtuss/);
  assert.match(WEBGPU_303_SHADER, /@compute/);
  assert.match(WEBGPU_303_SHADER, /fn synthesize/);
  assert.match(WEBGPU_303_SHADER, /sound_chunk: array<vec2<f32>>/);
  assert.match(WEBGPU_303_SHADER, /@binding\(3\) var<storage, read> sequence_step/);
  assert.match(WEBGPU_303_SHADER, /@binding\(4\) var<storage, read> step_modulation/);
  assert.match(WEBGPU_303_SHADER, /fn sequenceValue/);
  assert.match(WEBGPU_303_SHADER, /fn stepModulation/);
  assert.match(WEBGPU_303_SHADER, /fn swingTime/);
  assert.match(WEBGPU_303_SHADER, /1\.0 \+ amount/);
  assert.match(WEBGPU_303_SHADER, /1\.0 - amount/);
  assert.match(WEBGPU_303_SHADER, /swingTime\(straightTime, audio_param\.swing\)/);
  assert.match(WEBGPU_303_SHADER, /audio_param\.res \+ modulation\.z/);
  assert.match(WEBGPU_303_SHADER, /audio_param\.stereo \+ modulation\.w/);
  assert.deepEqual(WEBGPU_303_PARAM_ORDER, [
    "partials",
    "frequency",
    "timeMod",
    "timeScale",
    "gain",
    "dist",
    "dur",
    "ratio",
    "sampOffset",
    "fundamental",
    "stereo",
    "nse",
    "res",
    "lfo",
    "flt",
  ]);
  assert.deepEqual(WEBGPU_303_BUFFER_PARAM_ORDER, [
    ...WEBGPU_303_PARAM_ORDER,
    "swing",
  ]);
  assert.ok(Object.isFrozen(WEBGPU_303_BUFFER_PARAM_ORDER));

  const values = webGpu303ParamArray({
    partials: 1,
    frequency: 2,
    timeMod: 3,
    timeScale: 4,
    gain: 0.5,
    dist: 6,
    dur: 0.25,
    ratio: 8,
    sampOffset: 9,
    fundamental: 80,
    stereo: 1,
    nse: 12,
    res: 13,
    lfo: 14,
    flt: 15,
    swing: 0.25,
  });
  assert.equal(values.length, 16);
  assert.deepEqual(
    Array.from(values),
    [1, 2, 3, 4, 0.5, 5, 0.25, 8, 9, 80, 1, 12, 13, 14, 15, 0.25],
  );
});

test("WebGPU 303 swing warps even/odd boundaries without moving pair boundaries", () => {
  for (const time of [0, 0.25, 1, 1.75, 2, 9.5]) {
    near(webGpu303SwingTime(time, 0), time);
  }

  const swing = 0.25;
  near(webGpu303SwingTime(0.625, swing), 0.5);
  near(webGpu303SwingTime(1.25, swing), 1);
  near(webGpu303SwingTime(1.625, swing), 1.5);
  near(webGpu303SwingTime(2, swing), 2);
  near(webGpu303SwingTime(3.25, swing), 3);
  near(webGpu303SwingTime(4, swing), 4);
  near(webGpu303SwingTime(1.42, 99), 1);
});

test("WebGPU 303 sequence buffer can draw steps while preserving source noise fallback", () => {
  assert.equal(WEBGPU_303_SEQUENCE_LENGTH, 128);
  assert.equal(WEBGPU_303_SOURCE_SEQUENCE.length, WEBGPU_303_SEQUENCE_LENGTH);
  assert.ok(WEBGPU_303_SOURCE_SEQUENCE.every((value) => value === -1));

  const sanitized = sanitizeWebGpu303Sequence([0.2, 2, -4, "x", 0.5]);
  assert.equal(sanitized.length, WEBGPU_303_SEQUENCE_LENGTH);
  near(sanitized[0], 0.2);
  near(sanitized[1], 0.9999);
  assert.equal(sanitized[2], -1);
  assert.equal(sanitized[3], -1);
  near(sanitized[4], 0.5);
  assert.equal(sanitized[127], -1);

  const bufferValues = webGpu303SequenceArray([0.42]);
  assert.equal(bufferValues.length, WEBGPU_303_SEQUENCE_LENGTH);
  near(bufferValues[0], 0.42, 1e-6);
  assert.equal(bufferValues[1], -1);

  near(webGpu303SequenceValue(0, WEBGPU_303_DEFAULTS, [0.42]), 0.42);
  near(
    webGpu303SequenceValue(1, { ...WEBGPU_303_DEFAULTS, nse: 12345 }, WEBGPU_303_SOURCE_SEQUENCE),
    fract(Math.sin(110.082) * 12345),
  );
});

test("WebGPU 303 packs a neutral, bounded 128-step vec4 modulation lane", () => {
  assert.deepEqual(WEBGPU_303_DEFAULT_STEP_MODULATION, [1, 0, 0, 0]);
  assert.ok(Object.isFrozen(WEBGPU_303_DEFAULT_STEP_MODULATION));

  const sanitized = sanitizeWebGpu303StepModulation([
    [0.25, 1.5, 2.5, -0.75],
    [4, -200, 99, -20],
    [Number.NaN, Number.POSITIVE_INFINITY, "not a number", null],
  ]);
  assert.equal(sanitized.length, WEBGPU_303_SEQUENCE_LENGTH);
  assert.deepEqual(sanitized[0], [0.25, 1.5, 2.5, -0.75]);
  assert.deepEqual(sanitized[1], [1, -64, 15, -8]);
  assert.deepEqual(sanitized[2], WEBGPU_303_DEFAULT_STEP_MODULATION);
  assert.deepEqual(sanitized[127], WEBGPU_303_DEFAULT_STEP_MODULATION);

  const packed = webGpu303StepModulationArray(sanitized);
  assert.ok(packed instanceof Float32Array);
  assert.equal(packed.length, WEBGPU_303_SEQUENCE_LENGTH * 4);
  Array.from(packed.slice(0, 4)).forEach((value, index) => {
    near(value, sanitized[0][index]);
  });

  const audio = new WebGpu303Audio({});
  audio.updateStepModulation([[0.4, -2, 3, 0.5]]);
  assert.deepEqual(audio.stepModulation[0], [0.4, -2, 3, 0.5]);
});

test("WebGPU 303 default patch matches the WebGPU Audio AcidSynth controls", () => {
  assert.deepEqual(
    {
      partials: WEBGPU_303_DEFAULTS.partials,
      frequency: WEBGPU_303_DEFAULTS.frequency,
      timeMod: WEBGPU_303_DEFAULTS.timeMod,
      timeScale: WEBGPU_303_DEFAULTS.timeScale,
      gain: WEBGPU_303_DEFAULTS.gain,
      dist: WEBGPU_303_DEFAULTS.dist,
      dur: WEBGPU_303_DEFAULTS.dur,
      ratio: WEBGPU_303_DEFAULTS.ratio,
      sampOffset: WEBGPU_303_DEFAULTS.sampOffset,
      stereo: WEBGPU_303_DEFAULTS.stereo,
      nse: WEBGPU_303_DEFAULTS.nse,
      res: WEBGPU_303_DEFAULTS.res,
      lfo: WEBGPU_303_DEFAULTS.lfo,
      flt: WEBGPU_303_DEFAULTS.flt,
      swing: WEBGPU_303_DEFAULTS.swing,
    },
    {
      partials: 256,
      frequency: 38,
      timeMod: 16,
      timeScale: 9,
      gain: 0.15,
      dist: 0.5,
      dur: 0.26,
      ratio: 2,
      sampOffset: 1,
      stereo: 0.01,
      nse: 19871.8972,
      res: 2.2,
      lfo: 1,
      flt: -1.5,
      swing: 0,
    },
  );
  near(WEBGPU_303_DEFAULTS.fundamental, webGpu303FundamentalFromSourceControl(80));
  const params = Array.from(webGpu303ParamArray(WEBGPU_303_DEFAULTS));
  const expected = [
    256,
    38,
    16,
    9,
    0.15,
    0.5,
    0.26,
    2,
    1,
    251.18864315095783,
    0.01,
    19871.8972,
    2.2,
    1,
    -1.5,
    0,
  ];
  params.forEach((value, index) => near(value, expected[index], 1e-2));
});

test("WebGPU 303 parameter and runtime settings stay bounded", () => {
  const sanitized = sanitizeWebGpu303Params({
    partials: 900,
    frequency: -20,
    timeMod: 2.2,
    timeScale: Infinity,
    gain: 4,
    dist: -3,
    dur: -1,
    ratio: 99,
    sampOffset: 2.6,
    fundamental: 4,
    stereo: -80,
    nse: 90000,
    res: -4,
    lfo: 500,
    flt: -500,
    swing: 3,
  });
  assert.equal(sanitized.partials, 256);
  assert.equal(sanitized.frequency, 0.2);
  assert.equal(sanitized.timeMod, 2);
  assert.equal(sanitized.timeScale, 9);
  assert.equal(sanitized.gain, 0.75);
  assert.equal(sanitized.dist, 0.01);
  assert.equal(sanitized.dur, 0.001);
  assert.equal(sanitized.ratio, 32);
  assert.equal(sanitized.sampOffset, 3);
  assert.equal(sanitized.fundamental, 4);
  assert.equal(sanitized.stereo, -8);
  assert.equal(sanitized.nse, 40000);
  assert.equal(sanitized.res, 0);
  assert.equal(sanitized.lfo, 64);
  assert.equal(sanitized.flt, -64);
  assert.equal(sanitized.swing, 0.42);
  assert.equal(sanitizeWebGpu303Params({ swing: -3 }).swing, 0);
  assert.equal(sanitizeWebGpu303Params({ timeMod: 900 }).timeMod, 128);

  const audio = new WebGpu303Audio({}, { chunkDuration: 99, workgroupSize: 7 });
  assert.equal(audio.chunkDurationInSeconds, 0.5);
  assert.equal(audio.workgroupSize, 256);
  assert.equal(audio.playbackEnabled, false);
  assert.deepEqual(WEBGPU_303_WORKGROUP_SIZES, [32, 64, 128, 256]);
});

test("WebGPU 303 output is gated by the separate synth play state", () => {
  const gainEvents = [];
  const audio = new WebGpu303Audio({});
  audio.context = { currentTime: 4 };
  audio.master = {
    gain: {
      setTargetAtTime(value, time, constant) {
        gainEvents.push({ value, time, constant });
      },
    },
  };

  audio.setOutput(0.62);
  assert.equal(gainEvents.at(-1).value, 0);
  audio.setPlaybackEnabled(true);
  assert.equal(gainEvents.at(-1).value, 0.62);
  audio.setOutput(0.33);
  assert.equal(gainEvents.at(-1).value, 0.33);
  audio.setPlaybackEnabled(false);
  assert.equal(gainEvents.at(-1).value, 0);
});

test("WebGPU support detection is independent from existing Web Audio synth engines", () => {
  assert.deepEqual(webGpu303Support({}), { audio: false, webgpu: false, supported: false });
  assert.deepEqual(
    webGpu303Support({
      AudioContext: class {},
      navigator: { gpu: { requestAdapter() {} } },
    }),
    { audio: true, webgpu: true, supported: true },
  );
});

test("WebGPU 303 streaming scheduler keeps queueing render batches", async () => {
  const timers = [];
  const runtime = {
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout() {},
  };
  const audio = new WebGpu303Audio(runtime, { chunkDuration: 0.1 });
  let fillCount = 0;
  audio.running = true;
  audio.fillBuffer = async () => {
    fillCount += 1;
  };

  audio.queueFill();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 0);

  timers.shift().callback();
  const firstRender = audio.renderingPromise;
  assert.ok(firstRender);
  await firstRender;
  assert.equal(fillCount, 1);
  assert.equal(audio.renderingPromise, null);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 22);

  timers.shift().callback();
  const secondRender = audio.renderingPromise;
  assert.ok(secondRender);
  await secondRender;
  assert.equal(fillCount, 2);
  assert.equal(timers.length, 1);
});

test("WebGPU 303 exposes scheduled shader time for visual playhead sync", () => {
  const audio = new WebGpu303Audio({}, { chunkDuration: 0.1 });
  audio.running = true;
  audio.context = { currentTime: 1.1 };
  audio.renderOffset = 2.1;
  audio.nextStartTime = 1.3;
  audio.scheduledChunks = [
    { offset: 2, startAt: 1.2, endAt: 1.3, duration: 0.1 },
  ];

  near(audio.currentPlaybackTime(), 2);
  audio.context.currentTime = 1.25;
  near(audio.currentPlaybackTime(), 2.05);
  audio.context.currentTime = 1.36;
  near(audio.currentPlaybackTime(), 2.1);
  audio.context.currentTime = 1.5;
  near(audio.currentPlaybackTime(), 2.1);

  audio.running = false;
  assert.equal(audio.currentPlaybackTime(), null);
});

test("WebGPU 303 can use an externally owned AudioContext and destination", async () => {
  const connections = [];
  const disconnections = [];
  const destination = { kind: "rubix-mix" };
  const context = {
    currentTime: 4,
    sampleRate: 48000,
    state: "running",
    closeCount: 0,
    createGain() {
      return {
        gain: { value: 0 },
        connect(target) {
          connections.push(target);
          return target;
        },
        disconnect(target) {
          disconnections.push(target);
        },
      };
    },
    async close() {
      this.closeCount += 1;
    },
  };
  const runtime = {
    navigator: { gpu: { requestAdapter() {} } },
  };
  const audio = new WebGpu303Audio(runtime);
  audio.initGpu = async () => {
    audio.device = {};
  };

  const returned = await audio.start(
    { ...WEBGPU_303_DEFAULTS, gain: 0.2 },
    { context, destination, autoStart: false },
  );
  assert.equal(returned, context);
  assert.equal(audio.context, context);
  assert.equal(audio.ownsContext, false);
  assert.equal(audio.running, false);
  assert.ok(connections.includes(destination));

  await audio.stop();
  assert.equal(context.closeCount, 0, "stopping must not close a shared AudioContext");
  assert.ok(disconnections.includes(destination));
});

test("WebGPU 303 restartTimeline primes and reports an exact shared-context start", async () => {
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
  const audio = new WebGpu303Audio({
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
  assert.deepEqual(
    starts,
    [10.05],
    "timeline restart should return after priming one chunk, before its exact start time",
  );
  assert.equal(audio.scheduledChunks[0].offset, 3);
  near(audio.renderOffset, 3.1);
  assert.equal(audio.running, true);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 0);

  const pausedAt = audio.pauseTimeline();
  assert.equal(pausedAt, 3);
  assert.equal(audio.running, false);
  assert.deepEqual(stops, [10]);
});

test("WebGPU 303 page ships as a separate credited section", async () => {
  const [html, css, app, source, notices, readme, buildScript] = await Promise.all([
    readFile(new URL("webgpu-303.html", root), "utf8"),
    readFile(new URL("webgpu-303.css", root), "utf8"),
    readFile(new URL("webgpu-303-app.js", root), "utf8"),
    readFile(new URL("src/webgpu-303.js", root), "utf8"),
    readFile(new URL("THIRD_PARTY_NOTICES.md", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
  ]);

  assert.match(html, /id="webgpu303"/);
  assert.match(html, /id="audioButton"[^>]*aria-pressed="false"/);
  assert.match(html, /id="knobControls"/);
  assert.match(html, /id="synthPlayButton"[^>]*aria-pressed="false"/);
  assert.match(html, /Play synth/);
  assert.match(html, /id="randomizePatch"/);
  assert.match(html, /id="mutatePatch"/);
  assert.match(html, /class="webgpu-stage-knobs"/);
  assert.match(html, /class="webgpu-stage-knob-actions"/);
  assert.match(html, /id="clearSequence"/);
  assert.match(html, /id="randomizeSequence"/);
  assert.match(html, /src="webgpu-303-app\.js"/);
  assert.match(html, /sound - acid jam by srtuss on Shadertoy/);
  assert.ok(html.indexOf("id=\"audioButton\"") < html.indexOf("id=\"synthPlayButton\""));
  assert.ok(html.indexOf("id=\"synthPlayButton\"") < html.indexOf("class=\"header-level\""));
  assert.ok(html.indexOf("id=\"synthPlayButton\"") < html.indexOf("<main class=\"shell webgpu-303-shell\""));
  assert.ok(html.indexOf("id=\"knobControls\"") < html.indexOf("id=\"presetButtons\""));
  assert.ok(html.indexOf("class=\"webgpu-status-strip\"") < html.indexOf("class=\"webgpu-303-credit\""));
  assert.ok(html.indexOf("class=\"webgpu-303-credit\"") < html.indexOf("<details class=\"group control-section webgpu-303-section webgpu-303-presets\""));
  assert.ok(html.indexOf("<h2 class=\"group-title\">Pattern</h2>") < html.indexOf("<h2 class=\"group-title\">Filter</h2>"));
  assert.doesNotMatch(html, /knobState|stageKnobTitle|303 Knobs|Squelch altar|Pitch prism|Trip clock/);
  assert.match(css, /\.webgpu-303-page/);
  assert.match(css, /\.webgpu-stage-knobs/);
  assert.match(css, /\.webgpu-stage-knob-actions/);
  assert.match(css, /\.webgpu-303-page \.audio-strip \{[\s\S]*grid-template-columns: 78px 92px minmax\(96px, 140px\)/);
  assert.match(css, /\.synth-play-button/);
  assert.match(css, /\.synth-play-button\[aria-pressed="true"\]/);
  assert.doesNotMatch(css, /webgpu-stage-knob-actions \.synth-play-button/);
  assert.match(css, /\.webgpu-knob-bank/);
  assert.match(css, /\.webgpu-knob-bank \{[\s\S]*--knob-columns: 8/);
  assert.match(css, /\.webgpu-knob-bank \{[\s\S]*--knob-size: clamp\(58px, 5\.15vw, 72px\)/);
  assert.match(css, /\.webgpu-knob-bank \{[\s\S]*display: grid/);
  assert.match(css, /\.webgpu-knob-bank \{[\s\S]*justify-content: center/);
  assert.match(css, /\.webgpu-knob-bank \{[\s\S]*grid-template-columns: repeat\(var\(--knob-columns\), var\(--knob-size\)\)/);
  assert.match(css, /\.webgpu-knob-dial/);
  assert.match(css, /\.webgpu-preset-grid \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /min-height: 31px/);
  assert.match(css, /--knob-hue/);
  assert.match(css, /grid-template-rows: clamp\(360px, 50dvh, 520px\)/);
  assert.match(css, /flex: 0 1 clamp\(410px, 50dvh, 520px\)/);
  assert.match(css, /min-height: 260px/);
  assert.match(css, /\.webgpu-303-credit \{[\s\S]*border-bottom/);
  assert.doesNotMatch(css, /bottom: 54px/);
  assert.doesNotMatch(css, /webgpu-knob-group|webgpu-knob-grid|webgpu-knob-group-title|webgpu-stage-knobs-heading/);
  assert.match(source, /scheduledChunks/);
  assert.match(source, /currentPlaybackTime/);
  assert.match(source, /offset: chunkOffset/);
  assert.match(app, /new WebGpu303Audio\(globalThis/);
  assert.match(app, /Source Acid Synth/);
  assert.match(app, /presetParams/);
  assert.match(app, /WEBGPU_303_PARAM_ORDER/);
  assert.match(app, /knobOrder/);
  assert.match(app, /const knobOrder = Object\.freeze\(\[\s*"timeScale",\s*"timeMod",\s*"flt",\s*"res",\s*"dist"/);
  assert.match(app, /timeScale: "Speed"/);
  assert.match(app, /knobHueByKey/);
  assert.match(app, /balancedKnobColumnCount/);
  assert.match(app, /balanceKnobRows/);
  assert.match(app, /ResizeObserver/);
  assert.match(app, /dataset\.knobColumns/);
  assert.match(app, /PATTERN_LANE_TOP = 0\.07/);
  assert.match(app, /PATTERN_LANE_HEIGHT = 0\.8/);
  assert.match(app, /PATTERN_FOOT_TOP = 0\.89/);
  assert.match(app, /PATTERN_FOOT_HEIGHT = 4/);
  assert.match(app, /visualPlaybackTime/);
  assert.match(app, /currentPlaybackTime/);
  assert.match(app, /synthPlaying/);
  assert.match(app, /visualHoldTime/);
  assert.match(app, /setSynthPlayState/);
  assert.match(app, /toggleSynthPlay/);
  const synthTransport = app.slice(
    app.indexOf("async function toggleSynthPlay()"),
    app.indexOf("async function restartAudio()", app.indexOf("async function toggleSynthPlay()")),
  );
  assert.doesNotMatch(synthTransport, /startAudio|setAudioState|toggleAudio/);
  assert.match(synthTransport, /Turn Audio on before playing the synth/);
  const synthState = app.slice(
    app.indexOf("function setSynthPlayState"),
    app.indexOf("function syncParamOutputs", app.indexOf("function setSynthPlayState")),
  );
  assert.doesNotMatch(synthState, /setAudioState/);
  assert.match(app, /setPlaybackEnabled/);
  assert.match(app, /synthPlayButton/);
  assert.match(app, /sequencePhaseAtTime/);
  assert.match(app, /const playheadX = \(activeStep \+ 0\.5\) \* cellWidth/);
  assert.match(app, /SAFE_RANDOM_PARAM_RANGES/);
  assert.match(app, /MUTATE_PATCH_PARAM_ORDER/);
  assert.match(app, /key !== "timeScale" && key !== "timeMod"/);
  assert.match(app, /MUTATE_PATCH_AMOUNTS/);
  assert.match(app, /randomSafePatchParams/);
  assert.match(app, /mutateSafePatchParams/);
  assert.match(app, /for \(const key of MUTATE_PATCH_PARAM_ORDER\)/);
  assert.match(app, /const amount = MUTATE_PATCH_AMOUNTS\[key\] \?\? 0\.075/);
  assert.match(app, /energyManagedParams/);
  assert.match(app, /randomizePatch/);
  assert.match(app, /mutatePatch/);
  assert.match(app, /clockControlToTimeScale/);
  assert.match(app, /timeScaleToClockControl/);
  assert.match(app, /createKnobControl/);
  assert.match(app, /setAttribute\("role", "slider"\)/);
  assert.match(app, /Lysergic Ribbon/);
  assert.match(app, /Astral Smear/);
  assert.match(app, /Glass Seance/);
  assert.match(app, /Voltage Melt/);
  assert.match(app, /Liquid Needle/);
  assert.match(app, /Floor Warp/);
  assert.match(app, /Hollow Halo/);
  assert.match(app, /Vector Mirage/);
  assert.match(app, /Oracle Scanner/);
  assert.match(app, /Opal Cathedral/);
  assert.match(app, /Prism Bath/);
  assert.doesNotMatch(app, /dur: 0\.0/);
  assert.match(app, /updateSequence/);
  assert.match(app, /randomizeSequence/);
  assert.match(app, /pointerdown/);
  assert.match(app, /shiftKey/);
  assert.doesNotMatch(app, /knobGroups|knobState|303 Knobs|Squelch altar|Pitch prism|Trip clock/);
  assert.doesNotMatch(app, /Rubber Ladder|Glass Line|Seed Swarm|Acid Clock|Neon Ladder|Chrome Teeth|Solar Shard|Filter Snap|Wide Phase|Resonance Glass|Needle Trip|Drive Floor|Hollow Offset|Vector Sweep|Seed Scanner|Lysergic Snap/);
  assert.doesNotMatch(app, /from "\.\/src\/(?:audio|fm-drums|sample-drums|chaotic-fm|chaotic-pm|weierstrass)/);
  assert.doesNotMatch(source, /from "\.\/(?:audio\.js|fm-drums|sample-drums|chaotic-fm|chaotic-pm|weierstrass)/);
  assert.doesNotMatch(source, /createDynamicsCompressor/);
  assert.match(notices, /## WebGPU 303 \/ Acid Synth lineage/);
  assert.match(readme, /does not share the existing Web Audio synth engines/);
  for (const file of [
    "webgpu-303.html",
    "webgpu-303.css",
    "webgpu-303-app.js",
    "src/webgpu-303.js",
  ]) {
    assert.match(buildScript, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
