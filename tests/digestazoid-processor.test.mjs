import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DIGESTAZOID_COMPARTMENTS,
  DIGESTAZOID_EVENT_PROFILES,
  DIGESTAZOID_GESTURES,
  DIGESTAZOID_LIMITS,
  DIGESTAZOID_VALVES,
  digestazoidState,
} from "../src/digestazoid.js";

const registeredProcessors = new Map();

globalThis.sampleRate = 48_000;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    const messages = [];
    this.port = {
      messages,
      onmessage: null,
      postMessage(message) {
        messages.push(message);
      },
    };
  }
};
globalThis.registerProcessor = (name, Processor) => {
  registeredProcessors.set(name, Processor);
};

const {
  BubbleVoiceBank,
  DIGESTAZOID_BUBBLE_KINDS,
  DigestazoidPhysicalProcessor,
  RubberValveOscillator,
} = await import("../src/digestazoid-processor.js?digestazoid-render-test=1");

function processor(state = {}, seed = 0xd165e57) {
  return new DigestazoidPhysicalProcessor({
    processorOptions: { state: digestazoidState(state), seed },
  });
}

function render(instance, frameCount, blockSize = 128) {
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  let offset = 0;
  while (offset < frameCount) {
    const count = Math.min(blockSize, frameCount - offset);
    const blockLeft = new Float32Array(count);
    const blockRight = new Float32Array(count);
    assert.equal(instance.process([], [[blockLeft, blockRight]], {}), true);
    left.set(blockLeft, offset);
    right.set(blockRight, offset);
    offset += count;
  }
  return { left, right };
}

function metrics(channels) {
  let squareSum = 0;
  let peak = 0;
  let stereoDifference = 0;
  for (let index = 0; index < channels.left.length; index += 1) {
    const left = channels.left[index];
    const right = channels.right[index];
    assert.ok(Number.isFinite(left), `left sample ${index}`);
    assert.ok(Number.isFinite(right), `right sample ${index}`);
    squareSum += left * left + right * right;
    peak = Math.max(peak, Math.abs(left), Math.abs(right));
    stereoDifference += Math.abs(left - right);
  }
  return {
    rms: Math.sqrt(squareSum / Math.max(1, channels.left.length * 2)),
    peak,
    stereoDifference: stereoDifference / Math.max(1, channels.left.length),
  };
}

function goertzelMagnitude(samples, frequencyHz, startFrame, endFrame, rate = 48_000) {
  const start = Math.max(0, Math.round(startFrame));
  const end = Math.min(samples.length, Math.round(endFrame));
  let real = 0;
  let imaginary = 0;
  for (let index = start; index < end; index += 1) {
    const angle = TWO_PI * frequencyHz * (index - start) / rate;
    real += samples[index] * Math.cos(angle);
    imaginary -= samples[index] * Math.sin(angle);
  }
  return Math.hypot(real, imaginary) / Math.max(1, end - start);
}

function transientTexture(samples, startFrame = 0, endFrame = samples.length, rate = 48_000) {
  const start = Math.max(0, Math.round(startFrame));
  const end = Math.min(samples.length, Math.round(endFrame));
  let squareSum = 0;
  let differenceSquareSum = 0;
  const windowRms = [];
  const windowFrames = Math.max(8, Math.round(rate * 0.005));
  for (let windowStart = start; windowStart < end; windowStart += windowFrames) {
    let windowSquareSum = 0;
    const windowEnd = Math.min(end, windowStart + windowFrames);
    for (let index = windowStart; index < windowEnd; index += 1) {
      const sample = samples[index];
      squareSum += sample * sample;
      windowSquareSum += sample * sample;
      if (index > start) {
        const difference = sample - samples[index - 1];
        differenceSquareSum += difference * difference;
      }
    }
    windowRms.push(Math.sqrt(windowSquareSum / Math.max(1, windowEnd - windowStart)));
  }
  const rms = Math.sqrt(squareSum / Math.max(1, end - start));
  const windowMean = windowRms.reduce((sum, value) => sum + value, 0)
    / Math.max(1, windowRms.length);
  const windowVariance = windowRms.reduce((sum, value) => (
    sum + (value - windowMean) ** 2
  ), 0) / Math.max(1, windowRms.length);
  const magnitudeSum = (frequencies) => frequencies.reduce((sum, frequency) => (
    sum + goertzelMagnitude(samples, frequency, start, end, rate)
  ), 0);
  return {
    derivativeRatio: Math.sqrt(differenceSquareSum / Math.max(1, end - start))
      / Math.max(1e-12, rms),
    packetVariation: Math.sqrt(windowVariance) / Math.max(1e-12, windowMean),
    broadbandRatio: magnitudeSum([700, 900, 1_200, 1_600, 2_200, 2_800])
      / Math.max(1e-12, magnitudeSum([80, 100, 120, 160, 240, 320])),
  };
}

const TWO_PI = Math.PI * 2;

test("the worklet registers one stereo Digestazoid physical processor", () => {
  assert.equal(
    registeredProcessors.get("digestazoid-physical-model"),
    DigestazoidPhysicalProcessor,
  );
  assert.equal(typeof RubberValveOscillator, "function");
});

test("constructor and configure accept the app's nested state and explicit seed contract", () => {
  const instance = new DigestazoidPhysicalProcessor({
    processorOptions: {
      state: { gas: 0.84, liquid: 0.2, listeningMode: "inside", performing: true },
      seed: 123_456_789,
    },
  });
  assert.equal(instance.configuration.gas, 0.84);
  assert.equal(instance.configuration.liquid, 0.2);
  assert.equal(instance.configuration.listeningMode, "inside");
  assert.equal(instance.performing, true);
  assert.equal(instance.runtime.seed, 123_456_789);
  assert.equal(instance.noiseState >>> 0, 123_456_789);

  instance.port.onmessage({ data: {
    type: "configure",
    state: { gas: 0.31, peristalsisRate: 41, listeningMode: "stethoscope", performing: false },
  } });
  assert.equal(instance.configuration.gas, 0.31);
  assert.equal(instance.configuration.peristalsisRate, 41);
  assert.equal(instance.configuration.listeningMode, "stethoscope");
  assert.equal(instance.performing, false);
});

test("live gas, liquid, and sludge controls reconcile the persistent inventory", () => {
  const instance = processor({ gas: 0.2, liquid: 0.25, sludge: 0.2, performing: false });
  const total = (material) => instance.runtime.compartments.reduce((sum, part) => (
    sum + part[material]
  ), 0);
  const before = { gas: total("gas"), liquid: total("liquid"), sludge: total("sludge") };
  instance._handleMessage({
    type: "configure",
    state: { gas: 1.1, liquid: 0.8, sludge: 0.7 },
  });
  assert.ok(total("gas") > before.gas * 3);
  assert.ok(total("liquid") > before.liquid * 2);
  assert.ok(total("sludge") > before.sludge * 2);
  const raised = total("gas");
  instance._handleMessage({ type: "configure", state: { gas: 0.08 } });
  assert.ok(total("gas") < raised * 0.2);
});

test("all eight numbered gestures render audible, finite, bounded stereo from one body", () => {
  const profileByGesture = {
    growl: "MB",
    burble: "SB",
    bubble: "HS",
    slosh: "CRS",
    burp: "BURP",
    burple: "CRS",
    fart: "QUICK_FART",
    "long-fart": "WHOOPEE",
  };
  assert.deepEqual(DIGESTAZOID_GESTURES.map(({ id }) => id), Object.keys(profileByGesture));
  for (const gesture of DIGESTAZOID_GESTURES) {
    const instance = processor({ performing: false });
    instance.port.onmessage({ data: { type: "gesture", id: gesture.id, force: 0.82 } });
    assert.equal(instance.event.profile.id, profileByGesture[gesture.id], gesture.id);
    const rendered = render(instance, Math.round(48_000 * 0.42));
    const result = metrics(rendered);
    assert.ok(result.rms > 0.0005, `${gesture.id} RMS ${result.rms}`);
    assert.ok(result.rms < 0.3, `${gesture.id} RMS ${result.rms}`);
    assert.ok(result.peak > 0.002, `${gesture.id} peak ${result.peak}`);
    assert.ok(result.peak < 0.781, `${gesture.id} peak ${result.peak}`);
    assert.ok(result.stereoDifference > 1e-7, `${gesture.id} must inhabit stereo body space`);
  }
});

test("medical gesture renders preserve the calibrated dominant frequency regions", () => {
  const renderGesture = (id, seconds, force = 0.8) => {
    const instance = processor({ performing: false, listeningMode: "room", level: 0.58 });
    instance._handleMessage({ type: "gesture", id, force });
    return render(instance, Math.round(seconds * 48_000)).left;
  };

  const growl = renderGesture("growl", 0.9);
  const growl50 = goertzelMagnitude(growl, 50, 0.2 * 48_000, 0.8 * 48_000);
  const growl252 = goertzelMagnitude(growl, 252, 0.2 * 48_000, 0.8 * 48_000);
  assert.ok(growl50 > growl252 * 8, `${growl50} vs ${growl252}`);

  const burble = renderGesture("burble", 0.15);
  const burble78 = goertzelMagnitude(burble, 78, 0.015 * 48_000, 0.105 * 48_000);
  const burble322 = goertzelMagnitude(burble, 322, 0.015 * 48_000, 0.105 * 48_000);
  assert.ok(burble78 > burble322 * 8, `${burble78} vs ${burble322}`);

  const burple = renderGesture("burple", 0.58);
  const burple252 = goertzelMagnitude(burple, 252, 0.03 * 48_000, 0.5 * 48_000);
  const burple50 = goertzelMagnitude(burple, 50, 0.03 * 48_000, 0.5 * 48_000);
  assert.ok(burple252 > burple50 * 8, `${burple252} vs ${burple50}`);

  const bubble = renderGesture("bubble", 0.28);
  const bubble322 = goertzelMagnitude(bubble, 322, 0.02 * 48_000, 0.22 * 48_000);
  const bubble78 = goertzelMagnitude(bubble, 78, 0.02 * 48_000, 0.22 * 48_000);
  assert.ok(bubble322 > bubble78 * 8, `${bubble322} vs ${bubble78}`);
});

test("burps retain a throat cavity while farts sputter instead of whistling", () => {
  const renderGesture = (id, seconds, force = 0.8) => {
    const instance = processor({ performing: false, listeningMode: "room" });
    instance._handleMessage({ type: "gesture", id, force });
    return render(instance, Math.round(seconds * 48_000)).left;
  };
  const burp = renderGesture("burp", 0.2);
  const burp131 = goertzelMagnitude(burp, 131, 0.02 * 48_000, 0.17 * 48_000);
  const burp322 = goertzelMagnitude(burp, 322, 0.02 * 48_000, 0.17 * 48_000);
  assert.ok(burp131 > burp322 * 2.5, `${burp131} vs ${burp322}`);

  const fart = renderGesture("fart", 0.3);
  const fartTexture = transientTexture(fart, 0.015 * 48_000, 0.245 * 48_000);
  assert.ok(fartTexture.derivativeRatio > 0.25, JSON.stringify(fartTexture));
  assert.ok(fartTexture.packetVariation > 0.12, JSON.stringify(fartTexture));
  assert.ok(fartTexture.broadbandRatio > 0.025, JSON.stringify(fartTexture));
  const fartLowFlutter = [80, 100, 120, 160, 200].reduce((sum, frequency) => (
    sum + goertzelMagnitude(fart, frequency, 0.015 * 48_000, 0.245 * 48_000)
  ), 0);
  const oldQuickWhistle = goertzelMagnitude(fart, 410, 0.015 * 48_000, 0.245 * 48_000);
  assert.ok(fartLowFlutter > oldQuickWhistle * 3, `${fartLowFlutter} vs ${oldQuickWhistle}`);

  const longFart = renderGesture("long-fart", 0.92, 1);
  const longTexture = transientTexture(longFart, 0.03 * 48_000, 0.84 * 48_000);
  assert.ok(longTexture.derivativeRatio > 0.25, JSON.stringify(longTexture));
  assert.ok(longTexture.packetVariation > 0.12, JSON.stringify(longTexture));
  assert.ok(longTexture.broadbandRatio > 0.02, JSON.stringify(longTexture));
  const longLowFlutter = [60, 80, 100, 120, 150].reduce((sum, frequency) => (
    sum + goertzelMagnitude(longFart, frequency, 0.03 * 48_000, 0.84 * 48_000)
  ), 0);
  const oldLongWhistle = goertzelMagnitude(longFart, 580, 0.03 * 48_000, 0.84 * 48_000);
  assert.ok(longLowFlutter > oldLongWhistle * 3, `${longLowFlutter} vs ${oldLongWhistle}`);
});

test("bubble size moves harmonic bubble resonance around the calibrated 8 mm center", () => {
  const renderBubble = (bubbleSizeMm) => {
    const instance = processor({ performing: false, bubbleSizeMm, listeningMode: "room" });
    instance._handleMessage({ type: "gesture", id: "bubble", force: 0.82 });
    return render(instance, Math.round(0.24 * 48_000)).left;
  };
  const small = renderBubble(2);
  const large = renderBubble(22);
  const smallHigh = goertzelMagnitude(small, 644, 0.02 * 48_000, 0.2 * 48_000);
  const smallLow = goertzelMagnitude(small, 194, 0.02 * 48_000, 0.2 * 48_000);
  const largeHigh = goertzelMagnitude(large, 644, 0.02 * 48_000, 0.2 * 48_000);
  const largeLow = goertzelMagnitude(large, 194, 0.02 * 48_000, 0.2 * 48_000);
  assert.ok(smallHigh > smallLow * 2, `${smallHigh} vs ${smallLow}`);
  assert.ok(largeLow > largeHigh * 2, `${largeLow} vs ${largeHigh}`);
});

test("BUBBLE and BURBLE expose discrete wet ruptures instead of smooth pads", () => {
  const renderGesture = (id, seconds) => {
    const instance = processor({
      performing: false,
      listeningMode: "room",
      turbulence: 0.72,
      wetness: 0.82,
      bubbleSizeMm: 9,
    }, 0xb0bb1e);
    instance._handleMessage({ type: "gesture", id, force: 0.9 });
    return render(instance, Math.round(seconds * 48_000)).left;
  };
  const single = transientTexture(renderGesture("bubble", 0.46));
  const cluster = transientTexture(renderGesture("burble", 0.76));
  assert.ok(single.derivativeRatio > 0.09, JSON.stringify(single));
  assert.ok(single.packetVariation > 0.45, JSON.stringify(single));
  assert.ok(cluster.derivativeRatio > 0.18, JSON.stringify(cluster));
  assert.ok(cluster.packetVariation > 0.35, JSON.stringify(cluster));
});

test("the submerged bubble bank follows an inverse-size resonance and reuses fixed storage", () => {
  const bank = new BubbleVoiceBank(48_000, 8);
  const storage = {
    active: bank.active,
    phase: bank.phase,
    frequencyStart: bank.frequencyStart,
    noiseMemory: bank.noiseMemory,
  };
  const smallIndex = bank.spawn(
    DIGESTAZOID_BUBBLE_KINDS.SUBMERGED,
    0,
    2,
    0.3,
    0,
    0.2,
    0,
    0,
    1,
  );
  const largeIndex = bank.spawn(
    DIGESTAZOID_BUBBLE_KINDS.SUBMERGED,
    0,
    24,
    0.3,
    0,
    0.2,
    0,
    0,
    1,
  );
  assert.ok(
    bank.frequencyStart[smallIndex] > bank.frequencyStart[largeIndex] * 8,
    `${bank.frequencyStart[smallIndex]} vs ${bank.frequencyStart[largeIndex]}`,
  );
  for (let frame = 0; frame < 96_000; frame += 1) {
    bank.process(Math.sin(frame * 0.731));
    assert.ok(Number.isFinite(bank.outputCenter));
    assert.ok(Number.isFinite(bank.outputSide));
    assert.ok(Number.isFinite(bank.outputBody));
  }
  assert.equal(bank.active, storage.active);
  assert.equal(bank.phase, storage.phase);
  assert.equal(bank.frequencyStart, storage.frequencyStart);
  assert.equal(bank.noiseMemory, storage.noiseMemory);
});

test("BURBLE schedules an irregular multi-onset gas train beyond the short SB envelope", () => {
  const instance = processor({
    performing: false,
    turbulence: 0.86,
    viscosity: 0.58,
    bubbleSizeMm: 9,
  }, 0x5e371c);
  instance._handleMessage({ type: "gesture", id: "burble", force: 0.9 });
  assert.ok(instance.bubbleVoices.gestureSpawned >= 8);
  const scheduledDelays = [...instance.bubbleVoices.delayFrames]
    .filter((delay, index) => instance.bubbleVoices.active[index] && delay > 0)
    .sort((a, b) => a - b);
  assert.ok(scheduledDelays.length >= 6);
  assert.ok(new Set(scheduledDelays).size >= 6, scheduledDelays.join(","));
  assert.ok(scheduledDelays.at(-1) > 0.28 * 48_000, scheduledDelays.at(-1));
  const rendered = render(instance, Math.round(0.58 * 48_000));
  const late = metrics({
    left: rendered.left.subarray(Math.round(0.28 * 48_000)),
    right: rendered.right.subarray(Math.round(0.28 * 48_000)),
  });
  assert.ok(late.rms > 0.0003, `late clustered RMS ${late.rms}`);
  assert.ok(late.peak < 0.781);
});

test("BUBBLE traverses submerged and surface stages while viscous BURPLE drives abyssal body modes", () => {
  const bubble = processor({ performing: false, bubbleSizeMm: 11 }, 0xb100b1e);
  bubble._handleMessage({ type: "gesture", id: "bubble", force: 0.9 });
  const kinds = new Set([...bubble.bubbleVoices.kind]
    .filter((kind, index) => bubble.bubbleVoices.active[index]));
  assert.ok(kinds.has(DIGESTAZOID_BUBBLE_KINDS.SUBMERGED));
  assert.ok(kinds.has(DIGESTAZOID_BUBBLE_KINDS.SURFACE));

  const sludge = processor({
    performing: false,
    bubbleSizeMm: 20,
    viscosity: 0.94,
    wetness: 0.9,
    bodyResonance: 0.9,
    listeningMode: "stethoscope",
  }, 0xab155a1);
  sludge._handleMessage({ type: "gesture", id: "burple", force: 1 });
  const rendered = render(sludge, Math.round(0.7 * 48_000)).left;
  const lowBody = goertzelMagnitude(rendered, 27, 0.08 * 48_000, 0.62 * 48_000)
    + goertzelMagnitude(rendered, 43, 0.08 * 48_000, 0.62 * 48_000);
  const brittleHigh = goertzelMagnitude(rendered, 2_000, 0.08 * 48_000, 0.62 * 48_000);
  assert.ok(lowBody > brittleHigh * 8, `${lowBody} vs ${brittleHigh}`);
  assert.ok([...sludge.bubbleVoices.kind].includes(DIGESTAZOID_BUBBLE_KINDS.GLUG));
});

test("turbulence increases autonomous seething while viscous sludge favors sparse glugs", () => {
  const make = (turbulence, viscosity, seed) => processor({
    performing: true,
    turbulence,
    viscosity,
    gas: 1.2,
    liquid: 1,
    wetness: 0.9,
    bodyPulse: 0,
    peristalsisDepth: 0,
  }, seed);
  const quiet = make(0.04, 0.18, 0x715eed);
  const boiling = make(1, 0.18, 0x715eed);
  const sludge = make(1, 0.96, 0x715eed);
  render(quiet, 4 * 48_000);
  render(boiling, 4 * 48_000);
  render(sludge, 4 * 48_000);
  assert.ok(
    boiling.bubbleVoices.backgroundSpawned > quiet.bubbleVoices.backgroundSpawned + 12,
    `${boiling.bubbleVoices.backgroundSpawned} vs ${quiet.bubbleVoices.backgroundSpawned}`,
  );
  assert.ok(
    sludge.bubbleVoices.backgroundSpawned < boiling.bubbleVoices.backgroundSpawned,
    `${sludge.bubbleVoices.backgroundSpawned} vs ${boiling.bubbleVoices.backgroundSpawned}`,
  );
  assert.ok(sludge.bubbleVoices.glugSpawned > 0);
});

test("the deterministic seed produces sample-identical gesture and interaction sequences", () => {
  const state = { performing: true, turbulence: 0.86, listeningMode: "inside" };
  const first = processor(state, 0x1234abcd);
  const second = processor(state, 0x1234abcd);
  const messages = [
    { type: "interaction", action: "inflate", target: "gasPocket", x: 0.4, y: 0.3, force: 0.7 },
    { type: "interaction", action: "knead", target: "smallIntestine", x: 0.52, y: 0.55, dx: 0.3, dy: -0.2, force: 0.8 },
    { type: "gesture", id: "burple", force: 0.74, target: "stomach" },
  ];
  for (const message of messages) {
    first._handleMessage(message);
    second._handleMessage(message);
  }
  const firstRender = render(first, 24_000);
  const secondRender = render(second, 24_000);
  assert.deepEqual(firstRender.left, secondRender.left);
  assert.deepEqual(firstRender.right, secondRender.right);

  const otherSeed = processor(state, 0x1234abce);
  for (const message of messages) otherSeed._handleMessage(message);
  const otherRender = render(otherSeed, 24_000);
  assert.notDeepEqual(firstRender.left, otherRender.left);
});

test("idle, performing, silence, and wake transitions have explicit audio semantics", () => {
  const idle = processor({ performing: false });
  const idleResult = metrics(render(idle, 48_000));
  assert.equal(idleResult.rms, 0);
  assert.equal(idleResult.peak, 0);

  idle._handleMessage({ type: "set-performing", performing: true });
  const movingResult = metrics(render(idle, 48_000));
  assert.ok(movingResult.rms > 1e-5);
  assert.ok(movingResult.peak < 0.781);

  idle._handleMessage({ type: "gesture", id: "growl", force: 0.8 });
  render(idle, 1_024);
  const timeBeforeSilence = idle.runtime.timeSeconds;
  idle._handleMessage({ type: "silence" });
  const silent = render(idle, 8_192);
  assert.ok(silent.left.every((sample) => sample === 0));
  assert.ok(silent.right.every((sample) => sample === 0));
  assert.ok(idle.runtime.timeSeconds > timeBeforeSilence, "muting must not freeze digestive physics");

  idle._handleMessage({ type: "gesture", id: "bubble", force: 0.8 });
  assert.ok(metrics(render(idle, 8_192)).rms > 0.0005, "a new gesture should wake silence");

  const resumed = processor({ performing: true });
  resumed._handleMessage({ type: "silence" });
  assert.equal(metrics(render(resumed, 2_048)).rms, 0);
  resumed._handleMessage({ type: "configure", state: resumed.configuration });
  assert.ok(metrics(render(resumed, 24_000)).rms > 1e-5, "configure resumes an AudioContext restart");

  const escapedAtRest = processor({ performing: false });
  escapedAtRest._handleMessage({ type: "silence" });
  escapedAtRest._handleMessage({ type: "configure", state: escapedAtRest.configuration });
  assert.equal(metrics(render(escapedAtRest, 24_000)).rms, 0);
});

test("reset with nested state and seed exactly rebuilds the pressure network", () => {
  const state = digestazoidState("rubber-laboratory", { performing: false, level: 0.5 });
  const seed = 0x7193ab1;
  const changed = processor(state, seed);
  changed._handleMessage({ type: "gesture", id: "growl", force: 1 });
  render(changed, 12_000);
  changed._handleMessage({ type: "reset", state, seed });
  changed._handleMessage({ type: "gesture", id: "long-fart", force: 0.9 });
  const resetRender = render(changed, 20_000);

  const fresh = processor(state, seed);
  fresh._handleMessage({ type: "gesture", id: "long-fart", force: 0.9 });
  const freshRender = render(fresh, 20_000);
  assert.deepEqual(resetRender.left, freshRender.left);
  assert.deepEqual(resetRender.right, freshRender.right);
});

test("app target/action aliases pinch the intended valves, stretch the outlet, and release all", () => {
  const instance = processor({ performing: false });
  const initialSerial = instance.runtime.eventSerial;
  instance._handleMessage({
    type: "interaction", action: "start", target: "upperValve", x: 0.445, y: 0.235, force: 0.8,
  });
  assert.equal(instance.runtime.eventSerial, initialSerial, "start is only an arm/no-op");
  instance._handleMessage({
    type: "interaction", action: "pinch", target: "upperValve", x: 0.445, y: 0.235, force: 0.8,
  });
  assert.equal(instance.runtime.valves.esophageal.manualPinch, 0.8);
  assert.equal(instance.runtime.valves.pyloric.manualPinch, 0);

  instance._handleMessage({
    type: "interaction", action: "pinch", target: "ileocecalValve", x: 0.685, y: 0.69, force: 0.7,
  });
  instance._handleMessage({
    type: "interaction", action: "pinch", target: "lowerValve", x: 0.515, y: 0.875, force: 0.6,
  });
  assert.equal(instance.runtime.valves.ileocecal.manualPinch, 0.7);
  assert.equal(instance.runtime.valves.anal.manualPinch, 0.6);

  instance._handleMessage({
    type: "interaction", action: "stretch", target: "outlet", x: 0.52, y: 0.96, dy: 0.4, force: 0.9,
  });
  assert.ok(instance.runtime.outlets.lowerDrive >= 0.9);
  assert.ok(instance.runtime.valves.anal.kick > 0);

  instance._handleMessage({ type: "interaction", action: "release-all", target: "body", force: 0 });
  for (const valve of Object.values(instance.runtime.valves)) assert.equal(valve.manualPinch, 0);
  for (const chamber of instance.runtime.compartments) assert.equal(chamber.compression, 0);
});

test("telemetry is emitted at about 20 Hz with app summaries and detailed anatomy", () => {
  const instance = processor({ performing: true, turbulence: 0.7 });
  instance._handleMessage({ type: "gesture", id: "burple", force: 0.9 });
  render(instance, 48_000);
  const telemetry = instance.port.messages.filter(({ type }) => type === "telemetry");
  assert.equal(telemetry.length, 20);
  const first = telemetry[0];
  assert.equal(typeof first.pressures.stomach, "number");
  assert.equal(typeof first.pressures.intestine, "number");
  assert.equal(typeof first.pressures.colon, "number");
  assert.equal(typeof first.fills.gas, "number");
  assert.equal(typeof first.fills.liquid, "number");
  assert.equal(typeof first.fills.sludge, "number");
  for (const { id } of DIGESTAZOID_COMPARTMENTS) assert.ok(first.fills[id], id);
  for (const { id } of DIGESTAZOID_VALVES) assert.ok(first.valveDetails[id], id);
  for (const alias of ["upper", "pyloric", "ileocecal", "lower"]) {
    assert.equal(typeof first.valves[alias], "number", alias);
  }
  assert.equal(typeof first.peristalsisPhase, "number");
  assert.equal(typeof first.wallMotion, "number");
  assert.equal(typeof first.bubbleActivity, "number");
  assert.equal(typeof first.bubbleVoiceCount, "number");
  assert.ok(first.bubbleVoiceCount >= 0 && first.bubbleVoiceCount <= 28);
  assert.equal(typeof first.upperFlow, "number");
  assert.equal(typeof first.lowerFlow, "number");
  assert.equal(typeof first.pressureDetails.colon, "number");
  assert.equal(typeof first.valveDetails.pyloric.aperture, "number");
  assert.equal(typeof first.compartmentFills.colon.total, "number");
  assert.equal(typeof first.eventLabel, "string");
  assert.equal(first.eventLabel, "burple");
  assert.ok(first.event);
  assert.equal(first.event.profileId, "CRS");
  assert.ok(Number.isFinite(first.rms));
  assert.ok(Number.isFinite(first.peak));
  assert.ok(first.peak <= 0.781);
  assert.ok(telemetry.every((message) => message.type === "telemetry"));
});

test("hostile messages and extreme controls cannot produce NaN, infinity, or runaway output", () => {
  const instance = processor({ performing: true });
  instance._handleMessage({
    type: "configure",
    state: {
      level: 1e100, gas: Infinity, liquid: -Infinity, sludge: NaN,
      viscosity: 1e100, bubbleSizeMm: -1e100, peristalsisRate: Infinity,
      peristalsisDepth: -Infinity, stomachCompliance: 0,
      gutTension: 99, bodyPulse: -99, upperValve: NaN, pyloricValve: Infinity,
      lowerValve: -Infinity, outletStretch: 99, turbulence: "not-a-number",
      wetness: -4, bodyResonance: 7, listeningMode: "bloodstream",
    },
  });
  for (const [key, limits] of Object.entries(DIGESTAZOID_LIMITS)) {
    assert.ok(Number.isFinite(instance.configuration[key]), key);
    assert.ok(instance.configuration[key] >= limits[0], key);
    assert.ok(instance.configuration[key] <= limits[1], key);
  }
  const interactions = [
    { action: "inflate", target: "gasPocket" },
    { action: "deflate", target: "gasPocket" },
    { action: "knead", target: "smallIntestine" },
    { action: "pinch", target: "upperValve" },
    { action: "stretch", target: "outlet" },
    { action: "release-all", target: "body" },
  ];
  for (const interaction of interactions) {
    instance._handleMessage({
      type: "interaction",
      ...interaction,
      x: Infinity,
      y: -Infinity,
      dx: 1e100,
      dy: -1e100,
      force: Infinity,
    });
  }
  instance._handleMessage({ type: "gesture", id: "long-fart", force: Infinity, target: "outlet" });
  const result = metrics(render(instance, 96_000));
  assert.ok(result.rms >= 0 && result.rms < 0.4);
  assert.ok(result.peak <= 0.781);
  for (const chamber of instance.runtime.compartments) {
    for (const value of Object.values(chamber)) {
      if (typeof value === "number") assert.ok(Number.isFinite(value));
    }
  }
});

test("zero level is digital silence and a mono output remains safe", () => {
  const instance = processor({ level: 0, performing: true });
  instance._handleMessage({ type: "gesture", id: "long-fart", force: 1 });
  const stereo = render(instance, 24_000);
  assert.ok(stereo.left.every((sample) => sample === 0));
  assert.ok(stereo.right.every((sample) => sample === 0));

  const mono = processor({ level: 0.6, performing: false });
  mono._handleMessage({ type: "gesture", id: "bubble", force: 0.8 });
  const channel = new Float32Array(256);
  assert.equal(mono.process([], [[channel]], {}), true);
  assert.ok(channel.every(Number.isFinite));
  assert.ok(channel.some((sample) => sample !== 0));
});

test("the rubber-valve primitive stays finite under hostile pressure and rate inputs", () => {
  for (const rate of [8_000, 48_000, 192_000]) {
    const oscillator = new RubberValveOscillator(rate, 17);
    let peak = 0;
    for (let index = 0; index < rate / 2; index += 1) {
      const sample = oscillator.process({
        drive: index % 3 === 0 ? Infinity : index % 3 === 1 ? -Infinity : 1e100,
        frequencyHz: index % 2 ? Infinity : -99,
        rubberiness: index % 2 ? 99 : -99,
        turbulence: NaN,
        noise: index % 7 === 0 ? Infinity : Math.sin(index),
      });
      assert.ok(Number.isFinite(sample));
      peak = Math.max(peak, Math.abs(sample));
    }
    assert.ok(peak < 4, `${rate}: ${peak}`);
    oscillator.reset();
    assert.equal(oscillator.aperture, 0);
  }
});

test("the rubber valve repeatedly sticks, closes, and restarts with cycle jitter", () => {
  const oscillator = new RubberValveOscillator(48_000, 3);
  let randomState = 0x51a77e | 0;
  const random = () => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 0xffff_ffff * 2 - 1;
  };
  const closures = [];
  const samples = [];
  let wasOpen = false;
  for (let frame = 0; frame < Math.round(48_000 * 0.48); frame += 1) {
    samples.push(oscillator.processFrame(1.15, 96, 0.82, 0.86, random()));
    const isOpen = oscillator.airflow > 0.004;
    if (wasOpen && !isOpen) closures.push(frame);
    wasOpen = isOpen;
  }
  assert.ok(closures.length >= 30, closures.length);
  const intervals = closures.slice(1).map((frame, index) => frame - closures[index]);
  assert.ok(new Set(intervals.map((interval) => Math.round(interval / 4))).size >= 8);
  const texture = transientTexture(Float32Array.from(samples));
  assert.ok(texture.derivativeRatio > 0.2, JSON.stringify(texture));
  assert.ok(texture.broadbandRatio > 0.02, JSON.stringify(texture));

  let tailPeak = 0;
  for (let frame = 0; frame < 12_000; frame += 1) {
    const sample = oscillator.processFrame(0, 96, 0.82, 0.86, random());
    if (frame > 9_600) tailPeak = Math.max(tailPeak, Math.abs(sample));
  }
  assert.ok(tailPeak < 1e-4, tailPeak);
  oscillator.reset();
  assert.equal(oscillator.airflow, 0);
  assert.equal(oscillator.closureImpulse, 0);
});

test("processor source synthesizes in real time without sample-loading APIs", async () => {
  const source = await readFile(new URL("../src/digestazoid-processor.js", import.meta.url), "utf8");
  assert.match(source, /registerProcessor\("digestazoid-physical-model"/);
  assert.match(source, /class RubberValveOscillator/);
  assert.match(source, /class ModalResonator/);
  assert.doesNotMatch(source, /fetch\s*\(|decodeAudioData|AudioBufferSourceNode|createBufferSource|\.mp3|\.wav|\.ogg/i);
  assert.equal(DIGESTAZOID_EVENT_PROFILES.WHOOPEE.activeDurationSeconds, 0.85);
});
