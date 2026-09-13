import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  JULIE_SAW_BLADES,
  JULIE_SAW_DEFAULTS,
  JULIE_SAW_PRESETS,
  JULIE_SAW_RHYTHMS,
  JULIE_SAW_TECHNIQUES,
  applyJulieSawPreset,
  applyJulieSawTechnique,
  bendToFrequency,
  contactAlignment,
  julieSawRhythm,
  pitchName,
  randomizedJulieSawState,
  sanitizeJulieSawState,
  sweetSpotPosition,
} from "../src/julie-saw.js";
import {
  PHYSICAL_SOUND_PRESETS,
  buildPhysicalModalBank,
} from "../src/physical-sounds.js";

const root = new URL("../", import.meta.url);
const RATE = 48_000;
const BLOCK_SIZE = 128;

function renderBlock(processor) {
  const left = new Float32Array(BLOCK_SIZE);
  const right = new Float32Array(BLOCK_SIZE);
  assert.equal(processor.process([], [[left, right]]), true);
  for (const channel of [left, right]) {
    for (const sample of channel) {
      assert.ok(Number.isFinite(sample), "Julie Saw must never emit NaN or Infinity");
      assert.ok(Math.abs(sample) <= 1.001, "the worklet output must remain bounded");
    }
  }
  return { left, right };
}

function renderBlocks(processor, count) {
  const samples = [];
  for (let block = 0; block < count; block += 1) {
    const rendered = renderBlock(processor);
    samples.push(...rendered.left, ...rendered.right);
  }
  return samples;
}

function renderLeftBlocks(processor, count) {
  const samples = new Float32Array(count * BLOCK_SIZE);
  for (let block = 0; block < count; block += 1) {
    const rendered = renderBlock(processor);
    samples.set(rendered.left, block * BLOCK_SIZE);
  }
  return samples;
}

function positiveZeroCrossingFrequency(samples, rate = RATE) {
  let crossings = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index - 1] <= 0 && samples[index] > 0) crossings += 1;
  }
  return crossings * rate / samples.length;
}

function rms(samples) {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / Math.max(1, samples.length));
}

async function withProcessorHarness(run) {
  const previousRate = globalThis.sampleRate;
  const previousBase = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  let Processor;
  globalThis.sampleRate = RATE;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { onmessage: null, postMessage() {} };
    }
  };
  globalThis.registerProcessor = (name, implementation) => {
    assert.equal(name, "julie-saw-physical-model");
    Processor = implementation;
  };
  try {
    await import(`../src/julie-saw-processor.js?test=${Date.now()}`);
    assert.equal(typeof Processor, "function");
    await run({
      makeProcessor: (configuration = {}) => new Processor({
        processorOptions: {
          configuration: sanitizeJulieSawState({
            ...JULIE_SAW_DEFAULTS,
            autoPlay: false,
            vibratoDepthCents: 0,
            ...configuration,
          }),
        },
      }),
    });
  } finally {
    globalThis.sampleRate = previousRate;
    globalThis.AudioWorkletProcessor = previousBase;
    globalThis.registerProcessor = previousRegister;
  }
}

test("Julie Saw exposes broad blade, performance, technique, and rhythm ranges", () => {
  assert.ok(JULIE_SAW_BLADES.length >= 5);
  assert.ok(JULIE_SAW_PRESETS.length >= 20);
  assert.ok(JULIE_SAW_TECHNIQUES.length >= 16);
  assert.ok(JULIE_SAW_RHYTHMS.length >= 10);
  assert.equal(new Set(JULIE_SAW_PRESETS.map(({ id }) => id)).size, JULIE_SAW_PRESETS.length);
  assert.equal(new Set(JULIE_SAW_TECHNIQUES.map(({ id }) => id)).size, JULIE_SAW_TECHNIQUES.length);
  assert.equal(new Set(JULIE_SAW_RHYTHMS.map(({ id }) => id)).size, JULIE_SAW_RHYTHMS.length);
  for (const required of [
    "clean-ring", "knee-vibrato", "hand-vibrato", "detache", "tremolo",
    "sweep", "harmonic", "double-stop", "siren", "wowa", "storm",
    "soft-mallet", "hard-mallet", "edge-pluck", "choke",
  ]) assert.ok(JULIE_SAW_TECHNIQUES.some(({ id }) => id === required), required);
  for (const required of ["bounce-two", "bounce-three", "bounce-four", "mallet-duet", "storm-motion"]) {
    assert.ok(JULIE_SAW_RHYTHMS.some(({ id }) => id === required), required);
  }
});

test("arch and curl tune continuously while independently moving localization geometry", () => {
  for (const blade of JULIE_SAW_BLADES) {
    const low = sanitizeJulieSawState({ ...JULIE_SAW_DEFAULTS, bladeId: blade.id, bend: .08, tipCurl: .5 });
    const middle = sanitizeJulieSawState({ ...low, bend: .5 });
    const high = sanitizeJulieSawState({ ...low, bend: .92 });
    assert.ok(bendToFrequency(low) < bendToFrequency(middle));
    assert.ok(bendToFrequency(middle) < bendToFrequency(high));
    assert.ok(bendToFrequency(high) / bendToFrequency(low) > 4);
    assert.ok(sweetSpotPosition(low) < sweetSpotPosition(high));
  }
  const archHeavy = sanitizeJulieSawState({ ...JULIE_SAW_DEFAULTS, bend: .58, tipCurl: .1 });
  const curlHeavy = sanitizeJulieSawState({ ...JULIE_SAW_DEFAULTS, bend: .46, tipCurl: .65 });
  assert.ok(Math.abs(1200 * Math.log2(bendToFrequency(archHeavy) / bendToFrequency(curlHeavy))) < 40);
  assert.ok(Math.abs(sweetSpotPosition(archHeavy) - sweetSpotPosition(curlHeavy)) > .02);
  assert.match(pitchName(440), /^A4/);
});

test("the moving sweet spot strongly controls tonal coupling", () => {
  const state = sanitizeJulieSawState({ ...JULIE_SAW_DEFAULTS, bend: .68, tipCurl: .72, localization: .92 });
  const sweet = sweetSpotPosition(state);
  assert.ok(contactAlignment({ ...state, bowContact: sweet }) > .999);
  assert.ok(contactAlignment({ ...state, bowContact: clamp01(sweet - .35) }) < .02);
  const broad = contactAlignment({ ...state, localization: .1, bowContact: clamp01(sweet - .14) });
  const focused = contactAlignment({ ...state, localization: .98, bowContact: clamp01(sweet - .14) });
  assert.ok(broad > focused * 3);
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

test("presets recover complete playable states and technique changes remain bounded", () => {
  for (const preset of JULIE_SAW_PRESETS) {
    const state = applyJulieSawPreset(preset.id, { ...JULIE_SAW_DEFAULTS, autoPlay: true });
    assert.equal(state.presetId, preset.id);
    assert.equal(state.autoPlay, true);
    assert.equal(state.bladeId, preset.bladeId);
    assert.equal(state.techniqueId, preset.techniqueId);
    assert.equal(state.rhythmId, preset.rhythmId);
    assert.ok(bendToFrequency(state) > 30 && bendToFrequency(state) < 10_000);
  }
  const choked = applyJulieSawTechnique(JULIE_SAW_DEFAULTS, "choke");
  assert.ok(choked.bowPressure > 1);
  assert.ok(choked.bowSpeed < .1);
  const hostile = sanitizeJulieSawState({
    bend: Infinity,
    bowPressure: -100,
    tempoBpm: 99_999,
    level: Number.NaN,
    bladeId: "missing",
    rhythmId: "missing",
  });
  assert.deepEqual(hostile.bladeId, JULIE_SAW_DEFAULTS.bladeId);
  assert.deepEqual(hostile.rhythmId, JULIE_SAW_DEFAULTS.rhythmId);
  assert.ok(hostile.bend >= .02 && hostile.bend <= .98);
  assert.equal(hostile.bowPressure, 0);
  assert.equal(hostile.tempoBpm, 300);
  assert.ok(Number.isFinite(hostile.level));
});

test("seeded randomization stays in a useful rather than pathological region", () => {
  let index = 0;
  const sequence = [.01, .17, .31, .47, .62, .79, .93];
  const state = randomizedJulieSawState(JULIE_SAW_DEFAULTS, () => sequence[(index++) % sequence.length]);
  assert.equal(state.presetId, "custom");
  assert.ok(state.bend >= .12 && state.bend <= .86);
  assert.ok(state.bowPressure >= .24 && state.bowPressure <= .86);
  assert.ok(state.bowSpeed >= .22 && state.bowSpeed <= 1.02);
  assert.ok(state.localization >= .48);
  assert.ok(state.level >= .3 && state.level <= .48);
});

test("automatic rhythm steps are immutable, valid audio-thread gestures", () => {
  for (const rhythm of JULIE_SAW_RHYTHMS) {
    assert.equal(julieSawRhythm(rhythm.id), rhythm);
    assert.ok(rhythm.steps.length >= 2 && rhythm.steps.length <= 16);
    for (const step of rhythm.steps) {
      assert.ok(["bow", "rest", "soft-mallet", "hard-mallet", "pluck", "choke"].includes(step.kind));
      assert.ok(step.velocity >= 0 && step.velocity <= 1);
      assert.ok(Object.isFrozen(step));
    }
  }
});

test("the hidden Bowed Things family now supplies Julie's musical-saw bank", () => {
  const preset = PHYSICAL_SOUND_PRESETS["bowed-things"].find(({ id }) => id === "musical-saw");
  assert.ok(preset);
  assert.match(preset.description, /localized singing mode/i);
  const bank = buildPhysicalModalBank("bowed-things", {
    ...preset.settings,
    baseFrequencyHz: 392,
  }, { sampleRate: RATE, maxModes: 8 });
  assert.equal(bank.presetId, "musical-saw");
  assert.equal(bank.modeCount, 8);
  assert.ok(Math.abs(bank.fundamentalHz - 392) < .01);
  assert.ok(bank.t60Seconds[0] > bank.t60Seconds[1] * 2);
  assert.ok([...bank.frequenciesHz].every((value, index, values) => index === 0 || value > values[index - 1]));
});

test("Julie Saw worklet renders finite bowing, release, impulses, and sample-clock patterns", async () => {
  await withProcessorHarness(async ({ makeProcessor }) => {
    const alignedState = sanitizeJulieSawState({
      ...JULIE_SAW_DEFAULTS,
      bowContact: sweetSpotPosition(JULIE_SAW_DEFAULTS),
      localization: .92,
      bowPressure: .5,
      bowSpeed: .42,
    });
    const voice = makeProcessor(alignedState);
    voice._handleMessage({ type: "bow", gate: true, direction: 1, velocityScale: 1 });
    const onset = renderBlocks(voice, 180);
    assert.ok(rms(onset.slice(-BLOCK_SIZE * 20)) > .0001, "aligned bow must speak");
    const beforeRelease = rms(onset.slice(-BLOCK_SIZE * 20));
    voice._handleMessage({ type: "bow", gate: false });
    const earlyTail = renderBlocks(voice, 30);
    const lateTail = renderBlocks(voice, 700);
    assert.ok(rms(earlyTail) > 1e-6, "lifting the bow must leave a ringing tail");
    assert.ok(rms(lateTail.slice(-BLOCK_SIZE * 20)) < beforeRelease, "the tail must eventually decay");

    const pitched = makeProcessor(alignedState);
    pitched._handleMessage({ type: "bow", gate: true, direction: 1 });
    renderLeftBlocks(pitched, 360);
    pitched._handleMessage({ type: "bow", gate: false });
    renderLeftBlocks(pitched, 40);
    const cleanRing = renderLeftBlocks(pitched, 180);
    const detectedFrequency = positiveZeroCrossingFrequency(cleanRing);
    const expectedFrequency = bendToFrequency(alignedState);
    assert.ok(
      Math.abs(1200 * Math.log2(detectedFrequency / expectedFrequency)) < 65,
      `release pitch ${detectedFrequency} Hz should follow ${expectedFrequency} Hz geometry`,
    );

    const impulse = makeProcessor();
    impulse._handleMessage({ type: "gesture", gesture: "soft-mallet", velocity: .8 });
    assert.ok(rms(renderBlocks(impulse, 60)) > 1e-5);
    impulse._handleMessage({ type: "gesture", gesture: "thimble", velocity: .8 });
    assert.ok(rms(renderBlocks(impulse, 100)) > 1e-5);
    impulse._handleMessage({ type: "gesture", gesture: "teeth", velocity: .8 });
    assert.ok(rms(renderBlocks(impulse, 100)) > 1e-5);

    const automatic = makeProcessor({ autoPlay: true, rhythmId: "detache-eighths", tempoBpm: 180 });
    automatic._handleMessage({
      type: "auto", playing: true, step: 0, phase: 0, triggerCurrent: true,
    });
    renderBlocks(automatic, 220);
    assert.ok(automatic.autoStep >= 0);
    assert.ok(automatic.activity > 0);
    automatic._handleMessage({ type: "silence" });
    assert.equal(rms(renderBlocks(automatic, 3)), 0);
  });
});

test("reset clears every queued exciter and restores deterministic geometry immediately", async () => {
  await withProcessorHarness(async ({ makeProcessor }) => {
    const voice = makeProcessor({ bend: .9, bladeDamping: .82, trackSweetSpot: false });
    voice._handleMessage({ type: "note-on", frequencyHz: 990, velocity: 1 });
    voice._handleMessage({ type: "pitch-bend", semitones: 2 });
    voice._handleMessage({ type: "gesture", gesture: "thimble", velocity: 1 });
    voice._handleMessage({ type: "gesture", gesture: "teeth", velocity: 1 });
    voice._handleMessage({ type: "choke", duration: 1 });
    renderBlocks(voice, 20);

    const resetState = sanitizeJulieSawState({
      ...JULIE_SAW_DEFAULTS,
      bowContact: sweetSpotPosition(JULIE_SAW_DEFAULTS),
      vibratoDepthCents: 0,
      autoPlay: false,
    });
    voice._handleMessage({ type: "reset", configuration: resetState });
    assert.ok(Math.abs(voice.currentFrequency - bendToFrequency(resetState)) < 1e-9);
    assert.equal(voice.targetFrequencyOverride, 0);
    assert.equal(voice.pitchBendSemitones, 0);
    assert.equal(voice.thimbleHits, 0);
    assert.equal(voice.scrapeBurst, 0);
    assert.equal(voice.choke, 0);
    assert.equal(rms(renderBlocks(voice, 300)), 0, "reset must remain exactly silent until a new gesture");

    voice._handleMessage({ type: "bow", gate: true, direction: 1 });
    assert.ok(rms(renderBlocks(voice, 120)) > 1e-5, "the reset voice must remain immediately playable");
  });
});

test("live damping is independent of the state used to construct the worklet", async () => {
  await withProcessorHarness(async ({ makeProcessor }) => {
    const dryStart = makeProcessor({ bladeDamping: 0 });
    const dampedStart = makeProcessor({ bladeDamping: 1 });
    const target = sanitizeJulieSawState({
      ...JULIE_SAW_DEFAULTS,
      bladeDamping: .37,
      brightness: .61,
      vibratoDepthCents: 0,
    });
    for (const voice of [dryStart, dampedStart]) {
      voice._handleMessage({ type: "configure", configuration: target });
      voice._updateGeometry();
    }
    assert.deepEqual([...dryStart.modeBaseT60], [...dampedStart.modeBaseT60]);
    for (let index = 0; index < dryStart.modeCount; index += 1) {
      assert.ok(Math.abs(dryStart.modeDecay[index] - dampedStart.modeDecay[index]) < 1e-15);
    }
  });
});

test("phase-bearing transport starts transient steps deliberately and never retro-triggers a late join", async () => {
  await withProcessorHarness(async ({ makeProcessor }) => {
    const fresh = makeProcessor({ rhythmId: "mallet-duet", autoPlay: true });
    assert.equal(fresh.autoPlaying, false, "configuration alone must not start transport");
    fresh._handleMessage({
      type: "auto", playing: true, step: 0, phase: 0, triggerCurrent: true,
    });
    assert.ok(rms(renderBlocks(fresh, 2)) > 1e-6, "fresh Play must perform the step-zero mallet");

    const joined = makeProcessor({ rhythmId: "mallet-duet", autoPlay: true });
    joined._handleMessage({
      type: "auto", playing: true, step: 0, phase: .5, triggerCurrent: false,
    });
    assert.equal(rms(renderBlocks(joined, 2)), 0, "joining mid-step must not replay a missed impulse");
    assert.equal(joined.autoStep, 0);
  });
});

test("a sustained 30-second bow remains finite, active, bounded, and allocation-safe by construction", async () => {
  await withProcessorHarness(async ({ makeProcessor }) => {
    const voice = makeProcessor({
      bowContact: sweetSpotPosition(JULIE_SAW_DEFAULTS),
      trackSweetSpot: false,
      vibratoDepthCents: 0,
    });
    voice._handleMessage({ type: "bow", gate: true, direction: 1 });
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    const blocks = Math.ceil(RATE * 30 / BLOCK_SIZE);
    let activeBlocks = 0;
    let peak = 0;
    for (let block = 0; block < blocks; block += 1) {
      assert.equal(voice.process([], [[left, right]]), true);
      let blockPeak = 0;
      for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
        assert.ok(Number.isFinite(left[frame]) && Number.isFinite(right[frame]));
        blockPeak = Math.max(blockPeak, Math.abs(left[frame]), Math.abs(right[frame]));
      }
      if (blockPeak > 1e-7) activeBlocks += 1;
      peak = Math.max(peak, blockPeak);
    }
    assert.ok(activeBlocks > blocks * .99);
    assert.ok(peak > .001 && peak <= 1);
  });
});

test("aligned contact is more tonal and active than a distant localized miss", async () => {
  await withProcessorHarness(async ({ makeProcessor }) => {
    const baseline = sanitizeJulieSawState({
      ...JULIE_SAW_DEFAULTS,
      trackSweetSpot: false,
      localization: .96,
      vibratoDepthCents: 0,
      bowPressure: .52,
      bowSpeed: .42,
    });
    const aligned = makeProcessor({ ...baseline, bowContact: sweetSpotPosition(baseline) });
    const missed = makeProcessor({ ...baseline, bowContact: .04, edgeRasp: 0 });
    for (const voice of [aligned, missed]) voice._handleMessage({ type: "bow", gate: true, direction: 1 });
    const alignedRms = rms(renderBlocks(aligned, 220).slice(-BLOCK_SIZE * 40));
    const missedRms = rms(renderBlocks(missed, 220).slice(-BLOCK_SIZE * 40));
    assert.ok(alignedRms > missedRms * 1.3, `${alignedRms} vs ${missedRms}`);
    assert.ok(aligned.alignment > .95);
    assert.ok(missed.alignment < .05);
  });
});

test("Julie Saw page, research, navigation, and release lists expose the full instrument contract", async () => {
  const [html, css, app, processor, research, nav, catalog, midi, build] = await Promise.all([
    readFile(new URL("../julie-saw.html", import.meta.url), "utf8"),
    readFile(new URL("../julie-saw.css", import.meta.url), "utf8"),
    readFile(new URL("../julie-saw-app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/julie-saw-processor.js", import.meta.url), "utf8"),
    readFile(new URL("../JULIE_SAW_RESEARCH.md", import.meta.url), "utf8"),
    readFile(new URL("../nav.js", import.meta.url), "utf8"),
    readFile(new URL("../src/instrument-catalog.js", import.meta.url), "utf8"),
    readFile(new URL("../src/instrument-midi-capabilities.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build-site.sh", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<h1>JULIE SAW<\/h1>/);
  assert.match(html, /data-primary-transport/);
  assert.match(html, /data-reset-all data-reset-in-place/);
  assert.match(html, /id="stage"[\s\S]*tabindex="0"/);
  assert.match(html, /Track sweet spot/);
  assert.doesNotMatch(html, /julie-stage-readout"[^>]*aria-live/);
  assert.match(html, /id="liveStatus" aria-live="polite"/);
  for (const id of ["bend", "tipCurl", "bowPressure", "bowSpeed", "bowContact", "vibratoDepthCents", "attackSeconds", "releaseSeconds"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(app, /new AudioWorkletNode\(context, "julie-saw-physical-model"/);
  assert.match(app, /connectAudioOutput/);
  assert.match(app, /morphazoid:midi-input/);
  assert.match(app, /setPointerCapture/);
  assert.match(processor, /_advanceAutomaticClock/);
  assert.match(processor, /contactVelocity/);
  const bowSection = processor.slice(
    processor.indexOf("_bowExcitation("),
    processor.indexOf("_renderModes("),
  );
  const modalSection = processor.slice(
    processor.indexOf("_renderModes("),
    processor.indexOf("process(_inputs"),
  );
  const envelopeSection = processor.slice(
    processor.indexOf("_updateDriveEnvelope("),
    processor.indexOf("_updateGeometry("),
  );
  assert.doesNotMatch(bowSection, /return\s*(?:\{|\[)/, "the per-sample bow junction must not allocate return containers");
  assert.doesNotMatch(modalSection, /return\s*(?:\{|\[)/, "the per-sample modal pass must not allocate return containers");
  assert.doesNotMatch(envelopeSection, /Math\.exp/, "ADSR coefficients must be precomputed outside the sample loop");
  assert.match(research, /Evidence-graded technique inventory/);
  assert.match(research, /Shankar, Bryde, and\s+Mahadevan/);
  assert.match(research, /velocity weakening/i);
  assert.match(nav, /id: "julie-saw", label: "Julie Saw", href: "julie-saw.html"/);
  assert.match(catalog, /"julie-saw": define/);
  assert.match(midi, /"julie-saw"/);
  for (const path of [
    "julie-saw.html", "julie-saw.css", "julie-saw-app.js", "src/julie-saw.js",
    "src/julie-saw-processor.js", "assets/instruments/julie-saw.webp", "JULIE_SAW_RESEARCH.md",
  ]) {
    assert.ok(build.split(path).length >= 3, `${path} must be present in both build lists`);
  }
  assert.ok(root.href.endsWith("/"));
});
