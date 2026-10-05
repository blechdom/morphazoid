import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_METHODS, defaultsFor, methodsForVoiceMode, presetsForVoiceMode, validateScene, voiceModeForEngine } from '../src/instruments/voicesaurus/native-model.js';
import { singingNoteDescriptors } from '../src/instruments/voicesaurus/native-singing-model.js';
import {
  createVoiceInputState, isVoiceInput, randomizeVoiceInputState, randomizeVoiceMethodState,
  sanitizeVoiceInputState, voiceModeForInput, voicePresetsForInput,
} from '../src/instruments/synthesis/voice-input-state.js';
import { voiceTextForEngine, voiceTextOptions } from '../src/instruments/synthesis/voice-texts.js';

const rng = (seed = 17943) => () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);

test('voice inputs remain distinct from ordinary synth and external sources', () => {
  for (const id of ['speech', 'singing']) assert.equal(isVoiceInput(id), true);
  for (const id of ['synthesis', 'mic', 'file', 'sample-bank', null, undefined]) assert.equal(isVoiceInput(id), false);
  assert.equal(voiceModeForInput('speech'), 'speaking');
  assert.equal(voiceModeForInput('singing'), 'singing');
  assert.throws(() => createVoiceInputState('mic'), /speech or singing/);
});

test('initial states provide complete native speech and an editable singing phrase', () => {
  const speech = createVoiceInputState('speech'), singing = createVoiceInputState('singing');
  assert.equal(speech.version, 1); assert.equal(speech.scene.engine, 'espeak');
  assert.ok(speech.text.trim()); assert.equal(singing.scene.engine, 'singer');
  assert.ok(singingNoteDescriptors(singing.scene).length >= 3);
  assert.deepEqual(validateScene(speech.scene), speech.scene);
  assert.deepEqual(validateScene(singing.scene), singing.scene);
  singing.scene.input.phrase.notes[0].values.pitch = 12345;
  assert.notEqual(createVoiceInputState('singing').scene.input.phrase.notes[0].values.pitch, 12345);
  for (const state of [speech, singing]) for (const external of ['level', 'playing', 'enabled', 'context', 'loop', 'bank']) assert.equal(Object.hasOwn(state, external), false);
});

test('mode presets retain native voice settings and supply their own technique text as real input', () => {
  for (const id of ['speech', 'singing']) {
    const original = presetsForVoiceMode(voiceModeForInput(id)), bank = voicePresetsForInput(id);
    assert.equal(bank.length, original.length);
    for (const [index, item] of bank.entries()) {
      assert.equal(item.id, original[index].id);
      assert.deepEqual(item.state.scene.values, original[index].snapshot.values);
      assert.equal(item.state.text, voiceTextForEngine(item.state.scene.engine));
      if (id === 'singing') assert.equal(item.state.scene.input.singingText, item.state.text);
      else if (item.state.scene.engine === 'vizsn') assert.equal(item.state.scene.input.text, item.state.text);
      else assert.deepEqual(item.state.scene, original[index].snapshot);
      const name = NATIVE_METHODS[item.state.scene.engine].name;
      assert.equal(item.label, `${original[index].label.replace(`${name} · `, '')} · ${name}`);
      assert.deepEqual(sanitizeVoiceInputState(item.state, id), item.state);
    }
    bank[0].state.scene.values[Object.keys(bank[0].state.scene.values)[0]] = 'changed';
    assert.notDeepEqual(bank[0].state.scene, original[0].snapshot);
    assert.deepEqual(voicePresetsForInput(id)[0].state.scene.values, original[0].snapshot.values);
  }
});

test('state validation rejects cross-mode, incomplete and malformed snapshots without mutating callers', () => {
  const speech = createVoiceInputState('speech'), singing = createVoiceInputState('singing');
  for (const value of [null, {}, { ...speech, version: 2 }, { ...speech, text: 42 }, { ...speech, text: 'a'.repeat(1001) }, singing]) {
    assert.deepEqual(sanitizeVoiceInputState(value, 'speech'), speech);
  }
  const invalid = structuredClone(speech); delete invalid.scene.values.pitch;
  assert.deepEqual(sanitizeVoiceInputState(invalid, 'speech'), speech);
  const extreme = structuredClone(speech); extreme.scene.values.pitch = -123456.125; extreme.text = 'The performer’s own words.';
  const captured = sanitizeVoiceInputState(extreme, 'speech');
  assert.deepEqual(captured, extreme); captured.scene.values.pitch = 0;
  assert.equal(extreme.scene.values.pitch, -123456.125);
});

test('full dice explores all engines in each input and produces independent complete state', () => {
  for (const id of ['speech', 'singing']) {
    const previous = createVoiceInputState(id), before = structuredClone(previous), random = rng();
    previous.text = 'Replace these words only on full dice.'; before.text = previous.text;
    const engines = new Set(), states = new Set();
    for (let index = 0; index < 300; index++) {
      const next = randomizeVoiceInputState(previous, id, random);
      assert.equal(next.version, 1);
      assert.ok(voiceTextOptions(next.scene.engine).some(item => item.text === next.text));
      if (id === 'singing') assert.equal(next.scene.input.singingText, next.text);
      assert.equal(voiceModeForEngine(next.scene.engine), voiceModeForInput(id));
      assert.deepEqual(validateScene(next.scene), next.scene);
      if (id === 'singing') assert.ok(singingNoteDescriptors(next.scene).length >= 3);
      engines.add(next.scene.engine); states.add(JSON.stringify(next.scene));
    }
    assert.deepEqual([...engines].sort(), Object.keys(methodsForVoiceMode(voiceModeForInput(id))).sort());
    assert.equal(states.size, 300); assert.deepEqual(previous, before);
  }
});

test('full randomization is reproducible for a seed and reaches native enum values with native types', () => {
  for (const id of ['speech', 'singing']) {
    const previous = createVoiceInputState(id), first = rng(137), second = rng(137);
    for (let index = 0; index < 80; index++) {
      const next = randomizeVoiceInputState(previous, id, first);
      assert.deepEqual(next, randomizeVoiceInputState(previous, id, second));
      for (const [key, rule] of Object.entries(NATIVE_METHODS[next.scene.engine].controls)) {
        if (rule.choices && !rule.freeText) assert.ok(rule.choices.includes(next.scene.values[key]));
      }
    }
  }
});

test('whole voice dice avoids the unstable long-note Singer open shape', () => {
  const engines = Object.keys(methodsForVoiceMode('singing'));
  const phones = NATIVE_METHODS.singer.phones;
  let first = true;
  const random = () => {
    if (first) { first = false; return (engines.indexOf('singer') + .5) / engines.length; }
    return (phones.indexOf('open') + .5) / phones.length;
  };
  const next = randomizeVoiceInputState(createVoiceInputState('singing'), 'singing', random);
  assert.equal(next.scene.engine, 'singer'); assert.notEqual(next.scene.input.phone, 'open');
  assert.ok(next.scene.input.phrase.notes.length >= 3);
  for (const note of next.scene.input.phrase.notes) {
    assert.notEqual(note.input.phone, 'open');
    assert.ok(note.values.duration > 0 && note.values.duration <= 1.4);
  }
  assert.deepEqual(validateScene(next.scene), next.scene);
});

test('voice dice keeps numerical dependencies and useful gaps without clamping manual native values', () => {
  const speech = voicePresetsForInput('speech'), singing = voicePresetsForInput('singing');
  for (const engine of ['espeak', 'espeak-klatt', 'pico', 'mea8000', 'hts', 'sinsy', 'singer', 'csound-fof']) {
    const id = ['sinsy', 'singer', 'csound-fof'].includes(engine) ? 'singing' : 'speech';
    const previous = (id === 'singing' ? singing : speech).find(item => item.state.scene.engine === engine).state;
    for (let seed = 1; seed < 80; seed++) {
      const next = randomizeVoiceMethodState(previous, id, rng(seed));
      for (const values of [next.scene.values, ...(next.scene.input.phrase?.notes.map(note => note.values) ?? [])]) {
        if (engine.startsWith('espeak')) assert.ok(values.wordGap <= 8);
        if (engine === 'espeak') assert.ok(values.volume >= 75 && values.volume <= 110);
        if (engine === 'espeak-klatt') {
          assert.ok(values.volume >= 30 && values.volume <= 45);
          assert.ok(['reduced', 'moderate'].includes(values.emphasis));
        }
        if (engine === 'pico') {
          assert.ok(values.volume >= .3 && values.volume <= .6);
          assert.ok(values.speed >= .65 && values.speed <= 1.8);
        }
        if (engine === 'mea8000') {
          assert.ok([.044, .062, .088].includes(values.amplitude));
          for (let n = 1; n <= 4; n++) assert.ok([309, 726].includes(values[`bandwidth${n}`]));
        }
        if (engine === 'hts' || engine === 'sinsy') {
          assert.ok(values.gvWeight >= .6 && values.gvWeight <= 1.2);
          assert.ok(values.alpha >= .45 && values.alpha <= .68);
          if (engine === 'hts') {
            assert.ok(values.gvWeight <= .8);
            assert.ok(values.volumeDb >= -12 && values.volumeDb <= -6);
            assert.ok(values.framePeriod / values.sampleRate >= .0039 && values.framePeriod / values.sampleRate <= .0076);
          } else assert.ok(values.volumeDb >= -6 && values.volumeDb <= 0);
        }
        if (engine === 'csound-fof') {
          assert.ok(values.grainRise * Math.max(values.bandwidth1, values.bandwidth2, values.bandwidth3) <= .700001);
          assert.ok(values.grainDuration < values.duration);
        }
        if (engine === 'singer') {
          const feedback = -values.lipReflection * values.radius8 * values.tractScale;
          assert.ok(feedback >= .149999 && feedback <= .350001);
          assert.ok(values.changeTime < values.duration && values.glottisA < values.glottisB);
        }
      }
    }
  }
  const exact = speech.find(item => item.state.scene.engine === 'hts').state;
  exact.scene.values.gvWeight = 9.46;
  assert.equal(sanitizeVoiceInputState(exact, 'speech').scene.values.gvWeight, 9.46);
});

test('local dice retains method, prose, native input and the authored singing timeline', () => {
  for (const id of ['speech', 'singing']) {
    const visited = new Set();
    for (const preset of voicePresetsForInput(id)) {
      if (visited.has(preset.state.scene.engine)) continue;
      visited.add(preset.state.scene.engine);
      const previous = preset.state; previous.text = 'Custom words remain mine.';
      const before = structuredClone(previous), next = randomizeVoiceMethodState(previous, id, rng());
      assert.equal(next.scene.engine, previous.scene.engine); assert.equal(next.text, previous.text);
      assert.notDeepEqual(next.scene.values, previous.scene.values); assert.deepEqual(validateScene(next.scene), next.scene);
      if (previous.scene.input.phrase) {
        const originalNotes = singingNoteDescriptors(previous.scene), nextNotes = singingNoteDescriptors(next.scene);
        assert.deepEqual(nextNotes.map(({ pitch, beats, rest, input }) => ({ pitch, beats, rest, input })), originalNotes.map(({ pitch, beats, rest, input }) => ({ pitch, beats, rest, input })));
        assert.equal(next.scene.input.phrase.tempo, previous.scene.input.phrase.tempo);
        for (const note of next.scene.input.phrase.notes) {
          assert.ok(note.voiceOverrides.length > 0); assert.equal(note.voiceOverrides.includes('pitch'), false); assert.equal(note.voiceOverrides.includes('duration'), false);
        }
      } else assert.deepEqual(next.scene.input, previous.scene.input);
      assert.deepEqual(previous, before);
    }
  }
});

test('local parameter dice varies every native sound control instead of selecting factory presets', () => {
  for (const id of ['speech', 'singing']) {
    const bank = voicePresetsForInput(id), random = rng(38421);
    for (const engine of Object.keys(methodsForVoiceMode(voiceModeForInput(id)))) {
      const previous = bank.find(preset => preset.state.scene.engine === engine).state;
      const controls = NATIVE_METHODS[engine].controls;
      const values = Object.fromEntries(Object.keys(controls).map(key => [key, new Set()]));
      for (let index = 0; index < 24; index++) {
        const next = randomizeVoiceMethodState(previous, id, random);
        for (const [key, value] of Object.entries(next.scene.values)) values[key].add(value);
      }
      for (const [key, observed] of Object.entries(values)) {
        if (id === 'singing' && engine !== 'sinsy' && ['pitch', 'duration'].includes(key)) continue;
        if (controls[key].choices?.length === 1 || controls[key].min === controls[key].max && !controls[key].choices) continue;
        assert.ok(observed.size > 1, `${engine}/${key} must vary`);
      }
    }
  }
});

test('STK dice retains phoneme-relative resonators and fits articulation to each authored note', () => {
  const previous = voicePresetsForInput('singing').find(item => item.state.scene.engine === 'stk-voicform').state;
  previous.scene.input.phrase.notes[0].values.duration = .018;
  for (let seed = 1; seed <= 80; seed++) {
    const next = randomizeVoiceMethodState(previous, 'singing', rng(seed));
    for (const { input, values } of [next.scene, ...next.scene.input.phrase.notes]) {
      const base = defaultsFor('stk-voicform', input);
      assert.ok(values.noise <= (base.noise ? base.noise * 1.1 : .02));
      assert.ok(values.voiced >= base.voiced * .65 && values.voiced <= base.voiced * .95);
      assert.ok(values.vibrato <= .05 && values.jitter <= .015);
      assert.ok(values.vibratoRate >= 3.5 && values.vibratoRate <= 7);
      assert.ok(values.attack <= values.duration * .15 && values.decay <= values.duration * .3);
      assert.ok(values.release <= values.duration * .18);
      assert.ok(values.changeTime < values.duration - values.release);
      assert.ok(values.destinationPitch >= values.pitch * .75 && values.destinationPitch <= values.pitch * 1.25);
      if (values.destination !== 'hold') {
        const target = defaultsFor('stk-voicform', { phone: values.destination });
        assert.equal(target.voiced, base.voiced); assert.equal(target.noise, base.noise);
      }
      for (let n = 1; n <= 4; n++) {
        assert.ok(values[`formant${n}`] >= base[`formant${n}`] * .92 && values[`formant${n}`] <= base[`formant${n}`] * 1.08);
        assert.ok(values[`radius${n}`] >= 0 && values[`radius${n}`] <= .997);
        assert.ok(values[`gain${n}`] >= base[`gain${n}`] * .65 && values[`gain${n}`] <= base[`gain${n}`] * 1.15);
      }
    }
    assert.deepEqual(next.scene.input.phrase.notes.map(note => [note.values.pitch, note.values.duration]),
      previous.scene.input.phrase.notes.map(note => [note.values.pitch, note.values.duration]));
  }
  const manual = structuredClone(previous);
  Object.assign(manual.scene.values, { noise: 16, vibrato: 4, vibratoRate: 11025, gain1: 32 });
  assert.deepEqual(sanitizeVoiceInputState(manual, 'singing'), manual);
});
