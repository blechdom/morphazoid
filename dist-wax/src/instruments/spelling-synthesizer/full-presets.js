import { createPresetSchema } from '../../site/preset-schema.js';
import { SPELLING_ENGINES, SPELLING_PERSONALITIES } from './spelling-synthesizer.js';
// The user's text and readback cursor are performance material, never factory text.
export const schema=createPresetSchema({engine:{choices:Object.keys(SPELLING_ENGINES)},personality:{choices:Object.keys(SPELLING_PERSONALITIES)},rhythmAmount:{min:0,max:1},diphthongDelay:{min:0,max:320},pairGlides:{choices:[false,true]}});
const scene=(id,label,engine,personality,rhythmAmount,diphthongDelay,pairGlides)=>[id,label,{engine,personality,rhythmAmount,diphthongDelay,pairGlides}];
export const presets=schema.bank([
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
]);
export const randomize=schema.randomize;
