import { validateScene } from '../voicesaurus/native-model.js';
import { isSingingEngine, tempoForScene } from '../voicesaurus/native-singing-model.js';
import { singingSceneFromPronunciations } from '../voicesaurus/singing-text.js';
import { sinsyScoreToMusicXml, validateSinsyMusicXml } from '../../families/speech/sinsy-score.js';

const clone = value => structuredClone(value);
const unitRandom = random => () => {
  const value = random();
  return Number.isFinite(value) ? Math.min(.999999999, Math.max(0, value)) : 0;
};
const pick = (values, random) => values[Math.floor(random() * values.length)];
const textPreset = (id, label, category, text, kana) => Object.freeze({ id, label, category, text, kana });

// Authored, one-syllable words and vowel-bearing mouth percussion. Explicit
// pronunciations keep short loops predictable without fetching a dictionary.
const pronunciations = new Map(Object.entries({
  we: 'W IY', can: 'K AE N', sing: 'S IH NG', all: 'AO L', night: 'N AY T', till: 'T IH L', the: 'DH AH', dawn: 'D AO N',
  let: 'L EH T', warm: 'W AO R M', rain: 'R EY N', fall: 'F AO L', on: 'AA N', ground: 'G R AW N D',
  feel: 'F IY L', beat: 'B IY T', and: 'AE N D', your: 'Y AO R', feet: 'F IY T', move: 'M UW V',
  sun: 'S AH N', moon: 'M UW N', stars: 'S T AA R Z', glow: 'G L OW', soft: 'S AO F T', light: 'L AY T', low: 'L OW', slow: 'S L OW',
  ba: 'B AA', da: 'D AA', ka: 'K AA', ta: 'T AA', pa: 'P AA', sha: 'SH AA', cha: 'CH AA',
  bum: 'B AH M', bop: 'B AA P', tik: 'T IH K', tok: 'T AA K', shoo: 'SH UW', za: 'Z AA',
  ah: 'AA', oh: 'OW', oo: 'UW', ee: 'IY', eh: 'EH', uh: 'AH',
}).map(([word, phones]) => [word, phones.split(' ')]));

const textPresets = Object.freeze([
  textPreset('night-song', 'Sing all night', 'words', 'we can sing all night till the dawn', 'よ る の そ ら に う た'),
  textPreset('warm-rain', 'Warm rain', 'words', 'let the warm rain fall on the ground', 'あ め の お と を き く'),
  textPreset('feel-the-beat', 'Feel the beat', 'words', 'feel the beat and let your feet move', 'て を た た い て う た'),
  textPreset('mouth-drums', 'Ba da ka ta', 'percussion', 'ba da ka ta ba da sha ta', 'ば だ か た ば だ しゃ た'),
  textPreset('lip-and-tongue', 'Bum tik bop', 'percussion', 'bum tik ka bop bum ta tik bop', 'ぶ ち か ぼ ぶ た ち ぼ'),
  textPreset('soft-shuffle', 'Sha ta shoo', 'percussion', 'sha ta shoo ta sha ka za ta', 'しゃ た しゅ た しゃ か ざ た'),
  textPreset('open-vowels', 'Ah oh oo', 'vowels', 'ah oh oo ee ah eh oh oo', 'あ お う い あ え お う'),
  textPreset('vowel-answer', 'Oo ah answer', 'vowels', 'oo oo ah eh ee eh ah oh', 'う う あ え い え あ お'),
]);

export const VOICE_LOOP_TEXT_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'words', label: 'Short words' }),
  Object.freeze({ id: 'percussion', label: 'Mouth percussion' }),
  Object.freeze({ id: 'vowels', label: 'Open vowels' }),
]);

export function voiceLoopTextPresets(engine) {
  if (!isSingingEngine(engine)) throw new TypeError('Choose a singing engine for loop text.');
  return textPresets.filter(preset => !engine.startsWith('csound-') || preset.category !== 'percussion')
    .map(({ kana, ...preset }) => ({ ...preset, text: engine === 'sinsy' ? kana : preset.text }));
}

const melody = (id, label, intervals, beats) => Object.freeze({ id, label, intervals: Object.freeze(intervals), beats: Object.freeze(beats) });
export const VOICE_LOOP_MELODY_PRESETS = Object.freeze([
  melody('easy-rise', 'Easy rise', [0, 2, 4, 5, 7, 5, 2, 0], [1, .5, .5, 1, 1, 1, 1, 2]),
  melody('minor-answer', 'Minor answer', [0, 3, 5, 7, 5, 3, 2, 0], [.5, .5, 1, 1, 1, .5, 1.5, 2]),
  melody('small-steps', 'Small steps', [0, 1, 2, 4, 2, 1, -1, 0], [1, 1, .5, .5, 1, .5, 1.5, 2]),
  melody('low-bounce', 'Low bounce', [0, -5, 0, 2, 0, -2, -5, 0], [.5, 1, .5, 1, .5, 1, 1, 2.5]),
  melody('held-answer', 'Held answer', [0, 4, 2, 0, 7, 5, 2, 0], [1.5, .5, 1, 1, .5, .5, 1, 2]),
]);

function prepare(previous) {
  if (previous?.version !== 1 || typeof previous.text !== 'string' || !isSingingEngine(previous.scene)) {
    throw new TypeError('Choose a singing voice before editing its loop.');
  }
  return { ...clone(previous), scene: validateScene(previous.scene) };
}

function musicalNotes(scene) {
  if (scene.engine === 'sinsy') return scene.input.notes;
  if (!scene.input.phrase) {
    const input = clone(scene.input); delete input.phrase; delete input.singingText;
    scene.input.phrase = { tempo: tempoForScene(scene), notes: [{ rest: false, input, values: clone(scene.values), voiceOverrides: [] }] };
  }
  return scene.input.phrase.notes;
}

// A syllable can have several native consonant/vowel fragments. Treat those
// as one melody slot until the performer assigns them different pitches.
function slotsFor(scene) {
  const score = scene.engine === 'sinsy', groups = [];
  for (const note of musicalNotes(scene)) {
    const key = note.textSlot ?? note.textSyllable;
    const pitch = score ? note.midi : note.values.pitch;
    const rest = Boolean(note.rest || score && note.midi === null);
    const last = groups.at(-1);
    if (!score && !rest && last && !last.rest && key !== undefined && key === last.key && pitch === last.pitch) last.notes.push(note);
    else groups.push({ key, pitch, rest, notes: [note] });
  }
  return groups;
}

function finish(next) {
  if (next.scene.engine === 'sinsy') validateSinsyMusicXml(sinsyScoreToMusicXml(next.scene.input));
  if (['singer', 'stk-voicform'].includes(next.scene.engine)) {
    const notes = next.scene.input.phrase?.notes ?? [];
    if (notes.some((note, index) => !note.rest && note.values.duration + (index === notes.length - 1 ? note.values.release : 0) > 30)) {
      throw new RangeError('Raise the tempo: this voice supports at most 30 seconds per note.');
    }
  }
  next.scene = validateScene(next.scene);
  return next;
}

function applyTokens(previous, tokens) {
  const next = prepare(previous), sounded = slotsFor(next.scene).filter(slot => !slot.rest).length;
  if (!sounded) throw new Error('Add a sung note before choosing loop text.');
  const text = Array.from({ length: sounded }, (_, index) => tokens[index % tokens.length]).join(' ');
  next.scene = singingSceneFromPronunciations(next.scene, text, { pronunciations }).scene;
  next.text = text;
  return finish(next);
}

/** Text changes preserve the existing melody, timing and rests. A selected
 * line repeats or ends at the available syllable slots; it never adds beats.
 */
export function applyVoiceLoopTextPreset(previous, id) {
  const preset = voiceLoopTextPresets(previous?.scene?.engine).find(item => item.id === id);
  if (!preset) throw new TypeError('Choose a known loop text preset.');
  return applyTokens(previous, preset.text.split(' '));
}

export function randomizeVoiceLoopText(previous, category = 'words', random = Math.random) {
  const options = voiceLoopTextPresets(previous?.scene?.engine).filter(item => item.category === category);
  if (!options.length) throw new TypeError('Choose words, mouth percussion or open vowels.');
  const r = unitRandom(random), kana = previous.scene.engine === 'sinsy';
  let tokens;
  if (category === 'words') {
    // Keep a readable short phrase instead of arbitrary word salad.
    tokens = pick(options, r).text.split(' ');
    if (!kana && r() < .5) tokens = tokens.map(word => word === 'night' ? pick(['night', 'dawn'], r) : word === 'warm' ? pick(['warm', 'soft'], r) : word);
  } else {
    const vocabulary = [...new Set(options.flatMap(item => item.text.split(' ')))];
    const motif = Array.from({ length: 4 }, () => pick(vocabulary, r));
    tokens = [...motif, motif[0], pick(vocabulary, r), motif[2], pick(vocabulary, r)];
  }
  return applyTokens(previous, tokens);
}

function rootMidi(scene, slots) {
  const pitch = slots.find(slot => !slot.rest)?.pitch;
  let midi = scene.engine === 'sinsy' ? pitch : pitch > 0 ? 69 + 12 * Math.log2(pitch / 440) : 60;
  if (!Number.isFinite(midi)) midi = 60;
  // Preserve fractional tuning when moving an extreme source by octaves.
  const low = scene.engine === 'sinsy' ? 60 : 52, high = low + 11;
  if (midi < low || midi > high) midi = low + ((midi - low) % 12 + 12) % 12;
  return scene.engine === 'sinsy' ? Math.round(midi) : midi;
}

function setPitches(scene, slots, intervals) {
  const root = rootMidi(scene, slots), score = scene.engine === 'sinsy';
  const minimum = Math.ceil((score ? 55 : 48) - root), maximum = Math.floor((score ? 79 : 76) - root);
  let index = 0;
  for (const slot of slots) {
    if (slot.rest) continue;
    // Bound whole-semitone offsets so the source's fractional tuning survives
    // even when an authored contour reaches the edge of the vocal range.
    const midi = root + Math.max(minimum, Math.min(maximum, intervals[index++ % intervals.length]));
    for (const note of slot.notes) {
      if (score) note.midi = Math.round(midi);
      else note.values.pitch = 440 * 2 ** ((midi - 69) / 12);
    }
  }
}

function rhythmBeats(count, weights) {
  // Fit an existing lyric line to two or four bars on an eighth-note grid.
  // Dense manually authored lines use sixteenths without extending the loop.
  const step = count > 32 ? .25 : .5;
  const total = count <= 12 ? 8 : 16, units = Math.round(total / step);
  const result = Array(count).fill(1), shares = Array.from({ length: count }, (_, index) => weights[index % weights.length]);
  for (let left = units - count; left > 0; left--) {
    let selected = 0;
    for (let index = 1; index < count; index++) if (shares[index] / result[index] > shares[selected] / result[selected]) selected = index;
    result[selected]++;
  }
  return result.map(value => value * step);
}

function setLengths(scene, slots, weights) {
  const tempo = tempoForScene(scene), score = scene.engine === 'sinsy';
  if (!(tempo > 0)) throw new RangeError('Set a positive tempo before choosing loop lengths.');
  const beats = rhythmBeats(slots.length, weights);
  slots.forEach((slot, index) => {
    if (score) { slot.notes[0].beats = beats[index]; return; }
    const total = slot.notes.reduce((sum, note) => sum + note.values.duration, 0), duration = beats[index] * 60 / tempo;
    let elapsed = 0;
    slot.notes.forEach((note, fragment) => {
      const seconds = fragment === slot.notes.length - 1 ? duration - elapsed : duration * (total > 0 ? note.values.duration / total : 1 / slot.notes.length);
      note.values.duration = seconds; elapsed += seconds;
    });
  });
}

/** Only authored pitches/lengths change: all text, note voices, synthesis
 * controls, tempo and rest placement remain the performer's current values.
 */
export function applyVoiceLoopMelodyPreset(previous, id) {
  const preset = VOICE_LOOP_MELODY_PRESETS.find(item => item.id === id);
  if (!preset) throw new TypeError('Choose a known loop melody preset.');
  const next = prepare(previous), slots = slotsFor(next.scene);
  setPitches(next.scene, slots, preset.intervals); setLengths(next.scene, slots, preset.beats);
  return finish(next);
}

export function randomizeVoiceLoopPitches(previous, random = Math.random) {
  const next = prepare(previous), slots = slotsFor(next.scene), r = unitRandom(random);
  const scale = pick([[0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 9, 10]], r);
  let degree = 0;
  const motif = Array.from({ length: 4 }, (_, index) => {
    if (index) degree = Math.max(0, Math.min(5, degree + pick([-1, 0, 1, 1, 2], r)));
    return scale[degree];
  });
  const intervals = [...motif, motif[0], motif[1], pick([scale[1], scale[4]], r), 0];
  setPitches(next.scene, slots, intervals);
  return finish(next);
}

export function randomizeVoiceLoopLengths(previous, random = Math.random) {
  const next = prepare(previous), slots = slotsFor(next.scene), r = unitRandom(random);
  const weights = Array.from({ length: 8 }, (_, index) => index === 7 ? pick([1.5, 2, 2.5], r) : pick([.5, .5, 1, 1, 1.5], r));
  setLengths(next.scene, slots, weights);
  return finish(next);
}
