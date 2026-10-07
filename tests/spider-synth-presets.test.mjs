import test from 'node:test';
import assert from 'node:assert/strict';
import { presetStateKey, validateFullPresetBank } from '../src/site/header-presets.js';
import { SPIDER_FULL_PRESETS, captureSpiderPreset, validateSpiderPreset, randomizeSpiderPreset } from '../src/instruments/spider-synth/spider-synth-presets.js';
import { SpiderSynthWorld } from '../src/instruments/spider-synth/spider-synth-world.js';
import { createSpiderWeb, createSpiderFrame, writeSpiderPose } from '../src/instruments/spider-synth/spider-synth-model.js';
import { SPIDER_SPECIMENS } from '../src/instruments/spider-synth/spider-synth-specimens.js';
import { SpiderSynthDsp } from '../src/instruments/spider-synth/spider-synth-dsp.js';

test('24 complete performances cover all six skins with unique musical configurations', () => {
  validateFullPresetBank(SPIDER_FULL_PRESETS); assert.equal(SPIDER_FULL_PRESETS.length, 24);
  assert.equal(new Set(SPIDER_FULL_PRESETS.map(p => presetStateKey(p.snapshot))).size, 24);
  for (const skin of SPIDER_SPECIMENS) assert.equal(SPIDER_FULL_PRESETS.filter(p => p.snapshot.specimen === skin.id).length, 4);
  assert.ok(new Set(SPIDER_FULL_PRESETS.map(p => p.snapshot.motionChoice)).size >= 20);
  for (const { snapshot } of SPIDER_FULL_PRESETS) {
    assert.deepEqual(validateSpiderPreset(snapshot), snapshot);
    assert.equal('level' in snapshot.sound, false); assert.equal('voice' in snapshot.sound, false);
    for (const key of ['playing', 'soundPlaying', 'time', 'audioOn', 'phrase']) assert.equal(key in snapshot, false);
  }
});
test('preset validation rejects partial, mismatched and unsafe data before recall', () => {
  const base = SPIDER_FULL_PRESETS[0].snapshot;
  for (const change of [p => { delete p.sound.tension; }, p => { p.sound.tension = Infinity; },
    p => { p.specimen = 'missing'; }, p => { p.motion.specimen = 'golden'; }, p => { p.version = 2; },
    p => { p.playing = true; }, p => { p.speech.rate = NaN; }]) {
    const value = structuredClone(base); change(value); assert.throws(() => validateSpiderPreset(value));
  }
});
test('capture excludes live gains, transport, joystick and text without losing edits', () => {
  const base = SPIDER_FULL_PRESETS[0].snapshot;
  const captured = captureSpiderPreset({ ...base, sound: { ...base.sound, level: 0, voice: 0 },
    worldSettings: { ...base.worldSettings, joystick: { x: 1, z: -1 }, playing: true }, playing: true, time: 99, phrase: 'hello' });
  assert.deepEqual(captured, base);
});
test('dice generates complete new parameter states and varies each editable scene field', () => {
  let seed = 873; const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
  const previous = SPIDER_FULL_PRESETS[0].snapshot, before = presetStateKey(previous), seen = new Map();
  const visit = (value, prefix = '') => {
    for (const [key, item] of Object.entries(value)) {
      const path = `${prefix}.${key}`;
      if (item && typeof item === 'object' && !Array.isArray(item)) visit(item, path);
      else { if (!seen.has(path)) seen.set(path, new Set()); seen.get(path).add(presetStateKey(item)); }
    }
  };
  for (let n = 0; n < 80; n++) { const next = randomizeSpiderPreset(previous, random); validateSpiderPreset(next); assert.notEqual(presetStateKey(next), before); visit(next); }
  assert.equal(presetStateKey(previous), before);
  for (const [path, values] of seen) if (path !== '.version') assert.ok(values.size > 1, `${path} is frozen`);
});
test('every factory scene is silent at rest after Audio arm and its strings remain playable', () => {
  for (const { id, snapshot } of SPIDER_FULL_PRESETS) {
    const d = new SpiderSynthDsp(24000);
    d.update({ enabled: true, playing: false, soundPlaying: false, ...snapshot });
    const l = new Float32Array(6000), r = new Float32Array(6000);
    assert.equal(d.render(l, r).peak, 0, id);
    d.pluck({ segmentId: Math.floor(d.web.segments.length / 2), u: .5, velocity: .8, angle: 1 });
    assert.ok(d.render(l, r).peak > .001, id);
  }
});

test('Dice never mutes every assignment or mutes its only solo', () => {
  let seed = 873; const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
  const base = SPIDER_FULL_PRESETS[0].snapshot;
  for (const r of [() => 0, () => .999999, ...Array(200).fill(random)]) {
    const next = randomizeSpiderPreset(base, r);
    assert.ok(next.bodyMix.some(row => row.level > 0 && !next.muted.includes(row.groupId) && (!next.solo.length || next.solo.includes(row.groupId))));
  }
});

test('scene replacement preserves existing MIDI strings without replaying notes', () => {
  const d = new SpiderSynthDsp(24000), first = SPIDER_FULL_PRESETS[1].snapshot;
  d.update({ ...first, enabled: true, sound: { ...first.sound, pluckAttack: .1, pluckHold: .6, pluckRelease: 4 } });
  const l = new Float32Array(4800), r = new Float32Array(4800);
  for (const note of [60, 66, 68]) d.midi({ type: 'noteOn', note, velocity: 110, sourceId: 'keys', channel: 0 });
  d.render(l, r);
  const held = d.strings.voices.filter(v => v.remaining > 0 && v.midiSourceId === 'keys');
  assert.ok(held.length >= 3); const attacks = d.midiEvents;
  const next = SPIDER_FULL_PRESETS[8].snapshot;
  d.update({ ...next, webSettings: { ...next.webSettings, preset: 'triangle', spokes: 6, rings: 4 }, resetActivity: true, preserveMidi: true });
  assert.ok(held.every(v => !v.release));
  const output = d.render(l, r);
  assert.ok(output.peak > .001 && output.peak < .95);
  assert.equal(d.midiEvents, attacks); assert.equal(d.midiPerformance.getState(d.audioTime).heldCount, 3);
  d.resetMidi({ sourceId: 'keys' }); assert.ok(held.every(v => v.release));
});


test('factory routes actually travel; weaving adds playable silk and body scenes stay put', () => {
 let roaming = 0, weaving = 0, stationary = 0, flies = 0;
 for (const { label, snapshot: s } of SPIDER_FULL_PRESETS) {
  const world = new SpiderSynthWorld({ ...s.worldSettings, playing: true });
  const web = createSpiderWeb(s.webSettings), frame = createSpiderFrame();
  let extent = 0;
  for (let tick = 0; tick <= 240; tick++) {
   const time = tick / 20;
   world.sample(time, s.motion, web, frame, writeSpiderPose(time, s.motion), undefined, { playing: true, motionTime: time });
   extent = Math.max(extent, Math.hypot(frame.body.x, frame.body.z));
  }
  if (s.worldSettings.path === 'hold') { stationary++; assert.ok(extent < .002, label); }
  else { roaming++; assert.ok(extent > .04, label); }
  if (s.worldSettings.laySilk) {
   weaving++; assert.ok(world.silkSegments.length > 30, label);
   assert.ok(world.silkSegments.every(strand => strand.length > 0 && Number.isFinite(strand.length)), label);
  } else assert.equal(world.silkSegments.length, 0, label);
  if (s.flyOnSelect) flies++;
 }
 assert.equal(roaming, 20); assert.equal(weaving, 8); assert.equal(stationary, 4); assert.equal(flies, 6);
});
