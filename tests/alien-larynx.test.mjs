import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;

test("Alien Larynx exposes five bypassed systems, two system maps, and a voice return", async () => {
  const [html, architecture, diagram, alienArchitecture, alienDiagram] = await Promise.all([
    readFile(new URL("alien-larynx.html", root), "utf8"),
    readFile(new URL("throatazoid-architecture.html", root), "utf8"),
    readFile(new URL("throatazoid-signal-path.svg", root), "utf8"),
    readFile(new URL("alien-larynx-architecture.html", root), "utf8"),
    readFile(new URL("alien-larynx-signal-path.svg", root), "utf8"),
  ]);
  assert.match(html, /<title>ALIEN LARYNX — Morphazoid<\/title>/);
  assert.match(html, /id="returnToVoiceButton"/);
  assert.match(html, /src="alien-larynx-app\.js"/);
  assert.match(html, /href="throatazoid-architecture\.html"/);
  assert.match(html, /href="alien-larynx-architecture\.html"/);
  assert.equal((html.match(/class="alien-switch"/g) ?? []).length, 5);
  assert.equal((html.match(/role="switch" aria-checked="false"/g) ?? []).length, 5);
  assert.equal((html.match(/<fieldset[^>]+disabled>/g) ?? []).length >= 5, true);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "Alien Larynx element IDs stay unique");
  assert.match(architecture, /data="throatazoid-signal-path\.svg"/);
  assert.match(architecture, /href="throatazoid\.html"/);
  assert.match(architecture, /href="alien-larynx-architecture\.html"/);
  assert.match(diagram, /<title[^>]*>Throatazoid synthesis and DSP signal path<\/title>/i);
  assert.match(alienArchitecture, /data="alien-larynx-signal-path\.svg"/);
  assert.match(alienArchitecture, /href="alien-larynx\.html"/);
  assert.match(alienArchitecture, /href="throatazoid-architecture\.html"/);
  assert.match(
    alienDiagram,
    /<title[^>]*>Alien Larynx voice anchor and five-system DSP architecture<\/title>/i,
  );
  for (const label of [
    "DOUBLE LARYNX",
    "TRUE-SCALE EXOTIC TRACT",
    "MOUTH GENOMES",
    "ROBOT GLANDS",
    "WORMHOLE MANIFOLD",
  ]) assert.match(alienDiagram, new RegExp(label));
});

let Processor;

async function processorClass() {
  if (Processor) return Processor;
  const source = await readFile(
    new URL("src/alien-larynx-tract-processor.js", root),
    "utf8",
  );
  const registrations = new Map();
  class MockAudioWorkletProcessor {
    constructor() {
      this.port = { onmessage: null, postMessage() {} };
    }
  }
  const evaluate = vm.compileFunction(
    source,
    ["AudioWorkletProcessor", "registerProcessor", "sampleRate", "currentFrame", "currentTime"],
  );
  evaluate(
    MockAudioWorkletProcessor,
    (name, Constructor) => registrations.set(name, Constructor),
    SAMPLE_RATE,
    0,
    0,
  );
  Processor = registrations.get("alien-larynx-tract");
  assert.equal(typeof Processor, "function");
  return Processor;
}

function config(alien) {
  const mouths = Array.from({ length: 7 }, (_, index) => ({
    aperture: 0.68,
    length: 0.48 + index * 0.04,
    closed: false,
    genome: { from: index % 2 ? "a" : "e", to: index % 2 ? "i" : "u", morph: 0.42, phase: index / 7 },
  }));
  return {
    mouthCount: 3,
    throatCount: 3,
    selectedMouth: 0,
    articulateAll: true,
    bodyLength: 0.56,
    tension: 0.58,
    mutation: 0.18,
    coupling: 0.42,
    spread: 0.8,
    oralClosure: 0,
    lipDiameter: 3,
    articulationIndex: 26,
    articulationAperture: 0.96,
    articulationVoicing: 0.94,
    glottalClosure: 0,
    nasalCoupling: 0,
    fricationGain: 1,
    exciterIntensity: 0.72,
    exciterPitch: 118,
    exciterTenseness: 0.62,
    exciterBreath: 0.08,
    growl: 0.2,
    performanceGate: 1,
    pressureSourceCount: 4,
    pressureSources: Array.from({ length: 4 }, (_, index) => ({ open: true, level: 0.8 - index * 0.08 })),
    tongueCount: 1,
    noseCount: 1,
    mouths,
    throats: mouths,
    tongues: [{ position: 0.38, height: 0.22, curl: 0.1 }],
    noses: [{ openness: 0.01, length: 0.42, resonance: 0.38 }],
    alien,
  };
}

function disabledAlien() {
  return {
    larynx: { enabled: false, falseFoldMix: 0.24, asymmetry: 0.08, feedback: 0.16 },
    scale: { enabled: false, lengthCm: 17.5, soundSpeed: 343, radiation: 0.78 },
    genomes: { enabled: false, rateHz: 0 },
    glands: { enabled: false, programs: [] },
    wormhole: { enabled: false, topology: "ring", delayMs: 8, feedback: 0.24, seed: 73 },
  };
}

async function render(alien, blocks = 70) {
  const Constructor = await processorClass();
  const processor = new Constructor();
  processor.port.onmessage({ data: { type: "configure", state: config(alien) } });
  const tail = [];
  let frame = 0;
  let peak = 0;
  for (let block = 0; block < blocks; block += 1) {
    const input = new Float32Array(BLOCK_SIZE);
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      const time = frame / SAMPLE_RATE;
      input[index] = 0.14 * Math.sin(2 * Math.PI * 118 * time)
        + 0.035 * Math.sin(2 * Math.PI * 236 * time + 0.3);
      frame += 1;
    }
    assert.equal(processor.process([[input]], [[left, right]]), true);
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      assert.equal(Number.isFinite(left[index]) && Number.isFinite(right[index]), true);
      peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
      if (block >= blocks - 8) tail.push(left[index], right[index]);
    }
  }
  assert.ok(peak <= 1, `bounded worklet peak (${peak})`);
  return tail;
}

function difference(a, b) {
  let sum = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    sum += Math.abs(a[index] - b[index]);
  }
  return sum / Math.max(1, Math.min(a.length, b.length));
}

test("feature bypass is exact and every Alien DSP system changes a bounded signal", async () => {
  const omitted = await render(undefined);
  const bypassed = await render(disabledAlien());
  assert.deepEqual(bypassed, omitted, "all-off Alien state preserves the base voice exactly");

  const scenarios = {
    "coupled larynx": { larynx: { enabled: true, falseFoldMix: 0.72, asymmetry: 0.2, feedback: 0.5 } },
    "true scale": { scale: { enabled: true, lengthCm: 34, soundSpeed: 220, radiation: 0.85 } },
    "mouth genomes": { genomes: { enabled: true, rateHz: 0.7 } },
    "robot glands": {
      glands: {
        enabled: true,
        programs: Array.from({ length: 4 }, (_, index) => ({ waveform: index % 2 ? "pulse" : "impulse", pitchRatio: 1 + index * 0.5, division: index + 1, phase: index * 0.2, duty: 0.35, jitter: 0 })),
      },
    },
    "wormhole manifold": { wormhole: { enabled: true, topology: "mobius", delayMs: 2, feedback: 0.72, seed: 73 } },
  };
  for (const [name, overlay] of Object.entries(scenarios)) {
    const next = disabledAlien();
    Object.assign(next, overlay);
    const rendered = await render(next);
    assert.ok(difference(rendered, omitted) > 0.00001, `${name} must alter the signal`);
  }
});
