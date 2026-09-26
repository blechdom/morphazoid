import assert from 'node:assert/strict';
import test from 'node:test';
import { WEBGPU_CHIPTUNE_PARAM_ORDER as ORDER } from '../src/instruments/webgpu-chiptune/webgpu-chiptune.js';
import { PARAM_GROUPS, PARAM_MODES, PARAM_SPECIAL, PARAM_LABELS, PARAM_NOTES,
  simdChiptuneParameterActive, simdChiptuneParameterGroups } from '../src/instruments/simd-chiptune/parameter-groups.js';

test('live controls own every source parameter exactly once without losing an effect in the redesign', () => {
  const keys = PARAM_GROUPS.flatMap(group => group.keys);
  assert.equal(keys.length, ORDER.length);
  assert.equal(new Set(keys).size, ORDER.length);
  assert.deepEqual([...keys].sort(), [...ORDER].sort());
  for (const group of PARAM_GROUPS) {
    assert.deepEqual(group.keys, [...group.core, ...group.detail]);
    assert.ok(Object.isFrozen(group));
    assert.ok(Object.isFrozen(group.core));
    assert.ok(Object.isFrozen(group.detail));
    for (const key of group.keys) {
      assert.ok(PARAM_LABELS[key]?.length, `${key} needs a compact label`);
      assert.ok(PARAM_NOTES[key]?.length, `${key} needs a sound destination`);
      assert.ok(['song', 'both'].includes(PARAM_MODES[key]), `${key} needs mode applicability`);
    }
  }
});

test('shared tone, echo, source clocks and local timbres retain their actual synthesis ownership', () => {
  const owner = key => PARAM_GROUPS.find(group => group.keys.includes(key));
  for (const key of ['noiseRate', 'noiseColor', 'pulseWidth', 'pwmDepth', 'pwmRate']) assert.equal(owner(key).owner, 'global');
  for (const key of ['echoWet', 'echoTime', 'echoDecay', 'echoStereo']) assert.equal(owner(key).id, 'echo');
  assert.equal(owner('ghostDrums').owner, 'drums');
  assert.equal(owner('pitchClock').owner, 'upperOne');
  assert.match(PARAM_NOTES.pitchClock, /Upper B/);
  assert.match(PARAM_NOTES.pulseWidth, /Upper A\/B/);
  assert.match(PARAM_NOTES.noiseRate, /Snare.*Hats.*Shaker.*Noise/);
  assert.match(PARAM_NOTES.arpBassFollow, /independent of Bass volume/);
  for (const [key, voice] of [['leadTone', 'lead'], ['arpTone', 'arp'], ['bassPulseWidth', 'bass'], ['textureSweep', 'noise']]) {
    assert.equal(owner(key).owner, voice); assert.ok(owner(key).core.includes(key));
  }
  for (const part of ['kick', 'snare', 'hats', 'shaker']) {
    const groups = simdChiptuneParameterGroups('drums', { part });
    assert.ok(groups.some(group => group.part === part && group.tab === 'tone'));
    assert.ok(groups.some(group => group.part === part && group.tab === 'rhythm'));
    assert.ok(groups.every(group => !group.part || group.part === part));
  }
});

test('Pattern exposes only active source parameters and preserves its Arp contour range', () => {
  for (const key of ['gateRate', 'gateLength', 'gateAttack', 'gateRelease', 'patternSeed', 'pitchClock',
    'leadClock', 'upperOneSpan', 'leadTrillRate', 'bassSpan', 'arpBassFollow', 'drumRate',
    'kickCycle', 'snarePhase', 'hatARepeat', 'textureSweep', 'noiseLevel']) {
    assert.equal(PARAM_MODES[key], 'song', key);
    assert.equal(simdChiptuneParameterActive(key, 'pattern'), false, key);
    assert.equal(simdChiptuneParameterActive(key, 'song'), true, key);
  }
  for (const key of ['tempo', 'transpose', 'scaleMask', 'pitchRange', 'arpSpan', 'leadTone', 'bassPulseWidth',
    'kickTone', 'snareNoiseMix', 'hatBalance', 'drumDecay', 'noiseRate', 'noiseColor', 'echoWet', 'ghostDrums']) {
    assert.equal(PARAM_MODES[key], 'both', key);
    assert.equal(simdChiptuneParameterActive(key, 'pattern'), true, key);
  }
  const song = PARAM_GROUPS.find(group => group.id === 'songArrangement');
  assert.equal(song.mode, 'song'); assert.ok(song.keys.every(key => PARAM_MODES[key] === 'song'));
});

test('scale selection and packed gate durations keep musical editors instead of numeric knobs', () => {
  assert.equal(PARAM_SPECIAL.scaleMask, 'pitch-classes'); assert.equal(PARAM_SPECIAL.echoAlternate, 'toggle');
  const gateWords = ORDER.filter(key => /^gate[AB][0-3]$/.test(key));
  assert.equal(gateWords.length, 8);
  for (const key of gateWords) {
    assert.equal(PARAM_SPECIAL[key], 'gate-durations'); assert.match(PARAM_NOTES[key], /off, short, normal, long/);
  }
});
