import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScene, defaultsFor, methodsForVoiceMode } from '../src/instruments/voicesaurus/native-model.js';
import { createNativeMusicalRenderer } from '../src/families/speech/native-musical-notes.js';
import { createNativePhraseRenderer } from '../src/instruments/voicesaurus/native-phrase.js';
import { randomizeVoiceMethodState, randomizeVoiceInputState } from '../src/instruments/synthesis/voice-input-state.js';

const rng = seed => () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
function metrics(samples) {
  let sum = 0, peak = 0, limited = 0;
  for (const x of samples) {
    assert.ok(Number.isFinite(x)); sum += x * x; peak = Math.max(peak, Math.abs(x));
    if (Math.abs(x) > .89) limited++;
  }
  return { rms: Math.sqrt(sum / samples.length), peak, guardOccupancy: limited / samples.length };
}
function assertVoice(stats) {
  assert.ok(stats.rms > .0001, JSON.stringify(stats));
  assert.ok(stats.peak <= .900001, JSON.stringify(stats));
  // Old seed 4 pressed against the native .9 guard for 97% of its note.
  // This is a saturation regression check, not a judgement of vocal quality.
  assert.ok(stats.guardOccupancy < .1, JSON.stringify(stats));
}

test('STK parameter dice renders voiced vowels and intentional fricatives without sustained saturation', async t => {
  const render = await createNativeMusicalRenderer();
  for (const phone of ['aaa', 'eee', 'ooo', 'shh', 'sss']) {
    const scene = defaultScene('stk-voicform');
    scene.input.phone = phone; scene.values = defaultsFor(scene.engine, { phone });
    Object.assign(scene.values, { pitch: 220, duration: .65 });
    const previous = { version: 1, scene, text: 'A voiced vowel or an intentional fricative.' };
    const results = [];
    for (const seed of [4, 42, 38421]) {
      const next = randomizeVoiceMethodState(previous, 'singing', rng(seed));
      for (let repeat = 0; repeat < 3; repeat++) {
        const result = render(next.scene.engine, next.scene.input, next.scene.values);
        const stats = metrics(result.samples); assertVoice(stats); results.push(stats);
        assert.equal(result.sampleRate, 22050);
        assert.equal(result.samples.at(-1), 0);
      }
    }
    t.diagnostic(JSON.stringify({ phone, renders: results.length,
      rms: [Math.min(...results.map(x => x.rms)), Math.max(...results.map(x => x.rms))],
      maxGuardOccupancy: Math.max(...results.map(x => x.guardOccupancy)) }));
  }
});

test('whole-voice STK dice fits short lyric fragments and renders the complete native phrase', async t => {
  const render = createNativePhraseRenderer(), engines = Object.keys(methodsForVoiceMode('singing'));
  const previous = { version: 1, scene: defaultScene('stk-voicform'), text: 'Vowels and consonants.' };
  for (const seed of [4, 42, 38421]) {
    const random = rng(seed); let first = true;
    const next = randomizeVoiceInputState(previous, 'singing', () => {
      if (first) { first = false; return (engines.indexOf('stk-voicform') + .5) / engines.length; }
      return random();
    });
    assert.equal(next.scene.engine, 'stk-voicform');
    for (const { values } of next.scene.input.phrase.notes) {
      assert.ok(values.attack + values.decay + values.release < values.duration);
      assert.ok(values.changeTime < values.duration - values.release);
    }
    for (let repeat = 0; repeat < 3; repeat++) {
      const result = await render(next.scene.engine, next.scene.input.phrase);
      const stats = metrics(result.samples); assertVoice(stats);
      if (!repeat) t.diagnostic(JSON.stringify({ seed, text: next.text, seconds: result.duration, ...stats }));
    }
  }
});
