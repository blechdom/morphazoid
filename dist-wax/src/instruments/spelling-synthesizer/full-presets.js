import { SPELLING_NATIVE_ENGINES as EXTENDED_ENGINES, NATIVE_DEFAULTS, nativeSnapshot } from '../../families/speech/extended-engines.js';
import { createPresetSchema } from '../../site/preset-schema.js';
import { SPELLING_ENGINES, SPELLING_PERSONALITIES } from './spelling-synthesizer.js';
// The user's text and readback cursor are performance material, never factory text.
const baseSchema=createPresetSchema({...Object.fromEntries(Object.keys(NATIVE_DEFAULTS).map(key=>[key,{min:0,max:1}])),engine:{choices:Object.keys(SPELLING_ENGINES)},personality:{choices:Object.keys(SPELLING_PERSONALITIES)},rhythmAmount:{min:0,max:1},diphthongDelay:{min:0,max:320},pairGlides:{choices:[false,true]}});
// Additive migration: old five-field saved scenes remain valid; reject unknown fields.
export const schema=Object.freeze({...baseSchema,validate:value=>baseSchema.validate({...nativeSnapshot(value?.engine),...value})});
const scene=(id,label,engine,personality,rhythmAmount,diphthongDelay,pairGlides)=>[id,label,{...NATIVE_DEFAULTS,engine,personality,rhythmAmount,diphthongDelay,pairGlides}];
export const presets=schema.bank([
 ...Object.entries(EXTENDED_ENGINES).flatMap(([engine, voice]) => voice.examples.map(([label, parameters], index) => [`${engine}-${index+1}`, label, {...nativeSnapshot(engine,parameters),engine,personality:"clear",rhythmAmount:.35,diphthongDelay:120,pairGlides:true}])),
 scene('clear','Clear sample voice','diphone','clear',.72,180,true),
 scene('velvet','Velvet syllables','diphone','warm',.35,260,true),
 scene('whisper','Whispered consonants','diphone','whisper',.55,110,false),
 scene('reed','Reed storyteller','diphone','reed',.92,225,true),
 scene('creature','Creature alphabet','diphone','creature',.85,300,true),
 scene('tube','Pinkazoid speaks','tube','clear',.7,175,true),
 scene('rounded','Rounded tract','tube','warm',.22,310,true),
 scene('staccato','Pinched staccato','tube','reed',1,30,false),
 scene('alien','Uncanny tract','tube','creature',.88,240,true),
 scene('robot','Robot diction','vocoder','clear',.5,120,false),
 scene('hush','Electric hush','vocoder','whisper',.18,280,true),
 scene('relay','Fast reed relay','vocoder','reed',1,60,true),
 scene('deep','Deep machine vowels','vocoder','creature',.8,320,true),
 scene('dry','Dry little letters','diphone','clear',.08,0,false),
 scene('soft','Soft vocoder pairs','vocoder','warm',.4,220,true),
 // Retro spelling-toy character using our vocoder, not TI LPC emulation.
 scene('speak-spell','Speak & Spell-ish','vocoder','reed',0,0,false),
 scene('bell-labs','Bell Labs voice','bell','clear',.5,150,true),
 scene('bell-velvet','Velvet waveguide','bell','warm',.35,230,true),
 scene('bell-reed','Electric tube letters','bell','reed',.9,55,false),
 scene('lpc-spelling','Speak & Spell LPC','lpc','clear',.2,0,false),
 scene('lpc-soft','Soft LPC storyteller','lpc','warm',.45,180,true),
 scene('lpc-creature','Little LPC monster','lpc','creature',.85,270,true),
 scene('klatt-clear','Klatt formants','espeak-klatt','clear',.35,120,true),
 scene('klatt-soft','Soft Klatt syllables','espeak-klatt','warm',.2,240,true),
 scene('klatt-pulses','Klatt letter pulses','espeak-klatt','reed',.8,40,false),
 ...['slt','awb','rms'].flatMap(voice => [
   scene(`flite-${voice}`, `Flite ${voice.toUpperCase()}`, `flite-${voice}`, 'clear', .35, 120, true),
   scene(`flite-${voice}-soft`, `Soft ${voice.toUpperCase()} syllables`, `flite-${voice}`, 'warm', .2, 240, true),
   scene(`flite-${voice}-pulses`, `${voice.toUpperCase()} letter pulses`, `flite-${voice}`, 'reed', .8, 40, false),
 ]),
 scene('espeak-clear','eSpeak formants','espeak','clear',.35,120,true),
 scene('espeak-soft','Soft eSpeak syllables','espeak','warm',.2,240,true),
 scene('espeak-staccato','eSpeak letter pulses','espeak','reed',.8,40,false),
]);
export const randomize=schema.randomize;
