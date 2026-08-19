import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LINEAR_DRUM_DEFAULTS,
  LINEAR_DRUM_PARAMETER_SPECS,
  LINEAR_DRUM_PITCHED_ARCHETYPES,
  LINEAR_DRUM_PRESETS,
  LinearDrumAudio,
  linearDrumFrequencyAtPosition,
  linearDrumMappedParameterValues,
  linearDrumMappingAmount,
  linearDrumMorphWeights,
  linearDrumParameterPosition,
  linearDrumParameterValue,
  linearDrumParameters,
  linearDrumPitchedMorphWeights,
  linearDrumPositionAtFrequency,
  linearDrumSigmoid,
  sanitizeLinearDrumSettings,
} from "../src/linear-drums.js";

const root = new URL("../", import.meta.url);

test("Rattlesnake maps its logarithmic rail to frequency and back", () => {
  for (const position of [0, .01, .2, .5, .83, 1]) {
    const frequency = linearDrumFrequencyAtPosition(position, 20, 16_000);
    const roundTrip = linearDrumPositionAtFrequency(frequency, 20, 16_000);
    assert.ok(Math.abs(roundTrip - position) < 1e-12);
  }
  assert.equal(linearDrumFrequencyAtPosition(0, 20, 16_000), 20);
  assert.equal(linearDrumFrequencyAtPosition(1, 20, 16_000), 16_000);
});

test("each morph center is smooth, monotonic, and exactly halfway", () => {
  for (const center of [110, 720, 4_600]) {
    assert.equal(linearDrumSigmoid(center, center, 1.05), .5);
    const below = linearDrumSigmoid(center * .9999, center, 1.05);
    const above = linearDrumSigmoid(center * 1.0001, center, 1.05);
    assert.ok(below < .5);
    assert.ok(above > .5);
    assert.ok(above - below < .001);
  }
});

test("morph weights remain normalized and continuous over the complete range", () => {
  let previous = null;
  for (let index = 0; index <= 2_000; index += 1) {
    const frequency = linearDrumFrequencyAtPosition(index / 2_000, 20, 16_000);
    const weights = linearDrumMorphWeights(frequency, LINEAR_DRUM_DEFAULTS);
    const values = Object.values(weights);
    assert.ok(values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
    if (previous) {
      const largestStep = Math.max(...values.map((value, weightIndex) => (
        Math.abs(value - previous[weightIndex])
      )));
      assert.ok(largestStep < .005, `unexpected timbre step at ${frequency} Hz`);
    }
    previous = values;
  }
});

test("derived percussion parameters evolve without discrete family jumps", () => {
  let previous = null;
  let previousNoise = -Infinity;
  for (let index = 0; index <= 1_000; index += 1) {
    const frequency = linearDrumFrequencyAtPosition(index / 1_000, 20, 16_000);
    const parameters = linearDrumParameters(frequency, LINEAR_DRUM_DEFAULTS);
    assert.ok(parameters.noiseMix >= previousNoise - 1e-12);
    previousNoise = parameters.noiseMix;
    assert.equal(parameters.modalRatios.length, 6);
    assert.equal(parameters.modalGains.length, 6);
    if (previous) {
      assert.ok(Math.abs(parameters.decay - previous.decay) < .01);
      assert.ok(Math.abs(parameters.noiseMix - previous.noiseMix) < .01);
      assert.ok(Math.abs(parameters.pitchDropOctaves - previous.pitchDropOctaves) < .02);
      parameters.modalRatios.forEach((ratio, ratioIndex) => {
        assert.ok(Math.abs(ratio - previous.modalRatios[ratioIndex]) < .02);
      });
    }
    previous = parameters;
  }
  assert.ok(linearDrumParameters(20).weights.kick > .99);
  assert.ok(linearDrumParameters(1_000).weights.hand > .8);
  assert.ok(linearDrumParameters(16_000).weights.air > .99);
});

test("global controls and alternate body models sanitize to safe ranges", () => {
  const settings = sanitizeLinearDrumSettings({
    rangeMin: -4,
    rangeMax: 99_000,
    kickTomHz: 0,
    tomHandHz: Infinity,
    handAirHz: -1,
    morphWidth: 0,
    attack: -2,
    decay: 9,
    pitchFall: -1,
    strikeNoise: 7,
    brightness: 4,
    inharmonicity: -2,
    hardness: 8,
    sweepRate: 100,
    sweepSpeed: 0,
    model: "pm",
    pitchedOrder: ["xylophone", "xylophone", "bad", "marimba", "kalimba"],
    parameterMaps: {
      hardness: { enabled: true, source: "vertical", low: -2, high: 4, curve: 9 },
    },
  });
  assert.equal(settings.rangeMin, 20);
  assert.equal(settings.rangeMax, 20_000);
  assert.equal(settings.kickTomHz, 55);
  assert.equal(settings.tomHandHz, 720);
  assert.equal(settings.handAirHz, 1_900);
  assert.equal(settings.morphWidth, .3);
  assert.equal(settings.attack, .001);
  assert.equal(settings.decay, 2.5);
  assert.equal(settings.pitchFall, 0);
  assert.equal(settings.strikeNoise, 1.6);
  assert.equal(settings.brightness, 1);
  assert.equal(settings.inharmonicity, 0);
  assert.equal(settings.hardness, 1);
  assert.equal(settings.sweepRate, 28);
  assert.equal(settings.sweepSpeed, .2);
  assert.equal(settings.model, "hybrid");
  assert.deepEqual(settings.pitchedOrder, ["xylophone", "marimba", "kalimba"]);
  assert.equal(Object.keys(settings.parameterMaps).length, LINEAR_DRUM_PARAMETER_SPECS.length);
  assert.deepEqual(settings.parameterMaps.hardness, {
    enabled: true, source: "vertical", low: 0, high: 1, curve: 1,
  });
  assert.equal(linearDrumParameters(440, { model: "modal" }).model, "modal");
  assert.equal(linearDrumParameters(440, { model: "fm" }).model, "fm");
  assert.equal(linearDrumParameters(440, { model: "pitched" }).model, "pitched");
});

test("mappable parameter scales are reversible across percussion bounds", () => {
  for (const specification of LINEAR_DRUM_PARAMETER_SPECS) {
    assert.equal(linearDrumParameterValue(specification.id, 0), specification.min);
    assert.equal(linearDrumParameterValue(specification.id, 1), specification.max);
    for (const position of [0, .1, .5, .87, 1]) {
      const value = linearDrumParameterValue(specification.id, position);
      assert.ok(Math.abs(linearDrumParameterPosition(specification.id, value) - position) < 1e-12);
    }
  }
});

test("mapping curves preserve endpoints and bend smoothly around a linear fade", () => {
  for (const curve of [-1, -.5, 0, .5, 1]) {
    assert.equal(linearDrumMappingAmount(0, curve), 0);
    assert.equal(linearDrumMappingAmount(1, curve), 1);
    let previous = 0;
    for (let index = 1; index <= 1_000; index += 1) {
      const current = linearDrumMappingAmount(index / 1_000, curve);
      assert.ok(current >= previous);
      assert.ok(current - previous < .005);
      previous = current;
    }
  }
  assert.equal(linearDrumMappingAmount(.5, 0), .5);
  assert.ok(linearDrumMappingAmount(.5, -.7) > .5);
  assert.ok(linearDrumMappingAmount(.5, .7) < .5);
});

test("pitch and Y mappings interpolate smoothly in either direction", () => {
  const settings = {
    parameterMaps: {
      hardness: { enabled: true, source: "pitch", low: .1, high: .9 },
      decay: { enabled: true, source: "pitch", low: 1.6, high: .08, curve: -.55 },
      sweepRate: { enabled: true, source: "pitch", low: 5, high: 27 },
      brightness: { enabled: true, source: "vertical", low: .15, high: .95, curve: .6 },
    },
  };
  const low = linearDrumMappedParameterValues(20, settings, { vertical: 0 });
  const high = linearDrumMappedParameterValues(16_000, settings, { vertical: 1 });
  assert.ok(Math.abs(low.hardness - .1) < 1e-12);
  assert.ok(Math.abs(high.hardness - .9) < 1e-12);
  assert.ok(Math.abs(low.decay - 1.6) < 1e-12);
  assert.ok(Math.abs(high.decay - .08) < 1e-12);
  assert.ok(Math.abs(low.sweepRate - 5) < 1e-12);
  assert.ok(Math.abs(high.sweepRate - 27) < 1e-12);
  assert.ok(Math.abs(low.brightness - .15) < 1e-12);
  assert.ok(Math.abs(high.brightness - .95) < 1e-12);

  let previous = low;
  for (let index = 1; index <= 1_000; index += 1) {
    const frequency = linearDrumFrequencyAtPosition(index / 1_000, 20, 16_000);
    const current = linearDrumMappedParameterValues(frequency, settings, { vertical: index / 1_000 });
    assert.ok(current.hardness >= previous.hardness);
    assert.ok(current.decay <= previous.decay);
    assert.ok(current.sweepRate >= previous.sweepRate);
    assert.ok(current.brightness >= previous.brightness);
    previous = current;
  }
});

test("pitched archetype orders form a normalized continuous morph", () => {
  const settings = {
    model: "pitched",
    pitchedOrder: ["marimba", "kalimba", "xylophone"],
    kickTomHz: 150,
    tomHandHz: 1_180,
    morphWidth: 1.1,
  };
  let previous = null;
  for (let index = 0; index <= 1_000; index += 1) {
    const frequency = linearDrumFrequencyAtPosition(index / 1_000, 20, 16_000);
    const weights = linearDrumPitchedMorphWeights(frequency, settings);
    const values = Object.values(weights);
    assert.deepEqual(Object.keys(weights), settings.pitchedOrder);
    assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
    assert.ok(values.every((value) => value >= 0 && value <= 1));
    if (previous) {
      assert.ok(Math.max(...values.map((value, weightIndex) => (
        Math.abs(value - previous[weightIndex])
      ))) < .012);
    }
    previous = values;
  }
  const parameters = linearDrumParameters(440, settings);
  assert.equal(parameters.model, "pitched");
  assert.equal(parameters.pitchedRatios.length, 8);
  assert.equal(parameters.pitchedGains.length, 8);
  assert.deepEqual(parameters.pitchedOrder, settings.pitchedOrder);
});

test("the 4x4 preset bank contains sixteen distinct, bounded sounds", () => {
  assert.equal(LINEAR_DRUM_PRESETS.length, 16);
  assert.equal(new Set(LINEAR_DRUM_PRESETS.map(({ id }) => id)).size, 16);
  assert.equal(new Set(LINEAR_DRUM_PRESETS.map(({ name }) => name)).size, 16);
  assert.ok(LINEAR_DRUM_PRESETS.some(({ settings }) => settings.model === "modal"));
  assert.ok(LINEAR_DRUM_PRESETS.some(({ settings }) => settings.model === "fm"));
  assert.ok(LINEAR_DRUM_PRESETS.some(({ settings }) => (
    Object.values(settings.parameterMaps).some(({ enabled }) => enabled)
  )));
  assert.ok(LINEAR_DRUM_PRESETS.some(({ settings }) => (
    settings.parameterMaps.sweepRate.enabled || settings.parameterMaps.sweepSpeed.enabled
  )));
  const pitchedPresets = LINEAR_DRUM_PRESETS.filter(({ settings }) => settings.model === "pitched");
  assert.equal(pitchedPresets.length, 4);
  assert.equal(new Set(pitchedPresets.map(({ settings }) => settings.pitchedOrder.join(">"))).size, 4);
  for (const required of ["harp", "harpsichord", "piano", "marimba", "xylophone", "kalimba"]) {
    assert.ok(LINEAR_DRUM_PITCHED_ARCHETYPES.some(({ id }) => id === required));
    assert.ok(pitchedPresets.some(({ settings }) => settings.pitchedOrder.includes(required)));
  }
  assert.ok(pitchedPresets.some(({ settings }) => (
    Object.values(settings.parameterMaps).some(({ curve }) => Math.abs(curve) > .1)
  )));
});

test("Linear Drum audio builds each body model and releases its graph", async () => {
  let disconnected = 0;
  let oscillatorCount = 0;
  const parameter = (value = 0) => ({
    value,
    setValueAtTime(next) { this.value = next; },
    exponentialRampToValueAtTime(next) { this.value = next; },
    setTargetAtTime(next) { this.value = next; },
    cancelScheduledValues() {},
  });
  const node = (properties = {}) => ({
    ...properties,
    connect(destination) { return destination; },
    disconnect() { disconnected += 1; },
  });
  class FakeContext {
    constructor() {
      this.state = "running";
      this.currentTime = 0;
      this.sampleRate = 48_000;
      this.destination = node();
    }

    createGain() { return node({ gain: parameter(1) }); }
    createDynamicsCompressor() {
      return node({
        threshold: parameter(), knee: parameter(), ratio: parameter(),
        attack: parameter(), release: parameter(),
      });
    }
    createAnalyser() {
      return node({ fftSize: 0, smoothingTimeConstant: 0 });
    }
    createOscillator() {
      oscillatorCount += 1;
      return node({
        frequency: parameter(440),
        type: "sine",
        start() {},
        stop() {},
      });
    }
    createBiquadFilter() {
      return node({ frequency: parameter(350), Q: parameter(1), type: "lowpass" });
    }
    createBuffer(channels, frameCount, sampleRate) {
      const samples = new Float32Array(frameCount);
      return {
        duration: frameCount / sampleRate,
        getChannelData() { return samples; },
      };
    }
    createBufferSource() {
      return node({ buffer: null, start() {}, stop() {}, onended: null });
    }
    async close() { this.state = "closed"; }
  }

  const runtime = {
    AudioContext: FakeContext,
    setTimeout(callback) { callback(); return 1; },
  };
  const audio = new LinearDrumAudio(runtime);
  for (const [frequency, model] of [
    [45, "modal"], [880, "fm"], [8_000, "hybrid"], [440, "pitched"],
  ]) {
    const parameters = await audio.trigger(frequency, { model });
    assert.equal(parameters.frequency, frequency);
    assert.equal(parameters.model, model);
  }
  assert.ok(oscillatorCount >= 10);
  assert.ok(disconnected >= 3);
  audio.setOutput(.99);
  assert.equal(audio.output, .85);
  await audio.close();
  assert.equal(audio.context, null);
});

test("Rattlesnake page exposes the continuous instrument and global controls", async () => {
  const [html, source, css] = await Promise.all([
    readFile(new URL("linear-drums.html", root), "utf8"),
    readFile(new URL("linear-drums-app.js", root), "utf8"),
    readFile(new URL("linear-drums.css", root), "utf8"),
  ]);

  assert.match(html, /<h1 id="linearDrumsTitle">Rattlesnake<\/h1>/);
  assert.match(html, /id="stage"[^>]*aria-describedby="canvasInstructions liveStatus"/);
  assert.match(html, /id="frequency"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /id="sweepButton"[^>]*data-primary-transport/);
  assert.match(html, /name="bodyModel" value="hybrid" checked/);
  assert.match(html, /name="bodyModel" value="modal"/);
  assert.match(html, /name="bodyModel" value="fm"/);
  assert.match(html, /name="bodyModel" value="pitched"/);
  for (const id of [
    "kickTom", "tomHand", "handAir", "morphWidth", "attack", "decay",
    "pitchFall", "strikeNoise", "brightness", "inharmonicity", "hardness",
    "sweepRate", "sweepSpeed", "rangeMax",
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="mappingDock"/);
  assert.match(html, /id="mappingLanes"/);
  assert.match(html, /id="presetBank"[^>]*Sixteen Rattlesnake presets/);
  assert.equal((html.match(/class="parameter-map-toggle"/g) ?? []).length, 9);
  assert.match(source, /new LinearDrumAudio\(globalThis\)/);
  assert.match(source, /linearDrumFrequencyAtPosition/);
  assert.match(source, /LINEAR_DRUM_PRESETS/);
  assert.match(source, /mappedTransport\(\)/);
  assert.match(source, /function startSweep\(\)/);
  assert.doesNotMatch(source, /async function startSweep|function startSweep\(\)\s*\{[\s\S]{0,160}enableAudio/);
  assert.match(source, /if \(!state\.audioOn \|\| !audio\.context\) return null/);
  assert.match(source, /renderMappingLanes\(\)/);
  assert.match(source, /mapping-curve-frame/);
  assert.match(source, /linearDrumMappingAmount/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /\.linear-preset-bank[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(css, /\.linear-model-selector\s*{[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(css, /\.mapping-curve-plot[\s\S]*touch-action: none/);
  assert.match(css, /\.mapping-curve-handle/);
});
