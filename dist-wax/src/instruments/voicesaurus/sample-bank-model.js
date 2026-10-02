import { VOCALZOID_OPEN_BANKS } from '../vocalzoid/vocalzoid-open-banks.js';

const numeric=(label,min,max,step,value,unit='')=>({label,min,max,step,default:value,unit});
export const SAMPLE_BANK_CONTROLS=Object.freeze({
 pitch:numeric('Pitch',65.406,1046.5,.01,261.625565,'Hz'),
 duration:numeric('Duration',.05,8,.01,.6,'s'),
 vibratoCents:numeric('Vibrato depth',0,100,1,22,'ct'),
 vibratoRate:numeric('Vibrato rate',2,9,.1,5.2,'Hz'),
 glideMs:numeric('Pitch glide',0,260,1,65,'ms'),
 rootMidi:numeric('Fallback sample pitch',24,96,1,60,'MIDI'),
 style:{label:'KAL source color',choices:['raw','glass','velvet'],default:'raw'},
});
export const sampleBankDefaults=()=>Object.fromEntries(Object.entries(SAMPLE_BANK_CONTROLS).map(([key,rule])=>[key,rule.default]));
const defaultInput={source:'kal',openBankId:'air',lyric:'vo',phones:['V','OW'],alias:''};
function demo(bank){
 const root=bank?.rootMidi??60;
 return {source:bank?'open':'kal',openBankId:bank?.id??'air',singingText:'vocalzoid',phrase:{tempo:108,notes:[
  {lyric:'vo',phones:['V','OW'],midi:root,duration:1},
  {lyric:'cal',phones:['K','AH','L'],midi:root+4,duration:1},
  {lyric:'zoid',phones:['Z','OY','D'],midi:root+7,duration:2},
 ].map(note=>({rest:false,input:{lyric:note.lyric,phones:note.phones,alias:''},values:{...sampleBankDefaults(),pitch:440*2**((note.midi-69)/12),duration:note.duration*60/108,rootMidi:root}}))}};
}
const soundDemos=[
 ['straight','Straight tone',{vibratoCents:0,glideMs:0}],
 ['slow','Slow vibrato',{vibratoCents:40,vibratoRate:2}],
 ['fast','Fast vibrato',{vibratoCents:32,vibratoRate:9}],
 ['wide','Wide vibrato',{vibratoCents:90,vibratoRate:4}],
 ['glide','Sliding notes',{glideMs:250,vibratoCents:0}],
 ['glass','Glass color',{style:'glass'}],
 ['velvet','Velvet color',{style:'velvet'}],
].map(([id,label,values])=>{
 const input=demo();for(const note of input.phrase.notes)Object.assign(note.values,values);
 return {id:`sample-bank-${id}`,label,values,input};
});
export const SAMPLE_BANK_METHOD=Object.freeze({
 name:'Sample-bank singing · UTAU folders',family:'Sample concatenation',mode:'note',
 date:'2008 UTAU format · 2001 KAL source',source:'https://github.com/stakira/OpenUtau/wiki',
 history:'Classic UTAU appeared in 2008. This browser sample player reads its OTO timing data; it is not an OpenUtau or Vocaloid engine. The built-in KAL16 atlas derives from Flite (2001).',
 detail:'Retuned samples with looped vowel tails and crossfades. Choose an open demo, KAL16, or an extracted classic UTAU folder. Proprietary Vocaloid libraries are not supported.',
 controls:SAMPLE_BANK_CONTROLS,defaultInput,
 presets:[{id:'sample-bank-kal',label:'KAL16 · vocalzoid',input:demo()},...Object.values(VOCALZOID_OPEN_BANKS).map(bank=>({id:`sample-bank-${bank.id}`,label:`${bank.name} · vocalzoid`,input:demo(bank)})),...soundDemos],
});
export function validateSampleBankInput(input){
 if(!['kal','open','local'].includes(input.source))throw new TypeError('Choose a sample source.');
 if(input.source==='open'&&!VOCALZOID_OPEN_BANKS[input.openBankId])throw new TypeError('Unknown bundled demo voice.');
}
export function validateSampleBankNote(input){
 if(typeof input.lyric!=='string'||typeof input.alias!=='string'||!Array.isArray(input.phones)||input.phones.some(phone=>typeof phone!=='string'))throw new TypeError('A sample note needs a lyric, phone list, and optional exact alias.');
 if(input.lyric.length>1000||input.alias.length>1000||input.phones.length>100)throw new RangeError('The sample note exceeds its text budget.');
}
/** Map sequential timeline slots to the existing sample scheduler without clipping pitch. */
export function sampleBankRequest(scene,bank){
 validateSampleBankInput(scene.input);
 const tempo=scene.input.phrase?.tempo??120;
 const notes=scene.input.phrase?.notes??[{rest:false,input:scene.input,values:scene.values}];
 let start=0;
 const mapped=notes.map((note,index)=>{
  const duration=note.values.duration*tempo/60,at=start;start+=duration;
  validateSampleBankNote(note.input);
  if(note.rest)return null;
  if(!(note.values.pitch>0))throw new RangeError('Sample playback needs a positive frequency.');
  return {...note.input,...note.values,id:`bank-${index}`,midi:69+12*Math.log2(note.values.pitch/440),start:at,duration};
 }).filter(Boolean);
 return {notes:mapped,bpm:tempo,source:scene.input.source,openBankId:scene.input.openBankId,bank,...scene.values,scoreBeats:start};
}
