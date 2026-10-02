import {
  SPELLING_PRONUNCIATION_DICTIONARY_URL, parseSpellingPronunciations,
  fallbackSpellingPronunciation, spellingPronunciationTokens, isSpellingPronunciationVowel,
} from '../spelling-synthesizer/spelling-pronunciation.js';
import {syllabifyVocalzoidPhones} from '../vocalzoid/vocalzoid.js';
import {STK_PHONE_DATA} from '../../../vendor/musical-voices/native-data.js';
import {nativeMusicalDefaults} from '../../families/speech/native-musical-controls.js';
import {validateScene} from './native-model.js';
import {isSingingEngine,tempoForScene,SINGING_PHRASE_BUDGET} from './native-singing-model.js';
import {sinsyScoreToMusicXml,validateSinsyMusicXml} from '../../families/speech/sinsy-score.js';
import {noteVoiceOverrideKeys} from './voice-settings.js';

// ARPAbet -> original Singer / STK table keys. These are host articulatory
// mappings, not native text frontends or recorded diphone libraries.
const vowels={
 AA:['aah','ahh'],AE:['aa','aaa'],AH:['uhh','uhh'],AO:['aww','aww'],
 EH:['ehh','ehh'],ER:['rrr','rrr'],IH:['ihh','ihh'],IY:['eee','eee'],
 UH:['uuu','uuu'],UW:['ooo','ooo'],
};
const diphthongs={AW:['AA','UW'],AY:['AA','IY'],EY:['EH','IY'],OW:['AO','UW'],OY:['AO','IY']};
const consonants={
 B:['bbb','bbb'],CH:['chh','jjj'],D:['ddd','ddd'],DH:['dhh','thz'],
 F:['fff','fff'],G:['ggg','ggg'],HH:['hhh','hah'],JH:['jjj','jjj'],
 K:['kk+','ggg'],L:['lll','lll'],M:['mmm','mmm'],N:['nnn','nnn'],NG:['nng','nng'],
 P:['pp+','bbb'],R:['rrr','rrr'],S:['sss','sss'],SH:['shh','shh'],
 T:['tt+','ddd'],TH:['thh','thh'],V:['vvv','vvv'],W:['uuu','ooo'],Y:['eee','eee'],Z:['zzz','zzz'],ZH:['shh','zhh'],
};
export const SINGING_TEXT_PHONE_MAP=Object.freeze({
 vowels:Object.freeze(vowels),diphthongs:Object.freeze(diphthongs),consonants:Object.freeze(consonants),
});
const dictionaryCache=new WeakMap();
const clone=value=>structuredClone(value);
const clearInput=input=>{const copy=clone(input);delete copy.phrase;delete copy.singingText;return copy;};
const key=word=>word.toLowerCase().replaceAll('’',"'");
const unique=values=>[...new Set(values)];
const sinsySustainLyric=phone=>({a:'あ',i:'い',u:'う',e:'え',o:'お',N:'ん'}[phone]??'ん');

async function dictionaryFor(text,fetcher) {
 if(typeof fetcher!=='function')throw new Error('No pronunciation dictionary loader is available.');
 let pending=dictionaryCache.get(fetcher);
 if(!pending){
  pending=Promise.resolve().then(()=>fetcher(SPELLING_PRONUNCIATION_DICTIONARY_URL)).then(async response=>{
   if(!response||response.ok===false||typeof response.text!=='function')throw new Error('The pronunciation dictionary could not be loaded.');
   return response.text();
  }).catch(error=>{dictionaryCache.delete(fetcher);throw error;});
  dictionaryCache.set(fetcher,pending);
 }
 const words=spellingPronunciationTokens(text).filter(token=>token.type==='word').map(token=>key(token.source));
 return parseSpellingPronunciations(await pending,words);
}

/** Pure pronunciation grouping; dictionary misses remain visible to the caller. */
export function englishSingingSyllables(text,pronunciations=new Map()) {
 if(/[^a-z\s'’.,!?;:\-–—()]/i.test(text))throw new Error('Use English letters; write numbers as words. Use kana or romaji with Sinsy.');
 const groups=[],fallbackWords=[];
 for(const token of spellingPronunciationTokens(text,pronunciations)){
  if(token.type!=='word')continue;
  const word=key(token.source),found=pronunciations.get(word);
  if(!found)fallbackWords.push(token.source);
  const phones=found??fallbackSpellingPronunciation(word);
  for(const syllable of syllabifyVocalzoidPhones(phones))groups.push({word:token.source,phones:syllable,source:found?'dictionary':'rules'});
 }
 return {groups,fallbackWords:unique(fallbackWords)};
}

// Regroup previously generated adjacent phones only while their pitch remains
// shared. Editing a phone to a different pitch makes it a new melody slot.
function melodySlots(scene) {
 if(scene.engine==='sinsy')return scene.input.notes.map(note=>clone(note));
 const source=scene.input.phrase?.notes??[{rest:false,input:clearInput(scene.input),values:clone(scene.values)}],slots=[];
 for(const [index,sourceNote]of source.entries()){
  const note={...sourceNote,voiceOverrides:noteVoiceOverrideKeys(scene,index)};
  const last=slots.at(-1);
  if(!note.rest&&last&&!last.rest&&(note.textSlot??note.textSyllable)!==undefined&&(note.textSlot??note.textSyllable)===(last.textSlot??last.textSyllable)&&note.values.pitch===last.values.pitch){
   const duration=last.values.duration+note.values.duration;
   if(note.textVowel&&!last.textVowel){last.values=clone(note.values);last.input=clearInput(note.input);last.voiceOverrides=clone(note.voiceOverrides);last.textVowel=true;}
   last.values.duration=duration;
  }else slots.push(clone(note));
 }
 return slots;
}
function weight(phone){return isSpellingPronunciationVowel(phone)?1:/^(P|B|T|D|K|G|CH|JH)$/.test(phone)?.12:/^(M|N|NG|L|R|W|Y)$/.test(phone)?.24:.18;}

function originalShape(engine,template,phone,duration){
 const values=clone(template.values),original=nativeMusicalDefaults(engine,{phone});
 for(const name of Object.keys(values))if(/^(radius\d|glottalReflection|lipReflection|frication|velum|formant\d|gain\d|voiced|noise|tilt)/.test(name))values[name]=original[name];
 Object.assign(values,{duration,destination:'hold',pitchSweep:false});
 if(engine==='singer')values.customShape=false;else values.customFormants=false;
 const owned=Object.keys(values).filter(name=>/^(radius\d|glottalReflection|lipReflection|frication|velum|formant\d|gain\d|voiced|noise|tilt|customShape|customFormants|destination|changeTime|pitchSweep)/.test(name));
 return {rest:false,input:{...clearInput(template.input),phone},values,voiceOverrides:unique([...(template.voiceOverrides??[]),...owned])};
}
function csoundVowel(template,phone,duration,engine){
 const values={...clone(template.values),duration},original=STK_PHONE_DATA[vowels[phone][1]],base=original.formants[0][2];
 // FOF grain bandwidth is not interchangeable with an STK pole radius. Keep
 // the musician's grain/bandwidth settings and map only centers/relative gains.
 original.formants.slice(0,3).forEach(([frequency,_radius,gain],i)=>{
  values[`formant${i+1}`]=frequency;values[`gain${i+1}`]=10**((gain-base)/20);
 });
 return {rest:false,input:clearInput(template.input),values,voiceOverrides:unique([...(template.voiceOverrides??[]),'formant1','formant2','formant3','gain1','gain2','gain3'])};
}
function convertGroup(engine,group,template,index,omitted,approximated){
 const csound=engine.startsWith('csound-'),position=engine==='singer'?0:1;
 const fragments=[];
 for(const phone of group.phones){
  const pair=diphthongs[phone];
  if(csound){
   if(pair)pair.forEach((part,i)=>fragments.push({phone:part,sourcePhone:phone,weight:i?.3:.7,vowel:true}));
   else if(vowels[phone])fragments.push({phone,sourcePhone:phone,weight:1,vowel:true});
   else omitted.push(phone);
  }else if(vowels[phone]||pair||consonants[phone])fragments.push({phone,sourcePhone:phone,weight:weight(phone),vowel:isSpellingPronunciationVowel(phone)});
  else throw new Error(`No native singing mapping exists for ${phone}.`);
 }
 if(!fragments.length)return [];
 const total=fragments.reduce((sum,part)=>sum+part.weight,0),duration=template.values.duration;
 if(!Number.isFinite(duration)||duration<=0)throw new Error('Text conversion needs positive melody-note durations.');
 let elapsed=0;
 return fragments.map((part,fragmentIndex)=>{
  const seconds=fragmentIndex===fragments.length-1?duration-elapsed:duration*part.weight/total;elapsed+=seconds;
  let note;
  if(csound)note=csoundVowel(template,part.phone,seconds,engine);
  else{
   const pair=diphthongs[part.phone],shape=(vowels[pair?.[0]??part.phone]??consonants[part.phone])[position];
   note=originalShape(engine,template,shape,seconds);
   if(pair){
    note.values.destination=vowels[pair[1]][position];
    const gate=note.values.release>=0&&note.values.release<seconds?seconds-note.values.release:seconds;
    note.values.changeTime=gate*.65;
   }
   if(['W','Y'].includes(part.phone)||engine==='singer'&&part.phone==='ZH')approximated.push(part.phone);
   if(engine==='singer'&&part.phone==='ZH')note.values.voiced=.8;
   if(engine==='stk-voicform'&&['P','T','K','CH'].includes(part.phone)){
    // STK has no direct unvoiced stop/CH table: drive its corresponding voiced
    // table with noise. Keep this declared approximation in the returned report.
    note.values.voiced=0;note.values.noise=.7;approximated.push(part.phone);
   }
  }
  return {...note,textSyllable:index,textPhone:part.sourcePhone,textWord:group.word,textVowel:part.vowel};
 });
}

/**
 * Host text preprocessing into editable native notes. Never arms Audio, renders
 * speech, modifies its input scene, or claims a native text frontend for a synth.
 */
export async function singingSceneFromText(scene,text,{fetcher=globalThis.fetch,pronunciations}={}) {
 if(!isSingingEngine(scene))throw new Error('Choose a singing engine before converting text.');
 if(typeof text!=='string'||!text.trim())throw new Error('Enter some lyrics first.');
 if(text.length>1000)throw new Error('Use at most 1000 characters for one singing phrase.');
 const next=clone(scene),warnings=[],omitted=[],approximated=[];
 let groups;
 if(next.engine==='sinsy'){
  const {tokenizeSinsyLyrics}=await import('../../families/speech/sinsy-lyrics.js');
  groups=tokenizeSinsyLyrics(text).map(token=>({...token,word:token.source??token.lyric,phones:token.phonemes.split(/\s+/)}));
 }
 else{
  let dictionary=pronunciations;
  if(dictionary===undefined){try{dictionary=await dictionaryFor(text,fetcher);}catch{dictionary=new Map();warnings.push('Dictionary unavailable; pronunciation uses letter rules.');}}
  if(!(dictionary instanceof Map))throw new TypeError('Pronunciations must be a word-to-ARPAbet Map.');
  const parsed=englishSingingSyllables(text,dictionary);groups=parsed.groups;
  if(parsed.fallbackWords.length)warnings.push(`Rule pronunciation: ${parsed.fallbackWords.join(', ')}.`);
  if(next.engine.startsWith('csound-')){
   for(const group of groups)omitted.push(...group.phones.filter(phone=>!isSpellingPronunciationVowel(phone)));
   groups=groups.filter(group=>group.phones.some(isSpellingPronunciationVowel));
  }
 }
 if(!groups.length)throw new Error(next.engine.startsWith('csound-')?'This text has no vowels for the selected vowel-only engine.':'No singable lyrics were found.');
 const slots=melodySlots(next),score=next.engine==='sinsy',output=[];
 const sounded=slots.filter(note=>!note.rest&&(!score||note.midi!==null));
 const fallback=sounded.at(-1)??(score?{midi:60,beats:1,lyric:'ら',rest:false}:{rest:false,input:clearInput(next.input),values:clone(next.values)});
 let groupIndex=0,reused=0,melismaNotes=0;
 const lastGroup=groups.at(-1);
 let held;
 if(score){
  const vowel=groups.flatMap(group=>group.phones).findLast(phone=>/^[aiueoN]$/.test(phone));
  held={...lastGroup,lyric:sinsySustainLyric(vowel),phones:[vowel??'N'],kind:'melisma'};
 }else{
  const vowel=groups.flatMap(group=>group.phones).findLast(isSpellingPronunciationVowel);
  held={...lastGroup,phones:[diphthongs[vowel]?.at(-1)??vowel??'AH']};
  if(!vowel&&sounded.length>groups.length)warnings.push('No vowel was found; remaining melody notes sustain AH.');
 }
 const make=(template,group,index,slotIndex,melisma=false)=>{
  // Sinsy resets its Japanese lyric context at rests. An authored ー still
  // carries a vowel, but needs that explicit kana when the melody re-enters.
  const previous=output.at(-1);
  const lyric=score&&group.kind==='long-vowel'&&(!previous||previous.rest||previous.midi===null)?sinsySustainLyric(group.phones.at(-1)):group.lyric;
  const notes=score?[{...clone(template),rest:false,midi:template.midi??60,lyric}]:next.engine==='sample-bank'?[{...clone(template),rest:false,input:{lyric:group.word,phones:[...group.phones],alias:''},textSyllable:index,textVowel:true}]:convertGroup(next.engine,group,template,index,omitted,approximated);
  return notes.map(note=>({...note,textSlot:slotIndex,textMelisma:melisma}));
 };
 for(const [slotIndex,slot]of slots.entries()){
  if(slot.rest||score&&slot.midi===null){output.push(clone(slot));continue;}
  if(groupIndex>=groups.length){output.push(...make(slot,held,groups.length-1,slotIndex,true));melismaNotes++;continue;}
  output.push(...make(slot,groups[groupIndex],groupIndex,slotIndex));groupIndex++;reused++;
 }
 let appended=0;
 while(groupIndex<groups.length){
  const template=clone(fallback);
  if(score)template.beats=1;
  else{
   const tempo=tempoForScene(next);if(!(tempo>0))throw new Error('A positive tempo is needed to append lyric notes.');
   template.values.duration=60/tempo;
  }
  output.push(...make(template,groups[groupIndex],groupIndex,slots.length+appended));groupIndex++;appended++;
 }
 if(output.length>SINGING_PHRASE_BUDGET.notes)throw new Error(`These lyrics need ${output.length} notes; shorten the text to fit the ${SINGING_PHRASE_BUDGET.notes}-note phrase budget.`);
 if(score)next.input={...next.input,notes:output,singingText:text};
 else next.input={...next.input,singingText:text,phrase:{tempo:tempoForScene(next),...next.input.phrase,notes:output}};
 if(omitted.length)warnings.push(`Vowel-only engine: omitted ${unique(omitted).join(', ')} consonants.`);
 if(approximated.length)warnings.push(`Approximate native shapes for ${unique(approximated).join(', ')}.`);
 if(score)validateSinsyMusicXml(sinsyScoreToMusicXml(next.input));
 else if(['singer','stk-voicform'].includes(next.engine)&&output.some((note,index)=>!note.rest&&(index<output.length-1?note.values.duration:note.values.duration+note.values.release)>30))throw new Error('The native musical renderer supports at most 30 seconds per note.');
 return {scene:validateScene(next),syllables:groups,notes:output,warnings:unique(warnings),reusedNotes:reused,addedSyllables:groups.length-reused,melismaNotes};
}
