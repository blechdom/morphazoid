import { NATIVE_MUSICAL_ENGINES, nativeMusicalDefaults } from '../../families/speech/native-musical-controls.js';
import { CSOUND_NATIVE } from './csound-native.js';
import { SAMPLE_BANK_CONTROLS, validateSampleBankNote } from './sample-bank-model.js';
import { sinsyScoreToMusicXml } from '../../families/speech/sinsy-score.js';
import { validateVoiceOverrides, setNoteVoicePatch } from './voice-settings.js';

export const MUSICAL_SINGING_ENGINES = Object.freeze(['singer', 'stk-voicform', 'csound-fof', 'csound-vosim', 'sample-bank']);
export const SINGING_PHRASE_BUDGET = Object.freeze({ notes: 62, seconds: 120, frames: 12_000_000 });
export const DEFAULT_SINGING_TEMPO = 120;

const engineId = sceneOrEngine => typeof sceneOrEngine === 'string' ? sceneOrEngine : sceneOrEngine?.engine;
const musical = sceneOrEngine => MUSICAL_SINGING_ENGINES.includes(engineId(sceneOrEngine));
const controlsFor = engine => engine==='sample-bank'?SAMPLE_BANK_CONTROLS:NATIVE_MUSICAL_ENGINES[engine]?.controls ?? CSOUND_NATIVE[engine]?.controls;
const clone = value => structuredClone(value);
const finite = (value, label) => { if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`); return value; };

export function isSingingEngine(sceneOrEngine) {
  return engineId(sceneOrEngine) === 'sinsy' || musical(sceneOrEngine);
}

function requireSinging(scene) {
  if (!isSingingEngine(scene)) throw new TypeError('This engine has no singing timeline.');
}

export function tempoForScene(scene) {
  requireSinging(scene);
  return scene.engine === 'sinsy' ? scene.input.tempo ?? 100 : scene.input.phrase?.tempo ?? DEFAULT_SINGING_TEMPO;
}

export function singingNoteCount(scene) {
  requireSinging(scene);
  return scene.engine === 'sinsy' ? scene.input.notes.length : scene.input.phrase?.notes.length ?? 1;
}

function requireIndex(scene, index) {
  requireSinging(scene);
  if (!Number.isInteger(index) || index < 0 || index >= singingNoteCount(scene)) throw new RangeError('Select an existing singing note.');
}

/** Musical values/input are the actual authored objects, including legacy single notes.
 * Sinsy input is the actual score note; its synthesis values remain global.
 * Use setNoteRest rather than changing the wrapper's rest property for legacy notes.
 */
export function editableNote(scene, index = 0) {
  requireIndex(scene, index);
  if (scene.engine === 'sinsy') {
    const input = scene.input.notes[index];
    return { input, values: scene.values, rest: Boolean(input.rest || input.midi === null) };
  }
  return scene.input.phrase?.notes[index] ?? { input: scene.input, values: scene.values, rest: false };
}

/** Display projections never rewrite native zero, negative, or extreme pitch requests. */
export function singingNoteDescriptors(scene) {
  const tempo = tempoForScene(scene), score = scene.engine === 'sinsy';
  let startBeats = 0, startSeconds = 0;
  return Array.from({ length: singingNoteCount(scene) }, (_, index) => {
    const note = editableNote(scene, index);
    const pitch = score ? note.input.midi : note.values.pitch;
    const beats = score ? note.input.beats ?? 1 : note.values.duration * tempo / 60;
    const seconds = score ? tempo > 0 ? beats * 60 / tempo : null : note.values.duration;
    const midi = score ? pitch : pitch === 0 ? null : 69 + 12 * Math.log2(Math.abs(pitch) / 440);
    const descriptor = {
      index, pitch, pitchUnit: score ? 'MIDI' : 'Hz', midi,
      displayMidi: Number.isFinite(midi) ? midi : 60,
      pitchHz: score ? pitch === null ? null : 440 * 2 ** ((pitch - 69) / 12) : pitch,
      beats, seconds, startBeats, startSeconds, rest: Boolean(note.rest),
      phone: score ? null : note.input.phone ?? null,
      lyric: score ? note.input.lyric : null,
      staccato: score && Boolean(note.input.staccato),
      breath: score && Boolean(note.input.breath),
      input: note.input, values: note.values,
    };
    startBeats += beats;
    startSeconds = startSeconds === null || seconds === null ? null : startSeconds + seconds;
    return descriptor;
  });
}

function legacyInput(input) {
  const result = clone(input);
  delete result.phrase;
  return result;
}

function draftMusicalPhrase(scene) {
  if (!musical(scene)) throw new TypeError('This engine does not use native musical notes.');
  return scene.input.phrase ? clone(scene.input.phrase) : {
    tempo: DEFAULT_SINGING_TEMPO,
    notes: [{ rest: false, input: legacyInput(scene.input), values: clone(scene.values) }],
  };
}

/** Verify shape/types and scheduling resources; native setters own DSP value limits. */
export function validateMusicalPhrase(engine, phrase) {
  const controls = controlsFor(engine);
  if (!musical(engine) || !controls) throw new TypeError('This engine does not support musical phrases.');
  if (!phrase || !Array.isArray(phrase.notes) || phrase.notes.length < 1 || phrase.notes.length > SINGING_PHRASE_BUDGET.notes) {
    throw new RangeError(`A singing phrase supports 1–${SINGING_PHRASE_BUDGET.notes} notes within the rendering budget.`);
  }
  finite(phrase.tempo, 'Phrase tempo');
  for(const key of ['pitchPortamento','vowelPortamento'])if(phrase[key]!==undefined){
    finite(phrase[key],key);
    if(phrase[key]<0)throw new RangeError('A note transition time must be nonnegative.');
  }
  const rate = engine.startsWith('csound-') ? 24000 : 22050;
  const keys = Object.keys(controls);
  let cursor = 0, releaseEnd = 0, renderedFrames = 0;
  for (const [index, note] of phrase.notes.entries()) {
    if (!note || typeof note !== 'object' || !note.input || typeof note.input !== 'object' || !note.values || typeof note.values !== 'object') throw new TypeError(`Note ${index + 1} needs native input and values.`);
    if (typeof note.rest !== 'boolean') throw new TypeError(`Note ${index + 1} rest must be a boolean.`);
    validateVoiceOverrides(note,controls);
    if (Object.keys(note.values).length !== keys.length || keys.some(key => !Object.hasOwn(note.values, key))) throw new TypeError(`Note ${index + 1} needs all native parameters.`);
    for (const [key, rule] of Object.entries(controls)) {
      const value = note.values[key];
      if (rule.choices ? !rule.choices.includes(value) : !Number.isFinite(value)) throw new TypeError(`Invalid note ${index + 1} parameter: ${rule.label}.`);
    }
    if(engine==='sample-bank')validateSampleBankNote(note.input);
    const choices = NATIVE_MUSICAL_ENGINES[engine]?.input.choices;
    if (choices && !choices.includes(note.input.phone)) throw new TypeError(`Note ${index + 1} needs an original native shape.`);
    if (Object.hasOwn(note.input, 'phrase')) throw new TypeError('Musical notes cannot contain nested phrases.');
    const duration = note.values.duration;
    if (duration < 0) throw new RangeError('The phrase scheduler requires nonnegative note durations.');
    // Interior notes are capped at their slot, including any authored release.
    // Only the final note may extend the phrase beyond its gate/slot endpoint.
    const nativeLength = note.rest || index < phrase.notes.length - 1 ? duration : Math.max(0, duration + (note.values.release??0));
    releaseEnd = Math.max(releaseEnd, cursor + nativeLength);
    cursor += duration;
    if (!note.rest) renderedFrames += Math.ceil(nativeLength * rate) + 2;
  }
  const seconds = Math.max(cursor, releaseEnd), frames = Math.ceil(seconds * rate);
  if (!Number.isFinite(seconds) || seconds > SINGING_PHRASE_BUDGET.seconds) throw new RangeError(`The phrase exceeds the ${SINGING_PHRASE_BUDGET.seconds}-second playback budget.`);
  if (!Number.isSafeInteger(frames) || frames > SINGING_PHRASE_BUDGET.frames || !Number.isSafeInteger(renderedFrames) || renderedFrames > SINGING_PHRASE_BUDGET.frames) throw new RangeError('The phrase exceeds the PCM rendering memory budget.');
  return phrase;
}

function commitNotes(scene, edit) {
  requireSinging(scene);
  if (scene.engine === 'sinsy') {
    const input = clone(scene.input), selection = edit(input.notes);
    sinsyScoreToMusicXml(input);
    scene.input = input;
    return selection;
  }
  const phrase = draftMusicalPhrase(scene), selection = edit(phrase.notes);
  validateMusicalPhrase(scene.engine, phrase);
  scene.input.phrase = phrase;
  return selection;
}

export function setNotePitch(scene, index, value) {
  finite(value, 'Note pitch');
  const note = editableNote(scene, index);
  if (scene.engine === 'sinsy') note.input.midi = value;
  else note.values.pitch = value;
  return value;
}

/** Independent host trajectories between native notes, off unless requested. */
export function setSingingPortamento(scene, key, value) {
  if(!musical(scene)||!['pitchPortamento','vowelPortamento'].includes(key))throw new TypeError('This engine has no editable note transition.');
  finite(value,'Portamento time');
  if(value<0)throw new RangeError('A note transition time must be nonnegative.');
  const phrase=draftMusicalPhrase(scene);phrase[key]=value;
  validateMusicalPhrase(scene.engine,phrase);scene.input.phrase=phrase;
  return value;
}

export function setNoteBeats(scene, index, value) {
  finite(value, 'Note beats');
  const note = editableNote(scene, index);
  if (scene.engine === 'sinsy') note.input.beats = value;
  else {
    const tempo = tempoForScene(scene);
    if (tempo <= 0) throw new RangeError('A positive host tempo is needed to convert beats into native note seconds.');
    note.values.duration = finite(value * 60 / tempo, 'Native note duration');
  }
  return value;
}

/** Sinsy takes native kana/custom lyrics; Singer/STK take original table keys. */
export function setNoteSyllable(scene, index, value) {
  let note = editableNote(scene, index);
  if (scene.engine === 'sinsy') {
    if (typeof value !== 'string') throw new TypeError('The native singing lyric must be text.');
    note.input.lyric = value;
  } else {
    const spec = NATIVE_MUSICAL_ENGINES[scene.engine];
    if (!spec) throw new TypeError('This Csound opcode has no native syllable or phoneme table.');
    if (!spec.input.choices.includes(value)) throw new TypeError('Choose an original native shape.');
    const original = nativeMusicalDefaults(scene.engine, { phone: value });
    const patch={};
    for (const key of Object.keys(note.values)) {
      if (/^(radius\d|glottalReflection|lipReflection|frication|velum|formant\d|gain\d|voiced|noise|tilt)/.test(key)) patch[key] = original[key];
    }
    note=setNoteVoicePatch(scene,index,patch);note.input.phone=value;
  }
  return value;
}

export function setNoteRest(scene, index, rest) {
  requireIndex(scene, index);
  if (typeof rest !== 'boolean') throw new TypeError('Rest must be a boolean.');
  if (scene.engine === 'sinsy') {
    const note = scene.input.notes[index];
    note.rest = rest;
    if (!rest && note.midi === null) note.midi = 60;
  } else if (scene.input.phrase) scene.input.phrase.notes[index].rest = rest;
  else if (rest) commitNotes(scene, notes => { notes[0].rest = true; return 0; });
  return rest;
}

export function setNoteArticulation(scene, index, key, value) {
  requireIndex(scene, index);
  if (scene.engine !== 'sinsy' || !['staccato', 'breath'].includes(key) || typeof value !== 'boolean') throw new TypeError('Choose a native Sinsy articulation.');
  scene.input.notes[index][key] = value;
  return value;
}

export function setSingingTempo(scene, value) {
  finite(value, 'Tempo');
  requireSinging(scene);
  if (scene.engine === 'sinsy') scene.input.tempo = value;
  else {
    if (value <= 0) throw new RangeError('The host musical timeline needs a positive tempo to preserve note beats.');
    const phrase = draftMusicalPhrase(scene), previous = phrase.tempo;
    if (previous <= 0) throw new RangeError('The previous host tempo must be positive to preserve note beats.');
    for (const note of phrase.notes) note.values.duration = finite(note.values.duration * previous / value, 'Native note duration');
    phrase.tempo = value;
    validateMusicalPhrase(scene.engine, phrase);
    scene.input.phrase = phrase;
  }
  return value;
}

/** Add uses the selected sound at one beat; Duplicate preserves the entire note. */
export function addSingingNote(scene, index = singingNoteCount(scene) - 1, { rest = false } = {}) {
  requireIndex(scene, index);
  return commitNotes(scene, notes => {
    const selected = notes[index];
    const note = scene.engine === 'sinsy'
      ? { midi: selected.midi ?? 60, beats: 1, lyric: selected.lyric ?? 'ら', rest }
      : { ...clone(selected), rest, values: { ...clone(selected.values), duration: 60 / tempoForScene(scene) } };
    notes.splice(index + 1, 0, note);
    return index + 1;
  });
}

/** Insert on the time grid without losing a sound: split a containing slot and
 * ripple its remainder/later notes. Past the end, preserve the gap as a rest.
 * Editing happens on a clone so resource/native-score failures are atomic.
 */
export function insertSingingNoteAt(scene, beat, midi, { index = 0, beats = 1 } = {}) {
  requireIndex(scene, index);
  finite(beat, 'Insertion time'); finite(midi, 'Note pitch'); finite(beats, 'Note length');
  if (beat < 0 || beats <= 0) throw new RangeError('Insert at a nonnegative time with a positive note length.');
  const score = scene.engine === 'sinsy', tempo = tempoForScene(scene);
  if (!score && tempo <= 0) throw new RangeError('A positive tempo is needed to insert on the beat grid.');
  // Use ticks for Sinsy, native seconds for musical engines.
  const scale = score ? 480 : 60 / tempo;
  const units = value => score ? Math.round(value * scale) : value * scale;
  const start = units(beat), length = units(beats);
  if (length <= 0) throw new RangeError('A score note needs at least one native tick.');
  const source = clone(score ? scene.input.notes[index] : editableNote(scene, index));
  const duration = note => score ? Math.round((note.beats ?? 1) * 480) : note.values.duration;
  const resize = (note, value) => { if (score) note.beats = value / 480; else note.values.duration = value; return note; };
  const inserted = resize(clone(source), length);
  inserted.rest = false;
  if (score) { inserted.midi = midi; inserted.lyric ??= 'ら'; }
  else inserted.values.pitch = 440 * 2 ** ((midi - 69) / 12);
  return commitNotes(scene, notes => {
    let cursor = 0;
    for (let i = 0; i < notes.length; i++) {
      const end = cursor + duration(notes[i]);
      const tolerance = score ? 0 : 1e-9;
      if (start <= cursor + tolerance) { notes.splice(i, 0, inserted); return i; }
      if (start < end - tolerance) {
        const first = resize(clone(notes[i]), start - cursor);
        const last = resize(clone(notes[i]), end - start);
        notes.splice(i, 1, first, inserted, last);
        return i + 1;
      }
      cursor = end;
    }
    if (start > cursor + (score ? 0 : 1e-9)) {
      const rest = resize(clone(source), start - cursor);
      rest.rest = true;
      notes.push(rest);
    }
    notes.push(inserted);
    return notes.length - 1;
  });
}

export function duplicateSingingNote(scene, index = 0) {
  requireIndex(scene, index);
  return commitNotes(scene, notes => { notes.splice(index + 1, 0, clone(notes[index])); return index + 1; });
}

export function removeSingingNote(scene, index = 0) {
  requireIndex(scene, index);
  if (singingNoteCount(scene) === 1) return 0;
  return commitNotes(scene, notes => { notes.splice(index, 1); return Math.min(index, notes.length - 1); });
}

export function splitSingingNote(scene, index = 0) {
  requireIndex(scene, index);
  return commitNotes(scene, notes => {
    const first = notes[index], second = clone(first);
    if (scene.engine === 'sinsy') {
      const totalTicks = Math.round((first.beats ?? 1) * 480), firstTicks = Math.floor(totalTicks / 2);
      first.beats = firstTicks / 480;
      second.beats = (totalTicks - firstTicks) / 480;
    } else {
      first.values.duration /= 2;
      second.values.duration -= first.values.duration;
    }
    notes.splice(index + 1, 0, second);
    return index + 1;
  });
}

export function moveSingingNote(scene, index, destination) {
  requireIndex(scene, index);
  requireIndex(scene, destination);
  if (index === destination) return index;
  return commitNotes(scene, notes => { const [note] = notes.splice(index, 1); notes.splice(destination, 0, note); return destination; });
}

/** A one-note audition is a detached scene; playing it never rewrites the phrase. */
export function auditionScene(scene, index = 0) {
  const note = editableNote(scene, index);
  if (scene.engine === 'sinsy') return { ...clone(scene), input: { ...clone(scene.input), notes: [clone(note.input)] } };
  return { engine: scene.engine, values: clone(note.values), input: {...legacyInput(note.input),...(scene.engine==='sample-bank'?{source:scene.input.source,openBankId:scene.input.openBankId}:{})} };
}
