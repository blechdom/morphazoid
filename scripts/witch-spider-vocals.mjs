// Offline-only wordless Spider cries. Raw eSpeak phones bypass word spelling;
// each native result must contain exactly its requested phone before assembly.
import { spiderSpeechRequest, SPIDER_SPEECH_PRESETS } from '../src/instruments/spider-synth/spider-synth-speech.js';
import { SpiderSpeechPlayer } from '../src/instruments/spider-synth/spider-synth-speech-player.js';
import { renderNativeText } from '../src/families/speech/native-text.js';

const PHONES = Object.freeze({ 'A:': 'ɑː', 'u:': 'uː', x: 'x', s: 's' });
const gesture = (kind, phone, at, seconds, pitch, gain, glide = 0, tremolo = 0) =>
  ({ kind, phone, at, seconds, pitch, gain, glide, tremolo });
const RECIPES = [
  { label: 'Croak and tearing shrieks', preset: 'silk-buzz', gestures: [
    gesture('groan', 'u:', .025, .46, 18, .9, -.3, 17),
    gesture('rasp', 'x', .16, .17, 35, .45),
    gesture('scream', 'A:', .37, .36, 90, 1, .45, 29),
    gesture('rasp', 'x', .63, .12, 35, .7),
    gesture('scream', 'A:', .76, .28, 80, .9, -.3, 37),
    gesture('hiss', 's', .96, .13, 35, .45),
    gesture('moan', 'u:', 1.02, .55, 38, .85, -.35, 13),
    gesture('scream', 'A:', 1.39, .27, 85, .8, .4, 32),
    gesture('moan', 'u:', 1.58, .75, 20, .7, -.5, 11),
    gesture('rattle', 'x', 1.69, .17, 30, .5),
    gesture('rattle', 'x', 1.96, .12, 20, .4),
    gesture('hiss', 's', 2.14, .19, 20, .3),
  ] },
  { label: 'Fang chatter and gasping howls', preset: 'fang-chatter', gestures: [
    gesture('scream', 'A:', .025, .29, 94, .9, -.4, 43),
    gesture('rasp', 'x', .22, .10, 40, .55),
    gesture('groan', 'u:', .34, .48, 12, .95, .3, 21),
    gesture('rasp', 'x', .48, .09, 30, .6),
    gesture('rasp', 'x', .61, .08, 30, .65),
    gesture('scream', 'A:', .78, .44, 75, .9, .5, 31),
    gesture('hiss', 's', 1.10, .16, 30, .5),
    gesture('groan', 'u:', 1.24, .30, 26, .85, -.4, 27),
    gesture('scream', 'A:', 1.48, .25, 94, .8, -.35, 39),
    gesture('moan', 'u:', 1.69, .64, 12, .8, -.5, 9),
    gesture('rattle', 'x', 1.80, .13, 30, .5),
    gesture('rattle', 'x', 2.01, .11, 30, .4),
    gesture('hiss', 's', 2.18, .15, 20, .3),
  ] },
  { label: 'Cellar moans and breaking screams', preset: 'cellar-rasp', gestures: [
    gesture('groan', 'u:', .025, .57, 8, 1, -.35, 19),
    gesture('rasp', 'x', .18, .21, 30, .5),
    gesture('scream', 'A:', .46, .31, 80, .95, .5, 33),
    gesture('scream', 'A:', .76, .24, 94, .9, -.4, 41),
    gesture('hiss', 's', .91, .12, 30, .55),
    gesture('moan', 'u:', 1.02, .39, 30, .9, -.3, 15),
    gesture('rasp', 'x', 1.22, .13, 30, .5),
    gesture('scream', 'A:', 1.36, .37, 72, .8, .35, 35),
    gesture('moan', 'u:', 1.65, .68, 8, .75, -.5, 8),
    gesture('rattle', 'x', 1.76, .19, 30, .5),
    gesture('rattle', 'x', 2.03, .10, 30, .4),
    gesture('hiss', 's', 2.16, .17, 20, .3),
  ] },
];

export async function renderWitchSpiderVocal(variant, rate = 22050, seconds = 2.4) {
  const recipe = RECIPES[variant];
  if (!recipe || rate !== 22050 || seconds !== 2.4) throw new Error('Unsupported Spider clip recipe');
  const preset = SPIDER_SPEECH_PRESETS.find(item => item.id === recipe.preset);
  const sources = new Map(), phoneSources = [], data = new Float32Array(Math.round(rate * seconds));
  for (const part of recipe.gestures) {
    const key = `${part.phone}/${part.pitch}`;
    if (!sources.has(key)) {
      const input = `[[${part.phone}]]`;
      const request = spiderSpeechRequest(input, { preset: recipe.preset, rate: 100, pitch: part.pitch, range: 0 });
      const native = await renderNativeText(request.engine, request.text, request.values);
      const phones = native.events.filter(event => event.type === 'phoneme' && event.phone?.trim()).map(event => event.phone.trim());
      if (phones.length !== 1 || phones[0].replace(/[ˈˌ]/g, '') !== PHONES[part.phone]) {
        throw new Error(`Spider ${input}: expected one isolated phone, received ${JSON.stringify(phones)}`);
      }
      let first = 0, last = native.samples.length - 1;
      while (first < last && Math.abs(native.samples[first]) < .00015) first++;
      while (last > first && Math.abs(native.samples[last]) < .00015) last--;
      const samples = native.samples.slice(first, last + 1);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value ** 2, 0) / samples.length);
      if (!(rms > .00001)) throw new Error(`Silent Spider phone ${input}`);
      // Match isolated breath and voiced atoms before arranging the cry.
      for (let i = 0; i < samples.length; i++) samples[i] = .6 * Math.tanh(samples[i] * (.18 / rms) / .6);
      sources.set(key, samples);
      phoneSources.push({ input, phone: phones[0], pitch: part.pitch, engine: request.engine });
    }
    const samples = sources.get(key), frames = Math.round(part.seconds * rate), start = Math.round(part.at * rate);
    for (let i = 0; i < frames && start + i < data.length; i++) {
      const p = i / (frames - 1);
      // A monotonic curved read bends the entire phone without loop seams.
      const position = (p + part.glide * (p * p - p)) * (samples.length - 1);
      const index = Math.floor(position), mix = position - index;
      const value = samples[index] * (1 - mix) + (samples[index + 1] ?? samples[index]) * mix;
      const edge = Math.min(1, i / (rate * .012), (frames - 1 - i) / (rate * .045));
      const flutter = part.tremolo ? .78 + .22 * Math.sin(2 * Math.PI * part.tremolo * i / rate) : 1;
      data[start + i] += value * part.gain * edge * flutter;
    }
  }
  // The moan and ragged breaths lose strength after impact, ending in silence.
  for (let i = 0; i < data.length; i++) {
    const dying = Math.max(0, Math.min(1, (2.34 - i / rate) / .8));
    data[i] *= dying ** .8;
  }
  const player = new SpiderSpeechPlayer(rate);
  if (!player.speak(data, rate, preset.gain)) throw new Error('Spider player rejected wordless voice');
  const played = Float32Array.from(data, () => player.sample());
  return {
    data: played, events: recipe.gestures.length, label: recipe.label,
    source: `Spider Synth / ${preset.label} (${preset.variant}), bundled Voicesaurus ${preset.engine} isolated phones + native SpiderSpeechPlayer / wordless groans, screams, moans and fricative death rattle`,
    details: { vocalizationKind: 'nonverbal', speechPreset: recipe.preset, phoneSources, gestures: recipe.gestures },
  };
}
