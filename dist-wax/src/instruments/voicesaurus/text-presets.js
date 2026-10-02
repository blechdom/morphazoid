import {singingSceneFromText} from './singing-text.js';
import {isSingingEngine} from './native-singing-model.js';

// Authored demonstration melodies, expressed relative to the current voice pitch.
// No input pitch is quantized. Semitone intervals here describe only these scores.
// Romaji entries are literal Sinsy lyric input, not English translations.
const note = (semitones, beats = 1) => ({ ratio: 2 ** (semitones / 12), beats });
const rest = (beats = .5) => ({ ratio: 1, beats, rest: true });
const phrase = (id, label, text, tempo, contour) => Object.freeze({
  id, label, text, tempo,
  contour: Object.freeze(contour.map(step => Object.freeze(step))),
});

export const ENGLISH_TEXT_PRESETS = Object.freeze([
  phrase('daisy', 'Daisy', 'daisy daisy give me your answer please', 108, [
    note(7, 1.5), note(4, .5), note(7, 1.5), note(4, .5),
    note(0), note(2), note(4), note(5, .5), note(2, .5), note(0, 2),
  ]),
  phrase('moon', 'To the moon', 'do you really want to go to the moon', 96, [
    note(0, .5), note(2, .5), note(3, .5), note(5, .5), note(3),
    note(2, .5), note(7), note(5, .5), note(7, .5), note(10, 2),
  ]),
  phrase('consonants', 'Consonant percussion', 'pbpbpbpbpb shshshththththt s s s pl pl pl pl zzz gggg ghesghzhzhgh', 116, [
    note(0), rest(.25), note(-3), rest(.25),
    note(0, .25), note(2, .25), note(0, .25), rest(.25),
    note(3, .25), note(2, .25), note(0, .25), note(-2, .25),
    note(5, .5), note(0, .5), note(-5, 1.5),
  ]),
  phrase('love', 'I love you', 'i love you', 76, [
    note(0), note(4), note(7, 3),
  ]),
  phrase('hello', 'Hello echoes', 'hello hello hello', 112, [
    note(0, .5), note(7), rest(.5),
    note(2, .5), note(9), rest(.5),
    note(4, .5), note(12, 2),
  ]),
  phrase('counting', 'Count to eight', 'one two three four five six seven eight', 132, [
    note(0), note(2), note(4), note(5), note(7), note(9),
    note(11, .5), note(11, .5), note(12, 2),
  ]),
  phrase('stars', 'Made of stars', 'we are made of stars', 82, [
    note(0), note(3, .5), note(7, 1.5), note(5, .5), note(0, 2.5),
  ]),
  phrase('daylight', 'Let the daylight in', 'open the door and let the daylight in', 104, [
    note(-5, .5), note(-2, .5), note(0, .5), note(4), rest(.5),
    note(2, .5), note(0, .5), note(2, .5), note(5), note(4, .5), note(0, 2),
  ]),
  phrase('robots', 'Robots together', 'all the little robots sing together', 144, [
    note(0, .5), note(0, .5), note(7, .5), note(7, .5),
    note(6, .5), note(6, .5), note(2),
    note(3, .5), note(2, .5), note(0, 1.5),
  ]),
  phrase('whisper', 'Silver rain', 'we whisper softly in the silver rain', 92, [
    note(0, .5), note(1, .5), note(3), note(1, .5), note(0, .5),
    rest(.5), note(-2, .5), note(0, .5), note(3), note(1, .5), note(-2, 2),
  ]),
  phrase('bubbles', 'Bubble beat', 'bounce the bubbles pop the beat', 152, [
    note(0, .5), note(7, .5), note(0, .25), note(3, .25), rest(.25),
    note(7, .5), note(10, .5), note(7, 1.5),
  ]),
  phrase('again', 'Start again', 'turn around and start again', 118, [
    note(0), note(2, .5), note(5, .5), note(4, .5),
    note(2, .5), note(-1, .5), note(0, 1.5),
  ]),
  phrase('forever', 'Nothing lasts forever', 'nothing lasts forever', 78, [
    note(7), note(5, .5), note(3), rest(.5), note(2), note(0, .5), note(-5, 2),
  ]),
  phrase('maybe', 'Yes no maybe', 'yes no maybe so', 126, [
    note(0, .5), rest(.5), note(6, .5), rest(.5),
    note(2, .5), note(1, .5), note(0, 2),
  ]),
  phrase('vowels', 'Open vowels', 'ah oh ooh ah oh', 72, [
    note(0, 2), note(3, 2), note(5, 2), note(1, 2), note(7, 3),
  ]),
]);

export const JAPANESE_TEXT_PRESETS = Object.freeze([
  phrase('jp-sakura', 'Sakura · sa ku ra', 'sakura sakura', 88, [
    note(0), note(2, .5), note(3, 1.5), rest(.5),
    note(0), note(2, .5), note(7, 2.5),
  ]),
  phrase('jp-vowels', 'A i u e o', 'a i u e o', 100, [
    note(0), note(2), note(4), note(5), note(7, 2),
  ]),
  phrase('jp-ai', 'Ai shite iru', 'ai shite iru', 80, [
    note(0), note(2, .5), note(4, .5), note(3), note(2, .5), note(0, 2),
  ]),
  phrase('jp-ohayou', 'Ohayou', 'ohayou', 120, [
    note(0, .5), note(4, .5), note(7), note(12, 2),
  ]),
  phrase('jp-konnichiwa', 'Konnichiwa', 'konnichiwa', 110, [
    note(0, .75), note(0, .25), note(2, .5), note(5, .5), note(4, 1.5),
  ]),
  phrase('jp-arigatou', 'Arigatou', 'arigatou', 104, [
    note(7, .5), note(5, .5), note(4), note(2, .5), note(0, 2),
  ]),
  phrase('jp-kirakira', 'Kirakira hikaru', 'kirakira hikaru', 124, [
    note(0, .5), note(7, .5), note(2, .5), note(9, .5),
    rest(.5), note(4), note(7, .5), note(12, 2),
  ]),
  phrase('jp-pa', 'Pa pi pu pe po', 'pa pi pu pe po', 132, [
    note(0, .5), note(2, .5), note(1, .5), note(4, .5), note(3, 1.5),
  ]),
]);

const NO_TEXT_PRESETS = Object.freeze([]);

/** The caller determines whether a direct-note engine exposes a text path. */
export function textPresetsForEngine(engine, { textCapable = true } = {}) {
  if (!textCapable) return NO_TEXT_PRESETS;
  return engine === 'sinsy' ? JAPANESE_TEXT_PRESETS : ENGLISH_TEXT_PRESETS;
}

/** A text preset owns its words, pitch contour and rhythm, while the current
 * voice owns synthesis settings. Conversion articulates each melodic slot.
 */
export async function singingSceneFromTextPreset(scene,preset,options={}) {
  if(!isSingingEngine(scene))throw new TypeError('Choose a singing engine for a note contour.');
  const next=structuredClone(scene),score=next.engine==='sinsy';
  if(!textPresetsForEngine(scene.engine).some(item=>item.id===preset.id))throw new TypeError('Choose a text preset for this voice input.');
  const first=score?scene.input.notes.find(note=>!note.rest&&note.midi!==null)?.midi:scene.values.pitch;
  const base=Number.isFinite(first)?first:score?60:220;
  // Sinsy has no global fundamental: anchor its first sounded note rather than
  // adding the contour's initial interval again on every preset selection.
  const initialInterval=score?Math.round(12*Math.log2(preset.contour.find(step=>!step.rest)?.ratio??1)):0;
  const input=structuredClone(next.input);delete input.phrase;delete input.singingText;
  const notes=preset.contour.map(step=>score
    ?{midi:step.rest?null:base+Math.round(12*Math.log2(step.ratio))-initialInterval,beats:step.beats,rest:!!step.rest,lyric:'あ'}
    :{rest:!!step.rest,input:structuredClone(input),values:{...next.values,pitch:base*step.ratio,duration:step.beats*60/preset.tempo},voiceOverrides:[]});
  if(score)next.input={...next.input,tempo:preset.tempo,notes};
  else next.input={...next.input,phrase:{...next.input.phrase,tempo:preset.tempo,notes}};
  return singingSceneFromText(next,preset.text,options);
}
