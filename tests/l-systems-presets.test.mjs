import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createDefaultState } from "../src/instruments/l-systems/state.js";
import { L_SYSTEMS_FULL_PRESETS, L_SYSTEMS_MIC_PRESETS, SYNTH_CHOICES, captureLSystemsPreset, validateLSystemsPreset, randomizeLSystemsPreset } from "../src/instruments/l-systems/full-presets.js";
import { MICMIC_FULL_PRESETS } from "../src/families/branch-presets/full-presets.js";
import { L_SYSTEM_PRESETS, traceLSystem, iterationPlaybackAtPhase } from "../src/instruments/l-system/l-system.js";
import { branchDecayGain, generationOptions, micGenerationVoices, lSystemsTrace, allocateLSystemsHeads } from "../src/instruments/l-systems/branch-parameters.js";
import { generationVoiceSpecs } from "../src/instruments/micmic/micmic.js";
import { lSystemNoteVoice, lSystemNoteDuration, lSystemNoteEnvelope } from "../src/instruments/l-systems/discrete-audio.js";
import { LSystemsSynthAudio, LSystemsDrumAudio, L_SYSTEMS_TRIGGER_STYLES, lSystemsPercussionVoice } from "../src/instruments/l-systems/sound-engines.js";
import { amplitudeEnvelopePreset, percussionEnvelopeTimeMs, VoicePool } from "../src/audio.js";
import { graphDrumTriggerPlan } from "../src/families/graph/graph-drum-audio.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";
const amplitude = { enabled: true, swell: false, preset: "sustain", level: 1, points: amplitudeEnvelopePreset("sustain") };
const makeState = snapshot => Object.assign(createDefaultState(), snapshot.shared, { mode: snapshot.mode, ...(snapshot.mic ? { mic: snapshot.mic } : { synth: snapshot.synth, drums: snapshot.drums }) });
const rng = seed => () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);

test("48 diverse synth/trigger scenes and the separate 16-scene Delay bank are complete", () => {
  assert.equal(L_SYSTEMS_FULL_PRESETS.length, 48);
  assert.equal(L_SYSTEMS_MIC_PRESETS.length, 16);
  for (const bank of [L_SYSTEMS_FULL_PRESETS, L_SYSTEMS_MIC_PRESETS]) {
    validateFullPresetBank(bank);
    for (const { snapshot } of bank) {
      validateLSystemsPreset(snapshot);
      const s = makeState(snapshot);
      if (snapshot.mic) s.mix.mic = snapshot.micLevel;
      else Object.assign(s.mix, snapshot.levels);
      assert.deepEqual(captureLSystemsPreset(s, snapshot.envelope), snapshot);
      for (const key of ["audio", "playing", "position", "level"]) assert.ok(!Object.hasOwn(snapshot.shared, key));
      assert.equal(Object.hasOwn(snapshot, "mic"), snapshot.mode === "mic");
      assert.equal(Object.hasOwn(snapshot, "synth"), snapshot.mode !== "mic");
    }
  }
  for (const mode of ["continuous", "notes", "triggers"]) assert.equal(L_SYSTEMS_FULL_PRESETS.filter(p => p.snapshot.mode === mode).length, 16);
  for (const mode of ["continuous", "notes"]) assert.deepEqual(new Set(L_SYSTEMS_FULL_PRESETS.filter(p => p.snapshot.mode === mode).map(p => p.snapshot.synth.soundMode)), new Set(SYNTH_CHOICES));
});

test("imported Mic scenes preserve Delay's actual topology, time, pitch, wet/dry and pruning", () => {
  for (const [index, preset] of L_SYSTEMS_MIC_PRESETS.entries()) {
    const s = makeState(preset.snapshot), original = MICMIC_FULL_PRESETS[index].snapshot.parameters;
    assert.equal(s.geometryModel, "generations");
    const mapped = generationOptions(s);
    for (const [to, from] of Object.entries({ lSystemType: "lSystemType", generations: "generations", angle: "generationAngle", asymmetry: "generationAsymmetry", depth: "depth", timeRatio: "timeRatio", mutation: "mutation", pruningBias: "pruningBias", interval: "interval", pitchScale: "generationPitchScale", spread: "spread" })) assert.equal(mapped[to], original[from], to);
    for (const name of ["wet", "dry", "inputTrim"]) assert.equal(s.mic[name], original[name]);
    assert.deepEqual(micGenerationVoices(s), generationVoiceSpecs({ ...mapped, maximumVoices: 128 }));
    assert.ok(micGenerationVoices(s).length > 0);
  }
});

test("full-state random is deterministic, not a factory scene, bounded, and preserves output/device boundaries", () => {
  for (const mic of [false, true]) {
    const current = mic ? structuredClone(L_SYSTEMS_MIC_PRESETS[0].snapshot) : captureLSystemsPreset(createDefaultState(), amplitude);
    const before = structuredClone(current), values = new Map(), rand = rng(80);
    function collect(value, prefix = "") { for (const [k, v] of Object.entries(value)) { const key = `${prefix}.${k}`; if (v && typeof v === "object") collect(v, key); else { if (!values.has(key)) values.set(key, new Set()); values.get(key).add(JSON.stringify(v)); } } }
    for (let i = 0; i < 140; i++) {
      const next = randomizeLSystemsPreset(current, rand);
      validateLSystemsPreset(next, mic); collect(next);
      assert.notEqual(presetStateKey(next), presetStateKey(current));
      assert.ok(!(mic ? L_SYSTEMS_MIC_PRESETS : L_SYSTEMS_FULL_PRESETS).some(p => presetStateKey(p.snapshot) === presetStateKey(next)));
      if (mic) { assert.equal(next.micLevel, current.micLevel); assert.equal(next.mic.inputTrim, current.mic.inputTrim); }
    }
    assert.deepEqual(current, before);
    assert.deepEqual(randomizeLSystemsPreset(current, rng(43)), randomizeLSystemsPreset(current, rng(43)));
    const allowedFrozen = new Set([".version", ...(mic ? [".mode", ".micLevel", ".mic.inputTrim"] : [".envelope.preset", ".envelope.points.0.x", ".envelope.points.0.y", ".envelope.points.4.x", ".envelope.points.4.y"])]);
    for (const [key, choices] of values) if (!allowedFrozen.has(key)) assert.ok(choices.size > 1, `randomizer froze ${key}`);
  }
});

test("validation rejects incomplete/nonfinite/out-of-range and cross-bank scenes before applying", () => {
  const main = structuredClone(L_SYSTEMS_FULL_PRESETS[0].snapshot);
  assert.throws(() => validateLSystemsPreset(main, true));
  assert.throws(() => validateLSystemsPreset(L_SYSTEMS_MIC_PRESETS[0].snapshot, false));
  for (const edit of [s => delete s.synth.cutoff, s => s.synth.cutoff = Infinity, s => s.drums.subdivisions = 1.5, s => s.synth.soundMode = "unknown", s => s.shared.iterations = 100]) {
    const next = structuredClone(main); edit(next); assert.throws(() => validateLSystemsPreset(next));
  }
});

test("default rewritten geometry is unchanged; child timing and mutation are deterministic and consequential", () => {
  const s = createDefaultState(), g = L_SYSTEM_PRESETS.find(g => g.id === s.presetId);
  assert.deepEqual(lSystemsTrace(g, s.iterations, s), { ...traceLSystem({ ...g, iterations: s.iterations, angle: s.angle, lengthScale: s.lengthScale, turnAsymmetry: s.turnAsymmetry }), iteration: s.iterations });
  const normal = lSystemsTrace(g, 4, s), timed = lSystemsTrace(g, 4, { ...s, childTimeRatio: .65 });
  assert.notEqual(normal.duration, timed.duration);
  const mutated = lSystemsTrace(g, 4, { ...s, mutation: .4 });
  assert.deepEqual(mutated, lSystemsTrace(g, 4, { ...s, mutation: .4 }));
  assert.notDeepEqual(mutated.bounds, normal.bounds);
  assert.notEqual(mutated.segments[2].cumulativeTurn, normal.segments[2].cumulativeTurn);
  assert.ok(branchDecayGain(4, .7) < branchDecayGain(1, .7));
  const heads = Array.from({ length: 20 }, (_, depth) => ({ depth, voiceKey: `v${depth}` }));
  assert.ok(allocateLSystemsHeads(heads, 4, 1).every(h => h.depth >= 16));
  assert.ok(allocateLSystemsHeads(heads, 4, -1).every(h => h.depth < 4));
});

test("all factory and random scenes produce finite connected traversable geometry", () => {
  const samples = [...L_SYSTEMS_FULL_PRESETS, ...L_SYSTEMS_MIC_PRESETS].map(p => p.snapshot);
  for (let seed = 1; seed < 30; seed++) samples.push(randomizeLSystemsPreset(samples[0], rng(seed)));
  for (const snapshot of samples) {
    const s = makeState(snapshot), g = L_SYSTEM_PRESETS.find(g => g.id === s.presetId);
    const t = lSystemsTrace(g, s.iterations, s);
    assert.ok(t.duration > 0 && Number.isFinite(t.duration)); assert.ok(t.segments.length > 0);
    for (const segment of t.segments) {
      for (const v of [segment.start.x, segment.end.x, segment.end.y, segment.startDistance, segment.endDistance, segment.cumulativeTurn]) assert.ok(Number.isFinite(v));
      assert.ok(segment.endDistance >= segment.startDistance);
      if (segment.parentIndex !== null) assert.ok(t.segments[segment.parentIndex].children.includes(segment.index));
    }
    let totalHeads = 0;
    for (const phase of Array.from({ length: 64 }, (_, i) => (i + .5) / 64)) {
      const playback = iterationPlaybackAtPhase([t], phase, "final");
      totalHeads += playback.entries[0].snapshot.heads.length;
      for (const h of playback.entries[0].snapshot.heads) assert.ok(Number.isFinite(h.x) && Number.isFinite(h.y));
    }
    assert.ok(totalHeads > 0, `${s.presetId} has no playable heads`);
  }
});

test("new oscillators, ratios, note articulation and branch decay reach the note engine", () => {
  const s = createDefaultState(), event = { key: "hit", depth: 2, maxForkDepth: 3, cumulativeTurn: .4, powerShare: .5 };
  for (const mode of SYNTH_CHOICES) {
    s.synth.soundMode = mode;
    const v = lSystemNoteVoice(event, 2, s);
    assert.equal(v.mode, mode); assert.ok(v.gain > 0 && v.gain < .36);
  }
  s.synth.soundMode = "fm"; s.synth.modulationRatio = 2.7;
  assert.equal(lSystemNoteVoice(event, 2, s).modulationRatio, 2.7);
  const level = lSystemNoteVoice(event, 2, s).gain; s.branchDecay = .6;
  assert.ok(lSystemNoteVoice(event, 2, s).gain < level);
  s.synth.articulation = "fixed"; s.synth.noteDuration = .3;
  assert.equal(lSystemNoteDuration(s, 128), .3);
  const points = lSystemNoteEnvelope(.3, amplitude).map(p => percussionEnvelopeTimeMs(p.x));
  assert.ok(points[1] >= 8); assert.ok(points[4] - points[3] >= 20 - 1e-8);
});

test("Graph percussion reuse includes row-specific Karplus and both rattle options", () => {
  for (const id of ["karplus-strong", "karplus-tines", "karplus-objects", "rattlesnake", "rattlesnake-physical", "circuit", "resonant-metal", "drum-bank"]) assert.ok(L_SYSTEMS_TRIGGER_STYLES.some(s => s.id === id));
  const rows = [0, 4, 8, 12].map(voiceIndex => lSystemsPercussionVoice({ voiceIndex, frequency: 220, level: .3 }, { style: "karplus-strong" }));
  assert.equal(new Set(rows.map(r => r.karplusPresetId)).size, 4);
  for (const row of rows) assert.equal(graphDrumTriggerPlan(row).engine, "karplus-strong");
});

test("one smoothed tone stage and bounded Graph engines preserve host mute", () => {
  const synth = new LSystemsSynthAudio(128); assert.ok(synth instanceof VoicePool);
  const changes = [];
  synth.context = { currentTime: 2, sampleRate: 48000 };
  synth.toneFilter = { frequency: { setTargetAtTime: (...args) => changes.push(args) }, Q: { setTargetAtTime: (...args) => changes.push(args) } };
  synth.setTone(1800, .8); assert.deepEqual(changes, [[1800, 2, .025], [.8, 2, .025]]);
  const outputs = [], gates = [], cancelled = [];
  const d = new LSystemsDrumAudio(globalThis, { fmAudio: { setOutput() {}, setHostGain: v => gates.push(v), cancelScheduledHits: () => cancelled.push("fm") }, physicalAudio: { setOutput: v => outputs.push(v), cancelScheduledHits: () => cancelled.push("physical") } });
  d.setHostGain(0); d.setOutput(.7); assert.equal(outputs.at(-1), 0);
  d.setHostGain(1); assert.equal(outputs.at(-1), .7); d.cancelScheduledHits(); assert.deepEqual(cancelled, ["fm", "physical"]);
});

test("shared UI follows Delay ordering without losing subdivisions or original reader controls", () => {
  const html = readFileSync(new URL("../l-systems.html", import.meta.url), "utf8");
  const ordered = ["mainPresets", "playingMode", "speed", "subdivisions", "systemRackTitle", "preset", "iterations", "pruningBias", "branchDecay", "childTimeRatio", "angle", "turnAsymmetry", "mutation"];
  for (let i = 1; i < ordered.length; i++) assert.ok(html.indexOf(`id="${ordered[i]}"`) > html.indexOf(`id="${ordered[i-1]}"`), ordered[i]);
  for (const id of ["micFeedback", "micInterval", "micTimeRatio", "micPitchRange"]) assert.ok(html.includes(`id="${id}"`));
});
