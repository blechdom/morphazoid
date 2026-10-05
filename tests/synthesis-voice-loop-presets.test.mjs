import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScene, validateScene } from '../src/instruments/voicesaurus/native-model.js';
import { singingNoteDescriptors, tempoForScene } from '../src/instruments/voicesaurus/native-singing-model.js';
import { sanitizeVoiceInputState, voicePresetsForInput } from '../src/instruments/synthesis/voice-input-state.js';
import { sinsyScoreToMusicXml, validateSinsyMusicXml } from '../src/families/speech/sinsy-score.js';
import {
  VOICE_LOOP_MELODY_PRESETS, VOICE_LOOP_TEXT_CATEGORIES, voiceLoopTextPresets,
  applyVoiceLoopTextPreset, randomizeVoiceLoopText, applyVoiceLoopMelodyPreset,
  randomizeVoiceLoopPitches, randomizeVoiceLoopLengths,
} from '../src/instruments/synthesis/voice-loop-presets.js';

const engines = ['singer', 'stk-voicform', 'csound-fof', 'csound-vosim', 'sample-bank', 'sinsy'];
const rng = (seed = 17943) => () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
const clone = value => structuredClone(value);
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} vs ${expected}`);

function fixture(engine) {
  const scene = defaultScene(engine), tempo = 112;
  if (engine === 'sinsy') {
    scene.input = { ...scene.input, tempo, notes: Array.from({ length: 8 }, (_, index) => ({
      midi: 61 + index % 5, beats: [1, .5, .5, 1, 1, 1, 1, 2][index],
      lyric: 'ら', rest: index === 3, staccato: index === 1, breath: index === 7,
    })) };
  } else {
    const input = clone(scene.input); delete input.phrase; delete input.singingText;
    scene.input.phrase = { tempo, pitchPortamento: .012, vowelPortamento: .025, notes: Array.from({ length: 8 }, (_, index) => ({
      rest: index === 3, input: clone(input), voiceOverrides: [],
      values: { ...scene.values, pitch: 220 * 2 ** ((index % 5 + .17) / 12), duration: [1, .5, .5, 1, 1, 1, 1, 2][index] * 60 / tempo },
    })) };
  }
  return { version: 1, text: engine === 'sinsy' ? 'ら ら ら ら ら ら ら' : 'ah ah ah ah ah ah ah', scene: validateScene(scene) };
}

function logicalNotes(state) {
  const result = [], notes = state.scene.engine === 'sinsy' ? state.scene.input.notes : state.scene.input.phrase.notes;
  for (const [index, descriptor] of singingNoteDescriptors(state.scene).entries()) {
    const note = notes[index], slot = note.textSlot ?? note.textSyllable, last = result.at(-1);
    if (state.scene.engine !== 'sinsy' && !descriptor.rest && last && !last.rest && slot !== undefined && slot === last.slot && descriptor.pitch === last.pitch) {
      last.beats += descriptor.beats; last.seconds += descriptor.seconds;
    } else result.push({ slot, pitch: descriptor.pitch, rest: descriptor.rest, beats: descriptor.beats, seconds: descriptor.seconds });
  }
  return result;
}

function withoutAxes(state, axes) {
  const result = clone(state), score = result.scene.engine === 'sinsy';
  for (const note of score ? result.scene.input.notes : result.scene.input.phrase.notes) {
    for (const axis of axes) delete (score ? note : note.values)[score ? axis === 'pitch' ? 'midi' : 'beats' : axis];
  }
  return result;
}

test('loop text advertises supported words, vowels and consonant percussion without changing native engine capabilities', () => {
  assert.deepEqual(VOICE_LOOP_TEXT_CATEGORIES.map(item => item.id), ['words', 'percussion', 'vowels']);
  for (const engine of engines) {
    const options = voiceLoopTextPresets(engine);
    assert.equal(new Set(options.map(item => item.id)).size, options.length);
    assert.ok(options.some(item => item.category === 'words'));
    assert.ok(options.some(item => item.category === 'vowels'));
    assert.equal(options.some(item => item.category === 'percussion'), !engine.startsWith('csound-'));
    for (const item of options) {
      assert.equal(item.text.split(' ').length, 8);
      assert.ok(engine === 'sinsy' ? /^[ぁ-ゖ\s]+$/.test(item.text) : /^[a-z\s]+$/.test(item.text));
    }
    options[0].label = 'local mutation';
    assert.notEqual(voiceLoopTextPresets(engine)[0].label, 'local mutation');
  }
  assert.throws(() => voiceLoopTextPresets('espeak'), /singing engine/);
});

test('text presets keep complete slot pitch, length, rest, tempo and global voice settings across all singing engines', () => {
  for (const engine of engines) {
    const source = fixture(engine), before = clone(source), expected = logicalNotes(source);
    for (const preset of voiceLoopTextPresets(engine)) {
      const next = applyVoiceLoopTextPreset(source, preset.id), actual = logicalNotes(next);
      assert.equal(actual.length, expected.length, `${engine} ${preset.id}`);
      actual.forEach((note, index) => {
        assert.equal(note.pitch, expected[index].pitch); assert.equal(note.rest, expected[index].rest);
        close(note.beats, expected[index].beats, `${engine} beat preservation`);
        close(note.seconds, expected[index].seconds, `${engine} seconds preservation`);
      });
      assert.deepEqual(next.scene.values, source.scene.values);
      assert.equal(tempoForScene(next.scene), tempoForScene(source.scene));
      assert.equal(next.scene.input.singingText, next.text);
      assert.equal(next.text.split(' ').length, 7);
      assert.deepEqual(sanitizeVoiceInputState(JSON.parse(JSON.stringify(next)), 'singing'), next);
      if (engine === 'sample-bank') assert.equal(next.scene.input.source, source.scene.input.source);
      if (engine === 'sinsy') {
        assert.ok(next.scene.input.notes[1].staccato); assert.ok(next.scene.input.notes[7].breath);
        assert.equal(validateSinsyMusicXml(sinsyScoreToMusicXml(next.scene.input)), sinsyScoreToMusicXml(next.scene.input));
      }
    }
    assert.deepEqual(source, before);
  }
});

test('all factory singing scenes accept every applicable text and melody preset without exceeding native note budgets', () => {
  for (const { state } of voicePresetsForInput('singing')) {
    for (const { id } of voiceLoopTextPresets(state.scene.engine)) assert.deepEqual(validateScene(applyVoiceLoopTextPreset(state, id).scene), applyVoiceLoopTextPreset(state, id).scene);
    for (const { id } of VOICE_LOOP_MELODY_PRESETS) {
      const next = applyVoiceLoopMelodyPreset(state, id);
      assert.equal(next.text, state.text); assert.deepEqual(validateScene(next.scene), next.scene);
    }
  }
});

test('melody presets change only pitches and lengths and give two-bar loops with native phoneme timing intact', () => {
  for (const engine of engines) {
    const source = applyVoiceLoopTextPreset(fixture(engine), 'night-song'), before = clone(source);
    for (const preset of VOICE_LOOP_MELODY_PRESETS) {
      const next = applyVoiceLoopMelodyPreset(source, preset.id), slots = logicalNotes(next);
      assert.deepEqual(withoutAxes(next, ['pitch', 'duration']), withoutAxes(source, ['pitch', 'duration']));
      close(slots.reduce((sum, note) => sum + note.beats, 0), 8, `${engine} loop beats`);
      assert.ok(slots.every(note => note.beats >= .5 - 1e-9 && note.beats <= 3 + 1e-9));
      const descriptors = singingNoteDescriptors(next.scene).filter(note => !note.rest);
      assert.ok(descriptors.every(note => note.pitchHz >= 130 && note.pitchHz <= 800));
      if (engine !== 'sinsy') {
        const oldSlots = logicalNotes(source);
        const sourceNotes = singingNoteDescriptors(source.scene), nextNotes = singingNoteDescriptors(next.scene);
        const oldTotal = new Map(oldSlots.filter(note => !note.rest).map(note => [note.slot, note.seconds]));
        const nextTotal = new Map(slots.filter(note => !note.rest).map(note => [note.slot, note.seconds]));
        next.scene.input.phrase.notes.forEach((note, index) => {
          if (!note.rest) close(nextNotes[index].seconds / nextTotal.get(note.textSlot), sourceNotes[index].seconds / oldTotal.get(note.textSlot), 'consonant/vowel duration ratio');
        });
      }
    }
    assert.deepEqual(source, before);
  }
});

test('seeded pitch and length dice vary their own axis while preserving every other authored parameter', () => {
  for (const engine of engines) {
    const source = applyVoiceLoopTextPreset(fixture(engine), 'open-vowels'), before = clone(source);
    const pitches = new Set(), lengths = new Set();
    for (let seed = 1; seed <= 80; seed++) {
      const pitch = randomizeVoiceLoopPitches(source, rng(seed)), length = randomizeVoiceLoopLengths(source, rng(seed));
      assert.deepEqual(pitch, randomizeVoiceLoopPitches(source, rng(seed)));
      assert.deepEqual(length, randomizeVoiceLoopLengths(source, rng(seed)));
      assert.deepEqual(withoutAxes(pitch, ['pitch']), withoutAxes(source, ['pitch']));
      assert.deepEqual(withoutAxes(length, ['duration']), withoutAxes(source, ['duration']));
      assert.deepEqual(validateScene(pitch.scene), pitch.scene); assert.deepEqual(validateScene(length.scene), length.scene);
      pitches.add(JSON.stringify(singingNoteDescriptors(pitch.scene).map(note => note.pitch)));
      lengths.add(JSON.stringify(logicalNotes(length).map(note => note.beats)));
      close(logicalNotes(length).reduce((sum, note) => sum + note.beats, 0), 8, 'random rhythm closes on bar');
    }
    assert.ok(pitches.size > 12, `${engine} pitch variety ${pitches.size}`);
    assert.ok(lengths.size > 12, `${engine} rhythm variety ${lengths.size}`);
    assert.deepEqual(source, before);
  }
});

test('text dice is seeded, native-compatible and independent of pitch and length', () => {
  for (const engine of engines) {
    const source = applyVoiceLoopTextPreset(fixture(engine), 'open-vowels');
    for (const category of new Set(voiceLoopTextPresets(engine).map(item => item.category))) {
      const outputs = new Set();
      for (let seed = 1; seed <= 50; seed++) {
        const next = randomizeVoiceLoopText(source, category, rng(Math.imul(seed, 7919)));
        assert.deepEqual(next, randomizeVoiceLoopText(source, category, rng(Math.imul(seed, 7919))));
        logicalNotes(next).forEach((note, index) => {
          const old = logicalNotes(source)[index]; assert.equal(note.pitch, old.pitch); assert.equal(note.rest, old.rest);
          close(note.seconds, old.seconds, 'text dice duration');
        });
        assert.deepEqual(next.scene.values, source.scene.values); outputs.add(next.text);
      }
      assert.ok(outputs.size > 1, `${engine} ${category} changes actual text`);
    }
  }
});

test('hostile random samples stay finite and valid, and no focused action mutates its caller', () => {
  for (const engine of engines) {
    const source = applyVoiceLoopTextPreset(fixture(engine), 'open-vowels'), before = clone(source);
    for (const sample of [-Infinity, -100, -1, 0, .999999999, 1, 10, Infinity, NaN, undefined, 'bad']) {
      const random = () => sample;
      for (const next of [randomizeVoiceLoopPitches(source, random), randomizeVoiceLoopLengths(source, random), randomizeVoiceLoopText(source, 'vowels', random)]) {
        assert.deepEqual(validateScene(next.scene), next.scene);
        assert.ok(singingNoteDescriptors(next.scene).every(note => Number.isFinite(note.beats) && Number.isFinite(note.pitchHz) && note.seconds > 0));
      }
    }
    assert.deepEqual(source, before);
  }
});

test('fractional native tuning survives melodic presets, while Sinsy retains integer score pitches', () => {
  for (const engine of engines) {
    const next = applyVoiceLoopMelodyPreset(fixture(engine), 'easy-rise');
    for (const note of singingNoteDescriptors(next.scene).filter(note => !note.rest)) {
      if (engine === 'sinsy') assert.ok(Number.isInteger(note.midi));
      else close(note.midi - Math.floor(note.midi), .17, 'native fractional pitch');
    }
  }
  const low = fixture('singer');
  for (const note of low.scene.input.phrase.notes) note.values.pitch = 440 * 2 ** ((52.17 - 69) / 12);
  const bounded = applyVoiceLoopMelodyPreset(low, 'low-bounce');
  for (const note of singingNoteDescriptors(bounded.scene).filter(note => !note.rest)) {
    assert.ok(note.midi >= 48 && note.midi <= 76);
    close(note.midi - Math.floor(note.midi), .17, 'fractional pitch at lower range edge');
  }
});

test('legacy single notes and dense phrases remain bounded, with invalid focused requests rejected atomically', () => {
  for (const engine of engines) {
    const legacy = { version: 1, text: 'ah', scene: defaultScene(engine) };
    for (const action of [randomizeVoiceLoopLengths, randomizeVoiceLoopPitches]) {
      const next = action(legacy, () => .5);
      assert.deepEqual(validateScene(next.scene), next.scene); assert.equal(next.scene.engine, engine);
    }
    const source = fixture(engine), before = clone(source);
    assert.throws(() => applyVoiceLoopMelodyPreset(source, 'missing'), /known loop melody/);
    assert.throws(() => applyVoiceLoopTextPreset(source, 'missing'), /known loop text/);
    assert.throws(() => randomizeVoiceLoopText(source, 'missing'), /words, mouth percussion or open vowels/);
    assert.deepEqual(source, before);
    const notes = engine === 'sinsy' ? source.scene.input.notes : source.scene.input.phrase.notes;
    for (const note of notes) note.rest = true;
    assert.throws(() => applyVoiceLoopTextPreset(source, 'open-vowels'), /sung note/);
  }
  const dense = fixture('singer');
  dense.scene.input.phrase.notes = Array.from({ length: 50 }, () => clone(dense.scene.input.phrase.notes[0]));
  const next = randomizeVoiceLoopLengths(dense, rng());
  close(singingNoteDescriptors(next.scene).reduce((sum, note) => sum + note.beats, 0), 16, 'dense four-bar loop');
});
