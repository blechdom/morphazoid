import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  VOICE_TECHNIQUE_TEXTS, VOICE_PLAY_TEXTS,
  voiceTextForEngine, voiceTextOptions, randomVoiceText,
} from '../src/instruments/synthesis/voice-texts.js';
import { NATIVE_METHODS, defaultScene, methodsForVoiceMode, presetsForVoiceMode } from '../src/instruments/voicesaurus/native-model.js';
import { singingSceneFromText } from '../src/instruments/voicesaurus/singing-text.js';
import { SINGING_PHRASE_BUDGET } from '../src/instruments/voicesaurus/native-singing-model.js';
import { parseSpellingPronunciations } from '../src/instruments/spelling-synthesizer/spelling-pronunciation.js';

test('every native voice route has its own short original technique sentence and primary sources', () => {
  assert.deepEqual(Object.keys(VOICE_TECHNIQUE_TEXTS).sort(), Object.keys(NATIVE_METHODS).sort());
  assert.equal(new Set(Object.values(VOICE_TECHNIQUE_TEXTS).map(entry => entry.text)).size, Object.keys(NATIVE_METHODS).length);
  for (const [engine, entry] of Object.entries(VOICE_TECHNIQUE_TEXTS)) {
    assert(entry.label.trim(), engine);
    assert(entry.text.length >= 30 && entry.text.length <= 140, engine);
    assert(entry.sources.length > 0, engine);
    for (const source of entry.sources) {
      assert(source.label.trim());
      assert.equal(new URL(source.url).protocol, 'https:');
    }
    assert.equal(voiceTextOptions(engine)[0].text, voiceTextForEngine(engine));
    assert(voiceTextOptions(engine)[0].id.startsWith('technique-'));
    assert(voiceTextOptions(engine)[0].label.startsWith('About '));
  }
});

test('playful inputs offer both nerdy sentences and short vowel-bearing percussive nonsense', () => {
  assert(VOICE_PLAY_TEXTS.length >= 12);
  assert.equal(new Set(VOICE_PLAY_TEXTS.map(entry => entry.id)).size, VOICE_PLAY_TEXTS.length);
  assert(VOICE_PLAY_TEXTS.some(entry => /Fourier/.test(entry.text)));
  assert(VOICE_PLAY_TEXTS.some(entry => /ppnpbpbpb/.test(entry.text)));
  assert(VOICE_PLAY_TEXTS.some(entry => /plaskdjflkjp/.test(entry.text)));
  for (const entry of VOICE_PLAY_TEXTS) {
    assert(entry.text.length <= 64, entry.id);
    assert(/[aeiou]/i.test(entry.text), entry.id);
    assert.match(entry.text, /^[a-z\s'.,!?;:-]+$/i);
  }
});

test('Sinsy uses native kana while retaining its English technical explanation', () => {
  assert.match(VOICE_TECHNIQUE_TEXTS.sinsy.text, /hidden Markov/);
  assert.equal(voiceTextForEngine('sinsy'), 'がくふからうたをつくる');
  for (const option of voiceTextOptions('sinsy')) assert.match(option.text, /^[\u3040-\u309f\s]+$/);
});

test('text selection is deterministic and bounded even at injected RNG extremes', () => {
  for (const engine of Object.keys(NATIVE_METHODS)) {
    const options = voiceTextOptions(engine);
    for (let index = 0; index < options.length; index++) {
      assert.equal(randomVoiceText(engine, () => (index + .5) / options.length), options[index].text);
    }
    assert.equal(randomVoiceText(engine, () => -1), options[0].text);
    assert.equal(randomVoiceText(engine, () => NaN), options[0].text);
    assert.equal(randomVoiceText(engine, () => Infinity), options[0].text);
    assert.equal(randomVoiceText(engine, () => 1), options.at(-1).text);
    assert.equal(randomVoiceText(engine, () => 20), options.at(-1).text);
  }
  for (const invalid of ['unknown', '__proto__', null, undefined]) {
    assert.throws(() => voiceTextForEngine(invalid), /known voice engine/);
    assert.throws(() => voiceTextOptions(invalid), /known voice engine/);
    assert.throws(() => randomVoiceText(invalid, () => 0), /known voice engine/);
  }
});

test('shared text data and nested sources cannot be mutated by a caller', () => {
  assert(Object.isFrozen(VOICE_TECHNIQUE_TEXTS));
  assert(Object.isFrozen(VOICE_PLAY_TEXTS));
  assert.throws(() => { VOICE_TECHNIQUE_TEXTS.singer.sources[0].url = 'changed'; }, TypeError);
  assert.throws(() => { voiceTextOptions('singer')[1].text = 'changed'; }, TypeError);
  assert.throws(() => { voiceTextOptions('sinsy').push({}); }, TypeError);
});

const singingEngines = Object.keys(methodsForVoiceMode('singing'));
const words = Object.values(VOICE_TECHNIQUE_TEXTS).flatMap(entry => entry.text.toLowerCase().match(/[a-z']+/g) ?? [])
  .concat(VOICE_PLAY_TEXTS.flatMap(entry => entry.text.toLowerCase().match(/[a-z']+/g) ?? []));
const dictionary = parseSpellingPronunciations(await readFile(new URL('../vendor/cmudict/cmudict-en-us.dict', import.meta.url), 'utf8'), words);

for (const engine of singingEngines) test(`${engine}: every audition text fits the native singing-note budget`, async () => {
  for (const option of voiceTextOptions(engine)) {
    for (const pronunciations of [dictionary, new Map()]) {
      const before = defaultScene(engine);
      const result = await singingSceneFromText(before, option.text, { pronunciations });
      assert(result.notes.length > 0 && result.notes.length <= SINGING_PHRASE_BUDGET.notes, option.id);
      assert(result.notes.some(note => !note.rest), option.id);
      assert.equal(result.scene.input.singingText, option.text);
      assert.deepEqual(before, defaultScene(engine));
    }
  }
});

test('every existing singing factory melody accepts every short text even without the dictionary', async () => {
  for (const preset of presetsForVoiceMode('singing')) {
    for (const option of voiceTextOptions(preset.snapshot.engine)) {
      const before = structuredClone(preset.snapshot);
      const result = await singingSceneFromText(preset.snapshot, option.text, { pronunciations: new Map() });
      assert(result.notes.length <= SINGING_PHRASE_BUDGET.notes, `${preset.id}: ${option.id}`);
      assert(result.notes.some(note => !note.rest), `${preset.id}: ${option.id}`);
      assert.deepEqual(preset.snapshot, before);
    }
  }
});
