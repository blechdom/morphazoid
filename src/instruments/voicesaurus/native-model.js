import { NATIVE_TEXT_PRESETS } from '../../families/speech/native-text-presets.js';
import { NATIVE_TEXT_ENGINES } from '../../families/speech/native-text-controls.js';
import { NATIVE_RETRO_MODELS } from '../../families/speech/native-retro-model.js';
import { NATIVE_MUSICAL_ENGINES, nativeMusicalDefaults } from '../../families/speech/native-musical-controls.js';
import { CSOUND_NATIVE } from './csound-native.js';
import { VOICE_METHODS } from './methods.js';
import { SINSY_CONTROLS, sinsyScoreToMusicXml } from '../../families/speech/sinsy-score.js';
import { SINSY_PRESETS } from '../../families/speech/sinsy-presets.js';
import { FACTORY_ADJUSTMENTS } from './factory-adjustments.js';
import { isSingingEngine, validateMusicalPhrase } from './native-singing-model.js';

const built={
 ...Object.fromEntries(Object.entries(NATIVE_TEXT_ENGINES).map(([engine,spec])=>[engine,{...spec,mode:'text',defaultInput:{},presets:NATIVE_TEXT_PRESETS[engine]}])),
 ...Object.fromEntries(Object.entries(NATIVE_RETRO_MODELS).map(([engine,spec])=>[engine,{...spec,mode:engine==='vizsn'?'native-letters':'note',controls:{...spec.controls,...(spec.noteDuration?{durationMs:spec.noteDuration}:{})},presets:spec.presets.map(p=>({...p,values:{...p.values,...(p.input?.durationMs?{durationMs:p.input.durationMs}:{})}}))}])),
 ...Object.fromEntries(Object.entries(NATIVE_MUSICAL_ENGINES).map(([engine,spec])=>[engine,{...spec,mode:'note',name:VOICE_METHODS[engine].name,phones:spec.input.choices,phoneLabel:spec.input.label,defaultInput:{phone:spec.input.default},presets:spec.presets.map(p=>({...p,id:`${engine}-${p.id}`}))}])),
 ...Object.fromEntries(Object.entries(CSOUND_NATIVE).map(([engine,spec])=>[engine,{...spec,name:VOICE_METHODS[engine].name,defaultInput:{}}])),
 sinsy:{name:'Sinsy',family:'Statistical score singing',mode:'score',controls:SINSY_CONTROLS,defaultInput:structuredClone(SINSY_PRESETS[0].score),
   date:'2013 voice · 2015 release',source:'https://sinsy.sourceforge.net/',history:'Sinsy 0.92 uses its native Japanese MusicXML frontend and the NIT SONG070 F001 singing model (2013), credited to the Sinsy Working Group at Nagoya Institute of Technology.',
   presets:SINSY_PRESETS.map(p=>({...p,input:p.score})),
 },
};
export const NATIVE_METHODS=Object.freeze(Object.fromEntries(Object.entries(built).map(([engine,spec])=>[engine,{...VOICE_METHODS[engine]??VOICE_METHODS.diphone,...spec,
 ...(engine.startsWith('flite-kal')?{date:'2001 Flite release',history:'The actual Flite diphone voice and native text frontend. KAL and KAL16 are two sampling-rate versions of the same voice lineage.',source:'https://github.com/festvox/flite'}:{}),
}]).map(([engine,spec])=>[engine,{...spec,
 detail:spec.mode==='score'?'Japanese kana lyrics and a musical score drive Sinsy’s native singing frontend and HTS vocoder.':spec.mode==='text'?`${spec.name} synthesizes complete text with its native frontend and phrase prosody.`:spec.mode==='native-letters'?spec.inputDescription:engine==='singer'?'Perry Cook’s Singer vocal-tract model, using its original shapes, glottal tables and native note trajectories.':engine==='stk-voicform'?'STK’s original phoneme tables, voiced/noise excitation and four swept formants, played as musical notes.':engine==='mea8000'?spec.inputDescription:'Direct Csound opcode synthesis with independently editable formants and note controls.',
 history:engine==='singer'?'Cook’s 1989 ICMC paper documents the model lineage. This C++/WASM port follows the Snd-distributed Singer algorithm; host envelopes and experimental coefficient controls are identified separately.':engine==='stk-voicform'?'Cook and Scavone released STK in 1996. This is its VoicForm/SingWave implementation, with original phoneme data and additional accessible native controls.':engine==='gnuspeech'?'The Trillium lineage began in the 1990s. Gnuspeech’s tube-resonance model and native English frontend generate this complete phrase.':engine==='pico'?'Pico entered Android’s open-source tree in 2009. The US and UK voices are models of one native parametric engine.':engine==='hts'?'The integrated HTS SLT model and Flite frontend were released in 2016. HMM speech synthesis is older; this native sentence path retains the model’s duration and prosody prediction.':engine.startsWith('csound-')?(engine==='csound-fof'?'Rodet, Potard and Barrière described CHANT in 1984. This is Csound’s FOF opcode, not the original CHANT program or voice database.':'Kaegi and Tempelaars published VOSIM in 1978. This is Csound’s implementation of the pulse-group method.'):spec.history,
}]).map(([engine,spec])=>[engine,{...spec,year:Number(spec.date.match(/\d{4}/)[0])}]).sort((a,b)=>a[1].year-b[1].year||a[1].name.localeCompare(b[1].name))));
// These modes describe the browser's native input paths, not every historical
// capability of an engine. Never send score data through a text-only frontend.
export const VOICE_MODES=Object.freeze(['speaking','singing']);
export function voiceModeForEngine(engine) {
  if(!NATIVE_METHODS[engine])throw new TypeError('Unknown voice method.');
  return isSingingEngine(engine)?'singing':'speaking';
}
export function methodsForVoiceMode(mode) {
  if(!VOICE_MODES.includes(mode))throw new TypeError('Choose speaking or singing.');
  return Object.fromEntries(Object.entries(NATIVE_METHODS).filter(([engine])=>voiceModeForEngine(engine)===mode));
}
export function presetsForVoiceMode(mode) {
  const engines=methodsForVoiceMode(mode);
  return presets.filter(preset=>Object.hasOwn(engines,preset.snapshot.engine));
}
export const defaultsFor=(engine,input={})=>NATIVE_MUSICAL_ENGINES[engine]?nativeMusicalDefaults(engine,input):Object.fromEntries(Object.entries(NATIVE_METHODS[engine].controls).map(([key,rule])=>[key,rule.default]));
export function defaultScene(engine) {const spec=NATIVE_METHODS[engine];if(!spec)throw Error('Unknown voice method.');return {engine,values:defaultsFor(engine),input:structuredClone(spec.defaultInput??{})};}
export function validateScene(scene) {
  const spec=NATIVE_METHODS[scene?.engine];if(!spec||!scene.values||!scene.input)throw Error('Invalid voice scene.');
  if(Object.keys(scene.values).length!==Object.keys(spec.controls).length)throw Error('Incomplete native voice parameters.');
  for(const [key,rule] of Object.entries(spec.controls)) {
    const value=scene.values[key];
    if(rule.freeText?typeof value!=='string':rule.choices?!rule.choices.includes(value):!Number.isFinite(value))throw Error(`Invalid ${rule.label}.`);
  }
  if(spec.phones&&!spec.phones.includes(scene.input.phone))throw Error('Choose an original vocal shape.');
  if(spec.mode==='score')sinsyScoreToMusicXml(scene.input);
  if(Object.hasOwn(scene.input,'phrase'))validateMusicalPhrase(scene.engine,scene.input.phrase);
  return structuredClone(scene);
}
export const presets=Object.freeze(Object.entries(NATIVE_METHODS).flatMap(([engine,spec])=>spec.presets.map(preset=>{
  const adjustment=FACTORY_ADJUSTMENTS[preset.id]||{},input={...spec.defaultInput,...preset.input,...adjustment.input};
  return {id:preset.id,label:`${spec.name} · ${preset.label}`,snapshot:validateScene({engine,values:{...defaultsFor(engine,input),...preset.values,...adjustment.values},input:structuredClone(input)})};
})));
export function randomize(previous,random=Math.random,{mode}={}) {
  const r=()=>Math.min(.999999,Math.max(0,random()));
  const engines=Object.keys(mode===undefined?NATIVE_METHODS:methodsForVoiceMode(mode)),engine=engines[Math.floor(r()*engines.length)],scene=defaultScene(engine),spec=NATIVE_METHODS[engine];
  for(const [key,rule] of Object.entries(spec.controls)) {
    if(rule.choices)scene.values[key]=rule.choices[Math.floor(r()*rule.choices.length)];
    else {const raw=rule.min+(rule.max-rule.min)*r(),step=rule.step??.001;scene.values[key]=Math.max(rule.min,Math.min(rule.max,Number((rule.min+Math.round((raw-rule.min)/step)*step).toFixed(6))));}
  }
  if(engine==='gnuspeech') [scene.values.pulseFallMin,scene.values.pulseFallMax]=[scene.values.pulseFallMin,scene.values.pulseFallMax].sort((a,b)=>a-b);
  if(spec.phones?.length)scene.input.phone=spec.phones[Math.floor(r()*spec.phones.length)];
  // Dice chooses a playable starting point. These distributions never limit
  // manually entered values or the native engine's accepted domain.
  if('duration' in scene.values)scene.values.duration=.25+2.75*r();
  if(engine==='singer'){
    for(let n=1;n<=8;n++)scene.values[`radius${n}`]=.3+1.7*r();
    for(const key of ['fricationRadius1','fricationRadius2'])scene.values[key]=.2+.78*r();
    for(const key of ['glottalReflection','lipReflection'])scene.values[key]=-.85+1.7*r();
    scene.values.fricationGain=.3*r();scene.values.tractScale=.7+.5*r();
    if(scene.input.phone==='open')scene.values.duration=.01+.09*r();
  }
  if(engine==='stk-voicform')scene.values.formantScale=.5+.5*r();
  if(engine==='csound-vosim'){scene.values.decay=.05*r();scene.values.pulseFactor=.7+.6*r();}
  if(spec.mode==='score'){
    scene.input={tempo:60+Math.round(120*r()),notes:Array.from({length:3+Math.floor(6*r())},()=>({midi:48+Math.floor(37*r()),beats:[.25,.5,.75,1,1.5,2][Math.floor(6*r())],lyric:['あ','い','う','え','お','ら','な','し'][Math.floor(8*r())],staccato:r()<.25,breath:r()<.25,rest:r()<.1}))};
    scene.input.notes[0].rest=false;
  }
  return validateScene(scene);
}
