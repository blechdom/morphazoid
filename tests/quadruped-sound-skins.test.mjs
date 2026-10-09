import assert from "node:assert/strict";
import test from "node:test";
import { QUADRUPED_LIMITS } from "../src/instruments/quadruped/quadruped-limits.js";
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

test("three-octave pitch travel moves all five spectra while contact lengths and output stay bounded", t => {
  const summary = {};
  for (const { id } of QUADRUPED_SOUND_SKINS) {
    const registers = [-36, 0, 36].map(pitchSemitones => [7, 101, 904].map(seed => {
      const voice = renderQuadrupedContact({ skinId: id, pitchSemitones, seed });
      assert.ok(voice.duration / voice.playbackRate <= QUADRUPED_SOUND_LIMITS.maxPlaybackDuration);
      assert.equal(Math.abs(voice.samples[0]), 0);
      assert.equal(Math.abs(voice.samples.at(-1)), 0);
      const result = metrics(voice);
      assert.ok(result.rms > 0.008, `${id}/${pitchSemitones} remains an audible contact`);
      assert.ok(result.peak <= QUADRUPED_SOUND_LIMITS.maxPeak);
      return result;
    }));
    const means = registers.map(rows => rows.reduce((sum, row) => sum + row.centroid, 0) / rows.length);
    const spread = rows => Math.max(...rows.map(row => row.centroid)) - Math.min(...rows.map(row => row.centroid));
    assert.ok(means[0] < means[1] && means[1] < means[2], `${id}: ${means.join(", ")}`);
    assert.ok(means[2] - means[0] > Math.max(...registers.map(spread)), `${id}: pitch change exceeds seeded texture variation`);
    summary[id] = means.map(Math.round);
  }
  t.diagnostic(`Low / neutral / high spectral centroids (Hz): ${JSON.stringify(summary)}`);
});

test("deep stair pitch plus the pitch knob never lengthens contact buffers or grows the cache", () => {
  for (const { id } of QUADRUPED_SOUND_SKINS) {
    const bank = createQuadrupedSoundBank({ maxEntries: 12 });
    for (const pitchSemitones of [-36, -24, -12, 0, 12, 24, 36, NaN, Infinity, -1e90, 1e90]) {
      for (const pitchRatio of [0.25, 0.251, 1, 3.99, 4, Infinity]) {
        const voice = bank.get({ skinId: id, pitchSemitones, pitchRatio, velocity: 0 });
        assert.ok(voice.samples.every(Number.isFinite));
        assert.ok(voice.playbackRate >= Math.SQRT1_2 * 0.94);
        assert.ok(voice.playbackRate <= Math.SQRT2 * 1.11);
        assert.ok(voice.duration / voice.playbackRate <= QUADRUPED_SOUND_LIMITS.maxPlaybackDuration);
        assert.ok(bank.size <= 12);
      }
    }
    const a = bank.get({ skinId: id, pitchSemitones: -32.71 });
    const b = bank.get({ skinId: id, pitchSemitones: -32.7 });
    assert.equal(a.samples, b.samples, "fractional pitch remains cheap and continuous within a prepared register");
    assert.ok(Math.abs(b.playbackRate / a.playbackRate - 2 ** (0.01 / 12)) < 1e-12);
    const neutral = bank.get({ skinId: id, pitchSemitones: 0 });
    assert.equal(neutral.samples, bank.get({ skinId: id }).samples, "old presets retain neutral pitch");
  }
});

test("prepared-register seams never reverse pitch, including the lowest and highest stair ranges", () => {
  for (const { id } of QUADRUPED_SOUND_SKINS) for (const pitchRatio of [0.25, 1, 4]) {
    const bank = createQuadrupedSoundBank({ sampleRate: 8000, maxEntries: 8 });
    let previous = 0;
    for (let pitchSemitones = -36; pitchSemitones <= 36; pitchSemitones += 0.5) {
      const voice = bank.get({ skinId: id, pitchSemitones, pitchRatio });
      const frequency = voice.frequency * voice.playbackRate;
      assert.ok(frequency >= previous - 1e-8, `${id}/${pitchRatio}/${pitchSemitones}: ${frequency} after ${previous}`);
      previous = frequency;
    }
  }
});

test("Spring changes all five grounded excitations and decay without replacing the pitch control", t => {
  const summary = {};
  for (const { id } of QUADRUPED_SOUND_SKINS) {
    const observations = [7, 101, 904].map(seed => {
      const voices = [0, 1, 2.5].map(spring => renderQuadrupedContact({ skinId: id, spring, seed }));
      const [rigid, neutral, elastic] = voices;
      assert.ok(rigid.duration < neutral.duration && neutral.duration < elastic.duration);
      assert.ok(elastic.duration > rigid.duration * 2, `${id}: Spring should substantially change the decay`);
      assert.ok(voices.every(voice => voice.frequency === neutral.frequency && voice.playbackRate === neutral.playbackRate));
      assert.deepEqual(neutral.samples, renderQuadrupedContact({ skinId: id, seed }).samples);
      const measurements = voices.map(metrics);
      assert.ok(Math.max(...measurements.map(value => value.rms)) / Math.min(...measurements.map(value => value.rms)) < 1.6,
        `${id}: Spring changes excitation, rather than acting as a second level control`);
      // Compare the same early 25 ms at equal RMS; a simple level or tail-length
      // adjustment alone cannot pass this waveform-shape check.
      const count = Math.floor(0.025 * rigid.sampleRate);
      const norm = voice => Math.sqrt(voice.samples.slice(0, count).reduce((sum, value) => sum + value * value, 0));
      const a = norm(rigid), b = norm(elastic);
      let similarity = 0;
      for (let index = 0; index < count; index++) similarity += rigid.samples[index] / a * elastic.samples[index] / b;
      assert.ok(Math.abs(similarity) < 0.98, `${id}: the grounded excitation must change shape, similarity ${similarity}`);
      return measurements.map((value, index) => ({ rms: value.rms, centroid: value.centroid, duration: voices[index].duration }));
    });
    summary[id] = [0, 1, 2].map(index => ({
      centroidHz: Math.round(observations.reduce((sum, row) => sum + row[index].centroid, 0) / 3),
      durationMs: Math.round(observations[0][index].duration * 1000),
    }));
  }
  t.diagnostic(`Spring 0 / 1 / 2.5: ${JSON.stringify(summary)}`);
});

test("Spring extrema stay finite at every contact phase and pitch, with neutral recovery and a bounded cache", () => {
  for (const { id } of QUADRUPED_SOUND_SKINS) {
    const bank = createQuadrupedSoundBank({ sampleRate: 8000, maxEntries: 8 });
    const neutral = bank.get({ skinId: id, spring: 1 });
    for (const spring of [undefined, NaN, Infinity, "bad"]) {
      assert.equal(neutral.samples, bank.get({ skinId: id, spring }).samples);
    }
    for (const spring of [-1e99, 0, 0.35, 1, 1.8, 2.5, 1e99]) {
      for (const phase of ["touchdown", "load", "push", "toe-off"]) for (const pitchSemitones of [-36, 0, 36]) {
        const voice = bank.get({ skinId: id, spring, phase, pitchSemitones });
        assert.ok(voice.samples.every(value => Number.isFinite(value) && Math.abs(value) <= QUADRUPED_SOUND_LIMITS.maxPeak));
        assert.ok(rms(voice.samples) > 0.0001);
        assert.equal(Math.abs(voice.samples[0]), 0);
        assert.equal(Math.abs(voice.samples.at(-1)), 0);
        assert.ok(voice.duration / voice.playbackRate <= QUADRUPED_SOUND_LIMITS.maxPlaybackDuration);
        assert.ok(bank.size <= 8);
      }
    }
  }
});

test("contact articulation still responds at the lopsided motor's highest instantaneous velocity", () => {
  const maximum = QUADRUPED_LIMITS.tempoBpm[1] * 16 / 60 * 3 / QUADRUPED_LIMITS.minimumTimingWeight;
  const bank = createQuadrupedSoundBank();
  const fast = bank.get({ velocity: 800 });
  const faster = bank.get({ velocity: 1200 });
  const fastest = bank.get({ velocity: maximum });
  assert.equal(fast.samples, faster.samples);
  assert.equal(faster.samples, fastest.samples);
  assert.ok(fast.playbackRate < faster.playbackRate && faster.playbackRate < fastest.playbackRate);
  assert.equal(fastest.playbackRate, bank.get({ velocity: maximum * 100 }).playbackRate);
  assert.ok(fastest.gain <= 1);
});

test("cached mixer preserves every exact-rate onset, sample and stereo gain against direct interpolation", () => {
  const voices = [1, 2, 7, 53, 997].map((frames, index) => {
    const sampleRate = [8000, 24000, 48000][index % 3];
    return { samples: Float32Array.from({ length: frames }, (_, frame) => Math.sin(frame * 0.731 + index) * 0.1),
      sampleRate, duration: frames / sampleRate };
  });
  const events = Array.from({ length: 80 }, (_, index) => ({
    voice: { ...voices[index % voices.length], playbackRate: [0.667, 1, 1.0000000003, Math.SQRT2][index % 4] },
    offset: index % 7 * 0.00013, gain: 0.1 + index % 5 * 0.13, pan: index % 9 / 4 - 1,
  }));
  for (const sampleRate of [8000, 24000, 48000]) {
    const length = Math.ceil(Math.max(...events.map(event => event.offset + event.voice.duration / event.voice.playbackRate)) * sampleRate) + 1;
    const reference = [new Float32Array(length), new Float32Array(length)];
    for (const { voice, offset, gain, pan } of events) {
      const start = Math.round(offset * sampleRate);
      const increment = voice.playbackRate * voice.sampleRate / sampleRate;
      const angle = (pan + 1) * Math.PI / 4;
      const leftGain = Math.cos(angle) * gain, rightGain = Math.sin(angle) * gain;
      const frames = Math.min(Math.ceil(voice.samples.length / increment), length - start);
      for (let frame = 0; frame < frames; frame++) {
        const position = frame * increment;
        const index = Math.floor(position), fraction = position - index;
        const value = Math.fround((voice.samples[index] ?? 0) * (1 - fraction) + (voice.samples[index + 1] ?? 0) * fraction);
        reference[0][start + frame] += value * leftGain;
        reference[1][start + frame] += value * rightGain;
      }
    }
    const cache = new WeakMap();
    assert.deepEqual(mixQuadrupedContacts(events, sampleRate).channels, reference);
    assert.deepEqual(mixQuadrupedContacts(events, sampleRate, cache).channels, reference);
    assert.deepEqual(mixQuadrupedContacts(events, sampleRate, cache).channels, reference);
  }
});

test("dense gait playback rates stay warm within global PCM and entry limits", () => {
  const cache = new WeakMap();
  const samples = Float32Array.from({ length: 80 }, (_, index) => Math.sin(index * 0.3));
  const requests = Array.from({ length: 18 }, (_, index) => ({
    voice: { samples, duration: samples.length / 24000, sampleRate: 24000, playbackRate: 0.75 + index * 0.017 },
    offset: 0, gain: 0.3, pan: 0,
  }));
  mixQuadrupedContacts(requests, 24000, cache);
  const prepared = new Map(cache.get(samples));
  for (let repeat = 0; repeat < 5; repeat++) mixQuadrupedContacts(requests, 24000, cache);
  for (const [rate, array] of prepared) assert.equal(cache.get(samples).get(rate), array);

  const longBuffers = Array.from({ length: 40 }, () => new Float32Array(8000).fill(0.001));
  for (const buffer of longBuffers) for (let index = 0; index < 36; index++) {
    mixQuadrupedContacts([{ voice: { samples: buffer, duration: buffer.length / 24000, sampleRate: 24000,
      playbackRate: 0.67 + index * 0.007 }, offset: 0, gain: 1, pan: 0 }], 24000, cache);
  }
  const cached = [samples, ...longBuffers].flatMap(buffer => {
    assert.ok((cache.get(buffer)?.size ?? 0) <= QUADRUPED_SOUND_LIMITS.maxResamplesPerBuffer);
    return [...(cache.get(buffer)?.values() ?? [])];
  });
  assert.ok(cached.reduce((sum, buffer) => sum + buffer.length, 0) <= QUADRUPED_SOUND_LIMITS.maxResampleFrames);

  const shortBuffers = Array.from({ length: QUADRUPED_SOUND_LIMITS.maxResampleEntries + 50 }, () => Float32Array.of(0.01, 0));
  for (const buffer of shortBuffers) mixQuadrupedContacts([{ voice: { samples: buffer, duration: 2 / 24000,
    sampleRate: 24000, playbackRate: 0.7 }, offset: 0, gain: 1, pan: 0 }], 24000, cache);
  const entries = [samples, ...longBuffers, ...shortBuffers].reduce((sum, buffer) => sum + (cache.get(buffer)?.size ?? 0), 0);
  assert.ok(entries <= QUADRUPED_SOUND_LIMITS.maxResampleEntries);
});
