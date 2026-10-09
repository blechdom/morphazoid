import assert from "node:assert/strict";
import test from "node:test";
import {
  SPARTIAL_DEFAULTS, SPARTIAL_MAX_PARTIALS, SPARTIAL_MAX_VOICES, SPARTIAL_SPECTRAL_PRESETS,
  SpartialEngine, equalPowerRoute, partialCascadeRank, partialPosition, partialFrequencyRatio, randomSpartialSpectrum,
  sanitizeSpartialSettings, spartialCascadeTimes,
} from "../src/instruments/spartial/spartial.js";

const RATE = 48000;
const base = { rotation: 0, cascade: 0, attack: 0.002, release: 0.025, level: 1 };

function render(engine, seconds, channelCount = 16) {
  const channels = Array.from({ length: channelCount }, () => new Float32Array(Math.round(seconds * engine.sampleRate)));
  engine.render(channels);
  for (const channel of channels) for (const value of channel) {
    assert.ok(Number.isFinite(value), "all speaker samples are finite");
    assert.ok(Math.abs(value) <= 0.720001, "conservative gain bound survives polyphony and gather");
  }
  return channels;
}

function energy(channel, start = 0, end = channel.length) {
  let sum = 0;
  for (let frame = start; frame < end; frame += 1) sum += channel[frame] ** 2;
  return sum / Math.max(1, end - start);
}

function spectralAmplitude(channel, frequency) {
  let real = 0;
  let imaginary = 0;
  for (let frame = 0; frame < channel.length; frame += 1) {
    real += channel[frame] * Math.cos(2 * Math.PI * frequency * frame / RATE);
    imaginary += channel[frame] * Math.sin(2 * Math.PI * frequency * frame / RATE);
  }
  return Math.hypot(real, imaginary) * 2 / channel.length;
}

test("SPARTIAL sanitizes hostile state, preserves partial patches, and owns gains", () => {
  const sanitized = sanitizeSpartialSettings({
    speakerCount: 100, partials: -10, level: Infinity, rotation: NaN,
    target: -1, gains: [2, -2, Infinity], attack: 0, release: -1,
    pattern: "wrong", cascadeOrder: null, offset: -0.25,
  });
  assert.equal(sanitized.speakerCount, 16);
  assert.equal(sanitized.partials, 1);
  assert.equal(sanitized.level, SPARTIAL_DEFAULTS.level);
  assert.equal(sanitized.rotation, SPARTIAL_DEFAULTS.rotation);
  assert.deepEqual(sanitized.gains.slice(0, 3), [1, 0, 1]);
  assert.equal(sanitized.gains.length, 32);
  assert.equal(sanitized.attack, 0.002);
  assert.equal(sanitized.release, 0.005);
  assert.equal(sanitized.offset, 0.75);
  assert.equal(sanitized.pattern, "wrap");
  const updated = sanitizeSpartialSettings({ level: 0.25 }, sanitized);
  assert.equal(updated.speakerCount, 16);
  assert.notEqual(updated.gains, sanitized.gains);
  assert.doesNotThrow(() => sanitizeSpartialSettings(null, null));
  const extremes = sanitizeSpartialSettings({ cycles: Infinity, stretch: 0, inharmonicity: 8 });
  assert.equal(extremes.cycles, 1);
  assert.equal(extremes.stretch, 0.5);
  assert.equal(extremes.inharmonicity, 1);
  assert.equal(SPARTIAL_DEFAULTS.rotation, 0, "loading the instrument starts with stationary routing");
});

test("one cycle distributes the whole bank once and spatial squeeze converges on its angular origin", () => {
  for (const partials of [8, 16, 32]) {
    for (const cycles of [0, 0.25, 0.5, 1, 2, 4]) {
      const settings = { partials, cycles, speakerCount: 8 };
      for (let partial = 0; partial < partials; partial += 1) {
        assert.equal(partialPosition(partial, settings), partial * cycles * 8 / partials % 8);
      }
    }
  }
  for (const pattern of ["wrap", "reverse", "alternate", "scatter"]) {
    const settings = { partials: 32, cycles: 0, offset: 0.375, speakerCount: 8, pattern };
    for (let partial = 0; partial < 32; partial += 1) assert.equal(partialPosition(partial, settings), 3);
  }
  const engine = new SpartialEngine({ settings: { ...base, partials: 16, cycles: 1 } });
  engine.noteOn("squeeze", 57);
  render(engine, 0.03);
  engine.setSettings({ cycles: 0, offset: 0.375 });
  render(engine, 0.5);
  const gathered = render(engine, 0.02);
  assert.ok(energy(gathered[3]) > 0.001);
  for (let speaker = 0; speaker < 16; speaker += 1) {
    if (speaker !== 3) assert.ok(energy(gathered[speaker]) < 1e-14);
  }
});

test("spectral presets and seeded random fingerprints produce bounded distinct banks", () => {
  assert.equal(new Set(SPARTIAL_SPECTRAL_PRESETS.map((preset) => preset.id)).size, SPARTIAL_SPECTRAL_PRESETS.length);
  assert.equal(new Set(SPARTIAL_SPECTRAL_PRESETS.map((preset) => JSON.stringify(preset.settings))).size, SPARTIAL_SPECTRAL_PRESETS.length);
  for (const { settings } of SPARTIAL_SPECTRAL_PRESETS) {
    assert.equal(settings.gains.length, 32);
    assert.ok(settings.gains.every((gain) => gain >= 0 && gain <= 1));
    assert.ok(settings.gains.some((gain) => gain > 0));
    const engine = new SpartialEngine({ settings: { ...base, ...settings, partials: 32 } });
    engine.noteOn("preset", 57);
    assert.ok(render(engine, 0.03).some((channel) => energy(channel) > 1e-5));
  }
  const first = randomSpartialSpectrum(31);
  assert.deepEqual(first, randomSpartialSpectrum(31));
  assert.notDeepEqual(first, randomSpartialSpectrum(32));
  assert.equal(first.gains[0], 1);
  assert.ok(first.gains.every((gain) => gain >= 0 && gain <= 1));
});

test("inharmonic ratios preserve the fundamental and pitch edits glide held oscillators", () => {
  for (let partial = 0; partial < 32; partial += 1) assert.equal(partialFrequencyRatio(partial), partial + 1);
  for (const stretch of [0.5, 1, 2]) {
    assert.equal(partialFrequencyRatio(0, { stretch, inharmonicity: 1 }), 1);
    assert.equal(partialFrequencyRatio(3, { stretch }), 4 ** stretch);
  }
  assert.notEqual(partialFrequencyRatio(4, { inharmonicity: 0.7 }), 5);
  assert.equal(partialFrequencyRatio(4, { inharmonicity: 0.7 }), partialFrequencyRatio(4, { inharmonicity: 0.7 }));
  const gains = Array(32).fill(0);
  gains[1] = 1;
  const engine = new SpartialEngine({ settings: { ...base, partials: 8, gains, rolloff: 0 } });
  engine.noteOn("held", 57);
  const before = render(engine, 0.023);
  const oldIncrement = engine.voices[0].increments[1];
  engine.setSettings({ stretch: 1.4, inharmonicity: 0.6 });
  assert.equal(engine.voices[0].increments[1], oldIncrement, "frequency does not step on the control boundary");
  const transition = render(engine, 0.4);
  assert.ok(Math.abs(transition[1][0] - before[1].at(-1)) < 0.01);
  const after = render(engine, 0.2);
  const target = 220 * partialFrequencyRatio(1, engine.settings);
  assert.ok(spectralAmplitude(after[1], target) > 0.05, "held voice arrives at the new nonharmonic frequency");
  assert.ok(spectralAmplitude(after[1], 440) < 0.002, "old harmonic is gone");
  assert.equal(engine.snapshot().voices, 1);
});

test("live pitch edits fade newly ultrasonic partials and restore them safely", () => {
  const gains = Array(32).fill(0);
  gains[5] = 1;
  const engine = new SpartialEngine({ settings: { ...base, partials: 8, gains } });
  engine.noteOn("high", 105);
  assert.ok(energy(render(engine, 0.03)[5]) > 1e-4);
  engine.setSettings({ stretch: 1.2 });
  render(engine, 0.5);
  for (const channel of render(engine, 0.03)) assert.equal(energy(channel), 0);
  assert.ok(engine.voices[0].increments.every((increment) => increment <= 2 * Math.PI * 0.49));
  engine.setSettings({ stretch: 1 });
  render(engine, 0.3);
  assert.ok(energy(render(engine, 0.03)[5]) > 1e-4);
  assert.equal(engine.snapshot().voices, 1, "pitch changes retain the held note");
});

test("wrapped equal-power routes preserve power and seeded patterns visit every speaker", () => {
  for (const position of [-8.5, -0.5, 0, 0.2, 7.5, 8, 64.75]) {
    const route = equalPowerRoute(position, 8);
    assert.ok(Math.abs(route.leftGain ** 2 + route.rightGain ** 2 - 1) < 1e-12);
    assert.ok(route.left >= 0 && route.left < 8);
    assert.ok(route.right >= 0 && route.right < 8);
  }
  const seam = equalPowerRoute(7.5, 8);
  assert.equal(seam.left, 7);
  assert.equal(seam.right, 0);
  assert.ok(Math.abs(seam.leftGain - Math.SQRT1_2) < 1e-12);
  for (const pattern of ["wrap", "reverse", "alternate", "scatter"]) {
    const settings = { ...base, partials: 8, speakerCount: 8, pattern, seed: 341 };
    const positions = Array.from({ length: 8 }, (_, partial) => partialPosition(partial, settings));
    assert.equal(new Set(positions).size, 8, `${pattern} uses every speaker`);
    assert.equal(partialPosition(8, settings), partialPosition(0, settings));
    assert.deepEqual(positions, Array.from({ length: 8 }, (_, index) => partialPosition(index, settings)));
  }
  assert.notDeepEqual(
    Array.from({ length: 8 }, (_, index) => partialPosition(index, { pattern: "scatter", seed: 9 })),
    Array.from({ length: 8 }, (_, index) => partialPosition(index, { pattern: "scatter", seed: 12 })),
  );
});

test("actual harmonic signals emerge only from their assigned speakers", () => {
  const engine = new SpartialEngine({ settings: { ...base, partials: 8, speakerCount: 8 } });
  engine.noteOn("note", 57);
  render(engine, 0.01);
  const channels = render(engine, 0.1);
  for (let speaker = 0; speaker < 8; speaker += 1) {
    const expectedFrequency = 220 * (speaker + 1);
    const wanted = spectralAmplitude(channels[speaker], expectedFrequency);
    assert.ok(wanted > 0.005, `speaker ${speaker} has harmonic ${speaker + 1}`);
    const wrongFrequency = speaker === 0 ? 440 : 220;
    assert.ok(spectralAmplitude(channels[speaker], wrongFrequency) < wanted * 1e-5);
  }
  for (const channel of channels.slice(8)) assert.equal(energy(channel), 0);
});

test("fractional routing audibly crossfades around the last-to-first seam", () => {
  const engine = new SpartialEngine({ settings: {
    ...base, partials: 1, speakerCount: 8, offset: 7.5 / 8,
  } });
  engine.noteOn("note", 57);
  const channels = render(engine, 0.05);
  assert.ok(energy(channels[0]) > 0.01);
  assert.ok(Math.abs(energy(channels[0]) - energy(channels[7])) < 1e-10);
  for (let speaker = 1; speaker < 7; speaker += 1) assert.equal(energy(channels[speaker]), 0);
});

test("audio can join the visual orbit at a wrapped initial phase", () => {
  const engine = new SpartialEngine({
    settings: { ...base, partials: 1, speakerCount: 8 }, phase: -0.75,
  });
  assert.equal(engine.snapshot().phase, 0.25);
  assert.deepEqual(engine.snapshot().positions, [2]);
  engine.noteOn("join", 57);
  const channels = render(engine, 0.025);
  assert.ok(energy(channels[2]) > 0.1, "first sound uses the existing orbit position");
  for (let speaker = 0; speaker < channels.length; speaker += 1) {
    if (speaker !== 2) assert.equal(energy(channels[speaker]), 0);
  }
  assert.equal(new SpartialEngine({ phase: Infinity }).snapshot().phase, 0);
});

test("ascending, descending and outside-in cascades gate the real partials at sample offsets", () => {
  for (const order of ["up", "down", "alternate"]) {
    const engine = new SpartialEngine({ settings: {
      ...base, partials: 4, speakerCount: 4, cascade: 0.025, cascadeOrder: order,
    } });
    engine.noteOn("cascade", 57);
    const channels = render(engine, 0.11);
    const ranks = Array.from({ length: 4 }, (_, index) => partialCascadeRank(index, 4, order));
    assert.deepEqual([...ranks].sort((a, b) => a - b), [0, 1, 2, 3]);
    for (let partial = 0; partial < 4; partial += 1) {
      const onset = Math.round(ranks[partial] * 0.025 * RATE);
      assert.equal(energy(channels[partial], 0, onset), 0, `${order}: no early partial ${partial}`);
      assert.ok(energy(channels[partial], onset + 100, onset + 400) > 1e-4);
    }
  }
  assert.deepEqual(Array.from({ length: 5 }, (_, index) => partialCascadeRank(index, 5, "alternate")), [0, 2, 4, 3, 1]);
});

test("one-millisecond cascades start each rendered partial within one sample at 44.1 and 48 kHz", () => {
  for (const sampleRate of [44100, 48000]) {
    for (const cascadeOrder of ["up", "down", "alternate"]) {
      const settings = { ...base, partials: 8, speakerCount: 8, cascade: 0.001, cascadeStart: 0.002, cascadeOrder };
      const engine = new SpartialEngine({ sampleRate, settings });
      engine.noteOn("millisecond-cascade", 57);
      const channels = render(engine, 0.02);
      for (let partial = 0; partial < 8; partial += 1) {
        const firstSample = channels[partial].findIndex((value) => value !== 0);
        const expected = (settings.cascadeStart + partialCascadeRank(partial, 8, cascadeOrder) * 0.001) * sampleRate;
        assert.ok(firstSample >= 0 && Math.abs(firstSample - expected) <= 1,
          `${sampleRate} Hz / ${cascadeOrder}: partial ${partial + 1} starts at the requested millisecond`);
      }
    }
  }
});

test("cascade curves vary gap direction while preserving the initial wait and total span", () => {
  for (const curve of [-1, -0.5, 0, 0.5, 1]) {
    const settings = { partials: 16, cascade: 0.007, cascadeStart: 0.125, cascadeCurve: curve };
    const times = spartialCascadeTimes(settings);
    const gaps = times.slice(1).map((time, rank) => time - times[rank]);
    assert.equal(times[0], 0.125);
    assert.equal(times.at(-1), settings.cascadeStart + 15 * settings.cascade);
    for (let index = 1; index < gaps.length; index += 1) {
      if (curve > 0) assert.ok(gaps[index] > gaps[index - 1], "positive curve slows the cascade");
      else if (curve < 0) assert.ok(gaps[index] < gaps[index - 1], "negative curve accelerates the cascade");
      else assert.ok(Math.abs(gaps[index] - settings.cascade) < 1e-14, "zero curve keeps even spacing");
    }
  }
});

test("cascade variation is reproducible across repeated notes and preserves its span", () => {
  const settings = {
    ...base, partials: 8, speakerCount: 8, cascade: 0.005, cascadeStart: 0.005,
    cascadeCurve: 0.6, cascadeVariation: 1, seed: 537,
  };
  const times = spartialCascadeTimes(settings);
  assert.deepEqual(times, spartialCascadeTimes(settings));
  assert.notDeepEqual(times, spartialCascadeTimes({ ...settings, seed: 538 }));
  assert.equal(times.at(-1), settings.cascadeStart + 7 * settings.cascade);
  assert.ok(times.slice(1).every((time, rank) => time > times[rank]), "every varied gap stays positive");
  const engine = new SpartialEngine({ settings });
  engine.noteOn("first", 57);
  const first = render(engine, 0.08);
  engine.noteOff("first");
  render(engine, 0.03);
  engine.noteOn("repeat", 57);
  assert.deepEqual(render(engine, 0.08), first, "the same note renders identical entrance timing on retrigger");
});

test("cascade timing handles single partials, simultaneous starts, and bounded hostile settings", () => {
  assert.deepEqual(spartialCascadeTimes({ partials: 1, cascade: 0.5, cascadeStart: 0.2, cascadeCurve: 1, cascadeVariation: 1 }), [0.2]);
  assert.deepEqual(spartialCascadeTimes({ partials: 4, cascade: 0, cascadeStart: 0.2, cascadeCurve: -1, cascadeVariation: 1 }), [0.2, 0.2, 0.2, 0.2]);
  const sanitized = sanitizeSpartialSettings({ cascade: 5, cascadeStart: 7, cascadeCurve: -9, cascadeVariation: 4 });
  assert.equal(sanitized.cascade, 0.5);
  assert.equal(sanitized.cascadeStart, 2);
  assert.equal(sanitized.cascadeCurve, -1);
  assert.equal(sanitized.cascadeVariation, 1);
  const invalid = sanitizeSpartialSettings({ cascadeStart: Infinity, cascadeCurve: NaN, cascadeVariation: null });
  assert.equal(invalid.cascadeStart, 0);
  assert.equal(invalid.cascadeCurve, 0);
  assert.equal(invalid.cascadeVariation, 0);
  for (const partials of [1, 2, 16, 32]) {
    for (const cascade of [0, 0.001, 0.5]) {
      for (const cascadeCurve of [-1, 0, 1]) {
        for (const cascadeVariation of [0, 1]) {
          const times = spartialCascadeTimes({ partials, cascade, cascadeStart: 2, cascadeCurve, cascadeVariation });
          assert.equal(times.length, partials);
          assert.equal(times[0], 2);
          assert.equal(times.at(-1), 2 + (partials - 1) * cascade);
          assert.ok(times.every((time, index) => Number.isFinite(time) && time >= 2 && time <= 17.5
            && (index === 0 || time >= times[index - 1])));
        }
      }
    }
  }
});

test("cascade edits affect new entrances without rescheduling existing held notes", () => {
  const engine = new SpartialEngine({ settings: { ...base, partials: 8, cascade: 0.01, cascadeStart: 0.02 } });
  engine.noteOn("existing", 57);
  const previous = engine.voices[0].onsets.slice();
  engine.setSettings({ cascade: 0.001, cascadeStart: 0.05, cascadeCurve: 0.8, cascadeVariation: 0.7 });
  assert.deepEqual(engine.voices[0].onsets, previous);
  engine.noteOn("new", 57);
  assert.notDeepEqual(engine.voices[1].onsets, previous);
  const times = spartialCascadeTimes(engine.settings);
  for (let partial = 0; partial < 8; partial += 1) assert.equal(engine.voices[1].onsets[partial], Math.round(times[partial] * RATE));
});

test("releasing a note during the initial cascade wait cancels every pending entrance", () => {
  const engine = new SpartialEngine({ settings: { ...base, cascade: 0.001, cascadeStart: 0.1 } });
  engine.noteOn("cancel-wait", 57);
  for (const channel of render(engine, 0.02)) assert.equal(energy(channel), 0);
  engine.noteOff("cancel-wait");
  for (const channel of render(engine, 0.15)) assert.equal(energy(channel), 0);
  assert.equal(engine.snapshot().voices, 0);
});

test("retrigger clears old late partials within 6 ms before the fresh cascade", () => {
  const engine = new SpartialEngine({ settings: { ...base, partials: 8, speakerCount: 8, release: 5 } });
  engine.noteOn("restart", 45);
  const before = render(engine, 0.023);
  assert.ok(energy(before[7]) > 1e-4, "the last partial is already sounding before restart");
  engine.setSettings({ cascade: 0.02, cascadeStart: 0.005 });
  assert.equal(engine.retrigger("restart", 45), true);
  const restarted = render(engine, 0.035);
  const fadeFrames = Math.round(0.006 * RATE);
  for (let speaker = 0; speaker < 8; speaker += 1) {
    assert.ok(Math.abs(restarted[speaker][0] - before[speaker].at(-1)) < 0.02,
      `speaker ${speaker}: restart fades from the previous waveform`);
  }
  assert.ok(energy(restarted[7], 0, 100) > 1e-5, "the old late partial fades rather than cutting instantly");
  assert.equal(energy(restarted[7], fadeFrames), 0, "long release tails cannot mask the fresh cascade");
  assert.equal(energy(restarted[0], fadeFrames, Math.round(0.011 * RATE)), 0, "initial wait starts after the fixed restart fade");
  assert.ok(energy(restarted[0], Math.round(0.012 * RATE)) > 0.01, "the new first partial enters after fade plus initial wait");
  assert.equal(energy(restarted[1], fadeFrames, Math.round(0.031 * RATE)), 0, "the second new entrance keeps its requested 20 ms spacing");
  assert.ok(energy(restarted[1], Math.round(0.032 * RATE)) > 1e-4);
  assert.equal(engine.snapshot().voices, 1);
});

test("retrigger consolidates matching release tails while retaining unrelated held notes", () => {
  const engine = new SpartialEngine({ settings: { ...base, partials: 1, release: 5 } });
  engine.noteOn("restart", 45);
  engine.noteOn("midi", 57);
  render(engine, 0.03);
  const unrelated = engine.voices.find((voice) => voice.id === "midi");
  engine.noteOff("restart");
  engine.noteOn("restart", 45);
  render(engine, 0.02);
  assert.equal(engine.voices.filter((voice) => voice.active && voice.id === "restart").length, 2);
  engine.retrigger("restart", 45);
  assert.equal(unrelated.gate, true);
  assert.equal(unrelated.panicStep, 0, "the unrelated note gets no restart fade");
  render(engine, 0.008);
  assert.equal(engine.voices.filter((voice) => voice.active && voice.id === "restart").length, 1);
  assert.equal(engine.snapshot().voices, 2);
  assert.equal(unrelated.gate, true);
  assert.equal(unrelated.id, "midi");
});

test("rapid retriggers stay bounded and note-off cancels the queued restart", () => {
  const engine = new SpartialEngine({ settings: { ...base, partials: 8, cascade: 0.1, release: 5 } });
  engine.noteOn("rapid", 45);
  render(engine, 0.01);
  for (let repeat = 0; repeat < 100; repeat += 1) assert.equal(engine.retrigger("rapid", 45 + repeat % 12), true);
  assert.equal(engine.snapshot().voices, 1);
  assert.equal(engine.voices.filter((voice) => voice.pending?.id === "rapid").length, 1);
  engine.noteOff("rapid");
  assert.ok(engine.voices.every((voice) => !voice.pending));
  render(engine, 0.006);
  for (const channel of render(engine, 0.03)) assert.equal(energy(channel), 0);
  assert.equal(engine.snapshot().voices, 0);
  assert.equal(engine.retrigger("invalid", Infinity), false);
  for (let index = 0; index < 8; index += 1) engine.noteOn(`other-${index}`, 45 + index);
  assert.equal(engine.retrigger("missing", 57), false, "restarting a missing ID cannot steal unrelated voices");
  assert.ok(engine.voices.every((voice) => voice.gate && !voice.pending));
});

test("retrigger keeps its fixed interval for empty slots and already-pending replacements", () => {
  const engine = new SpartialEngine({ settings: { ...base, partials: 1 } });
  engine.retrigger("empty", 45);
  const started = render(engine, 0.01);
  assert.equal(started[0].findIndex((sample) => sample !== 0), Math.round(0.006 * RATE));
  engine.panic();
  render(engine, 0.01);
  for (let index = 0; index < 8; index += 1) engine.noteOn(`other-${index}`, 45);
  render(engine, 0.02);
  engine.noteOn("queued", 57);
  render(engine, 0.002);
  const slot = engine.voices.find((voice) => voice.pending?.id === "queued");
  const remainingFade = slot.releaseFrames;
  assert.equal(engine.retrigger("queued", 57), true);
  assert.equal(slot.releaseFrames, remainingFade, "the unrelated fading note keeps its existing release timing");
  render(engine, 0.005);
  assert.equal(slot.id, "queued");
  assert.equal(slot.envelopes[0], 0, "replacement waits until six milliseconds after restart");
  render(engine, 0.002);
  assert.ok(slot.envelopes[0] > 0);
  assert.equal(engine.snapshot().voices, 8);
});

test("restarting a latch preserves an unrelated MIDI note queued behind its old tail", () => {
  const gains = Array(32).fill(0);
  gains[3] = 1;
  const engine = new SpartialEngine({ settings: {
    ...base, partials: 4, speakerCount: 4, gains, release: 0.005,
  } });
  // Only partial four has gain. High notes remain silent above Nyquist, so
  // the queued low MIDI note can be detected directly in the rendered audio.
  engine.noteOn("latch", 127);
  for (let index = 0; index < 6; index += 1) engine.noteOn(`other-${index}`, 127);
  engine.noteOn("short", 127);
  render(engine, 0.01);
  engine.noteOff("short");
  render(engine, 0.003);
  engine.noteOn("midi", 57);
  render(engine, 0.004);
  const oldTail = engine.voices.find((voice) => voice.id === "latch");
  assert.equal(oldTail.pending.id, "midi");
  assert.ok(engine.voices.some((voice) => !voice.active), "the short release frees another restart slot");
  const remainingFrames = oldTail.releaseFrames;
  const steps = oldTail.releaseSteps.slice();
  assert.equal(remainingFrames, Math.round(0.002 * RATE));
  assert.equal(engine.retrigger("latch", 127), true);
  assert.equal(oldTail.releaseFrames, remainingFrames, "restarting the latch must not delay the unrelated MIDI entrance");
  assert.deepEqual(oldTail.releaseSteps, steps, "the existing tail keeps its original envelope slope");
  assert.equal(oldTail.gate, false);
  const output = render(engine, 0.004);
  assert.equal(output[3].findIndex((sample) => sample !== 0), remainingFrames,
    "the actual MIDI sound enters at its originally scheduled sample");
  assert.equal(oldTail.id, "midi");
  assert.equal(oldTail.gate, true);
});

test("a gathered chord restart fades throughout its 6 ms normalization window", () => {
  const settings = { ...base, partials: 1, lock: 1, cascadeStart: 0.005 };
  const restarted = new SpartialEngine({ settings });
  const held = new SpartialEngine({ settings });
  for (let index = 0; index < 8; index += 1) {
    restarted.noteOn(index, 45);
    held.noteOn(index, 45);
  }
  render(restarted, 0.023);
  render(held, 0.023);
  for (let index = 0; index < 8; index += 1) restarted.retrigger(index, 45);
  const fade = render(restarted, 0.01);
  const reference = render(held, 0.01);
  const midpoint = Math.round(0.003 * RATE);
  assert.ok(Math.abs(reference[0][midpoint]) > 0.1);
  assert.ok(Math.abs(fade[0][midpoint] / reference[0][midpoint] - 0.5) < 0.01,
    "polyphonic normalization does not erase the restart fade");
  assert.equal(energy(fade[0], Math.round(0.006 * RATE)), 0, "new voices wait for their own initial delay");
});

test("inharmonic cascades follow actual low-to-high frequencies rather than partial index", () => {
  const settings = {
    ...base, partials: 16, speakerCount: 16, cascade: 0.008,
    cascadeStart: 0.003, cascadeCurve: 0.7, cascadeVariation: 0.5,
    stretch: 0.5, inharmonicity: 1, seed: 17,
  };
  const times = spartialCascadeTimes(settings);
  const byFrequency = Array.from({ length: 16 }, (_, index) => index)
    .sort((left, right) => partialFrequencyRatio(left, settings) - partialFrequencyRatio(right, settings));
  assert.notDeepEqual(byFrequency, Array.from({ length: 16 }, (_, index) => index),
    "the test spectrum actually crosses partial frequencies");
  assert.equal(byFrequency[0], 0, "the fundamental remains the lowest frequency");
  for (const cascadeOrder of ["up", "down", "alternate"]) {
    const engine = new SpartialEngine({ settings: { ...settings, cascadeOrder } });
    engine.noteOn("inharmonic-cascade", 57);
    const channels = render(engine, 0.15);
    for (let frequencyRank = 0; frequencyRank < 16; frequencyRank += 1) {
      const partial = byFrequency[frequencyRank];
      const onset = Math.round(times[partialCascadeRank(frequencyRank, 16, cascadeOrder)] * RATE);
      assert.equal(energy(channels[partial], 0, onset), 0,
        `${cascadeOrder}: partial ${partial + 1} waits for its actual frequency rank`);
      assert.ok(energy(channels[partial], onset + 100, onset + 250) > 1e-8,
        `${cascadeOrder}: partial ${partial + 1} sounds at its actual frequency rank`);
    }
  }
});

test("note-off cancels waiting cascade onsets and ends release without orphan voices", () => {
  const engine = new SpartialEngine({ settings: {
    ...base, partials: 8, cascade: 0.1, speakerCount: 8,
  } });
  engine.noteOn("short", 57);
  const onset = render(engine, 0.02);
  assert.ok(energy(onset[0]) > 0);
  engine.noteOff("short");
  const release = render(engine, 0.5);
  assert.ok(energy(release[0], 0, 500) > 0);
  assert.equal(energy(release[0], 1500), 0);
  for (const channel of release.slice(1)) assert.equal(energy(channel), 0);
  assert.equal(engine.snapshot().voices, 0);
});

test("partials above Nyquist are excluded instead of folding into audible frequencies", () => {
  // MIDI 105 is 3520 Hz. The seventh harmonic (24640) is beyond Nyquist.
  const gains = Array(32).fill(0);
  gains[6] = 1;
  const engine = new SpartialEngine({ settings: { ...base, partials: 8, gains } });
  engine.noteOn("high", 105);
  for (const channel of render(engine, 0.04)) assert.equal(energy(channel), 0);
  gains[5] = 1;
  engine.setSettings({ gains });
  const channels = render(engine, 0.04);
  assert.ok(energy(channels[5]) > 1e-4, "sixth harmonic below Nyquist remains audible");
  assert.equal(energy(channels[6]), 0);
});

test("rotation advances on rendered samples, counter-rotation splits directions, and lock gathers", () => {
  const engine = new SpartialEngine({ settings: { ...base, rotation: 0.25 } });
  engine.noteOn("drone", 45);
  render(engine, 0.2);
  assert.ok(Math.abs(engine.snapshot().phase - 0.05) < 1e-9);
  const settings = { partials: 8, speakerCount: 8, counterRotate: true };
  assert.equal(partialPosition(0, settings, 0.125), 1);
  assert.equal(partialPosition(1, settings, 0.125), 0);
  engine.setSettings({ lock: 1, target: 3 });
  render(engine, 0.3);
  const gathered = render(engine, 0.03);
  assert.ok(energy(gathered[3]) > 0.01);
  for (let speaker = 0; speaker < 16; speaker += 1) {
    if (speaker !== 3) assert.ok(energy(gathered[speaker]) < 1e-12);
  }
  for (const position of engine.snapshot().positions) assert.ok(Math.abs(position - 3) < 1e-12);
});

test("phase reset stops residual rotation and fades routing home while retaining the held sound", () => {
  const engine = new SpartialEngine({
    settings: { ...base, partials: 1, rotation: 0.5 }, phase: 0.25,
  });
  engine.noteOn("held-through-reset", 45);
  const before = render(engine, 0.023);
  assert.ok(engine.snapshot().phase > 0.25);
  assert.ok(energy(before[2]) > 0.1, "the moving note is sounding away from the reset destination");
  engine.setSettings({ rotation: 0 });
  const routesBefore = engine.routes.slice();
  const voicePhasesBefore = engine.voices[0].phases.slice();
  assert.equal(engine.setPhase(0), true);
  assert.equal(engine.snapshot().phase, 0);
  assert.equal(engine.rotation, 0);
  assert.deepEqual(engine.routes, routesBefore, "reset begins from the existing speaker gains");
  assert.deepEqual(engine.voices[0].phases, voicePhasesBefore, "reset preserves oscillator continuity");
  const transition = render(engine, 0.4);
  for (let speaker = 0; speaker < 16; speaker += 1) {
    assert.ok(Math.abs(transition[speaker][0] - before[speaker].at(-1)) < 0.015,
      `speaker ${speaker} has no reset-boundary impulse`);
  }
  assert.equal(engine.snapshot().phase, 0, "the previous speed cannot produce residual drift");
  const settled = render(engine, 0.02);
  assert.ok(energy(settled[0]) > 0.1, "the still-held note reaches the reset destination");
  for (const channel of settled.slice(1)) assert.ok(energy(channel) < 1e-14);
  assert.equal(engine.snapshot().voices, 1);
  assert.equal(engine.voices[0].id, "held-through-reset");
  assert.equal(engine.setPhase(-0.75), true);
  assert.equal(engine.snapshot().phase, 0.25, "phase requests wrap in turns");
  for (const invalid of [NaN, Infinity, "0", null]) {
    assert.equal(engine.setPhase(invalid), false);
    assert.equal(engine.snapshot().phase, 0.25, "invalid resets retain the current phase");
  }
});

test("live levels, spectrum, topology and gather changes retain finite continuous audio", () => {
  const engine = new SpartialEngine({ settings: {
    ...base, partials: 1, lock: 1, target: 0,
  } });
  engine.noteOn("live", 45);
  const before = render(engine, 0.023);
  engine.setSettings({
    partials: 32, gains: Array(32).fill(1), rolloff: 0.5, pattern: "scatter",
    speakerCount: 16, lock: 0.6, target: 13, level: 0.45, rotation: -1.5,
  });
  const transition = render(engine, 0.08);
  for (let speaker = 0; speaker < 16; speaker += 1) {
    assert.ok(Math.abs(transition[speaker][0] - before[speaker].at(-1)) < 0.015,
      `speaker ${speaker} has no structural boundary impulse`);
  }
  engine.setSettings({ gains: Array(32).fill(0), level: 0 });
  render(engine, 0.4);
  for (const channel of render(engine, 0.01)) assert.ok(energy(channel) < 1e-14);
  assert.equal(engine.snapshot().voices, 1, "editing the spectrum preserves the held note");
});

test("partial bars scale their own harmonic linearly without compensating other bars", () => {
  for (const partials of [1, 4]) {
    const engine = new SpartialEngine({ settings: { ...base, partials, rolloff: 0 } });
    engine.noteOn("paint", 57);
    render(engine, 0.04);
    const before = render(engine, 0.1);
    const gains = Array(32).fill(1);
    gains[0] = 0.5;
    engine.setSettings({ gains });
    render(engine, 0.3);
    const after = render(engine, 0.1);
    assert.ok(Math.abs(Math.sqrt(energy(after[0]) / energy(before[0])) - 0.5) < 1e-5,
      `fundamental bar halves amplitude with ${partials} active partials`);
    if (partials > 1) assert.ok(Math.abs(energy(after[8 / partials]) / energy(before[8 / partials]) - 1) < 1e-6,
      "lowering the fundamental does not turn up another harmonic");
  }
});

test("polyphony and voice stealing remain bounded and release pending notes", () => {
  const engine = new SpartialEngine({ settings: {
    ...base, partials: 32, rolloff: 0, lock: 1, target: 2,
  } });
  for (let index = 0; index < SPARTIAL_MAX_VOICES; index += 1) engine.noteOn(index, 45);
  const chord = render(engine, 0.03);
  assert.ok(energy(chord[2]) > 0.002);
  assert.equal(engine.snapshot().voices, 8);
  for (let index = 8; index < 100; index += 1) engine.noteOn(index, 50 + index % 24);
  assert.equal(engine.voices.length, SPARTIAL_MAX_VOICES);
  assert.equal(engine.snapshot().voices, 8);
  render(engine, 0.02);
  assert.equal(engine.snapshot().voices, 8);
  assert.equal(new Set(engine.voices.map((voice) => voice.id)).size, 8);
  for (const voice of engine.voices) engine.noteOff(voice.id);
  render(engine, 0.04);
  assert.equal(engine.snapshot().voices, 0);
  assert.equal(engine.noteOn("bad", Infinity), false);
  engine.noteOn("end", 69);
  render(engine, 0.01);
  engine.panic();
  render(engine, 0.01);
  for (const channel of render(engine, 0.02)) assert.equal(energy(channel), 0);
  assert.equal(engine.snapshot().voices, 0);
});

test("panic fades within six milliseconds without an edge and cancels stolen-note replacements", () => {
  const engine = new SpartialEngine({ settings: { ...base, partials: 1 } });
  engine.noteOn("held", 45);
  const before = render(engine, 0.022);
  assert.ok(Math.abs(before[0].at(-1)) > 0.2, "panic is exercised away from a zero crossing");
  engine.panic();
  const faded = render(engine, 0.01);
  assert.ok(Math.abs(faded[0][0] - before[0].at(-1)) < 0.02,
    "panic starts from the current envelope instead of truncating the waveform");
  assert.ok(energy(faded[0], 0, 100) > 0);
  assert.equal(energy(faded[0], Math.ceil(0.006 * RATE)), 0);
  assert.equal(engine.snapshot().voices, 0);

  for (let index = 0; index < 8; index += 1) engine.noteOn(index, 45);
  render(engine, 0.01);
  engine.noteOn("pending", 72);
  assert.ok(engine.voices.some((voice) => voice.pending));
  engine.panic();
  assert.ok(engine.voices.every((voice) => !voice.pending));
  render(engine, 0.01);
  for (const channel of render(engine, 0.02)) assert.equal(energy(channel), 0);
  assert.equal(engine.snapshot().voices, 0);
});

test("panic's fade remains audible throughout its duration for a fully gathered chord", () => {
  const settings = { ...base, partials: 1, lock: 1, target: 0 };
  const fading = new SpartialEngine({ settings });
  const held = new SpartialEngine({ settings });
  for (let index = 0; index < 8; index += 1) {
    fading.noteOn(index, 45);
    held.noteOn(index, 45);
  }
  render(fading, 0.02);
  render(held, 0.02);
  fading.panic();
  const fade = render(fading, 0.006);
  const reference = render(held, 0.006);
  const midpoint = Math.round(0.003 * RATE);
  assert.ok(Math.abs(reference[0][midpoint]) > 0.1);
  assert.ok(Math.abs(fade[0][midpoint] / reference[0][midpoint] - 0.5) < 0.01,
    "polyphonic headroom compensation does not cancel the panic ramp");
  for (const channel of render(fading, 0.002)) assert.equal(energy(channel), 0);
});

test("rendered note and rotation timing do not depend on render quantum boundaries", () => {
  const settings = {
    ...base, partials: 8, cascade: 0.003, cascadeStart: 0.0007,
    cascadeCurve: 0.7, cascadeVariation: 0.8, rotation: -0.3,
  };
  const whole = new SpartialEngine({ settings });
  const split = new SpartialEngine({ settings });
  whole.noteOn("clock", 57);
  split.noteOn("clock", 57);
  const length = 4096;
  const full = Array.from({ length: 16 }, () => new Float32Array(length));
  const pieces = Array.from({ length: 16 }, () => new Float32Array(length));
  whole.render(full);
  for (let offset = 0; offset < length; offset += 128) {
    split.render(pieces.map((channel) => channel.subarray(offset, offset + 128)));
  }
  assert.deepEqual(pieces, full);
  assert.deepEqual(split.snapshot(), whole.snapshot());
});

test("AudioWorklet owns message dispatch and emits low-rate snapshots from sample time", async () => {
  const previous = {
    AudioWorkletProcessor: globalThis.AudioWorkletProcessor,
    registerProcessor: globalThis.registerProcessor,
    sampleRate: globalThis.sampleRate,
  };
  let Processor;
  const messages = [];
  globalThis.AudioWorkletProcessor = class {
    constructor() { this.port = { postMessage: (message) => messages.push(message) }; }
  };
  globalThis.registerProcessor = (name, implementation) => {
    assert.equal(name, "spartial-synth");
    Processor = implementation;
  };
  globalThis.sampleRate = RATE;
  try {
    await import(`../src/instruments/spartial/spartial-processor.js?test=${Date.now()}`);
    const processor = new Processor({ processorOptions: {
      settings: { ...base, partials: 1 }, phase: 0.25,
    } });
    assert.equal(processor.engine.snapshot().phase, 0.25);
    const output = Array.from({ length: 16 }, () => new Float32Array(128));
    processor.port.onmessage({ data: { type: "noteOn", id: "key", note: 57, velocity: 0.8 } });
    for (let block = 0; block < 25; block += 1) assert.equal(processor.process([], [output]), true);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "snapshot");
    assert.equal(messages[0].voices, 1);
    assert.equal(messages[0].positions.length, 1);
    assert.ok(energy(output[2]) > 0, "processor forwards the initial phase into audio routing");
    processor.port.onmessage({ data: { type: "phase", phase: 0 } });
    assert.equal(processor.engine.snapshot().phase, 0, "Reset reaches the audio engine");
    assert.equal(processor.engine.snapshot().voices, 1, "Reset preserves the held note");
    processor.port.onmessage({ data: { type: "retrigger", id: "key", note: 60, velocity: 0.8 } });
    for (let block = 0; block < 4; block += 1) processor.process([], [output]);
    assert.equal(processor.engine.voices.filter((voice) => voice.active && voice.note === 60).length, 1,
      "Restart reaches the processor and replaces the held note after its short fade");
    processor.port.onmessage({ data: { type: "settings", settings: { level: NaN, partials: 10000 } } });
    assert.equal(processor.engine.settings.partials, SPARTIAL_MAX_PARTIALS);
    processor.port.onmessage({ data: { type: "panic" } });
    for (let block = 0; block < 4; block += 1) processor.process([], [output]);
    for (const channel of output) assert.equal(energy(channel), 0);
  } finally {
    Object.assign(globalThis, previous);
  }
});
