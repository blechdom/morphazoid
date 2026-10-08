import assert from "node:assert/strict";
import test from "node:test";
import {
  QUADRUPED_SOUND_LIMITS,
  QUADRUPED_SOUND_SKINS,
  createQuadrupedSoundBank,
  renderQuadrupedContact,
  mixQuadrupedContacts,
  sanitizeQuadrupedSoundSkin,
} from "../src/instruments/quadruped/quadruped-sound-skins.js";

function metrics({ samples, sampleRate }) {
  let energy = 0, peak = 0, tail = 0, difference = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    assert.ok(Number.isFinite(value));
    energy += value * value;
    peak = Math.max(peak, Math.abs(value));
    if (index > samples.length * 0.75) tail += value * value;
    if (index) difference += (value - samples[index - 1]) ** 2;
  }
  // Log-spaced Goertzel probes compare spectral shape without a Web Audio or
  // third-party FFT dependency. They are characterization, not listening proof.
  const bands = [0, 0, 0, 0];
  let weighted = 0, spectrumEnergy = 0;
  for (let probe = 0; probe < 96; probe += 1) {
    const frequency = 35 * (Math.min(9_000, sampleRate * 0.4) / 35) ** (probe / 95);
    const coefficient = 2 * Math.cos(2 * Math.PI * frequency / sampleRate);
    let a = 0, b = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const next = samples[index] + coefficient * a - b;
      b = a; a = next;
    }
    const power = Math.max(0, a * a + b * b - coefficient * a * b);
    // Compensation for the unequal widths of logarithmic frequency intervals.
    const weightedPower = power * frequency;
    spectrumEnergy += weightedPower;
    weighted += weightedPower * frequency;
    bands[frequency < 250 ? 0 : frequency < 1000 ? 1 : frequency < 3500 ? 2 : 3] += weightedPower;
  }
  return {
    rms: Math.sqrt(energy / samples.length), peak,
    centroid: weighted / Math.max(spectrumEnergy, 1e-12),
    bands: bands.map(value => value / Math.max(spectrumEnergy, 1e-12)),
    roughness: Math.sqrt(difference / Math.max(energy, 1e-12)),
    tail: tail / Math.max(energy, 1e-12),
  };
}

function rms(samples) {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
}

test("five independent contact mechanisms are available with a stable fallback", () => {
  assert.deepEqual(QUADRUPED_SOUND_SKINS.map(({ id }) => id), ["ground", "tendon", "porcelain", "voltage", "breath"]);
  assert.equal(sanitizeQuadrupedSoundSkin("missing"), "ground");
  assert.equal(sanitizeQuadrupedSoundSkin("porcelain"), "porcelain");
});

test("all skin/phase/extreme combinations produce finite bounded events with silent edges", () => {
  for (const { id } of QUADRUPED_SOUND_SKINS) {
    for (const phase of ["touchdown", "load", "push", "toe-off"]) {
      for (const extreme of [0, 1]) {
        const render = renderQuadrupedContact({ skinId: id, phase, sampleRate: extreme ? 8000 : 48000,
          animal: { mass: extreme ? 2 : 0.3, compliance: extreme ? 1.6 : 0.4 },
          terrain: { hardness: extreme, damping: extreme, roughness: extreme, brightness: extreme },
          velocity: extreme ? 192 : 0, resonance: extreme, scrape: extreme, seed: 4321 });
        assert.ok(render.duration <= QUADRUPED_SOUND_LIMITS.maxDuration + 1 / render.sampleRate);
        assert.equal(Math.abs(render.samples[0]), 0);
        assert.equal(Math.abs(render.samples.at(-1)), 0);
        assert.ok(rms(render.samples) > 0.0001, `${id}/${phase} must have a contact`);
        assert.ok(render.samples.every(value => Number.isFinite(value) && Math.abs(value) <= QUADRUPED_SOUND_LIMITS.maxPeak));
      }
    }
  }
});

test("event identities reproduce exactly and changing contact seeds changes ground grains", () => {
  const options = { skinId: "ground", phase: "push", seed: "front-left:cycle-7:push" };
  const first = renderQuadrupedContact(options);
  assert.deepEqual(first.samples, renderQuadrupedContact(options).samples);
  assert.notDeepEqual(first.samples, renderQuadrupedContact({ ...options, seed: "front-left:cycle-8:push" }).samples);
  assert.ok(first.duration < 0.09, "grain release stays a short event rather than a held loop");
});

test("load, propulsion and toe release stay below the touchdown body", () => {
  for (const { id } of QUADRUPED_SOUND_SKINS) {
    const attack = rms(renderQuadrupedContact({ skinId: id }).samples);
    for (const phase of ["load", "push", "toe-off"]) {
      const accent = rms(renderQuadrupedContact({ skinId: id, phase }).samples);
      assert.ok(accent < attack * 0.55, `${id}/${phase}: ${accent} against ${attack}`);
    }
    const toe = renderQuadrupedContact({ skinId: id, phase: "toe-off" });
    assert.ok(toe.duration < renderQuadrupedContact({ skinId: id, phase: "load" }).duration);
  }
});

test("intensity zero is silence; mass, velocity, surface and grain controls have causal destinations", () => {
  for (const { id } of QUADRUPED_SOUND_SKINS) {
    const silent = renderQuadrupedContact({ skinId: id, contact: { intensity: 0 } });
    assert.ok(silent.samples.every(value => value === 0));
    const quiet = renderQuadrupedContact({ skinId: id, contact: { intensity: 0.25 } });
    const strong = renderQuadrupedContact({ skinId: id, contact: { intensity: 1 } });
    assert.ok(Math.abs(rms(strong.samples) / rms(quiet.samples) - 4) < 0.00001);
    const small = renderQuadrupedContact({ skinId: id, animal: { mass: 0.31 } });
    const large = renderQuadrupedContact({ skinId: id, animal: { mass: 1.9 } });
    assert.ok(small.frequency > large.frequency * 2);
    const slow = renderQuadrupedContact({ skinId: id, velocity: 1 });
    const fast = renderQuadrupedContact({ skinId: id, velocity: 190 });
    assert.ok(fast.playbackRate > slow.playbackRate);
    assert.ok(rms(fast.samples) > rms(slow.samples));
    const soft = renderQuadrupedContact({ skinId: id, terrain: { hardness: 0, damping: 1, brightness: 0 } });
    const hard = renderQuadrupedContact({ skinId: id, terrain: { hardness: 1, damping: 0, brightness: 1 } });
    assert.notDeepEqual(soft.samples, hard.samples);
    assert.ok(hard.frequency > soft.frequency);
    assert.ok(hard.duration > soft.duration);
    assert.ok(rms(renderQuadrupedContact({ skinId: id, phase: "toe-off", scrape: 1 }).samples)
      > rms(renderQuadrupedContact({ skinId: id, phase: "toe-off", scrape: 0 }).samples) * 2);
  }
});

test("three-seed measurements separate the spectral identities while keeping touchdown levels close", t => {
  const summary = {};
  for (const { id } of QUADRUPED_SOUND_SKINS) {
    summary[id] = [7, 101, 904].map(seed => metrics(renderQuadrupedContact({ skinId: id, seed })));
  }
  const mean = (id, key) => summary[id].reduce((sum, row) => sum + row[key], 0) / 3;
  const means = QUADRUPED_SOUND_SKINS.map(({ id }) => mean(id, "rms"));
  assert.ok(Math.max(...means) / Math.min(...means) < 1.65, "skin RMS spread remains below 4.4 dB");
  assert.ok(mean("porcelain", "centroid") > mean("ground", "centroid") * 1.8);
  assert.ok(mean("breath", "centroid") > mean("voltage", "centroid") * 1.8);
  assert.ok(mean("tendon", "roughness") > mean("porcelain", "roughness") * 1.5);
  // Spectral/envelope character must differ more than seeded noise variation.
  for (const [left, right] of [["ground", "porcelain"], ["voltage", "breath"]]) {
    const spread = Math.max(...summary[left].map(row => row.centroid)) - Math.min(...summary[left].map(row => row.centroid));
    assert.ok(Math.abs(mean(left, "centroid") - mean(right, "centroid")) > spread);
  }
  t.diagnostic(JSON.stringify(Object.fromEntries(QUADRUPED_SOUND_SKINS.map(({ id }) => [id, {
    rms: +mean(id, "rms").toFixed(4), centroidHz: Math.round(mean(id, "centroid")),
    roughness: +mean(id, "roughness").toFixed(3),
    centroidSpreadHz: Math.round(Math.max(...summary[id].map(row => row.centroid)) - Math.min(...summary[id].map(row => row.centroid))),
  }]))));
});

test("prepared buffers are reused across continuous velocity/intensity/pitch changes and bounded under churn", () => {
  const bank = createQuadrupedSoundBank({ maxEntries: 4 });
  const first = bank.get({ skinId: "tendon", seed: "a" });
  const changed = bank.get({ skinId: "tendon", seed: "a", velocity: 175, pitchRatio: 1.0003, contact: { intensity: 0.54 } });
  assert.equal(first.samples, changed.samples);
  assert.notEqual(first.gain, changed.gain);
  assert.notEqual(first.playbackRate, changed.playbackRate);
  assert.equal(bank.size, 1);
  for (let index = 0; index < 20; index += 1) bank.get({ resonance: index / 20 });
  assert.equal(bank.size, 4);
  assert.notEqual(first.samples, bank.get({ skinId: "tendon", seed: "a" }).samples);
  bank.clear();
  assert.equal(bank.size, 0);
});

test("a warmed 500 BPM trio workload allocates no additional sample buffers", () => {
  const requests = [];
  for (let actor = 0; actor < 3; actor += 1) {
    for (const limb of ["front-left", "front-right", "rear-left", "rear-right"]) {
      for (const phase of ["touchdown", "load", "push", "toe-off"]) {
        for (let seed = 0; seed < 4; seed += 1) requests.push({ animal: { mass: 0.5 + actor * 0.5 }, phase, seed, contact: { id: limb } });
      }
    }
  }
  for (const { id } of QUADRUPED_SOUND_SKINS) {
    const bank = createQuadrupedSoundBank();
    const arrays = new Set(requests.map(request => bank.get({ ...request, skinId: id }).samples));
    assert.ok(arrays.size <= QUADRUPED_SOUND_LIMITS.maxCacheEntries);
    for (let index = 0; index < 3200; index += 1) {
      const prepared = bank.get({ ...requests[index % requests.length], skinId: id,
        velocity: 132 + index / 10000, pitchRatio: 1 + index / 100000 });
      assert.ok(arrays.has(prepared.samples));
    }
    assert.equal(bank.size, arrays.size);
  }
});

test("nonfinite or oversized public inputs cannot escape render/cache limits", () => {
  const bank = createQuadrupedSoundBank({ sampleRate: Infinity, maxEntries: Infinity });
  const result = bank.get({ skinId: {}, phase: "__proto__", velocity: Infinity, pitchRatio: NaN,
    resonance: NaN, scrape: Infinity, animal: { mass: 1e300, compliance: -1e300 },
    contact: { intensity: Infinity }, terrain: { hardness: NaN }, seed: null });
  assert.ok(result.samples.every(Number.isFinite));
  assert.ok(Number.isFinite(result.gain));
  assert.ok(Number.isFinite(result.playbackRate));
  assert.equal(result.skinId, "ground");
  assert.equal(result.phase, "touchdown");
  assert.ok(result.duration <= QUADRUPED_SOUND_LIMITS.maxDuration + 1 / result.sampleRate);
});


test("sound dynamics continue responding through 500 BPM at triple pace", () => {
  const bank = createQuadrupedSoundBank();
  const medium = bank.get({ velocity: 192, contact: { intensity: 1 } });
  const fast = bank.get({ velocity: 400, contact: { intensity: 1 } });
  assert.equal(medium.samples, fast.samples, "dynamics reuse the same prepared voice");
  assert.ok(fast.gain > medium.gain);
  assert.ok(fast.playbackRate > medium.playbackRate);
});


test("batched contacts preserve each onset, level and stereo position without voice admission loss", () => {
  const voice = { samples: Float32Array.of(1, 0.5, 0), sampleRate: 8000, duration: 3 / 8000, playbackRate: 1 };
  const mixed = mixQuadrupedContacts([
    { voice, offset: 0, gain: 0.5, pan: -1 },
    { voice, offset: 4 / 8000, gain: 0.25, pan: 1 },
    { voice: { ...voice, playbackRate: 0.5 }, offset: 8 / 8000, gain: 1, pan: -1 },
  ], 8000);
  assert.equal(mixed.channels[0][0], 0.5);
  assert.equal(mixed.channels[0][1], 0.25);
  assert.equal(mixed.channels[1][4], 0.25);
  assert.equal(mixed.channels[1][5], 0.125);
  assert.ok(Math.abs(mixed.channels[0][4]) < 1e-8);
  assert.equal(mixed.channels[0][8], 1);
  assert.equal(mixed.channels[0][9], 0.75);
  assert.equal(mixed.channels[0][10], 0.5);
  assert.equal(mixed.channels[0][12], 0);
  assert.equal(mixQuadrupedContacts([]), null);
  const many = mixQuadrupedContacts(Array.from({ length: 432 }, (_, index) => ({ voice, offset: index * 0.0001, gain: 0.25, pan: index % 3 - 1 })), 8000);
  assert.ok(many.channels.every(channel => channel.every(Number.isFinite)));
  assert.ok(many.channels[0].some(value => value !== 0) && many.channels[1].some(value => value !== 0));
});
